/* 밸런스 측정 — 봇이 **실제로 플레이해서** 잰다.
 *
 * 턴제에서는 잣대가 "승률" 이었다. 캐릭터가 영구히 남는 지금은 그 숫자가 없다.
 * 대신 재는 것:
 *   ① 적정 레벨 곡선 — 몇 레벨이면 몇 층이 할 만한가
 *   ② 보스 벽        — 유독 못 넘는 보스가 있는가
 *   ③ 장비 의존도    — 맨몸과 풀장비의 차이
 *   ④ 스킬 격차      — 시너지 15개 중 압도적인 것이 있는가
 *   ⑤ 성장 시간      — Lv.1 → 30 까지 몇 분인가
 *
 * ⚠⚠ **봇의 밸런스는 봇의 밸런스지 사람의 밸런스가 아니다.** 반응 0.22초 ·
 *   조준 오차 8° 를 일부러 넣었다(tools/bot.js). 이 값을 바꾸면 결론이 통째로
 *   바뀐다 — 바꿀 때는 왜 바꾸는지 함께 적을 것.
 * ⚠ 화면을 그리지 않는다. 규칙만 돌려 실시간의 수백 배로 간다(실측 약 600배).
 *
 * 쓰기:  node tools/balance.mjs [판수] [경력수]   기본 12판/조건 · 5경력
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "public");
const N = Math.max(3, parseInt(process.argv[2] || "12", 10));
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-bal-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "about:blank"],
  { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
const errs = []; let id = 0; const wait = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errs.push(d.text + " " + ((d.exception && d.exception.description) || ""));
  }
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
});
const send = (me, p, s) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => (await S("Runtime.evaluate", {
  expression: x, returnByValue: true, awaitPromise: true, timeout: 600000
})).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await S("Emulation.setDeviceMetricsOverride", { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1300);

/* 봇을 주입한다 — tools/ 는 배포되지 않으므로 글자로 넣는다 */
await ev(fs.readFileSync(path.join(HERE, "bot.js"), "utf8"));
const botOK = await ev("!!window.BOT");
if (!botOK) { console.log("✘ 봇 주입 실패"); process.exit(1); }

