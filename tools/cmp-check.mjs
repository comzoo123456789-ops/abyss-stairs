/* 견주기 — 표가 **예고한 값**과 **정말 끼고 난 값**이 같은가.
 *
 * 이 화면의 쓸모는 하나다: "이걸 끼면 어떻게 되나" 에 맞는 답을 하는 것.
 * 틀린 답을 자신 있게 적으면 없는 것보다 나쁘다 — 그 숫자를 믿고 장비를
 * 갈아 끼우기 때문이다. 그래서 여기서 재는 것은 모양이 아니라 **숫자의 참**이다.
 *
 *   ① 셈이 한 곳인가      derive() 가 준 값이 몸에 붙은 값과 같다
 *   ② 표가 맞는가          예고한 초당 피해 = 정말 끼고 난 초당 피해
 *   ③ 기준이 첫 칸인가     "지금 낀 것" 이 맨 앞이고 옆으로 굴러도 붙어 있다
 *   ④ 자리마다 묶는가      무기와 투구를 함께 고르면 묶음 둘
 *   ⑤ ESC 가 한 겹씩       견주기만 닫히고 가방은 남는다
 *   ⑥ 좁은 화면            390px 에서 문서가 안 넘친다
 *
 * ⚠ 물건의 능력치만 견주면 **거짓말이 된다.** 활은 한 대 14 인데 초당 0.85대고
 *   단검은 그 반대다. 직업 기본값 · 무기 적성 · 세트 보너스도 다 얹혀야 한다.
 *   `OLD=1` 이 그 "물건 능력치만 보는" 옛 방식으로 되돌려, ②가 정말 빨개지는지
 *   보여 준다. 되돌릴 자리를 못 찾으면 터뜨린다.
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

/* 대조군: 견주기가 **물건의 능력치만** 보게 되돌린다(직업·적성·세트 없이). */
const NAIVE = `var ds = cols.map(function (c) {
      var it2 = c.it, t2 = {};
      for (var kk in ((it2 && it2.s) || {})) t2[kk] = it2.s[kk];
      return { t: t2, sets: [], maxHp: t2.hp || 0, def: t2.armor || 0, spd: 0,
               critPct: t2.critPct || 0, critDmgPct: t2.critDmgPct || 0,
               lifeOnHit: t2.lifeOnHit || 0, goldPct: 0, xpPct: 0,
               swing: { dmg: t2.dmg || 0, aps: 1, reach: 0 },
               dps: t2.dmg || 0 };
    });`;
const REVERT = [
  ["/js/app.js",
   /var ds = cols\.map\(function \(c\) \{ return world\.derive\(eqWith\(eq, c\.it, slot\)\); \}\);/,
   NAIVE]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/app.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-cmp-"));
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
  /* ⚠ 가방은 **구르는 칸**이다. 아래쪽 칸은 화면 밖(y 1261 을 봤다)이라
   *   좌표가 그 요소에 안 닿는다 — 굴려 넣고 나서 잰다. 이걸 안 하고
   *   `.click()` 으로 때우면 "눌렸다" 로 통과하는데 사람은 못 누른다. */
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
  await sleep(260);
  return at;
}

