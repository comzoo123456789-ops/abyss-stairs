//  붙었다 떨어지는 춤 — 0 피해로 쿨다운을 돌릴 수 있는가.
//
//    사용:  node tools/kite-check.mjs [턴수]        기본 100턴
//
//  ⚠ 이 검사가 있는 이유. 이동이 4방향이라 **대각선에 선 몬스터는 못 때린다**
//    (`stepMonster` 의 근접 판정이 맨해튼 1 이다). 그리고 몬스터의 한 턴은
//    "때리거나 걷거나" 둘 중 하나다. 그래서 붙어 있는 적 앞에서 위아래로만
//    오가면, 몬스터는 매 턴 다시 붙는 데에만 턴을 쓰고 영영 못 때린다.
//    그동안 쿨다운은 턴마다 줄어든다 — 시간이 공짜라 스킬이 공짜가 된다.
//
//  대조군을 함께 잰다. 같은 자리에서 **가만히 있으면** 얼마나 맞는지 재지 않으면
//  "춤추면 0 피해" 라는 숫자가 큰지 작은지 알 수 없다.

import { loadRules, makeArena, stand } from "./arena.mjs";

const TURNS = parseInt(process.argv[2] || "100", 10);

const W = loadRules();
const { Game, DUNGEON: D, DATA } = W;

let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };

/* 판은 tools/arena.mjs 가 만든다 — mob-check 와 **같은 판**이어야 한다 */
function arena(seed, runLeft, mon) {
  return makeArena(W, { seed: seed, runLeft: runLeft, mon: mon });
}

/* 춤 — 위아래로만 오간다. 사람이 방향키 두 개로 하는 그것이다. */
function dance(a, turns) {
  const t0 = a.g.turn;
  for (let i = 0; i < turns && !a.g.over; i++) {
    if (!a.g.move(0, i % 2 === 0 ? -1 : 1)) a.g.wait();
  }
  return a.g.turn - t0;
}

console.log("── 붙었다 떨어지는 춤 (" + TURNS + "턴) ──");

const SEEDS = [31337, 555, 4242, 9001, 62];
let danceHit = 0, danceDmg = 0, standHit = 0, standDmg = 0, rounds = 0;

for (const seed of SEEDS) {
  const a = arena(seed), b = arena(seed);
  if (!a || !b) continue;
  rounds++;
  dance(a, TURNS);
  stand(b, TURNS);
  danceHit += a.swings(); danceDmg += a.hp0 - a.g.player.hp;
  standHit += b.swings(); standDmg += b.hp0 - b.g.player.hp;
}

const perDance = (danceHit / rounds).toFixed(1), perStand = (standHit / rounds).toFixed(1);
console.log("가만히 서 있기 :", rounds + "판 · 몬스터 공격 " + perStand + "회/판 · 받은 피해 " +
  (standDmg / rounds).toFixed(1));
console.log("위아래 춤      :", rounds + "판 · 몬스터 공격 " + perDance + "회/판 · 받은 피해 " +
  (danceDmg / rounds).toFixed(1));

/* 춤이 공짜면 안 된다. 가만히 있는 것의 **절반**은 맞아야 거래가 성립한다 —
 * 0 이면 쿨다운이 그냥 공짜다. */
const free = danceHit === 0;
console.log("춤이 공짜인가  :", ok(!free), free ? "✘ 0 피해로 무한정 버틴다" :
  "맞으면서만 버틴다 (서 있기의 " + ((danceHit / Math.max(standHit, 1)) * 100).toFixed(0) + "%)");

/* 쿨다운이 실제로 몇 바퀴 도는지 — 이것이 이 구멍의 값어치다 */
{
  const a = arena(31337);
  a.g.player.skills = [{ id: DATA.SKILLS[0].id, rank: 1, cd: 0 }];
  let casts = 0;
  for (let i = 0; i < TURNS && !a.g.over; i++) {
    if (a.g.player.skills[0].cd === 0 && a.g.useSkill(0) !== false) { casts++; continue; }
    if (!a.g.move(0, i % 2 === 0 ? -1 : 1)) a.g.wait();
  }
  console.log("춤추며 스킬    :", TURNS + "턴에 " + casts + "번 · 받은 피해 " +
    (a.hp0 - a.g.player.hp) + " · 몬스터 공격 " + a.swings() + "회");
}