/* 한 판을 돌리는 판(harness). 페이지 안에서 돈다 — 왕복 비용을 없앤다. */
await ev(`
window.__runFloor = function (cfg) {
  var W = window.WORLD, DT = window.DATA, I = window.ITEMS, S = window.SAVE, SK = window.SKILLS;

  /* 표준 캐릭터 — 레벨에 맞는 장비를 입힌 "그쯤 플레이한 사람".
   * ⚠ 맨몸으로 재면 실제보다 어렵게 나오고, 최고 장비로 재면 쉽게 나온다.
   *   재는 것은 **보통 사람**이다. */
  var hero = S.blank(cfg.cls || "warrior");
  hero.level = cfg.level;
  hero.potions = cfg.potions === undefined ? 3 : cfg.potions;
  hero.equip = {};
  hero.skills = cfg.skills || {};
  /* ⚠ 손잡이를 **그 직업 것**으로 둔다. 표의 앞 넷을 박아 두면 마법사가
   *   전사 재주를 들고 나가 아무것도 못 쓴다(그리고 "마법사가 약하다" 로 읽힌다). */
  hero.bar = cfg.bar || window.CLASSES.skillsOf(hero.cls).slice(0, 4);
  if (cfg.gear !== "none") {
    /* ⚠ 칸마다 **따로** 굴린다. 하나의 흐름으로 일곱 칸을 지나가면 앞 칸의
     *   뽑기 횟수가 달라질 때 뒤 칸이 통째로 바뀐다 — 등급만 바꿨는데 무기
     *   종류까지 바뀌어 "희귀가 마법보다 약하다" 는 거짓 결과가 나왔다. */
    var gseed = function (k) {
      return window.DUNGEON.makeRng((cfg.seed ^ 0x51ed270b) + k * 0x9e3779b1);
    };
    /* 장비 수준·등급·강화를 **레벨과 따로** 줄 수 있어야 한다.
     * ⚠ 안 그러면 "레벨을 올려도 안 나아진다" 를 봐도 그게 레벨 탓인지
     *   장비 탓인지 가를 수 없다(실제로 못 갈랐다).
     * ⚠ cfg.tier 는 전에 **읽히지도 않았다.** 넘겨도 조용히 무시됐다. */
    var ilvl = Math.max(1, Math.min(30,
      cfg.ilvl === undefined ? cfg.level : cfg.ilvl));
    var enh = Math.max(0, Math.min(I.ENH_MAX, Math.floor(cfg.enh || 0)));
    for (var si = 0; si < I.SLOTS.length; si++) {
      var grng = gseed(si + 1);
      var slot = I.SLOTS[si];
      var tier = cfg.tier ||
        (cfg.gear === "best" ? "rare" : (cfg.gear === "poor" ? "common" : null));
      /* ⚠ 무기는 **그 직업이 잘 쓰는 것**으로 굴린다. 아무 무기나 주면
       *   마법사가 도끼를 들고 나가 적성 보너스도 원거리도 못 받는다 —
       *   실제 사람은 자기 무기를 찾아 든다. */
      var opt2 = { ilvl: ilvl, slot: slot, tier: tier };
      if (slot === "weapon") {
        var likes = window.CLASSES.byId(hero.cls).likes;
        opt2.base = likes[Math.floor(grng() * likes.length)];
      }
      var it = I.roll(grng, opt2);
      /* ⚠ 못 쓰는 것은 안 입는다 — 레벨 제한이 있는데 무시하면 과대평가된다 */
      if (!I.canEquip(it, hero.level)) continue;
      var pk = I.pack(it);
      if (enh) pk.e = enh;               /* 대장간에서 강화해 둔 상태 */
      hero.equip[slot] = pk;
    }
  }

  var w = new W.World({ seed: cfg.seed, depth: cfg.depth, hero: hero });
  var bot = window.BOT.make(w, {
    seed: cfg.seed, react: cfg.react, aimErr: cfg.aimErr,
    skill: cfg.skill !== false, dodge: cfg.dodge !== false
  });
  bot.hero = hero;
  /* 물약 — app.js 의 것과 **같은 규칙**이어야 한다(절반 회복 · 8초). */
  var potAt = -99;
  bot.drink = function () {
    var p = w.player;
    if (hero.potions <= 0) return false;
    if (w.time - potAt < 8) return false;
    if (p.hp >= p.maxHp) return false;
    hero.potions--; potAt = w.time;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.5));
    return true;
  };

  /* 재기만 하는 호출 — **돌리지 않는다.** 장비가 실제로 무엇이 됐는지만 본다. */
  if (cfg.peek) {
    var sw0 = w.player.swing || {};
    return { peek: {
      dps: Math.round((sw0.dmg || 0) * (sw0.aps || 1)),
      wep: (hero.equip.weapon && I.rebuild(hero.equip.weapon))
             ? I.rebuild(hero.equip.weapon).name : "맨손",
      hp: w.player.maxHp, def: w.player.baseDef } };
  }

  var limit = cfg.limit || 300;                /* 게임 시간 상한(초) */
  var steps = Math.round(limit * 60);
  var startXp = hero.xp, startLv = hero.level, startGold = hero.gold;
  var cleared = false;
  for (var i = 0; i < steps; i++) {
    bot.step(1/60);
    if (w.player.dead) break;
    var alive = 0;
    for (var k = 0; k < w.ents.length; k++)
      if (!w.ents[k].dead && w.ents[k].team !== 0) alive++;
    if (alive === 0) { cleared = true; break; }
  }
  var st = bot.stats;
  return {
    cleared: cleared, died: w.player.dead, time: +st.time.toFixed(1),
    kills: st.kills, taken: Math.round(st.taken), potions: st.potions,
    hpLow: +st.hpLow.toFixed(2), swings: st.swings, skills: st.skills,
    dodges: st.dodges,
    lvUp: hero.level - startLv, gold: hero.gold - startGold,
    hpEnd: Math.max(0, Math.round(w.player.hp)), hpMax: w.player.maxHp
  };
};

/* 그 조건의 장비가 실제로 어떤 것인지 — **시행과 같은 길**로 만들어 본다.
 * ⚠ 표에 적을 화력을 따로 굴려 재면 다른 물건이 나온다. 같은 함수를 쓴다. */
window.__peekGear = function (cfg) {
  var c = {}; for (var k in cfg) c[k] = cfg[k];
  c.peek = true;
  var r = window.__runFloor(c);
  return r.peek;
};

/* 같은 조건을 여러 번 돌려 평균을 낸다 */
window.__trials = function (cfg, n) {
  var ok = 0, rows = [];
  for (var i = 0; i < n; i++) {
    var c = {}; for (var k in cfg) c[k] = cfg[k];
    c.seed = (cfg.seed || 1) + i * 7919;
    var r = window.__runFloor(c);
    rows.push(r);
    if (r.cleared) ok++;
  }
  function avg(f, only) {
    var list = only ? rows.filter(only) : rows;
    if (!list.length) return 0;
    var s = 0; for (var i = 0; i < list.length; i++) s += f(list[i]);
    return s / list.length;
  }
  /* ⚠ **깬 판만으로 시간을 잰다.** 실패한 판은 시간 상한(240~300초)까지 가므로
   *   평균에 섞으면 "이 시너지가 80% 느리다" 같은 거짓 결론이 나온다
   *   (실측으로 그렇게 나왔다 — 깸 75%인 것들만 125초대로 뭉쳐 있었다).
   *   빠르기와 안정성은 **다른 숫자**다. 따로 본다. */
  var won = function (r) { return r.cleared; };
  /* 비율의 **표준오차** — sqrt(p(1-p)/n).
   * ⚠ 이걸 안 내면 "70%" 와 "70%±15" 를 구별할 수 없고, 문턱 근처 판정이
   *   실행마다 뒤집힌다(실측: 같은 코드로 두 번 돌려 판정 셋이 갈렸다). */
  var p = ok / n;
  return {
    n: n, clear: p, se: Math.sqrt(p * (1 - p) / n),
    time: +avg(function (r) { return r.time; }, won).toFixed(1),
    taken: Math.round(avg(function (r) { return r.taken; })),
    hpLow: +avg(function (r) { return r.hpLow; }).toFixed(2),
    potions: +avg(function (r) { return r.potions; }).toFixed(1),
    kills: +avg(function (r) { return r.kills; }).toFixed(1),
    /* 못 깬 판은 왜 못 깼나 — 죽어서인가 시간이 모자라서인가.
     * ⚠ 이 둘은 전혀 다른 문제다(너무 세다 vs 너무 질기다). */
    died: rows.filter(function (r) { return r.died; }).length,
    slow: rows.filter(function (r) { return !r.cleared && !r.died; }).length
  };
};
`);

const t0 = Date.now();
console.log("밸런스 측정 — 조건당 " + N + "판 · 봇 반응 0.22초 · 조준 오차 8°\n");

/* ── ① 적정 레벨 곡선 ─────────────────────────────────
 * 층마다 "이 레벨이면 70% 이상 깬다" 를 찾는다. */