const W = 1280, H = 860;
await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Page.navigate", { url: TARGET });
await sleep(1500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* 사방이 트인 마당 · 시험 장비 · 활을 쥔다 */
const setup = await ev(`(function(){
  window.__start({ depth: 1 });
  var w = window.__w();
  w.level.tiles.fill(window.DUNGEON.FLOOR);
  w.level.visible.fill(1); w.level.seen.fill(1);
  w.refreshFov = function () { this.level.visible.fill(1); return false; };
  w.ents.length = 1;
  window.__give();
  var bi = window.__findBag("bow");
  if (bi >= 0) window.__equipBag(bi);
  return { bow: bi >= 0, lvl: window.__hero().level };
})()`);
await sleep(400);
await esc(); await sleep(250);

/* ── ① 셈이 한 곳인가 ─────────────────────────────────
 * derive() 가 준 값이 몸에 붙은 값과 한 자리도 안 달라야 한다.
 * ⚠ 이 둘이 갈리면 견주기가 아니라 **게임이 틀린 것**이다. */
const same = await ev(`(function(){
  var w = window.__w(), p = w.player;
  var d = w.derive(window.SAVE.liveEquip(window.__hero()));
  var gaps = [];
  function eq(name, a, b) { if (Math.abs(a - b) > 1e-6) gaps.push(name + " " + a + " vs " + b); }
  eq("최대체력", d.maxHp, p.maxHp);
  eq("방어", d.def, p.baseDef);
  eq("이동", d.spd, p.spd);
  eq("치명타", d.critPct, p.critPct);
  eq("치명타피해", d.critDmgPct, p.critDmgPct);
  eq("타격회복", d.lifeOnHit, p.lifeOnHit);
  eq("한대피해", d.swing.dmg, p.baseDmg);
  eq("공격속도", d.swing.aps, p.baseAps);
  eq("사거리", d.swing.reach, p.swing.reach);
  return { gaps: gaps, dps: d.dps, n: 9 };
})()`);
add("셈이 한 곳이다", same.gaps.length === 0,
  "derive 와 몸의 값 " + same.n + "가지 대조 · 어긋남 " + same.gaps.length +
  (same.gaps.length ? " · " + same.gaps.join(" / ") : "") + " · 지금 초당 피해 " + same.dps);

/* ── ② 표가 예고한 값이 정말 그렇게 되는가 ─────────────── */
await ev("window.__bag()");
await sleep(350);
/* 무기 하나를 고른다 — 지금 낀 활과 다른 것 */
const pick = await ev(`(function(){
  var bag = window.SAVE.liveBag(window.__hero());
  for (var i = 0; i < bag.length; i++)
    if (bag[i] && bag[i].slot === "weapon") return { i: i, name: bag[i].name, base: bag[i].base };
  return null;
})()`);
let predicted = null, actual = null, cmpNote = "가방에 무기가 없다";
if (pick) {
  await realClick('[data-sel="' + pick.i + '"]');
  const btn = await realClick("#btnCompareSel");
  await sleep(300);
  const tbl = await ev(`(function(){
    var m = document.getElementById("cmpModal");
    if (!m) return { none: true };
    var rows = [].slice.call(m.querySelectorAll(".cmp-t tbody tr"));
    var r = rows.filter(function (x) {
      var h = x.querySelector(".cmp-rowh");
      return h && h.textContent.trim() === "초당 피해";
    })[0];
    if (!r) return { norow: true, rows: rows.length };
    var tds = [].slice.call(r.querySelectorAll("td"));
    return { mine: parseFloat(tds[0].querySelector("b").textContent),
             cand: parseFloat(tds[1].querySelector("b").textContent),
             grps: m.querySelectorAll(".cmp-grp").length,
             rows: rows.length };
  })()`);
  if (tbl.none) cmpNote = "견주기 창이 안 열렸다 (단추 " + JSON.stringify(btn) + ")";
  else if (tbl.norow) cmpNote = "초당 피해 줄이 없다 (줄 " + tbl.rows + "개)";
  else {
    predicted = tbl.cand;
    /* 정말 끼워 보고 **몸에서** 다시 잰다. derive 로 재면 제자리를 도는 셈이다 */
    actual = await ev(`(function(){
      window.__equipBag(${pick.i});
      var p = window.__w().player;
      return Math.round(p.swing.dmg * p.swing.aps * 10) / 10;
    })()`);
    cmpNote = pick.name + " · 예고 " + predicted + " · 정말 끼니 " + actual +
      " (지금 낀 것 " + tbl.mine + ")";
  }
}
add("표가 맞는다", predicted !== null && actual !== null &&
  Math.abs(predicted - actual) <= 0.05, cmpNote);

/* 뒷정리 — 다음 잼은 깨끗한 화면에서 */
await ev(`(function(){
  ["cmpModal", "itemModal", "itemCtx"].forEach(function (k) {
    var e = document.getElementById(k); if (e && e.parentNode) e.parentNode.removeChild(e);
  });
})()`);
await sleep(200);

/* ── ③ 기준 칸 · ④ 자리마다 묶기 ───────────────────────
 * 무기 하나와 투구 하나를 함께 고른다. 막지 않고 **묶어서** 보여야 한다. */
await ev("window.__bag()");
await sleep(350);
/* ⚠ 앞 잼에서 고른 것을 **풀고** 시작한다. 고른 것은 일부러 남겨 두는 값이라
 *   (여러 종류를 한 번에 분해하려고) 안 풀면 다음 잼이 그것까지 들고 간다.
 *   게다가 ②에서 하나를 끼워 가방 번호가 밀렸다 — 같은 번호가 딴 물건이다. */
await realClick("#btnSelNone");
const two = await ev(`(function(){
  var bag = window.SAVE.liveBag(window.__hero());
  var w = -1, hd = -1;
  for (var i = 0; i < bag.length; i++) {
    if (!bag[i]) continue;
    if (w < 0 && bag[i].slot === "weapon") w = i;
    if (hd < 0 && bag[i].slot === "head") hd = i;
  }
  return { w: w, h: hd };
})()`);
let grpNote = "무기나 투구가 없다", grpOk = false, stickNote = "-", stickOk = false;
if (two.w >= 0 && two.h >= 0) {
  await realClick('[data-sel="' + two.w + '"]');
  await realClick('[data-sel="' + two.h + '"]');
  await realClick("#btnCompareSel");
  await sleep(320);
  const g = await ev(`(function(){
    var m = document.getElementById("cmpModal");
    if (!m) return { none: true };
    var grps = [].slice.call(m.querySelectorAll(".cmp-grp"));
    var heads = [].slice.call(m.querySelectorAll(".cmp-t thead th"));
    var first = m.querySelector(".cmp-t thead th:nth-child(2)");
    var rowh = m.querySelector(".cmp-t .cmp-rowh");
    var st = rowh ? getComputedStyle(rowh) : null;
    return { n: grps.length,
             slots: grps.map(function (x) { return x.querySelector(".cmp-slot").textContent.trim(); }),
             firstTag: first ? first.querySelector(".cmp-tag").textContent.trim() : "",
             firstNm: first ? first.querySelector(".cmp-nm").textContent.trim() : "",
             sticky: st ? st.position : "",
             left: st ? st.left : "" };
  })()`);
  if (g.none) grpNote = "견주기 창이 안 열렸다";
  else {
    grpOk = g.n === 2;
    grpNote = "묶음 " + g.n + "개 · " + g.slots.join(" / ") + " (막지 않고 나눠 보인다)";
    stickOk = g.firstTag === "지금 낀 것" && g.sticky === "sticky" && g.left === "0px";
    stickNote = "첫 칸 [" + g.firstTag + "] " + g.firstNm +
      " · 줄 이름 " + g.sticky + " left " + g.left;
  }
}
add("자리마다 묶는다", grpOk, grpNote);
add("기준이 첫 칸이다", stickOk, stickNote);

/* ── ⑤ ESC 는 한 겹씩 ───────────────────────────────── */
const lay = await ev(`(function(){
  return { cmp: !!document.getElementById("cmpModal"),
           bag: !document.getElementById("panel").hidden };
})()`);
await esc(); await sleep(260);
const lay2 = await ev(`(function(){
  return { cmp: !!document.getElementById("cmpModal"),
           bag: !document.getElementById("panel").hidden };
})()`);
await esc(); await sleep(260);
const lay3 = await ev(`!document.getElementById("panel").hidden`);
add("ESC 는 한 겹씩", lay.cmp && lay.bag && !lay2.cmp && lay2.bag && !lay3,
  "견주기 " + (lay.cmp ? "열림" : "닫힘") + " → ESC → 견주기 " + (lay2.cmp ? "열림" : "닫힘") +
  " · 가방 " + (lay2.bag ? "열림" : "닫힘") + " → ESC → 가방 " + (lay3 ? "열림" : "닫힘"));

/* ── ⑥ 좁은 화면 ────────────────────────────────────
 * ⚠ 표는 **표 안에서** 옆으로 구른다. 문서가 넘치면 안 된다. */
await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await ev("window.__bag()");
await sleep(350);
await realClick("#btnSelNone");
let narrow = { over: -1 };
if (pick) {
  await realClick('[data-sel="' + two.w + '"]');
  await realClick("#btnCompareSel");
  await sleep(320);
  narrow = await ev(`(function(){
    var m = document.getElementById("cmpModal");
    if (!m) return { none: true };
    var card = m.querySelector(".cmp-card").getBoundingClientRect();
    var sc = m.querySelector(".cmp-scroll");
    return { over: document.documentElement.scrollWidth - window.innerWidth,
             cardW: Math.round(card.width), win: window.innerWidth,
             inner: sc ? (sc.scrollWidth > sc.clientWidth) : false,
             outside: Math.max(0, Math.round(card.right - window.innerWidth)) };
  })()`);
}
add("좁은 화면", !narrow.none && narrow.over <= 0 && narrow.outside === 0,
  narrow.none ? "견주기 창이 안 열렸다"
    : "390px · 문서 넘침 " + narrow.over + "px · 창 " + narrow.cardW + "px(화면 " + narrow.win +
      ") · 밖으로 " + narrow.outside + "px · 표는 안에서 구른다 " + narrow.inner);

/* ── ⑦ 문이 셋이다 ──────────────────────────────────
 * 가방 [견주기] · 물건 창의 한 줄 요약 · 오른쪽 단추.
 * ⚠ 문을 셋 내고 하나만 재면 나머지 둘은 죽어도 모른다. 이 저장소에서
 *   [지우기] 가 어느 줄에서도 안 눌리는데 검사가 통과한 이력이 있다. */
await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(250);
await ev(`(function(){
  var e = document.getElementById("cmpModal"); if (e) e.remove();
})()`);
await ev("window.__bag()");
await sleep(350);
let doors = { mini: 0, more: false, opened: false, ctx: false };
const one = await ev(`(function(){
  var bag = window.SAVE.liveBag(window.__hero());
  for (var i = 0; i < bag.length; i++) if (bag[i] && bag[i].slot) return i;
  return -1;
})()`);
if (one >= 0) {
  await realClick('[data-bag-idx="' + one + '"]');
  const mini = await ev(`(function(){
    var m = document.getElementById("itemModal");
    if (!m) return { nomodal: true };
    return { rows: m.querySelectorAll(".cmp-mini-r").length,
             head: !!m.querySelector(".cmp-mini-t"),
             more: !!m.querySelector(".cmp-more") };
  })()`);
  doors.mini = mini.rows || 0;
  doors.more = !!mini.more;
  if (mini.more) {
    await realClick(".cmp-more");
    doors.opened = await ev('!!document.getElementById("cmpModal")');
  }
  await ev(`(function(){
    ["cmpModal", "itemModal"].forEach(function (k) {
      var e = document.getElementById(k); if (e) e.remove();
    });
  })()`);
  await sleep(200);
  /* 오른쪽 단추 — 진짜 contextmenu 를 쏜다 */
  const at = await ev(`(function(){
    var e = document.querySelector('[data-bag-idx="${one}"]');
    if (!e) return null;
    e.scrollIntoView({ block: "center" });
    var r = e.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (at) {
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "right", buttons: 2, clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "right", buttons: 0, clickCount: 1 });
    await sleep(260);
    doors.ctx = await ev(`(function(){
      var c = document.getElementById("itemCtx");
      return !!(c && c.querySelector('[data-do=compare]'));
    })()`);
  }
}
add("문이 셋이다", doors.mini > 0 && doors.more && doors.opened && doors.ctx,
  "가방 단추 ✔ · 물건 창 요약 " + doors.mini + "줄 · [자세히 견주기] " +
  (doors.more ? "있음" : "없음") + "→" + (doors.opened ? "열림" : "안 열림") +
  " · 오른쪽 단추 " + (doors.ctx ? "있음" : "없음"));

console.log(OLD ? "── 견주기 [대조군: 물건 능력치만 본다] ──"
                : ("── 견주기" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
console.log("   (활 " + (setup.bow ? "쥠" : "없음") + " · Lv." + setup.lvl + ")");
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(14) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
