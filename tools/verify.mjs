//  전체 회귀 검사 — 로직(Node) + 화면(Chrome) 을 한 번에 돌린다.
//
//    사용:  node tools/verify.mjs [판수]        기본 150판/직업
//
//  로직 검사는 DOM 없이 규칙만 돌린다(던전 연결성 · 예외 · 직업별 밸런스).
//  화면 검사는 tools/check.mjs 를 폭별로 돌린다.
//  ⚠ 둘 다 필요하다 — 로직이 맞아도 캔버스가 0px 일 수 있고,
//    화면이 멀쩡해도 경험치가 NaN 일 수 있다(실제로 둘 다 났다).

import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS = path.join(ROOT, "public", "js");
const N = parseInt(process.argv[2] || "150", 10);

function loadRules() {
  const win = {};
  const ctx = vm.createContext({ window: win, Math, console, Uint8Array, Int32Array });
  /* sound.js 는 DOM·WebAudio 를 쓰므로 여기서는 안 올린다 —
   * game.js 가 `if (global.SFX)` 로 감싸 두어 없어도 돈다(그러라고 감쌌다). */
  for (const f of ["data.js", "dungeon.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  }
  return win;
}

const DIRS = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];
let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };

const W = loadRules();
const { Game, DUNGEON: D, DATA, josa } = W;

console.log("── 로직 ──");

// 1) 문법
let synBad = 0;
for (const f of fs.readdirSync(JS)) {
  const r = spawnSync(process.execPath, ["--check", path.join(JS, f)], { encoding: "utf8" });
  if (r.status !== 0) { console.log("   ✘ " + f + ": " + r.stderr.split("\n")[0]); synBad++; }
}
console.log("문법        :", ok(synBad === 0), fs.readdirSync(JS).length + "개 파일");

// 2) 던전 연결성 — 시작점에서 계단까지 걸어갈 수 있는가
//    ⚠ 보물방을 문으로 둘러싼 뒤에도 성립해야 한다(벽으로 막으면 아이템이 영영 안 닿는다).
let unreachable = 0, treasureSealed = 0, treasureCount = 0;
for (let s = 1; s <= 200; s++) {
  for (let depth = 1; depth <= DATA.MAX_DEPTH; depth++) {
    const lv = D.generate(62, 38, depth, (s * 2654435761 + depth) >>> 0);
    const seen = new Uint8Array(lv.w * lv.h);
    const q = [lv.upAt.y * lv.w + lv.upAt.x];
    seen[q[0]] = 1;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++], cx = cur % lv.w, cy = (cur / lv.w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
        const id = ny * lv.w + nx;
        if (seen[id]) continue;
        seen[id] = 1; q.push(id);
      }
    }
    if (!seen[lv.downAt.y * lv.w + lv.downAt.x]) unreachable++;
    if (lv.treasure) {
      treasureCount++;
      const t = lv.treasure;
      let reach = false;
      for (let y = t.y; y < t.y + t.h && !reach; y++)
        for (let x = t.x; x < t.x + t.w; x++)
          if (seen[y * lv.w + x]) { reach = true; break; }
      if (!reach) treasureSealed++;
    }
  }
}
console.log("던전 연결성 :", ok(unreachable === 0), 200 * DATA.MAX_DEPTH + "개 층 · 계단 못 가는 층 " + unreachable + "개");
console.log("보물방      :", ok(treasureSealed === 0),
  treasureCount + "개 생성 · 들어갈 수 없는 방 " + treasureSealed + "개");

// 3) 조사 — 받침 판정
const JOSA = [["굶주린 쥐","를"],["고블린","을"],["해골 병사","를"],["오크 전사","를"],["망령","을"],
              ["동굴 트롤","을"],["심연의 군주","를"],["치유 물약","을"],["단검","을"],["전투 도끼","를"],
              ["붉은 물약","을"],["금화 10","을"],["금화 22","를"],["금화 45","를"],["금화 9","를"]];
const badJosa = JOSA.filter(([w, want]) => josa(w, "을", "를").slice(w.length) !== want);
console.log("한국어 조사 :", ok(badJosa.length === 0),
  JOSA.length + "건 중 틀림 " + badJosa.length + (badJosa.length ? " — " + badJosa.map(b => b[0]).join(", ") : ""));