const CURVE = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 30];
console.log("① 적정 레벨 곡선 — 층마다 70% 이상 깨는 가장 낮은 레벨\n");
console.log("  층   Lv   깸     평균시간  받은피해  최저체력  물약");
const curve = [];
for (const d of CURVE) {
  let found = null, rows = [];
  /* 층 ≈ 레벨이 기준선이라고 보고 그 언저리를 훑는다 */
  for (const lv of [Math.max(1, d - 6), Math.max(1, d - 3), d, d + 3, d + 6, d + 10]) {
    /* ⚠ 씨앗을 **레벨마다 바꾼다.** 층마다 같은 지도 여섯 개로만 판정하면
     *   그 여섯이 험한 판일 때 층 전체가 험한 것으로 나온다(실측: 25·28층이
     *   30층보다 어렵다는 말이 안 되는 결과가 나왔다 — 지도 탓이었다). */
    const r = await ev(`window.__trials({ depth: ${d}, level: ${lv}, seed: ${d * 131 + lv * 977} }, ${N})`);
    rows.push({ lv, r });
    /* ⚠ **문턱을 넉넉히 넘었을 때만** 찾았다고 한다. 딱 걸친 값(70%±15)에서
     *   멈추면 다음 실행에 뒤집혀 곡선 전체가 달라진다 — 실행마다 "28층에
     *   Lv.34 가 필요하다" 와 "Lv.25 면 된다" 가 오갔다. */
    if (!found && r.clear - 1.0 * r.se >= 0.7) found = { lv, r };
    if (found) break;
  }
  const show = found || rows[rows.length - 1];
  curve.push({ d, lv: show.lv, ok: !!found, r: show.r });
  console.log("  " + String(d).padStart(2) + "층 " + String(show.lv).padStart(3) +
    "  " + (show.r.clear * 100).toFixed(0).padStart(3) + "%  " +
    String(show.r.time).padStart(7) + "초 " +
    String(show.r.taken).padStart(8) + "  " +
    (show.r.hpLow * 100).toFixed(0).padStart(7) + "%  " +
    String(show.r.potions).padStart(4) +
    /* ⚠ 못 깬 이유를 갈라 적는다 — **죽는 것**과 **시간이 모자라는 것**은
     *   전혀 다른 문제다(너무 세다 vs 너무 질기다). */
    (show.r.died ? "  죽음 " + show.r.died : "") +
    (show.r.slow ? "  시간초과 " + show.r.slow : "") +
    (found ? "" : "  ⚠ Lv+10 에도 못 깬다"));
}

/* ── ①-b 적정 **장비** 곡선 ────────────────────────────
 * 층마다 "이 장비면 70% 이상 깬다" 를 찾는다.
 *
 * ⚠ 레벨이 아니라 장비다. **레벨은 체력만 준다**(applyHero 에서 lv 가 maxHp
 *   한 줄에만 나온다) — 화력·방어는 전부 장비에서 온다. 그래서 스펙 컷을 둘
 *   자리를 찾으려면 이 축으로 재야 한다.
 * ⚠ 레벨은 층에 맞춰 고정한다. 그러면 장비만 변수다.
 * ⚠ 등급·수준·강화를 **따로** 줄 수 있어야 한다. 전에는 장비 수준이 레벨에
 *   묶여 있어 둘을 가를 수 없었고, cfg.tier 는 읽히지도 않았다.
 */
const LADDER = [
  { t: "common", dl: -8, e: 0,  n: "일반(낡음)" },
  { t: "common", dl: 0,  e: 0,  n: "일반" },
  { t: "magic",  dl: -8, e: 0,  n: "마법(낡음)" },
  { t: "magic",  dl: 0,  e: 0,  n: "마법" },
  { t: "magic",  dl: 0,  e: 5,  n: "마법 +5" },
  { t: "rare",   dl: -8, e: 0,  n: "희귀(낡음)" },
  { t: "rare",   dl: 0,  e: 0,  n: "희귀" },
  { t: "rare",   dl: 0,  e: 5,  n: "희귀 +5" },
  { t: "rare",   dl: 0,  e: 10, n: "희귀 +10" }
];
console.log("\n①-b 적정 장비 곡선 — 층마다 70% 이상 깨는 가장 낮은 장비 (레벨 = 층)\n");
console.log("  층   필요한 장비      깸     시간   받은피해  피해출력  무기");
const gcurve = [];
for (const d of [5, 10, 15, 20, 25, 30]) {
  let found = null; const tried = [];
  for (const g of LADDER) {
    const r = await ev(`(function(){
      var c = { depth: ${d}, level: ${d}, seed: ${d * 131 + 6100},
                tier: "${g.t}", ilvl: Math.max(1, ${d} + ${g.dl}), enh: ${g.e} };
      var t = window.__trials(c, ${N});
      /* 화력은 **같은 길로 만든 장비**에서 읽는다 — 따로 굴리면 다른 물건이
       * 나와 표와 실제가 어긋난다(실제로 어긋났다). */
      var pk = window.__peekGear(c);
      t.dps = pk.dps; t.wep = pk.wep;
      return t;
    })()`);
    tried.push({ g, r });
    /* ⚠ 문턱을 **넉넉히** 넘었을 때만 찾았다고 한다 — 딱 걸친 값에서 멈추면
     *   실행마다 곡선이 뒤집힌다(①번과 같은 규칙). */
    if (r.clear - 1.0 * r.se >= 0.7) { found = { g, r }; break; }
  }
  const show = found || tried[tried.length - 1];
  gcurve.push({ d, g: show.g, ok: !!found, r: show.r });
  console.log("  " + String(d).padStart(2) + "층 " + show.g.n.padStart(11) +
    "  " + (show.r.clear * 100).toFixed(0).padStart(3) + "%  " +
    String(show.r.time).padStart(6) + "초" +
    String(show.r.taken).padStart(9) +
    String(show.r.dps).padStart(9) + "/초  " + show.r.wep +
    (show.r.died ? "  죽음 " + show.r.died : "") +
    (show.r.slow ? "  시간초과 " + show.r.slow : "") +
    (found ? "" : "  ⚠ 최고 장비로도 못 깬다"));
}