/* 도망 — 한 방향으로 걸어서 떼어놓을 수 있는가, 얼마를 내는가.
 *
 * ⚠ 밸런스 시뮬(verify.mjs)은 이 값을 못 잰다. 그 AI 는 붙으면 반드시 때리고
 *   **물러나는 일이 없다** — 기회 공격을 넣기 전후로 360판 결과가 소수점까지
 *   같았다. 사람은 물러난다. 그래서 여기서 따로 잰다. */
{
  let a = null;
  for (const seed of [31337, 555, 4242, 9001, 62, 7, 77, 777]) {
    a = arena(seed, 10);
    if (a) break;
  }
  if (a) {
    const lv = a.g.level;
    let steps = 0, blocked = false;
    const before = a.swings();
    for (let i = 0; i < 12; i++) {
      const nx = a.g.player.x - 1, ny = a.g.player.y;
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny) || lv.traps[lv.idx(nx, ny)] !== 0) { blocked = true; break; }
      if (!a.g.move(-1, 0)) { blocked = true; break; }
      steps++;
      if (a.g.over) break;
    }
    const hits = a.swings() - before;
    const gap = Math.abs(a.m.x - a.g.player.x) + Math.abs(a.m.y - a.g.player.y);
    console.log("등 돌려 도망   :", steps + "칸" + (blocked ? " (길이 막혀 멈춤)" : "") +
      " · 맞은 횟수 " + hits + " · 끝났을 때 거리 " + gap +
      " · 받은 피해 " + (a.hp0 - a.g.player.hp));
    /* 한 칸에 한 대까지. 싸우는 것과 같은 값이다 — 이보다 비싸면 도망이 사라진다. */
    console.log("도망 값        :", ok(steps === 0 || hits <= steps),
      steps === 0 ? "잴 자리 없음" : "한 칸당 " + (hits / steps).toFixed(2) + "대 (1.00 이하여야 한다)");
  }
}

/* 때리는 것은 물러나는 것이 아니다 — 적 쪽으로 move() 해도 기회 공격이 없어야 한다.
 * 붙은 적을 칠 때마다 한 대를 더 맞으면 근접 전투가 통째로 두 배가 된다. */
{
  const a = arena(555);
  if (a) {
    const before = a.swings();
    let turns = 0;
    for (let i = 0; i < 10 && !a.g.over; i++) { a.g.move(1, 0); turns++; }
    const hits = a.swings() - before;
    console.log("때릴 때        :", ok(hits <= turns),
      turns + "턴에 맞은 횟수 " + hits + " (턴수 이하여야 한다)");
  }
}

/* 빠른 몬스터 앞에서도 춤이 통하는가 — **기회 공격을 유지할지 정하는 자리다.**
 *
 * 기회 공격은 원거리도 속도도 없던 시절의 임시 처방이었다(NetHack·DCSS 에는
 * 기회 공격이 없다. 같은 속도 상대에게서 걸어 물러나면 안 맞는 것이 장르 표준이고,
 * 그 게임들이 괜찮은 이유는 **빠른 놈과 원거리 놈이 있어서**다).
 * 이제 망령이 spd 150 이다. 속도만으로 춤이 손해가 되면 기회 공격을 뺄 수 있다. */
{
  const noOp = Game.prototype.opportunity;
  function danceVs(mon, withOpp) {
    Game.prototype.opportunity = withOpp ? noOp : function () {};
    let hit = 0, dmg = 0, rounds = 0;
    for (const seed of SEEDS) {
      const a = arena(seed, 0, mon);
      if (!a) continue;
      rounds++;
      dance(a, TURNS);
      hit += a.swings(); dmg += a.hp0 - a.g.player.hp;
    }
    Game.prototype.opportunity = noOp;
    return { hit: hit / Math.max(1, rounds), dmg: dmg / Math.max(1, rounds) };
  }
  function standVs(mon) {
    let hit = 0, rounds = 0;
    for (const seed of SEEDS) {
      const b = arena(seed, 0, mon);
      if (!b) continue;
      rounds++;
      stand(b, TURNS);
      hit += b.swings();
    }
    return hit / Math.max(1, rounds);
  }

  for (const mon of ["orc", "wraith"]) {
    const spd = (DATA.byId(DATA.MONSTERS, mon).spd || 100);
    const st = standVs(mon);
    const off = danceVs(mon, false);
    const on = danceVs(mon, true);
    const pctOff = st ? (off.hit / st * 100) : 0;
    console.log(("속도 " + spd + " " + DATA.byId(DATA.MONSTERS, mon).name).padEnd(16) + ":",
      "서 있기 " + st.toFixed(0) + "대 · 춤(기회공격 없이) " + off.hit.toFixed(0) +
      "대(" + pctOff.toFixed(0) + "%) · 춤(있을 때) " + on.hit.toFixed(0) + "대");
  }
  console.log("읽는 법        : 기회 공격 없이도 춤이 서 있기에 가까우면 그 상대에게는 빼도 된다.");
}

console.log(fails === 0 ? "\n전부 통과" : "\n✘ " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
