/* 몬스터 행동이 실제로 도는가 — 속도 · 원거리 · 도망 · 소환.
 *
 *   사용:  node tools/mob-check.mjs [턴수]        기본 100턴
 *
 * ⚠ 수치가 아니라 **행동**을 잰다. "표에 spd: 150 이라고 적혀 있다" 는 통과가
 *   아니다. 100턴 세워 두고 몇 대 맞는지를 세야 속도가 도는지 알 수 있다.
 * ⚠ 판은 tools/arena.mjs 가 만든다. kite-check 와 **같은 판**이어야 한다 —
 *   두 벌로 두면 한쪽에서만 재현되는 결과가 나온다.
 */
import { loadRules, makeArena, stand } from "./arena.mjs";

const TURNS = parseInt(process.argv[2] || "100", 10);
const W = loadRules();
const { DATA } = W;

let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };
const row = (n, good, note) => console.log(n.padEnd(14), ok(good), note);
const dist = (a) => Math.abs(a.m.x - a.g.player.x) + Math.abs(a.m.y - a.g.player.y);

console.log("── 몬스터 행동 ──");

/* ① 속도 — 에너지가 실제로 도는가. 대조군은 같은 자리의 보통 속도다. */
{
  const rows = [];
  for (const mon of ["orc", "wraith"]) {
    const a = makeArena(W, { mon: mon });
    if (!a) { rows.push({ mon: mon, bad: "판을 못 만들었다" }); continue; }
    stand(a, TURNS);
    const spd = a.def.spd || 100;
    const want = Math.floor(TURNS * spd / 100);
    rows.push({ mon: mon, name: a.def.name, spd: spd, hit: a.swings(), want: want });
  }
  for (const r of rows) {
    if (r.bad) { row("속도 " + r.mon, false, r.bad); continue; }
    /* 에너지가 깔끔하게 나누어떨어지므로 오차를 2 로 둔다 */
    row("속도 " + r.spd, Math.abs(r.hit - r.want) <= 2,
      r.name + " · " + TURNS + "턴에 " + r.hit + "대 (기대 " + r.want + ")");
  }
  const orc = rows.find(r => r.mon === "orc"), wr = rows.find(r => r.mon === "wraith");
  row("빠른 놈", !!(orc && wr) && wr.hit > orc.hit * 1.3,
    orc && wr ? "보통 " + orc.hit + "대 vs 빠른 놈 " + wr.hit + "대" : "못 쟀다");
}

/* ② 원거리 — **붙지 않고** 때리는가. 그리고 사거리 밖에서는 안 쏘는가. */
{
  const def = DATA.byId(DATA.MONSTERS, "slinger");
  const R = def.ranged;
  const a = makeArena(W, { mon: "slinger", at: R });
  if (!a) row("원거리", false, "판을 못 만들었다");
  else {
    stand(a, 12);
    /* ⚠ "맞았다" 만 보면 걸어와서 때린 것과 구별이 안 된다. **끝났을 때 거리**를
     *   함께 본다 — 멀리 선 채로 때렸어야 원거리다. */
    row("원거리", a.swings() > 0 && dist(a) > 1,
      def.name + " 사거리 " + R + " · " + R + "칸에서 12턴 → " + a.swings() +
      "대 · 끝났을 때 거리 " + dist(a));
  }

  const far = makeArena(W, { mon: "slinger", at: R + 3 });
  if (far) {
    const d0 = dist(far);
    stand(far, 2);                    /* 두 턴이면 사거리 안으로 못 들어온다 */
    row("사거리 밖", far.swings() === 0,
      (R + 3) + "칸(사거리 " + R + ") 에서 두 턴 → " + far.swings() + "대 (0 이어야 한다) · 거리 " +
      d0 + " → " + dist(far));
  }
}

/* ③ 도망 — 물러나되 **끝이 있는가**.
 * ⚠ 이것이 이 기능에서 제일 위험한 자리다. 끝없이 달아나게 뒀더니 같은 속도라
 *   걸어서는 못 잡아 시뮬 120판 중 55판이 결판이 안 났다. */
{
  const a = makeArena(W, { mon: "goblin", monHp: 100, runLeft: 12, at: 1 });
  if (!a) row("도망", false, "판을 못 만들었다");
  else {
    a.m.hp = 5;                        /* timid 0.25 밑으로 — 등을 돌릴 체력 */
    const d0 = dist(a);
    let peak = d0, turned = -1;
    for (let i = 0; i < 20; i++) {
      stand(a, 1);
      const d = dist(a);
      if (d > peak) peak = d;
      if (turned < 0 && a.swings() > 0) turned = i + 1;   /* 다시 물기 시작한 턴 */
    }
    row("도망", peak > d0, "거리 " + d0 + " → 최대 " + peak);
    row("도망의 끝", turned > 0 && turned <= 15,
      turned > 0 ? turned + "턴째에 돌아서서 물었다 (15턴 안이어야 한다)"
                 : "✘ 20턴 내내 안 돌아섰다 — 영영 못 잡는다");
  }
}

/* ④ 소환 — 부르되 상한을 지키는가 */
{
  const a = makeArena(W, { mon: "lord", at: 2, depth: 10 });
  if (!a) row("소환", false, "판을 못 만들었다");
  else {
    const cap = a.def.summon.max;
    let peak = 0;
    for (let i = 0; i < 40; i++) { stand(a, 1); peak = Math.max(peak, a.g.monsters.length - 1); }
    row("소환", peak > 0, a.def.name + " · 40턴에 최대 " + peak + "마리 불러냈다");
    row("소환 상한", peak <= cap, "상한 " + cap + " · 실측 최대 " + peak);
  }
}

/* ⑤ 말도 안 되는 속도로도 안 멈추는가 — MAX_ACTS 가 지키는 자리 */
{
  const a = makeArena(W, { mon: "orc" });
  if (a) {
    a.m.spd = 100000;
    const t0 = Date.now();
    stand(a, 30);
    const ms = Date.now() - t0;
    row("속도 폭주", ms < 3000 && a.swings() <= 30 * 3,
      "spd 100000 으로 30턴 · " + ms + "ms · " + a.swings() + "대 (턴당 3대 이하)");
  }
}

console.log(fails === 0 ? "\n전부 통과" : "\n✘ " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