/* ── ② 보스 벽 ───────────────────────────────────────── */
console.log("\n② 보스 벽 — 그 층의 적정 레벨로 보스층을 밟는다\n");
const BOSS = [6, 12, 18, 24, 30];
const bossRows = [];
for (const d of BOSS) {
  /* 곡선에서 가장 가까운 적정 레벨을 쓴다 */
  let lv = d;
  for (const c of curve) if (Math.abs(c.d - d) <= 3 && c.ok) lv = Math.max(lv, c.lv);
  const r = await ev(`window.__trials({ depth: ${d}, level: ${lv}, seed: ${5000 + d} }, ${N})`);
  const name = await ev(`window.DATA.bossAt(${d}).def.name`);
  bossRows.push({ d, lv, name, r });
  console.log("  " + String(d).padStart(2) + "층 " + name.padEnd(8) +
    " Lv." + String(lv).padStart(2) + "  깸 " + (r.clear * 100).toFixed(0).padStart(3) +
    "%  " + String(r.time).padStart(6) + "초  최저체력 " +
    (r.hpLow * 100).toFixed(0).padStart(3) + "%");
}

/* ── ③ 장비 의존도 ───────────────────────────────────── */
console.log("\n③ 장비 의존도 — 같은 레벨·같은 층, 장비만 다르게\n");
const gearRows = [];
for (const g of ["none", "poor", null, "best"]) {
  const label = { none: "맨몸", poor: "일반만", "null": "보통(굴림)", best: "희귀" }[String(g)];
  const r = await ev(`window.__trials({ depth: 15, level: 15, gear: ${g === null ? "null" : '"' + g + '"'}, seed: 777 }, ${N})`);
  gearRows.push({ label, r });
  console.log("  " + label.padEnd(11) + " 깸 " + (r.clear * 100).toFixed(0).padStart(3) +
    "%  " + String(r.time).padStart(6) + "초  받은피해 " + String(r.taken).padStart(5) +
    "  최저체력 " + (r.hpLow * 100).toFixed(0).padStart(3) + "%");
}

/* ── ④ 스킬 격차 ─────────────────────────────────────── */
console.log("\n④ 스킬 격차 — 시너지 하나씩만 켜고 15층을 돈다\n");
const skillDefs = await ev(`window.SKILLS.LIST.map(function(s){
  return { id: s.id, name: s.name, syn: s.syn.map(function(y){ return { id: y.id, name: y.name }; }) }; })`);
const skillRows = [];
for (const sk of skillDefs) {
  for (const sy of sk.syn) {
    const taken = JSON.stringify({ [sk.id]: [sy.id] });
    const r = await ev(`window.__trials({ depth: 15, level: 15, seed: 3000, skills: ${taken} }, ${N})`);
    skillRows.push({ label: sk.name + " · " + sy.name, r });
  }
}
/* 시너지 없음 기준선 */
const base = await ev(`window.__trials({ depth: 15, level: 15, seed: 3000, skills: {} }, ${N})`);
skillRows.sort((a, b) => a.r.time - b.r.time);
console.log("  (기준: 시너지 없음 " + base.time + "초 · 깸 " + (base.clear * 100).toFixed(0) + "%)");
for (const s of skillRows) {
  const gap = ((base.time - s.r.time) / base.time * 100);
  console.log("  " + s.label.padEnd(18) + String(s.r.time).padStart(6) + "초  깸 " +
    (s.r.clear * 100).toFixed(0).padStart(3) + "%  기준 대비 " +
    (gap >= 0 ? "+" : "") + gap.toFixed(0).padStart(3) + "%" +
    (s.r.died ? "  죽음 " + s.r.died : "") + (s.r.slow ? "  시간초과 " + s.r.slow : ""));
}
const fastest = skillRows[0], slowest = skillRows[skillRows.length - 1];
const skillGap = (slowest.r.time - fastest.r.time) / slowest.r.time * 100;

