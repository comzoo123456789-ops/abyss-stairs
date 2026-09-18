//  전체 회귀 검사 — 로직(Node) + 화면(Chrome) 을 한 번에 돌린다.
//
//    사용:  node tools/verify.mjs [판수]        기본 120판/직업
//
//  로직 검사는 DOM 없이 규칙만 돌린다(던전 · 아이템 굴림 · 치명타 · 상태이상 · 빌드).
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
const N = parseInt(process.argv[2] || "120", 10);

function loadRules() {
  const win = {};
  const ctx = vm.createContext({ window: win, Math, console, Uint8Array, Uint16Array, Int32Array });
  /* sound.js · sprites* 는 DOM 을 쓰므로 안 올린다 —
   * game.js 가 `if (global.SFX)` 로 감싸 두어 없어도 돈다(그러라고 감쌌다). */
  for (const f of ["data.js", "items.js", "dungeon.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  }
  return win;
}

//  ⚠ 이동이 4방향이 된 뒤로는 검사도 4방향이어야 한다. 8방향으로 두면 AI 가
//    사람이 갈 수 없는 길로 가서 승률이 실제보다 높게 나온다.
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };

const W = loadRules();
const { Game, DUNGEON: D, DATA, ITEMS, josa } = W;

console.log("── 로직 ──");

// 1) 문법
let synBad = 0;
for (const f of fs.readdirSync(JS)) {
  const r = spawnSync(process.execPath, ["--check", path.join(JS, f)], { encoding: "utf8" });
  if (r.status !== 0) { console.log("   ✘ " + f + ": " + r.stderr.split("\n")[0]); synBad++; }
}
console.log("문법        :", ok(synBad === 0), fs.readdirSync(JS).length + "개 파일");

// 2) 던전 연결성 + 보물방 진입 가능성
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

// 3) 조사
const JOSA = [["굶주린 쥐", "를"], ["고블린", "을"], ["해골 병사", "를"], ["오크 전사", "를"],
              ["망령", "을"], ["동굴 트롤", "을"], ["심연의 군주", "를"], ["치유 물약", "을"],
              ["붉은 물약", "을"], ["금화 10", "을"], ["금화 22", "를"], ["금화 9", "를"]];
const badJosa = JOSA.filter(([w, want]) => josa(w, "을", "를").slice(w.length) !== want);
console.log("한국어 조사 :", ok(badJosa.length === 0),
  JOSA.length + "건 중 틀림 " + badJosa.length + (badJosa.length ? " — " + badJosa.map(b => b[0]).join(", ") : ""));

// 4) 화면에 나갈 문구에 마크다운 기호가 섞이지 않았는가
//    ⚠ data.js 의 설명은 HTML 로 그대로 들어간다. `**강조**` 를 적으면 별표가 그대로 보인다.
const dataSrc = fs.readFileSync(path.join(JS, "data.js"), "utf8");
const strayMd = (dataSrc.match(/["'][^"'\n]*\*\*[^"'\n]*["']/g) || []).length;
console.log("문구        :", ok(strayMd === 0), strayMd ? "마크다운 기호 " + strayMd + "건" : "마크다운 기호 없음");

// 5) 아이템 굴림 — 등급·옵션·이름이 제대로 나오는가
{
  const g = new Game("warrior");
  g.reset(777, "warrior");
  const seenRar = {}, seenAffix = {}, seenKind = {};
  let badName = 0, noAffixOnRare = 0, total = 0;
  for (let depth = 1; depth <= 10; depth++) {
    for (let i = 0; i < 120; i++) {
      const it = ITEMS.makeGear(["weapon", "armor", "offhand"][i % 3], depth, g.rng);
      total++;
      seenRar[it.rarity] = (seenRar[it.rarity] || 0) + 1;
      if (it.weaponKind) seenKind[it.weaponKind] = 1;
      for (const a of it.affixes) seenAffix[a.id] = 1;
      /* 이름 — 빈 문자열이나 "undefined" 가 섞이면 안 된다 */
      if (!it.name || /undefined|NaN/.test(it.name)) badName++;
      /* 등급이 높은데 옵션이 안 붙으면 굴림이 죽은 것이다 */
      const want = DATA.byId(DATA.RARITY, it.rarity).affixes;
      if (it.affixes.length < want) noAffixOnRare++;
    }
  }
  const rarKinds = Object.keys(seenRar).length;
  console.log("아이템 굴림 :", ok(rarKinds === 4 && badName === 0 && noAffixOnRare === 0),
    total + "점 · 등급 " + rarKinds + "종 · 옵션 " + Object.keys(seenAffix).length + "/" + DATA.AFFIXES.length +
    "종 · 무기 " + Object.keys(seenKind).length + "/" + DATA.WEAPON_KINDS.length + "종" +
    (badName ? " · ⚠이름 오류 " + badName : "") + (noAffixOnRare ? " · ⚠옵션 누락 " + noAffixOnRare : ""));
}

// 6) 능력치 합산 — 옵션이 실제로 반영되는가(표시와 실제가 어긋나면 안 된다)
{
  const g = new Game("warrior");
  g.reset(2024, "warrior");
  const before = { atk: g.power(), def: g.guard(), crit: g.stats().crit, hp: g.maxhp() };
  /* 옵션을 강제로 붙인 장비를 만들어 착용 */
  /* ⚠ 무기 종류를 고정한다. 안 하면 굴려 나온 종류의 태생 옵션(검 +2% 치명 등)이
   *   섞여 "옵션 +25% 인데 +28% 올랐다" 로 나와 검사가 빨개진다(제품이 아니라 검사 결함). */
  const gear = ITEMS.makeGear("weapon", 5, g.rng,
    { affixes: 0, rarity: DATA.RARITY[0], weaponKind: g.cls.startWeapon.kind, tier: g.cls.startWeapon.tier });
  gear.affixes = [
    { id: "crit", stat: "crit", label: "치명타 확률", unit: "%", value: 0.25, pre: "날카로운", suf: "예리함의" },
    { id: "hp", stat: "hpFlat", label: "최대 체력", unit: "", value: 40, pre: "강인한", suf: "생명의" }
  ];
  g.player.inventory.push(gear);
  g.equip(gear, true);
  const after = { atk: g.power(), def: g.guard(), crit: g.stats().crit, hp: g.maxhp() };
  const critOk = Math.abs((after.crit - before.crit) - 0.25) < 0.001;
  const hpOk = (after.hp - before.hp) >= 40;
  console.log("옵션 반영   :", ok(critOk && hpOk),
    "치명 " + Math.round(before.crit * 100) + "% → " + Math.round(after.crit * 100) + "% · " +
    "최대체력 " + before.hp + " → " + after.hp);
}

// 7) 치명타 — 정말 터지고, 확률을 올리면 더 자주 터지는가
{
  const g = new Game("warrior");
  g.reset(31337, "warrior");
  function measure(chance) {
    g.player.perks = ITEMS.blank();
    g.player.perks.crit = chance - g.cls.base.crit;
    let crit = 0;
    for (let i = 0; i < 4000; i++) if (g.critRoll(1)) crit++;
    return crit / 4000;
  }
  const low = measure(0.05), high = measure(0.60);
  console.log("치명타      :", ok(low > 0.02 && low < 0.09 && high > 0.5),
    "확률 5% 설정 → 실측 " + (low * 100).toFixed(1) + "% · 60% 설정 → " + (high * 100).toFixed(1) + "%");
}

// 8) 상태이상 — 걸리고, 턴마다 깎이고, 끝나면 사라지는가
{
  const g = new Game("warrior");
  g.reset(555, "warrior");
  const m = g.spawn(DATA.byId(DATA.MONSTERS, "orc"), g.player.x + 5, g.player.y);
  m.hp = 9999; m.maxhp = 9999;
  g.monsters = [m];
  g.applyAil(m, "poison", 0);
  const hp0 = m.hp;
  let ticks = 0;
  for (let i = 0; i < 8; i++) { g.tickAil(m, false); if (m.hp < hp0) ticks++; }
  const gone = !m.ail.poison;
  console.log("상태이상    :", ok(hp0 - m.hp > 0 && gone),
    "중독 " + DATA.AILMENTS.poison.turns + "턴 · 총 " + (hp0 - m.hp) + " 피해 · 만료 " + (gone ? "됨" : "안 됨"));
}

// 9) 스킬 — 전부 동작하고 쿨이 걸리고 다시 풀리는가.
//    ⚠ 화면에서는 "버튼이 보인다" 까지만 확인된다 — 1층엔 붙을 적이 없다.
{
  const rows = [];
  for (const sk of DATA.SKILLS) {
    const g = new Game("warrior");
    g.reset(4242, "warrior");
    g.player.skills = [{ id: sk.id, rank: 1, cd: 0 }];
    /* 사거리 안에 적을 둔다. 근접 스킬은 옆 칸, 원거리는 세 칸 */
    const near = g.spawn(DATA.byId(DATA.MONSTERS, "goblin"), g.player.x + 1, g.player.y);
    const far = g.spawn(DATA.byId(DATA.MONSTERS, "goblin"), g.player.x + 3, g.player.y);
    near.hp = near.maxhp = 9999; far.hp = far.maxhp = 9999;
    g.monsters = [near, far];
    const hpBefore = g.player.hp, mhpBefore = near.hp + far.hp;
    const used = g.useSkill(0) !== false;
    const cdSet = g.player.skills[0].cd;
    const blocked = g.useSkill(0) === false;
    g.monsters = [];
    for (let i = 0; i < cdSet + 1 && !g.over; i++) g.wait();
    const recovered = g.player.skills[0].cd === 0 && !g.over;
    const didSomething = (near.hp + far.hp) < mhpBefore || g.player.hp !== hpBefore ||
                         g.player.ward > 0 || Object.keys(near.ail).length > 0;
    rows.push({ id: sk.id, name: sk.name, used, cdSet, blocked, recovered, didSomething });
  }
  const bad = rows.filter(r => !(r.used && r.cdSet > 0 && r.blocked && r.recovered && r.didSomething));
  console.log("스킬        :", ok(bad.length === 0),
    rows.length + "종 · " + rows.map(r => r.name).join(" · "));
  bad.forEach(r => console.log("   ✘ " + r.name + " " + JSON.stringify(r)));
}

// 10) 레벨업 선택 — 3개가 나오고, 고르면 실제로 반영되는가
{
  const g = new Game("warrior");
  g.reset(9001, "warrior");
  g.offerPerks();
  const count = g.pendingPerks ? g.pendingPerks.length : 0;
  /* ⚠ 일부 수치만 더해 비교하면 "금화 획득 +30%" 같은 선택에서 변화가 0 으로 나온다 —
   *   그것도 유효한 선택이므로 능력치 전체와 스킬 목록을 함께 본다. */
  const snap = () => JSON.stringify(g.stats()) + "|" + JSON.stringify(g.player.skills);
  const before = snap();
  g.choosePerk(0);
  const after = snap();
  const closed = !g.pendingPerks;
  console.log("레벨업 선택 :", ok(count === 3 && after !== before && closed),
    count + "개 제시 · 고른 뒤 변화 " + (after !== before ? "있음" : "없음") + " · 창 " + (closed ? "닫힘" : "⚠열림"));
}

// 11) 상점 — 물건이 차고, 사면 금화가 줄고 물건이 들어오는가
{
  const g = new Game("rogue");
  g.reset(4711, "rogue");
  g.depth = 4;
  const stock = g.rollShop(4);
  g.shop = stock;
  g.gold = 99999;
  const bagBefore = g.player.inventory.length, skillsBefore = g.player.skills.length;
  let boughtItem = false, boughtSkill = false;
  for (let i = 0; i < stock.length; i++) {
    const before = g.gold;
    if (g.buy(i) && g.gold < before) {
      if (stock[i].what === "skill") boughtSkill = true; else boughtItem = true;
    }
  }
  const sellBefore = g.gold;
  const sold = g.player.inventory.length ? g.sell(0) : false;
  console.log("상점        :", ok(stock.length >= 5 && boughtItem && g.gold > 0),
    stock.length + "개 진열 · 물건 구매 " + (boughtItem ? "됨" : "✘") +
    " · 스킬 구매 " + (boughtSkill ? "됨" : "없음(자리 부족일 수 있다)") +
    " · 팔기 " + (sold ? "됨(+" + (g.gold - sellBefore) + ")" : "✘") +
    " · 가방 " + bagBefore + "→" + g.player.inventory.length +
    " · 스킬 " + skillsBefore + "→" + g.player.skills.length);
}

// 12) 엘리트 — 나오고, 실제로 더 강한가
{
  const g = new Game("warrior");
  g.reset(1234, "warrior");
  let elites = 0, plain = 0, eliteHp = 0, plainHp = 0;
  for (let depth = 5; depth <= 9; depth++) {
    g.depth = depth;
    for (let i = 0; i < 400; i++) {
      const m = g.spawn(DATA.byId(DATA.MONSTERS, "orc"), 1, 1);
      if (m.elite) { elites++; eliteHp += m.hp; } else { plain++; plainHp += m.hp; }
    }
  }
  const ratio = (eliteHp / Math.max(1, elites)) / (plainHp / Math.max(1, plain));
  console.log("엘리트      :", ok(elites > 0 && ratio > 1.3),
    "2000마리 중 " + elites + "마리(" + (elites / 20).toFixed(1) + "%) · 체력 배수 " + ratio.toFixed(2) + "배");
}

// 13) 무작위 조작 내구 — 예외 0 (직업·스킬·상점을 돌려 가며)
{
  let crashes = 0;
  const CLS = DATA.CLASSES.map(c => c.id);
  for (let run = 0; run < 120; run++) {
    try {
      const g = new Game(CLS[run % CLS.length]);
      g.reset((run * 7919 + 13) >>> 0, CLS[run % CLS.length]);
      for (let t = 0; t < 1400 && !g.over; t++) {
        if (g.pendingPerks) { g.choosePerk((Math.random() * 3) | 0); continue; }
        if (g.shop) {
          if (Math.random() < 0.5) g.buy((Math.random() * g.shop.length) | 0);
          else g.closeShop();
          continue;
        }
        const r = Math.random();
        if (r < 0.05) g.pickUp();
        else if (r < 0.08) g.descendIfStairs();
        else if (r < 0.14) g.useSkill((Math.random() * 4) | 0);
        else if (r < 0.17) g.shoot();
        else if (r < 0.21 && g.player.inventory.length) g.useItem((Math.random() * g.player.inventory.length) | 0);
        else if (r < 0.23 && g.player.inventory.length) g.dropItem((Math.random() * g.player.inventory.length) | 0);
        else { const d = DIRS[(Math.random() * DIRS.length) | 0]; g.move(d[0], d[1]); }
      }
    } catch (e) { crashes++; if (crashes < 4) console.log("   예외:", e.message, "\n     " + (e.stack || "").split("\n")[1]); }
  }
  console.log("무작위 내구 :", ok(crashes === 0), "120판 · 예외 " + crashes + "건");
}

// 14) 밸런스 — 빌드를 쌓으며 내려가는 AI 의 직업별 승률
/* 상인은 길을 막지 않는다(밟으면 들어가면서 상점이 열린다) — 그래서 여기서도
 * 특별 취급하지 않는다. 예전에 상인을 막았을 때는 상인이 유일한 통로를 가로막는
 * 배치에서 길을 못 찾아 갇혔다. */
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

/* 사람처럼 두는 AI. 빌드 시스템이 붙었으니 그것도 쓴다:
 *   · 레벨업은 **공격 계열**로 민다(사람도 대개 그렇게 한다)
 *   · 상인을 만나면 살 수 있는 것을 산다
 *   · 스킬은 쿨이 돌면 쓴다
 *   · 모르는 물약은 안전할 때만 시험한다(독이 섞여 있다) */
const PERK_PREF = ["p_atk", "p_crit", "p_cdmg", "p_skill", "p_hp", "p_def"];
function play(seed, clsId) {
  const g = new Game(clsId);
  g.reset(seed, clsId);
  const inv = pred => g.player.inventory.findIndex(pred);
  const skip = new Set();
  /* ⚠ 상점을 닫고 또 걸어가면 무한 순환이 된다(상인에게 걸어 들어가는 것은 턴을
   *   쓰지 않으므로 턴이 안 늘고 영원히 돈다 — 실측: 40판 전부 미결).
   *   한 층에 한 번만 본다. */
  const shopped = new Set();
  let t = 0, stuck = 0;

  while (!g.over && t < 60000) {
    t++;

    /* 레벨업 — 선호 순서대로, 없으면 새 스킬, 없으면 첫 번째 */
    if (g.pendingPerks) {
      let idx = -1;
      for (const want of PERK_PREF) {
        idx = g.pendingPerks.findIndex(c => c.what === "perk" && c.perk.id === want);
        if (idx >= 0) break;
      }
      if (idx < 0) idx = g.pendingPerks.findIndex(c => c.what === "skillnew");
      if (idx < 0) idx = 0;
      g.choosePerk(idx);
      continue;
    }

    /* 상점 — 살 수 있는 것을 다 사고 닫는다 */
    if (g.shop) {
      let bought = false;
      for (let i = 0; i < g.shop.length; i++) {
        const row = g.shop[i];
        if (row.sold || g.gold < row.cost) continue;
        if (g.buy(i)) { bought = true; break; }
      }
      if (!bought) { shopped.add(g.depth); g.closeShop(); }
      continue;
    }

    const p = g.player, lv = g.level, hurt = p.hp / g.maxhp();

    /* 상태이상이 심하면 씻는다 */
    if ((p.ail.poison || p.ail.bleed) && hurt < 0.5) {
      const ci = inv(it => g.identified[it.id] && it.effect === "cure");
      if (ci >= 0) { g.useItem(ci); continue; }
    }
    if (hurt < 0.45) {
      let i = inv(it => g.identified[it.id] && it.effect === "heal" && it.power >= 60);
      if (i < 0 || hurt > 0.25) { const j = inv(it => g.identified[it.id] && it.effect === "heal"); if (j >= 0) i = j; }
      if (i >= 0) { g.useItem(i); continue; }
      /* 회복 스킬 */
      const hs = p.skills.findIndex(s => s.cd <= 0 && DATA.byId(DATA.SKILLS, s.id).kind === "heal");
      if (hs >= 0 && g.useSkill(hs) !== false) continue;
    }

    let adj = null;
    for (const d of DIRS) { const m = g.monsterAt(p.x + d[0], p.y + d[1]); if (m) { adj = { d, m }; break; } }
    const near = g.nearestVisible();

    /* 스킬 — 쿨이 돌고 쓸 자리가 있으면 쓴다 */
    let usedSkill = false;
    for (let si = 0; si < p.skills.length; si++) {
      const s = p.skills[si];
      if (s.cd > 0) continue;
      const def = DATA.byId(DATA.SKILLS, s.id);
      let worth = false;
      if (def.kind === "cleave") worth = g.monsters.some(m => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1);
      else if (def.kind === "blast" || def.kind === "quake" || def.kind === "ail")
        worth = g.monsters.some(m => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= def.range);
      else if (def.kind === "throw" || def.kind === "drain" || def.kind === "charge")
        worth = near && (Math.abs(near.x - p.x) + Math.abs(near.y - p.y)) <= def.range;
      else if (def.kind === "snipe") worth = !!g.farthestVisible(def.range);
      else if (def.kind === "ward") worth = !!adj && hurt < 0.7;
      else if (def.kind === "heal") worth = hurt < 0.5;
      if (worth && g.useSkill(si) !== false) { usedSkill = true; break; }
    }
    if (usedSkill) continue;

    /* 활 — 붙기 전에 쏜다 */
    if (p.weapon && p.weapon.ranged && !adj && near) {
      if (g.shoot() !== false) continue;
    }

    if (hurt < 0.35 && adj) {
      let i = inv(it => it.effect === "fire");
      if (i < 0) i = inv(it => it.effect === "bolt");
      if (i < 0 && hurt < 0.2) i = inv(it => it.effect === "blink");
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (adj) { g.move(adj.d[0], adj.d[1]); continue; }

    /* 안전할 때 모르는 물약을 하나 시험한다 — 독일 수 있으니 체력이 넉넉할 때만 */
    if (hurt > 0.8 && !g.monsters.some(m => g.isVisible(m.x, m.y))) {
      const i = inv(it => it.kind === "potion" && !g.identified[it.id]);
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (g.itemAt(p.x, p.y)) {
      if (p.inventory.length >= DATA.BAG_MAX) skip.add(g.depth + ":" + p.x + "," + p.y);
      else { g.pickUp(); continue; }
    }

    const key = it => g.depth + ":" + it.x + "," + it.y;
    const desperate = hurt < 0.3 && inv(it => g.identified[it.id] && it.effect === "heal") < 0;
    let goals, toStairs = false;
    if (desperate && g.depth < DATA.MAX_DEPTH) { goals = [lv.downAt]; toStairs = true; }
    else if (g.merchant && g.gold >= 60 && !shopped.has(g.depth)) goals = [g.merchant];
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

//  기준: 직업마다 승률 30~70%. 이보다 높으면 긴장이 없고, 낮으면 사람은 못 깬다.
//  그리고 직업 사이 격차가 28%p 를 넘으면 안 된다 — 넘으면 "센 직업" 하나만 고르게 된다.
//  ⚠ 빌드 자유도가 생긴 뒤로는 직업보다 **선택**이 승률을 가른다. 폭을 조금 넓게 잡는다.
console.log("\n── 밸런스 (빌드를 쌓으며 내려가는 AI · " + N + "판/직업) ──");
const rates = [];
for (const c of DATA.CLASSES) {
  let wins = 0, unresolved = 0;
  const dd = {}, depths = [], scores = [], lv = [], crit = [];
  for (let i = 0; i < N; i++) {
    const g = play((i * 104729 + 7) >>> 0, c.id);
    depths.push(g.depth); scores.push(g.score()); lv.push(g.player.level);
    crit.push(g.stats().crit);
    if (g.won) wins++;
    else if (g.over) dd[g.depth] = (dd[g.depth] || 0) + 1;
    else unresolved++;
  }
  const rate = wins / N * 100;
  rates.push(rate);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const pre = Object.keys(dd).filter(k => +k < DATA.MAX_DEPTH).reduce((a, k) => a + dd[k], 0);
  console.log(c.name.padEnd(9), ok(rate >= 30 && rate <= 70 && unresolved === 0),
    ("승률 " + rate.toFixed(1) + "%").padEnd(12) +
    "평균 " + avg(depths).toFixed(2) + "층 · Lv." + avg(lv).toFixed(1) +
    " · 치명 " + Math.round(avg(crit) * 100) + "%" +
    " · 점수 " + Math.round(avg(scores)).toLocaleString() +
    " · 보스 전 사망 " + pre + " · 보스층 " + (dd[DATA.MAX_DEPTH] || 0) +
    (unresolved ? " · ⚠미결 " + unresolved : ""));
}
const gap = Math.max(...rates) - Math.min(...rates);
console.log("직업 격차   :", ok(gap <= 28), gap.toFixed(1) + "%p (28%p 이하여야 한다)");

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

// 부드러운 이동
{
  const ra = spawnSync(process.execPath, [path.join(ROOT, "tools", "anim-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (ra.stdout.match(/✘/g) || []).length;
  console.log("부드러운 이동".padEnd(20), ok(ra.status === 0), bad ? "문제 " + bad + "건" : "통과");
  if (bad) ra.stdout.split("\n").filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 한 판을 끝까지 밟는다(종료 화면)
const rp = spawnSync(process.execPath, [path.join(ROOT, "tools", "check.mjs"), "--play"],
  { encoding: "utf8", cwd: ROOT });
const endLine = rp.stdout.split("\n").find(l => l.includes("끝까지 진행")) || "";
console.log("끝까지 한 판".padEnd(20), ok(rp.status === 0), endLine.replace(/.*끝까지 진행\s*:\s*/, "").trim());

console.log(fails === 0 ? "\n전부 통과" : "\n✘ 실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
