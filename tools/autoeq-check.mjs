/* 자동장착 — 고른 한 벌이 **정말 가장 센 것**인가.
 *
 * 이 기능의 쓸모는 하나다: 일곱 칸을 일일이 견주지 않아도 되게 하는 것.
 * 그런데 고른 답이 참값보다 낮으면 사람이 손으로 고른 것만 못하고, 그걸
 * 알 방법이 없다 — 화면에는 늘 "이게 제일 좋다" 고 적히기 때문이다.
 * 그래서 여기서 재는 것은 모양이 아니라 **답의 참**이다.
 *
 *   ① 참값과 같은가    되풀이 탐욕 = 완전 탐색 (여러 직업 · 여러 가방)
 *   ② 나빠지지 않는가  입고 나서 전투력이 전보다 낮으면 안 된다
 *   ③ 예고가 참인가    미리보기가 적은 값 = 정말 입고 난 몸의 값
 *   ④ 잠근 칸          잠근 자리는 한 곳도 안 건드린다
 *   ⑤ 묻고 입는다      창만 뜨고, [이대로 입기] 전에는 아무것도 안 바뀐다
 *   ⑥ 물건이 안 샌다   입기 전후 물건 개수가 같다
 *   ⑦ 레벨 제한        지금 못 끼는 것은 고르지 않는다
 *   ⑧ 기준은 둘        균형 · 공격뿐이고 둘이 정말 다른 답을 낸다
 *   ⑨ 좁은 화면        390px 에서 문서가 안 넘친다
 *
 * ⚠ 한 바퀴만 도는 탐욕은 **참값보다 12.0 ~ 17.9% 낮았다**(실측 2026-09-25 ·
 *   네 직업). 칸끼리 서로 값을 바꾸기 때문이다(세트 · 적성 · 치명타 피해는
 *   무기가 무엇이냐에 따라 값이 달라진다). `OLD=1` 이 그 옛 방식으로
 *   되돌려 ①이 정말 빨개지는지 보여 준다. 되돌릴 자리를 못 찾으면 터뜨린다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ROOT = path.join(REPO, "public");
const OLD = process.env.OLD === "1";
const ui = process.argv.indexOf("--url");
const URL_ARG = ui >= 0 ? process.argv[ui + 1] : null;
if (URL_ARG && OLD) { console.error("--url 과 OLD=1 은 같이 못 쓴다"); process.exit(2); }

/* 대조군: 한 바퀴만 돌고, 맨바닥에서만 올라간다(= 옛 "한 번 탐욕"). */
const REVERT = [
  ["/js/autoeq.js", /while \(moved && laps < 12\) \{/, "while (moved && laps < 1) {"],
  ["/js/autoeq.js", /var best = \(c\.v > a\.v \+ 1e-9\) \? c : a;/, "var best = c;"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/autoeq.js"];

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  if (OLD && OLDIFY.indexOf(p) >= 0) {
    const body = oldify(p, fs.readFileSync(path.join(ROOT, p), "utf8"));
    r.writeHead(200, { "content-type": MIME[".js"] }); r.end(body); return;
  }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-ae-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--hide-scrollbars", "about:blank"],
  { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((res, rej) => {
  let b = ""; const t = setTimeout(() => rej(new Error("Chrome 이 30초 안에 안 떴다")), 30000);
  ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
});
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
const errs = []; let id = 0; const wait = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errs.push(d.text + " " + ((d.exception && d.exception.description) || ""));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
    errs.push(m.params.args.map(a => a.value === undefined ? a.description : a.value).join(" "));
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
});
const send = (me, p, s) => new Promise((res, rej) => {
  const i = ++id; wait.set(i, x => x.error ? rej(new Error(me + ": " + x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");

const ev = async x => {
  const r = await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("화면에서 터졌다 :: " + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = async () => {
  await S("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
};
/* ⚠ `.click()` 으로 판정하지 않는다. 잘린 요소에도 먹는다 — 좌표를 그 요소가
 *   받는지 보고 진짜 마우스로 누른다. */
async function realClick(sel) {
  await ev(`(function(){
    var e = document.querySelector(${JSON.stringify(sel)});
    if (e && e.scrollIntoView) e.scrollIntoView({ block: "center" });
  })()`);
  await sleep(140);
  const at = await ev(`(function(){
    var e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return null;
    var r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { hidden: true };
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    var hit = document.elementFromPoint(x, y);
    return { x: x, y: y, mine: !!(hit && (hit === e || e.contains(hit))) };
  })()`);
  if (!at || at.hidden || !at.mine) return at;
  await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none", buttons: 0 });
  await S("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
  await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(300);
  return at;
}

const W = 1280, H = 900;
await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Page.navigate", { url: TARGET });
/* ⚠ 고정 기다림으로 단정하지 않는다 — 준비되면 넘어간다. */
for (let i = 0; i < 400; i++) {
  if (await ev("!!(window.ITEMS && window.AUTOEQ && window.__w && window.__aeplan)")) break;
  await sleep(60);
}
await sleep(500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* 사방이 트인 마당. 가방은 **우리가 짠다** — `__give` 는 유물만 스물넷이라
 * 완전 탐색 갈래가 너무 많고 레벨 제한 갈래를 한 번도 안 밟는다. */
const SEED = `
window.__aeseed = function (cls, lvl, perSlot, seed, hiN) {
  var I = window.ITEMS, D = window.DUNGEON, S = window.SAVE;
  window.__pick(cls);
  var h = window.__hero();
  h.level = lvl; h.equip = {}; h.bag = []; h.locks = {};
  var rng = D.makeRng(seed);
  var TI = ["common", "magic", "rare", "relic"];
  for (var s = 0; s < I.SLOTS.length; s++) {
    for (var k = 0; k < perSlot; k++) {
      var it = I.roll(rng, { slot: I.SLOTS[s], ilvl: Math.max(1, lvl - 2), tier: TI[(s + k) % 4] });
      if (it) h.bag.push(I.pack(it));
    }
  }
  /* 아직 못 끼는 것 — 레벨 제한을 밟게 한다 */
  for (var q = 0; q < (hiN || 0); q++) {
    /* ⚠ 이 게임의 요구 레벨 상한은 **12** 이다(베이스 lvl 최대 12 ·
     *   접사 il 최대 14 × 0.8). Lv.15 에서는 막힐 물건이 아예 없어
     *   이 갈래를 한 번도 안 밟는다 — 낮은 레벨로 재야 한다. */
    var hi = I.roll(rng, { slot: "weapon", ilvl: 14, tier: "relic" });
    if (hi) h.bag.push(I.pack(hi));
  }
  window.__w().applyHero();
  S.save(h);
  return { bag: h.bag.length, lvl: h.level, cls: h.cls };
};

/* 완전 탐색 — 참값. 칸마다 '비움' 까지 후보로 둔다. */
window.__aebrute = function (key) {
  var I = window.ITEMS, S = window.SAVE, w = window.__w(), h = window.__hero();
  var eq = S.liveEquip(h), bag = S.liveBag(h), L = h.locks || {};
  var slots = [], fixed = {};
  for (var i = 0; i < I.SLOTS.length; i++) {
    if (L[I.SLOTS[i]]) { if (eq[I.SLOTS[i]]) fixed[I.SLOTS[i]] = eq[I.SLOTS[i]]; }
    else slots.push(I.SLOTS[i]);
  }
  var bySlot = {};
  slots.forEach(function (s) { bySlot[s] = []; });
  for (var b = 0; b < bag.length; b++) {
    var it = bag[b];
    if (!it || !bySlot[it.slot]) continue;
    if (!I.canEquip(it, h.level)) continue;
    bySlot[it.slot].push(it);
  }
  /* 지금 낀 것도 후보다 */
  slots.forEach(function (s) { if (eq[s]) bySlot[s].push(eq[s]); });
  function sc(e) { return window.AUTOEQ.scoreOf(w, e, key); }
  function cp(e) { var o = {}, k; for (k in e) if (e[k]) o[k] = e[k]; return o; }
  var best = null, bv = -1, tried = 0;
  function walk(i, e) {
    if (i === slots.length) { tried++; var v = sc(e); if (v > bv) { bv = v; best = cp(e); } return; }
    var s = slots[i], list = bySlot[s];
    walk(i + 1, e);
    for (var j = 0; j < list.length; j++) { var t = cp(e); t[s] = list[j]; walk(i + 1, t); }
  }
  var t0 = performance.now();
  walk(0, cp(fixed));
  return { v: Math.round(bv * 1000) / 1000, tried: tried, ms: Math.round(performance.now() - t0) };
};
`;
await ev(SEED);

/* ── ① 참값과 같은가 ───────────────────────────────────── */
const CASES = [["warrior", 15, 11], ["knight", 15, 22], ["rogue", 20, 33], ["mage", 25, 44]];
const gaps = [];
let combos = 0, bms = 0, cms = 0;
for (const [cls, lvl, seed] of CASES) {
  for (const key of ["mix", "atk"]) {
    const r = await ev(`(function(){
      window.__aeseed(${JSON.stringify(cls)}, ${lvl}, 3, ${seed}, 0);
      window.__aekey(${JSON.stringify(key)});
      var t0 = performance.now();
      var p = window.__aeplan();
      var cms = performance.now() - t0;
      var mine = window.AUTOEQ.scoreOf(window.__w(), p.eq, ${JSON.stringify(key)});
      var b = window.__aebrute(${JSON.stringify(key)});
      return { mine: Math.round(mine * 1000) / 1000, best: b.v, tried: b.tried,
               bms: b.ms, cms: Math.round(cms), laps: p.laps, n: p.changes.length };
    })()`);
    combos += r.tried; bms += r.bms; cms += r.cms;
    const gap = r.best > 0 ? (r.best - r.mine) / r.best * 100 : 0;
    gaps.push({ cls, key, gap, mine: r.mine, best: r.best });
  }
}
const worst = gaps.reduce((a, b) => (b.gap > a.gap ? b : a), gaps[0]);
add("참값과 같다", worst.gap < 0.01,
  CASES.length + "직업 × 기준 둘 · 완전 탐색 " + combos.toLocaleString() + "갈래 대조 · " +
  "가장 나쁜 차이 " + worst.gap.toFixed(2) + "% (" + worst.cls + "/" + worst.key + " " +
  worst.mine + " vs " + worst.best + ") · 되풀이 탐욕 " + cms + "ms · 완전 탐색 " + bms + "ms");

/* ── ② 나빠지지 않는다 · ③ 예고가 참인가 · ⑥ 물건이 안 샌다 ─── */
await ev(`window.__aeseed("warrior", 15, 3, 11, 0); window.__aekey("mix")`);
await sleep(200);
const both = await ev(`(function(){
  var S = window.SAVE, h = window.__hero(), w = window.__w();
  var p = window.__aeplan();
  var before = { dps: p.before.dps, ehp: p.before.ehp,
                 items: h.bag.length + Object.keys(h.equip).length };
  var say = { dps: p.after.dps, ehp: p.after.ehp, n: p.changes.length };
  return { before: before, say: say };
})()`);
/* 진짜로 입혀 본다 — 화면을 거쳐서. */
await ev("window.__bag()");
await sleep(350);
await realClick("#btnAutoEq");
await sleep(300);
const shown = await ev(`(function(){
  var m = document.getElementById("aeModal");
  if (!m) return { none: true };
  var h = window.__hero();
  return { rows: m.querySelectorAll(".ae-row").length,
           keys: m.querySelectorAll(".ae-key-chip").length,
           locks: m.querySelectorAll(".ae-lk").length,
           go: (m.querySelector("[data-act=aego]") || {}).textContent || "",
           /* ⑤ 아직 아무것도 안 바뀌었어야 한다 */
           worn: Object.keys(h.equip).length, bag: h.bag.length };
})()`);
add("묻고 나서 입는다", !shown.none && shown.rows > 0 && shown.worn === 0,
  shown.none ? "창이 안 열렸다"
    : ("창이 뜨고 " + shown.rows + "곳을 미리 보여 줌 · 기준칩 " + shown.keys +
       " · 잠금칩 " + shown.locks + " · 누르기 전 낀 것 " + shown.worn + "곳(0 이어야 한다)"));

await realClick("#aeModal [data-act=aego]");
await sleep(450);
const after = await ev(`(function(){
  var S = window.SAVE, h = window.__hero(), w = window.__w();
  var d = w.derive(S.liveEquip(h));
  return { dps: d.dps, ehp: d.ehp, worn: Object.keys(h.equip).length,
           items: h.bag.length + Object.keys(h.equip).length,
           /* 몸에 정말 붙었나 — derive 로만 재면 제자리를 도는 셈이다 */
           bodyDmg: w.player.baseDmg, bodyAps: w.player.baseAps, bodyHp: w.player.maxHp,
           open: !!document.getElementById("aeModal") };
})()`);
add("나빠지지 않는다", after.dps >= both.before.dps - 1e-6 && after.ehp >= both.before.ehp - 1e-6,
  "공격 " + both.before.dps + " → " + after.dps + " · 생존 " + both.before.ehp + " → " + after.ehp +
  " · 낀 것 " + after.worn + "곳");
const sayOk = Math.abs(after.dps - both.say.dps) < 0.05 && Math.abs(after.ehp - both.say.ehp) < 1;
add("예고가 참이다", sayOk,
  "예고 공격 " + both.say.dps + " · 생존 " + both.say.ehp + " → 정말 " + after.dps + " · " + after.ehp +
  " · 몸에 붙은 값 한 대 " + after.bodyDmg + " · 초당 " + after.bodyAps + "타 · 체력 " + after.bodyHp);
add("물건이 안 샌다", after.items === both.before.items,
  "입기 전 " + both.before.items + "개 → 뒤 " + after.items + "개 (가방으로 돌아온 것까지)");

/* ── ④ 잠근 칸은 안 건드린다 ───────────────────────────── */
const lock = await ev(`(function(){
  var S = window.SAVE, h = window.__hero();
  window.__aeseed("warrior", 15, 3, 77, 0);
  /* 먼저 한 벌 입혀 두고 무기를 잠근다 */
  var p0 = window.__aeplan();
  var I = window.ITEMS;
  var bag = S.liveBag(h);
  /* 가방에서 무기 하나를 골라 끼운다 — 잠글 것이 있어야 한다 */
  for (var i = 0; i < bag.length; i++) if (bag[i].slot === "weapon") { window.__equipBag(i); break; }
  var worn = S.liveEquip(h).weapon;
  window.__aelock("weapon", true);
  var p = window.__aeplan();
  var touched = p.changes.filter(function (c) { return c.slot === "weapon"; }).length;
  /* 잠근 것을 풀면 다시 후보가 되는가 */
  window.__aelock("weapon", false);
  var p2 = window.__aeplan();
  var free = p2.changes.filter(function (c) { return c.slot === "weapon"; }).length;
  return { name: worn ? worn.name : null, touched: touched, free: free,
           locked: p.locked.join(","), n: p.changes.length, n2: p2.changes.length };
})()`);
add("잠근 칸은 안 건드린다", lock.touched === 0 && lock.free > 0,
  "무기 [" + lock.name + "] 를 잠그면 바꿀 곳 " + lock.n + "곳에 무기 " + lock.touched +
  "곳 · 풀면 " + lock.n2 + "곳에 무기 " + lock.free + "곳");

/* 잠금이 저장에 남는가 — 새로고침해도 살아야 한다 */
await ev(`window.__aelock("ring", true)`);
await ev("window.__save()");
const keptLock = await ev(`(function(){
  var raw = window.SAVE.load().save;
  return { ring: !!(raw.locks && raw.locks.ring), keys: Object.keys(raw.locks || {}).join(",") };
})()`);
add("잠금이 저장된다", keptLock.ring, "다시 읽은 저장의 잠긴 칸: [" + keptLock.keys + "]");
await ev(`window.__aelock("ring", false)`);

/* ── ⑦ 레벨 제한 ───────────────────────────────────────── */
const gate = await ev(`(function(){
  var S = window.SAVE, I = window.ITEMS;
  window.__aeseed("warrior", 3, 3, 55, 6);
  var h = window.__hero();
  var p = window.__aeplan();
  var bad = p.changes.filter(function (c) { return c.to && !I.canEquip(c.to, h.level); }).length;
  /* 모자란 것을 내가 세지 않고 **가방에서 다시 센다** —
   * 새어서 맞추면 검사가 제 수를 재는 꼴이 된다. */
  var real = 0;
  var bag = S.liveBag(h);
  for (var i = 0; i < bag.length; i++) if (!I.canEquip(bag[i], h.level)) real++;
  return { bad: bad, later: p.later, real: real, req: p.laterReq, lvl: h.level, n: p.changes.length };
})()`);
add("못 끼는 것은 안 고른다", gate.bad === 0 && gate.real > 0 && gate.later === gate.real,
  "Lv." + gate.lvl + " 인데 가방에 못 끼는 것 " + gate.real + "개(가장 낮은 것이 Lv." + gate.req + ") · " +
  "창이 센 것 " + gate.later + "개 · 고른 " + gate.n + "곳 중 못 끼는 것 " + gate.bad + "개");

/* ── ⑧ 기준은 둘이고 서로 다른 답을 낸다 ─────────────────
 * ⚠ 생존 기준을 더하지 않았는지도 여기서 지킨다. 재 보니 생존만 좇아도
 *   생존이 균형보다 평균 2.1% 밖에 안 느는데 공격을 최대 89% 버린다. */
const two = await ev(`(function(){
  window.__aeseed("mage", 25, 3, 11, 0);
  var w = window.__w();
  window.__aekey("mix"); var m = window.__aeplan();
  window.__aekey("atk"); var a = window.__aeplan();
  window.__aekey("mix");
  return { keys: window.AUTOEQ.KEYS.map(function (k) { return k.id; }).join(","),
           mix: { dps: m.after.dps, ehp: m.after.ehp },
           atk: { dps: a.after.dps, ehp: a.after.ehp } };
})()`);
const differ = two.atk.dps > two.mix.dps - 1e-9 && two.mix.ehp >= two.atk.ehp - 1e-9;
add("기준은 둘이다", two.keys === "mix,atk" && differ,
  "기준 [" + two.keys + "] · 균형 공격 " + two.mix.dps + " / 생존 " + two.mix.ehp +
  " · 공격 기준 " + two.atk.dps + " / " + two.atk.ehp);

/* ── ⑨ 좁은 화면 ───────────────────────────────────────── */
await esc(); await sleep(200); await esc(); await sleep(200);
await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await sleep(300);
await ev(`window.__aeseed("warrior", 15, 3, 11, 0)`);
await ev("window.__bag()");
await sleep(400);
await realClick("#btnAutoEq");
await sleep(400);
const narrow = await ev(`(function(){
  var m = document.getElementById("aeModal");
  if (!m) return { none: true };
  var c = m.querySelector(".ae-card");
  var r = c.getBoundingClientRect();
  var over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  /* 칸 안의 것이 카드 밖으로 나갔는가 — 문서 넘침으로는 안 잡힌다 */
  var outN = 0;
  [].slice.call(c.querySelectorAll(".ae-row, .ae-key-chip, .ae-lk, .ae-t")).forEach(function (e) {
    var q = e.getBoundingClientRect();
    if (q.width < 1) return;
    if (q.right > r.right + 1 || q.left < r.left - 1) outN++;
  });
  return { w: Math.round(r.width), h: Math.round(r.height), over: over, outN: outN,
           inView: r.top >= -1 && r.bottom <= window.innerHeight + 1 };
})()`);
add("좁은 화면", !narrow.none && narrow.over === 0 && narrow.outN === 0,
  narrow.none ? "창이 안 열렸다"
    : ("390px 에서 창 " + narrow.w + "x" + narrow.h + " · 문서 넘침 " + narrow.over +
       "px · 카드 밖으로 나간 것 " + narrow.outN + "개"));

console.log(OLD ? "── 자동장착 [대조군: 한 바퀴만 도는 탐욕] ──"
                : ("── 자동장착" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