/* ── ⑤ 성장 시간 ─────────────────────────────────────── */
console.log("\n⑤ 성장 시간 — Lv.1 로 시작해 도달 층을 늘려 가며 계속 돈다\n");
await ev(`window.__career = function (SEED, CLS) {
  var spent = 0;                         /* 물약에 쓴 금화(대장간에 못 쓴 돈) */
  var W = window.WORLD, S = window.SAVE, DT = window.DATA, I = window.ITEMS;
  var hero = S.blank(CLS || "warrior");
  var total = 0, runs = 0, deaths = 0, marks = [];
  var mark = { 5: 0, 10: 0, 15: 0, 20: 0, 25: 0, 30: 0 };
  var guard = 0;
  while (hero.level < 30 && guard++ < 400) {
    /* 갈 수 있는 가장 깊은 층으로 — 사람이 하듯 */
    var d = Math.max(1, Math.min(hero.maxDepth, DT.MAX_DEPTH));
    var cfg = { depth: d, level: hero.level, seed: SEED + guard * 13, limit: 240 };
    /* 캐릭터를 이어 쓴다 — 매번 새로 만들면 성장이 안 쌓인다 */
    var w = new W.World({ seed: cfg.seed, depth: d, hero: hero });
    var bot = window.BOT.make(w, { seed: cfg.seed + 1 });
    bot.hero = hero;
    var potAt = -99;
    bot.drink = function () {
      var p = w.player;
      if (hero.potions <= 0 || w.time - potAt < 8 || p.hp >= p.maxHp) return false;
      hero.potions--; potAt = w.time;
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.5));
      return true;
    };
    var cleared = false;
    for (var i = 0; i < 240 * 60; i++) {
      bot.step(1/60);
      if (w.player.dead) break;
      var alive = 0;
      for (var k = 0; k < w.ents.length; k++)
        if (!w.ents[k].dead && w.ents[k].team !== 0) alive++;
      if (alive === 0) { cleared = true; break; }
    }
    total += bot.stats.time; runs++;
    if (w.player.dead) deaths++;
    else if (cleared) {
      /* 깼으면 한 층 더 깊이 갈 수 있다 */
      hero.maxDepth = Math.min(DT.MAX_DEPTH, Math.max(hero.maxDepth, d + 1));
      /* 마을에 들러 물약을 채운다(금화가 되면) */
      while (hero.potions < 5 && hero.gold >= 40) { hero.gold -= 40; hero.potions++; spent += 40; }
      /* 주운 것 중 좋은 것을 입는다 — 사람이 하듯 */
      var bag = S.liveBag(hero);
      for (var b = 0; b < bag.length; b++) {
        var it = bag[b];
        if (!I.canEquip(it, hero.level)) continue;
        var cur = I.rebuild(hero.equip[it.slot]);
        if (!cur || it.val > cur.val) hero.equip[it.slot] = I.pack(it);
      }
      hero.bag = [];
    }
    /* 재주 점수를 쓴다 — 첫 시너지부터 순서대로 */
    while (hero.points > 0) {
      var placed = false;
      for (var s2 = 0; s2 < window.SKILLS.LIST.length && !placed; s2++) {
        var def = window.SKILLS.LIST[s2];
        if ((hero.skills[def.id] || []).length) continue;
        hero.skills[def.id] = [def.syn[0].id];
        hero.points--; placed = true;
      }
      if (!placed) break;
    }
    for (var m in mark) if (!mark[m] && hero.level >= +m) mark[m] = +(total / 60).toFixed(1);
    /* **그 층에 닿았을 때 몇 레벨이었나.** 이게 긴장의 정체다 —
     * 적정 레벨보다 한참 위면 아무 일도 안 일어나고, 아래면 벽이 된다. */
    marks.push({ d: d, lv: hero.level, cleared: cleared, died: w.player.dead });
  }
  /* 대장간에 쓸 수 있는 돈 = 남은 금화. 물약값은 따로 센다(고정 지출이다). */
  return { level: hero.level, minutes: +(total / 60).toFixed(1), runs: runs,
           deaths: deaths, maxDepth: hero.maxDepth, marks: mark, path: marks,
           gold: hero.gold, spent: spent };
};`);

/* ⚠ **한 번만 돌리면 안 된다.** 지도·전리품·죽음이 판마다 달라 한 경력의 결과가
 *   24분에서 50분까지 흔들렸다(실측). 여러 번 돌려 평균과 폭을 함께 본다 —
 *   폭을 안 보면 "좋아졌다" 와 "운이 좋았다" 를 구별할 수 없다. */
/* ⚠ 경력 수를 **늘릴 수 있어야** 한다. 치명타가 Math.random 이라 5경력으로는
 *   "안 죽는다(0회)" 와 "한 번쯤 죽는다(1.6회)" 를 못 가린다 — 실측으로 같은
 *   코드가 둘 다 냈다. 판정이 흔들릴 때는 판수를 늘려 다시 잰다.
 *   쓰기: node tools/balance.mjs [판수] [경력수] */
const CAREERS = Math.max(3, parseInt(process.argv[3] || "5", 10));
const careers = [];
for (let c = 0; c < CAREERS; c++) careers.push(await ev(`window.__career(${4000 + c * 331})`));
const mean = f => careers.reduce((a, r) => a + f(r), 0) / careers.length;
const career = {
  level: Math.round(mean(r => r.level)),
  minutes: +mean(r => r.minutes).toFixed(1),
  runs: Math.round(mean(r => r.runs)),
  deaths: +mean(r => r.deaths).toFixed(1),
  maxDepth: Math.round(mean(r => r.maxDepth)),
  marks: {}, path: careers[0].path,
  lo: Math.min(...careers.map(r => r.minutes)),
  hi: Math.max(...careers.map(r => r.minutes)),
  /* 죽음의 **폭** — 평균만 보면 잡음을 결론으로 보고한다(치명타가 Math.random
   * 이라 씨앗을 고정해도 경력마다 다르다). */
  dLo: Math.min(...careers.map(r => r.deaths)),
  dHi: Math.max(...careers.map(r => r.deaths)),
  dEach: careers.map(r => r.deaths),
  done: careers.filter(r => r.level >= 30).length
};
for (const lv of [5, 10, 15, 20, 25, 30]) {
  const got = careers.map(r => r.marks[lv]).filter(Boolean);
  career.marks[lv] = got.length === careers.length
    ? +(got.reduce((a, b) => a + b, 0) / got.length).toFixed(1) : 0;
}
for (const lv of [5, 10, 15, 20, 25, 30])
  console.log("  Lv." + String(lv).padStart(2) + " 까지  " +
    (career.marks[lv] ? career.marks[lv] + "분" : "⚠ 못 찍음"));
console.log("  평균(" + CAREERS + "회): Lv." + career.level + " · 도달 " + career.maxDepth +
  "층 · " + career.minutes + "분(" + career.lo + "~" + career.hi + ") · " +
  career.runs + "판 · 죽음 " + career.deaths + "회 · Lv.30 도달 " +
  career.done + "/" + CAREERS);