// 4) 화면에 나갈 문구에 마크다운 기호가 섞이지 않았는가
//    ⚠ data.js 의 설명은 HTML 로 그대로 들어간다. `**강조**` 를 적으면 별표가 그대로 보인다.
const dataSrc = fs.readFileSync(path.join(JS, "data.js"), "utf8");
const strayMd = (dataSrc.match(/["'][^"'\n]*\*\*[^"'\n]*["']/g) || []).length;
console.log("문구        :", ok(strayMd === 0), strayMd ? "마크다운 기호 " + strayMd + "건" : "마크다운 기호 없음");

// 5) 직업이 서로 다른가 — 같으면 고를 이유가 없다
const seenAb = {};
let dupAb = 0;
for (const c of DATA.CLASSES) { if (seenAb[c.ability.kind]) dupAb++; seenAb[c.ability.kind] = 1; }
console.log("직업 구분   :", ok(DATA.CLASSES.length >= 3 && dupAb === 0),
  DATA.CLASSES.map(c => c.name + "(" + c.ability.name + ")").join(" · "));

// 6) 미식별 물약 — 겉모습이 겹치지 않는가
const g0 = new Game("warrior");
const potions = DATA.ITEMS.filter(i => i.kind === "potion");
const labels = new Set(potions.map(p => g0.potionLook[p.id] && g0.potionLook[p.id].label));
console.log("미식별 물약 :", ok(labels.size === potions.length && DATA.POTION_LOOKS.length >= potions.length),
  potions.length + "종 · 서로 다른 겉모습 " + labels.size + "개 · 색 후보 " + DATA.POTION_LOOKS.length + "개");

// 7) 경험치·레벨이 정말 오르는가 (한 번 NaN 으로 죽어 있던 자리다)
const lvlG = new Game("warrior");
lvlG.gainXp(1000);
console.log("레벨업      :", ok(lvlG.player.level > 1 && !isNaN(lvlG.player.xp)),
  "경험 " + lvlG.player.xp + " → 레벨 " + lvlG.player.level + " · 공격 " + lvlG.power() + " · 체력 " + lvlG.player.maxhp);

// 7-b) 직업 능력 — 피해가 들어가고 쿨이 걸리고 다시 풀리는가.
//      ⚠ 화면에서는 "버튼이 보인다" 까지만 확인된다. 1층엔 붙을 적이 없어서
//        브라우저 검사만으로는 쿨다운이 도는지 알 수 없다 — 여기서 못박는다.
const abRows = [];
for (const c of DATA.CLASSES) {
  const g = new Game(c.id);
  g.reset(4242, c.id);
  /* 옆 칸에 적을 하나 세운다 — 능력마다 사거리가 달라 인접이 가장 확실하다 */
  const mdef = DATA.byId(DATA.MONSTERS, "goblin");
  const target = g.spawn(mdef, g.player.x + 1, g.player.y);
  target.hp = 9999; target.maxhp = 9999;   /* 한 방에 죽으면 피해량을 못 읽는다 */
  g.monsters = [target];
  const hp0 = target.hp;
  const used = g.useAbility();
  const dealt = hp0 - target.hp;
  const cdSet = g.player.cooldown;
  const blocked = g.useAbility() === false;          /* 쿨 중에는 거절돼야 한다 */
  /* ⚠ 쿨이 도는지 보려면 적을 치워야 한다. 옆에 세워 둔 채 쉬게 했더니
   *   체력 36인 마법사가 8턴 안에 맞아 죽어 `act()` 가 멈췄고, 검사가
   *   "쿨다운이 안 풀린다" 로 나왔다 — 제품이 아니라 검사의 결함이었다. */
  g.monsters = [];
  for (let i = 0; i < c.ability.cd + 1 && !g.over; i++) g.wait();
  const recovered = g.player.cooldown === 0 && !g.over;
  abRows.push({ name: c.name, ab: c.ability.name, used, dealt, cdSet, blocked, recovered });
}
const abBad = abRows.filter(r => !(r.used && r.dealt > 0 && r.cdSet > 0 && r.blocked && r.recovered));
console.log("직업 능력   :", ok(abBad.length === 0),
  abRows.map(r => r.name + " " + r.ab + " " + r.dealt + "피해/쿨" + r.cdSet).join(" · "));
if (abBad.length) abBad.forEach(r => console.log("   ✘ " + r.name + " " + JSON.stringify(r)));

// 7-c) 함정 — 밟으면 피해를 주고 드러난 채 남는가(두 번 터지지 않는가)
{
  const g = new Game("warrior");
  g.reset(777, "warrior");
  const lv = g.level;
  const tx = g.player.x + 1, ty = g.player.y;
  lv.traps[lv.idx(tx, ty)] = 1;
  g.cls = Object.assign({}, g.cls, { evade: 0 });     /* 회피로 흐려지면 못 잰다 */
  const hp0 = g.player.hp;
  g.move(1, 0);
  const hurt = hp0 - g.player.hp;
  const revealed = lv.traps[lv.idx(tx, ty)] === 2;
  const hp1 = g.player.hp;
  g.move(-1, 0); g.move(1, 0);                        /* 같은 칸을 다시 밟는다 */
  const twice = g.player.hp < hp1 - 1;                /* 몬스터 피해와 섞이지 않게 여유 */
  console.log("함정        :", ok(hurt > 0 && revealed && !twice),
    hurt + " 피해 · " + (revealed ? "드러남" : "숨은 채") + " · 재발동 " + (twice ? "있음" : "없음"));
}

// 7-d) 보물방 — 아이템이 실제로 안에 들어 있는가(문만 있고 비어 있으면 허탕이다)
{
  let rooms = 0, withItems = 0, withGuards = 0;
  for (let s = 1; s <= 120 && rooms < 40; s++) {
    const g = new Game("warrior");
    g.reset(s * 1013904223, "warrior");
    for (let d = 1; d < DATA.MAX_DEPTH && rooms < 40; d++) {
      const tr = g.level.treasure;
      if (tr) {
        rooms++;
        const inBox = (o) => o.x >= tr.x && o.x < tr.x + tr.w && o.y >= tr.y && o.y < tr.y + tr.h;
        if (g.items.filter(inBox).length >= DATA.TREASURE_ITEMS) withItems++;
        if (g.monsters.filter(inBox).length >= 1) withGuards++;
      }
      g.descend();
    }
  }
  console.log("보물방 내용 :", ok(rooms > 0 && withItems === rooms && withGuards === rooms),
    rooms + "개 중 아이템 다 든 방 " + withItems + " · 지키는 적 있는 방 " + withGuards);
}

// 7-e) 미식별 물약 — 마시기 전엔 겉모습, 마신 뒤엔 본명
{
  const g = new Game("warrior");
  g.reset(31337, "warrior");
  const def = DATA.byId(DATA.ITEMS, "heal_s");
  const it = g.makeItem(def, 0, 0);
  g.player.inventory = [it];
  g.player.hp = 1;
  const nameBefore = g.itemName(it);
  const descBefore = g.itemDesc(it);
  g.useItem(0);
  const nameAfter = g.itemName(it);
  console.log("물약 식별   :", ok(nameBefore !== def.name && nameAfter === def.name && /모른다/.test(descBefore)),
    "\"" + nameBefore + "\" → 마신 뒤 \"" + nameAfter + "\"");
}

// 8) 무작위 조작 내구 — 예외 0 (직업을 돌려 가며)
let crashes = 0;
const CLS = DATA.CLASSES.map(c => c.id);
for (let run = 0; run < 120; run++) {
  try {
    const g = new Game(CLS[run % CLS.length]);
    g.reset((run * 7919 + 13) >>> 0, CLS[run % CLS.length]);
    for (let t = 0; t < 1200 && !g.over; t++) {
      const r = Math.random();
      if (r < 0.05) g.pickUp();
      else if (r < 0.09) g.descendIfStairs();
      else if (r < 0.13) g.useAbility();
      else if (r < 0.17 && g.player.inventory.length) g.useItem((Math.random() * g.player.inventory.length) | 0);
      else { const d = DIRS[(Math.random() * 8) | 0]; g.move(d[0], d[1]); }
    }
  } catch (e) { crashes++; if (crashes < 3) console.log("   예외:", e.message); }
}
console.log("무작위 내구 :", ok(crashes === 0), "120판 · 예외 " + crashes + "건");

// 9) 밸런스 — 층을 정리하고 내려가는 AI 의 직업별 승률
function bfsStep(g, sx, sy, targets) {
  const lv = g.level, Wd = lv.w;
  const goal = new Set(targets.map(t => t.y * Wd + t.x));
  if (!goal.size) return null;
  const prev = new Int32Array(lv.w * lv.h).fill(-1);
  const start = sy * Wd + sx;
  prev[start] = start;
  const q = [start]; let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (goal.has(cur) && cur !== start) {
      let n = cur; while (prev[n] !== start) n = prev[n];
      return [(n % Wd) - sx, ((n / Wd) | 0) - sy];
    }
    const cx = cur % Wd, cy = (cur / Wd) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
      const id = ny * Wd + nx;
      if (prev[id] !== -1) continue;
      prev[id] = cur; q.push(id);
    }
  }
  return null;
}

/* 사람과 맞추려고 넣은 것:
 *   · 모르는 물약은 **안전할 때만** 마셔 본다(체력 80% 이상 · 보이는 적 없음). 독이 섞여 있다.
 *   · 정체를 안 뒤에는 회복만 아껴 둔다.
 *   · 직업 능력은 쿨이 돌면 쓴다 — 안 쓰면 직업을 고른 의미가 없다. */
function play(seed, clsId) {
  const g = new Game(clsId);
  g.reset(seed, clsId);
  const inv = pred => g.player.inventory.findIndex(pred);
  const skip = new Set();
  let t = 0, stuck = 0;

  while (!g.over && t < 60000) {
    t++;
    const p = g.player, lv = g.level, hurt = p.hp / p.maxhp;

    let adj = null;
    for (const d of DIRS) { const m = g.monsterAt(p.x + d[0], p.y + d[1]); if (m) { adj = { d, m }; break; } }
    const near = g.nearestVisible();

    if (hurt < 0.45) {
      let i = inv(it => g.identified[it.id] && it.effect === "heal" && it.power >= 50);
      if (i < 0 || hurt > 0.25) { const j = inv(it => g.identified[it.id] && it.effect === "heal"); if (j >= 0) i = j; }
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (p.cooldown <= 0) {
      const ab = g.cls.ability;
      let worth = false;
      if (ab.kind === "cleave") worth = !!adj;
      else if (ab.kind === "throw") worth = near && (Math.abs(near.x - p.x) + Math.abs(near.y - p.y)) <= ab.range;
      else if (ab.kind === "blast") worth = g.monsters.some(m =>
        Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= ab.range);
      if (worth && g.useAbility()) continue;
    }

    if (hurt < 0.35 && adj) {
      let i = inv(it => it.effect === "fire");
      if (i < 0) i = inv(it => it.effect === "bolt");
      if (i < 0 && hurt < 0.2) i = inv(it => it.effect === "blink");
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (adj) { g.move(adj.d[0], adj.d[1]); continue; }

    if (hurt > 0.8 && !g.monsters.some(m => g.isVisible(m.x, m.y))) {
      const i = inv(it => it.kind === "potion" && !g.identified[it.id]);
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (g.itemAt(p.x, p.y)) {
      if (p.inventory.length >= 16) skip.add(g.depth + ":" + p.x + "," + p.y);
      else { g.pickUp(); continue; }
    }

    const key = it => g.depth + ":" + it.x + "," + it.y;
    const desperate = hurt < 0.3 && inv(it => g.identified[it.id] && it.effect === "heal") < 0;
    let goals, toStairs = false;
    if (desperate && g.depth < DATA.MAX_DEPTH) { goals = [lv.downAt]; toStairs = true; }
    else if (g.items.some(it => !skip.has(key(it)))) goals = g.items.filter(it => !skip.has(key(it)));
    else if (g.monsters.length) goals = g.monsters;
    else { goals = [lv.downAt]; toStairs = true; }
    if (toStairs && lv.at(p.x, p.y) === D.STAIRS) { if (g.descendIfStairs()) { stuck = 0; continue; } }

    const step = bfsStep(g, p.x, p.y, goals);
    if (!step) {
      const s2 = bfsStep(g, p.x, p.y, [lv.downAt]);
      if (s2) { g.move(s2[0], s2[1]); continue; }
      if (++stuck > 30) break;
      g.wait(); continue;
    }
    if (!g.move(step[0], step[1])) { if (++stuck > 30) break; g.wait(); } else stuck = 0;
  }
  return g;
}

//  기준: 직업마다 승률 35~65%. 이보다 높으면 긴장이 없고, 낮으면 사람은 못 깬다.
//  그리고 직업 사이 격차가 25%p 를 넘으면 안 된다 — 넘으면 "센 직업" 하나만 고르게 된다
//  (실측으로 잡은 사고: 도적이 200판 전승 100% 였다 — 레벨당 공격 +3 + 짧은 쿨 원거리).
console.log("\n── 밸런스 (층을 정리하고 내려가는 AI · " + N + "판/직업) ──");
const rates = [];
for (const c of DATA.CLASSES) {
  let wins = 0, unresolved = 0;
  const dd = {}, depths = [], scores = [];
  for (let i = 0; i < N; i++) {
    const g = play((i * 104729 + 7) >>> 0, c.id);
    depths.push(g.depth); scores.push(g.score());
    if (g.won) wins++;
    else if (g.over) dd[g.depth] = (dd[g.depth] || 0) + 1;
    else unresolved++;
  }
  const rate = wins / N * 100;
  rates.push(rate);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const pre = Object.keys(dd).filter(k => +k < DATA.MAX_DEPTH).reduce((a, k) => a + dd[k], 0);
  console.log(c.name.padEnd(9), ok(rate >= 35 && rate <= 65 && unresolved === 0),
    ("승률 " + rate.toFixed(1) + "%").padEnd(12) +
    "평균 " + avg(depths).toFixed(2) + "층 · 점수 " + Math.round(avg(scores)).toLocaleString() +
    " · 보스 전 사망 " + pre + " · 보스층 " + (dd[DATA.MAX_DEPTH] || 0) +
    (unresolved ? " · ⚠미결 " + unresolved : ""));
}
const gap = Math.max(...rates) - Math.min(...rates);
console.log("직업 격차   :", ok(gap <= 25), gap.toFixed(1) + "%p (25%p 이하여야 한다)");

// ── 화면 ──
console.log("\n── 화면 (실제 Chrome) ──");
const SCREENS = [
  ["데스크톱 1440×900", ["--w", "1440", "--h", "900"]],
  ["노트북 1280×720", ["--w", "1280", "--h", "720"]],
  ["아이폰 390×844", ["--touch", "--w", "390", "--h", "844"]],
  ["태블릿 820×1180", ["--touch", "--w", "820", "--h", "1180"]],
  ["도적 1440×900", ["--cls", "rogue", "--w", "1440", "--h", "900"]],
  ["마법사 1440×900", ["--cls", "mage", "--w", "1440", "--h", "900"]]
];
for (const [label, args] of SCREENS) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "check.mjs"), ...args],
    { encoding: "utf8", cwd: ROOT });
  const bad = (r.stdout.match(/✘/g) || []).length;
  console.log(label.padEnd(20), ok(r.status === 0), bad ? "문제 " + bad + "건" : "통과");
  if (bad) r.stdout.split("\n").filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 한 판을 끝까지 밟는다(종료 화면)
const rp = spawnSync(process.execPath, [path.join(ROOT, "tools", "check.mjs"), "--play"],
  { encoding: "utf8", cwd: ROOT });
const endLine = rp.stdout.split("\n").find(l => l.includes("끝까지 진행")) || "";
console.log("끝까지 한 판".padEnd(20), ok(rp.status === 0), endLine.replace(/.*끝까지 진행\s*:\s*/, "").trim());

console.log(fails === 0 ? "\n전부 통과" : "\n✘ 실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