/* ── 금화 — 대장간을 **닿을 수 있는 자리**에 두었는가 ──
 * ⚠ 표시값 합이 아니라 **기대 비용**으로 견준다(강화는 실패한다).
 * ⚠ 너무 싸면 한 판에 +10 이 되어 소비처가 사라지고, 너무 비싸면
 *   아무도 못 해 기능이 통째로 죽는다. 어느 쪽인지는 재야만 안다. */
const money = await ev(`(function(){
  var I = window.ITEMS;
  function seeded(s){ return function(){ s=(s*1664525+1013904223)>>>0; return s/4294967296; }; }
  var r = seeded(20250922), one = 0, all = 0;
  for (var i = 0; i < I.SLOTS.length; i++) {
    var it = I.roll(r, { slot: I.SLOTS[i], tier: "rare", ilvl: 28 });
    var p = I.pack(it), sum = 0;
    for (var n = 0; n < 10; n++) { sum += I.enhCost(I.rebuild(p)) / I.enhChance(n); p.e = n + 1; }
    all += sum;
    if (I.SLOTS[i] === "weapon") one = sum;
  }
  return { one: Math.round(one), all: Math.round(all) };
})()`);
const goldAvg = Math.round(mean(r => r.gold));
const spentAvg = Math.round(mean(r => r.spent));
const goldLo = Math.min(...careers.map(r => r.gold));
const goldHi = Math.max(...careers.map(r => r.gold));
console.log("\n  금화 — 한 경력에 남는 돈 " + goldAvg.toLocaleString() +
  " (" + goldLo.toLocaleString() + "~" + goldHi.toLocaleString() + ") · 물약에 " +
  spentAvg.toLocaleString());
console.log("  대장간 기대비용: 무기 하나 +10 에 " + money.one.toLocaleString() +
  " · 일곱 칸 전부 +10 에 " + money.all.toLocaleString());
const ratio = goldAvg / money.one;
console.log("  → 한 경력의 돈으로 무기를 " + ratio.toFixed(1) + "번 +10 할 수 있다" +
  (ratio < 0.3 ? "  ⚠ 너무 비싸다 — 아무도 못 해 기능이 죽는다"
   : ratio > 6 ? "  ⚠ 너무 싸다 — 한 판에 다 채워 소비처가 사라진다"
   : "  적당하다(0.3~6배 사이)"));
/* 적정 레벨과 견줘 본다 — **앞지르면 긴장이 없고, 뒤처지면 벽이 된다** */
const need = {};
for (const c of curve) if (c.ok) need[c.d] = c.lv;
const gaps = [];
console.log("\n  층별 도달 레벨 (적정 대비)");
let line = "  ";
for (const st of careers.reduce(function (a, r) { return a.concat(r.path); }, [])) {
  let ref = null, bestD = 99;
  for (const k in need) if (Math.abs(+k - st.d) < bestD) { bestD = Math.abs(+k - st.d); ref = need[k]; }
  if (ref === null) continue;
  const gap = st.lv - ref;
  gaps.push(gap);
}
/* ⚠ 층마다 여러 번 나오므로 줄줄이 찍지 않는다 — **평균만** 본다. */
const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
/* ⚠ 이 격차는 ①번 곡선을 기준으로 잰다. 그 곡선 자체가 12판 표본이라
 *   실행마다 몇 층의 판정이 뒤집히고, 그때 기준이 바뀌어 격차도 함께 흔들린다
 *   (실측: +2.7 → -0.2). 방향만 참고하고 값을 단정하지 말 것. */
console.log("  평균 " + (avgGap >= 0 ? "+" : "") + avgGap.toFixed(1) + "레벨" +
  (avgGap > 5 ? "  ⚠ 적정보다 한참 위 — 파밍할 이유가 없다"
   : avgGap < -3 ? "  ⚠ 적정보다 아래 — 벽에 부딪힌다" : ""));

/* ── ⑤-b 직업 격차 — **셋이 고르게 센가** ──────────────
 * ⚠ 이것이 직업을 넣은 값어치의 유일한 증거다. 하나가 압도적이면 나머지 둘은
 *   있으나 마나고, 하나가 못 쓰면 고를 이유가 없다. */
console.log("\n⑤-b 직업 격차 — 같은 층·같은 레벨을 셋이 돈다\n");
const CLS_ROWS = [];
for (const c of ["warrior", "rogue", "mage"]) {
  const name = await ev(`window.CLASSES.byId("${c}").name`);
  const r10 = await ev(`window.__trials({ depth: 10, level: 10, cls: "${c}", seed: 3131 }, ${N})`);
  const r20 = await ev(`window.__trials({ depth: 20, level: 20, cls: "${c}", seed: 4141 }, ${N})`);
  const r28 = await ev(`window.__trials({ depth: 28, level: 26, cls: "${c}", seed: 5151 }, ${N})`);
  const avg = (r10.clear + r20.clear + r28.clear) / 3;
  CLS_ROWS.push({ c, name, r10, r20, r28, avg });
  console.log("  " + name.padEnd(5) +
    " 10층 " + (r10.clear * 100).toFixed(0).padStart(3) + "%/" + String(r10.time).padStart(5) + "초" +
    " · 20층 " + (r20.clear * 100).toFixed(0).padStart(3) + "%/" + String(r20.time).padStart(5) + "초" +
    " · 28층 " + (r28.clear * 100).toFixed(0).padStart(3) + "%/" + String(r28.time).padStart(5) + "초" +
    "  받은피해 " + String(r20.taken).padStart(4));
}
const clsBest = Math.max(...CLS_ROWS.map(r => r.avg));
const clsWorst = Math.min(...CLS_ROWS.map(r => r.avg));
const clsGap = (clsBest - clsWorst) * 100;

/* ── ⑥ 봇 실력에 얼마나 기대고 있는가 ─────────────────
 * ⚠ 하네스가 스스로 경고한 것을 **실제로 재는** 자리다. 봇의 반응·조준을
 *   나쁘게 했을 때 결론이 뒤집히면, 그 수치는 "사람이 할 만하다" 의 근거가
 *   못 된다. 흔들리는 폭을 알아야 결론에 폭을 붙일 수 있다. */
console.log("\n⑥ 봇 실력 민감도 — 같은 층·같은 레벨, 봇만 바꿔서\n");
const SKILLLV = [
  { name: "빠름(0.12초·3°)",  react: 0.12, aimErr: 3 },
  { name: "기준(0.22초·8°)",  react: 0.22, aimErr: 8 },
  { name: "느림(0.35초·15°)", react: 0.35, aimErr: 15 },
  { name: "안 피함",          react: 0.22, aimErr: 8, dodge: false }
];
const sens = [];
for (const s2 of SKILLLV) {
  /* ⚠ **포화된 조건에서 재면 실력 차이가 안 보인다.** 20층/Lv.20 에서는 넷 다
   *   60~80% 로 뭉쳐 "빠른 봇이 느린 봇보다 못하다" 는 말이 안 되는 결과가
   *   나왔다(잡음이 ±15%p 인데 차이가 그보다 작았다). 일부러 **모자란 레벨**로
   *   험한 층에 넣고, 판수를 세 배로 늘린다. 그리고 클리어율만 보지 않고
   *   **받은 피해**도 본다 — 그쪽이 훨씬 민감하다. */
  const r = await ev(`window.__trials({ depth: 24, level: 18, seed: 8080, react: ${s2.react},
    aimErr: ${s2.aimErr}, dodge: ${s2.dodge === false ? "false" : "true"} }, ${N * 3})`);
  sens.push({ name: s2.name, r });
  console.log("  " + s2.name.padEnd(16) + " 깸 " + (r.clear * 100).toFixed(0).padStart(3) +
    "%  " + String(r.time).padStart(6) + "초  받은피해 " + String(r.taken).padStart(5) +
    "  최저체력 " + (r.hpLow * 100).toFixed(0).padStart(3) + "%");
}
const fast = sens[0].r, slow = sens[2].r, blind = sens[3].r, mid = sens[1].r;
const swing = Math.abs(fast.clear - slow.clear);
/* 회피가 실제로 값어치를 하는가 — 이게 실시간 전투가 성립하는지의 증거다 */
const dodgeWorth = blind.taken > 0 ? (blind.taken - mid.taken) / blind.taken : 0;

/* ── 판정 ─────────────────────────────────────────────── */
console.log("\n─── 판정 ───\n");
const verdict = [];
const V = (n, ok, note) => { verdict.push([n, ok, note]); };
/* 비율 판정 전용 — 문턱이 오차 범위 안에 들면 **판정하지 않는다.**
 * ⚠ "이 판수로는 못 가린다" 와 "통과" 는 다른 말이다. 섞으면 잡음을 결론으로
 *   보고하게 된다(실제로 그랬다 — 같은 코드로 두 번 돌려 판정 셋이 갈렸다). */
const VR = (name, rate, se, want, note, higherIsBetter = true) => {
  const lo = rate - 1.96 * se, hi = rate + 1.96 * se;
  const shaky = want > lo && want < hi;
  const ok = higherIsBetter ? rate >= want : rate <= want;
  verdict.push([name, ok, note + " · " + (rate * 100).toFixed(0) + "%±" +
    (1.96 * se * 100).toFixed(0) + "%p" +
    (shaky ? "  ⚠ 문턱(" + (want * 100).toFixed(0) + "%)이 오차 안이라 이 판수로는 못 가린다" : ""),
    shaky]);
};

/* ── 장비 요구가 층마다 **오르는가** ──
 * ⚠ 평평하면 파밍·강화를 할 이유가 없다. 낮은 층 장비로 끝까지 가면
 *   대장간도 전리품도 장식이 된다. */
const rungOf = g => LADDER.findIndex(x => x.n === g.n);
const rungs = gcurve.map(x => rungOf(x.g));
const rise = rungs[rungs.length - 1] - rungs[0];
V("장비 요구가 층마다 오르는가", rise >= 3,
  gcurve.map(x => x.d + "층 " + x.g.n).join(" · ") + " → 사다리 " + rise + "칸" +
  (rise < 3 ? "  ⚠ 평평하다 — 낮은 층 장비로 끝까지 간다(파밍·강화할 이유가 없다)" : ""));

const curveOK = curve.every(c => c.ok);
const overLevel = curve.filter(c => c.ok && c.lv > c.d + 4);
V("적정 레벨이 층과 맞는가", curveOK && overLevel.length === 0,
  curveOK ? (overLevel.length ? "⚠ 층보다 4레벨 넘게 필요한 곳: " +
      overLevel.map(c => c.d + "층→Lv." + c.lv).join(" · ")
    : "모든 층이 층수 ±4레벨 안에서 깨진다")
  : "⚠ Lv+10 에도 못 깨는 층: " + curve.filter(c => !c.ok).map(c => c.d + "층").join(" · "));

/* 보스는 다섯을 **합쳐** 본다 — 하나씩 10판이면 오차가 너무 크다 */
const bossAll = bossRows.reduce((a, b) => a + b.r.clear, 0) / bossRows.length;
const bossSe = Math.sqrt(bossAll * (1 - bossAll) / (bossRows.length * N));
const bossHard = bossRows.filter(b => b.r.clear + 1.96 * b.r.se < 0.5);
VR("보스 벽이 없는가", bossAll, bossSe, 0.5,
  bossRows.map(b => b.name + " " + (b.r.clear * 100).toFixed(0) + "%").join(" · ") +
  (bossHard.length ? "  ⚠ 확실히 못 깨는 보스: " + bossHard.map(b => b.name).join(",") : ""));

const naked = gearRows[0].r, rich = gearRows[3].r;
const gearGap = naked.time > 0 ? rich.time / naked.time : 0;
V("장비가 값어치를 하는가", rich.clear > naked.clear || rich.time < naked.time * 0.8,
  "맨몸 깸 " + (naked.clear * 100).toFixed(0) + "% / " + naked.time + "초 → 희귀 " +
  (rich.clear * 100).toFixed(0) + "% / " + rich.time + "초");

V("스킬 격차가 작은가", skillGap < 35,
  "가장 빠른 " + fastest.label + "(" + fastest.r.time + "초) ~ 가장 느린 " +
  slowest.label + "(" + slowest.r.time + "초) · 격차 " + skillGap.toFixed(0) + "%");

/* ⚠ 목표 분량은 **내가 정할 수 있는 값이 아니다** — 사람이 정하는 것이다.
 *   그래서 "끝까지 가는가" 만 판정하고 걸린 시간은 **알려만 준다.** */
V("끝까지 갈 수 있는가", career.done === CAREERS,
  career.done + "/" + CAREERS + " 경력이 Lv.30 · 30층에 닿았다 · " +
  career.minutes + "분(" + career.lo + "~" + career.hi + ") — 목표 분량은 정해야 할 값이다");

/* 긴장 — **한 번도 안 죽으면** 아무 일도 안 일어난 것이다.
 * ⚠ 문턱(0.5회)이 경력들의 **폭 안**에 들면 판정하지 않는다. 치명타가
 *   Math.random 이라 실행마다 흔들린다 — 실측으로 같은 코드가 0회와 1.6회를
 *   모두 냈다. "이 경력 수로는 못 가린다" 와 "통과" 는 다른 말이다. */
const tenShaky = career.dLo < 0.5 && career.dHi >= 0.5;
verdict.push(["긴장이 있는가", career.deaths >= 0.5,
  "경력당 죽음 " + career.deaths + "회(" + career.dEach.join("·") + ") · 적정보다 평균 " +
  (avgGap >= 0 ? "+" : "") + avgGap.toFixed(1) + "레벨" +
  (tenShaky ? "  ⚠ " + CAREERS + "경력으로는 못 가린다 — 안 죽은 경력과 죽은 경력이 섞였다"
   : career.deaths < 0.5 ? "  ⚠ 곧장 내려가도 안 죽는다 — 파밍할 이유가 없다" : ""),
  tenShaky]);

V("봇 실력에 안 기대는가", swing < 0.5,
  "24층을 Lv.18 로 · 빠른 봇 " + (fast.clear * 100).toFixed(0) + "% ~ 느린 봇 " +
  (slow.clear * 100).toFixed(0) + "% (차이 " + (swing * 100).toFixed(0) + "%p)");

/* ⚠ 이것이 **실시간 전투가 성립한다는 증거**다. 피하나 안 피하나 같으면
 *   선딜도 예고도 아무 뜻이 없고, 그냥 수치 싸움이다. */
V("피하는 것이 값어치를 하는가", dodgeWorth > 0.15,
  "안 피하면 " + blind.taken + " 피해 · 피하면 " + mid.taken + " 피해 (" +
  (dodgeWorth * 100).toFixed(0) + "% 덜 맞는다)");

/* ⚠ 옛 턴제판에서 쓰던 잣대를 그대로 가져왔다 — **25%p 이하**.
 *   그보다 벌어지면 "고를 수 있다" 가 아니라 "정답이 있다" 가 된다. */
/* ⚠ 격차는 두 비율의 차라 오차가 **각각의 오차를 합친 것**이다.
 *   10판씩이면 ±20%p 가 예사다 — 그래서 clsgap.mjs 로 실력별로 따로 잰다. */
const clsSe = Math.sqrt(2) * 1.96 * Math.sqrt(0.25 / (N * 3)) * 100;
V("직업이 고르다", clsGap <= 25 + clsSe,
  CLS_ROWS.map(r => r.name + " " + (r.avg * 100).toFixed(0) + "%").join(" · ") +
  " · 격차 " + clsGap.toFixed(0) + "%p (오차 ±" + clsSe.toFixed(0) +
  "%p — 실력별 갈라 보기는 tools/clsgap.mjs)");

V("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 2).join(" / ") : "0건");

let bad = 0, shaky = 0;
for (const row of verdict) {
  const [n, ok, note, isShaky] = row;
  if (isShaky) shaky++;
  else if (!ok) bad++;
  console.log((isShaky ? "~" : ok ? "✔" : "✘") + " " + n.padEnd(22, " ") + " " + note);
}
console.log("\n걸린 시간 " + ((Date.now() - t0) / 1000).toFixed(0) + "초 · " +
  (bad ? "✘ 손볼 곳 " + bad + "군데" : "✔ 손볼 곳 없음") +
  (shaky ? " · ~ 판정 보류 " + shaky + "건(판수를 늘려야 가린다)" : ""));
if (shaky) console.log("  판수를 늘려 다시: node tools/balance.mjs " + (N * 4));
console.log("\n⚠ 이 수치는 **반응 0.22초 · 조준 오차 8° 봇**의 것이다. 사람은 다르다 —");
console.log("  결론을 쓰기 전에 두어 개는 직접 밟아 대조할 것.");

try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
