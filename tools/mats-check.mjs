/* 재료 가방 — 세는 자리이지 소개하는 자리가 아니다.
 *
 * 고치기 전 실측(2026-09-25): 재료 넷이 934x70 짜리 카드로 늘어서 **310px**
 * (휴대폰 368px)를 먹었다. 넷뿐이고 하는 일은 "몇 개 있나" 인데 화면의
 * 한 켜를 영구히 차지했다. 설명은 **버리지 않고** 손을 올렸을 때로 옮겼다.
 *
 *   ① 장비 가방과 같은 칸   재료 칸 크기 = 가방 칸 크기 (따로 놀지 않는다)
 *   ② 늘어놓지 않는다      넷이 한 줄 · 묶음 높이가 칸 하나만 하다
 *   ③ 손을 올리면 뜬다     이름 · 개수 · 설명이 다 있다
 *   ④ 설명을 안 버렸다     뜬 글이 원문과 **한 글자도** 다르지 않다
 *   ⑤ 눌러도 뜬다         휴대폰에는 hover 가 없다 (유일한 길)
 *   ⑥ 밖으로 안 나간다     상자가 화면 밖 0 · 패널 밖 0
 *   ⑦ 떼면 사라진다       손을 떼거나 패널을 닫으면 남지 않는다
 *   ⑧ 이름이 한 곳에서     연금술사 바가 같은 표(MATS)에서 온다
 *
 * ⚠ `title` 속성으로 때우지 말 것. 뜨는 데 1초가 넘고 **휴대폰에서는 아예
 *   안 뜬다** — 설명을 옮긴 뜻이 통째로 사라진다. `OLD=1` 이 옛 모양으로
 *   되돌려 ①②③⑤가 정말 빨개지는지 보여 준다.
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

/* 대조군: 칸을 세로로 늘어놓고, 설명 배선을 끊는다. */
const REVERT = [
  ["/css/rpg.css",
   /\.mats-tab-container \{\n  display: grid;\n  grid-template-columns: repeat\(auto-fill, var\(--bag-cell, 48px\)\);\n  justify-content: start;\n  gap: 6px;\n  margin-top: 10px;\n\}/,
   ".mats-tab-container {\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n  margin-top: 10px;\n}"],
  ["/js/app.js", /^(\s*)bindMatTip\(box\);$/m, "$1void 0;"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/css/rpg.css", "/js/app.js"];

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  if (OLD && OLDIFY.indexOf(p) >= 0) {
    const body = oldify(p, fs.readFileSync(path.join(ROOT, p), "utf8"));
    r.writeHead(200, { "content-type": MIME[path.extname(p)] }); r.end(body); return;
  }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-mt-"));
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
const BASE = URL_ARG ? URL_ARG.replace(/\/?$/, "/") : "http://127.0.0.1:" + port + "/index.html";

async function open(w, h, touch) {
  await S("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !!touch });
  await S("Page.navigate", { url: BASE + "?cb=" + Math.random().toString(36).slice(2) });
  for (let i = 0; i < 400; i++) {
    if (await ev("!!(window.__give && window.__bag && window.SAVE)")) break;
    await sleep(60);
  }
  await sleep(400);
  await ev(`(function(){
    window.__pick("warrior"); window.__give();
    var h = window.__hero();
    h.mats = { m_dust: 137, m_crystal: 12, m_essence: 3, m_scale: 0 };
    window.SAVE.save(h);
  })()`);
  await sleep(250);
  await ev("window.__bag()");
  await sleep(450);
}
async function toMats() {
  await ev(`(function(){ var b = document.getElementById("btnBagTabMats"); if (b) b.click(); })()`);
  await sleep(500);
}
/* ⚠ 진짜 마우스로 옮긴다. `elementHandle.hover()` 류는 mouseover 가 제대로
 *   안 터져 "안 뜸" 으로 나온다(이 저장소에서 이미 겪었다). */
async function hoverNth(n) {
  const at = await ev(`(function(){
    var c = document.querySelectorAll("[data-mat]")[${n}];
    if (!c) return null;
    if (c.scrollIntoView) c.scrollIntoView({ block: "center" });
    var r = c.getBoundingClientRect();
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    var hit = document.elementFromPoint(x, y);
    return { x: x, y: y, mine: !!(hit && (hit === c || c.contains(hit))), key: c.getAttribute("data-mat") };
  })()`);
  if (!at) return null;
  await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y, button: "none", buttons: 0 });
  await sleep(320);
  return at;
}
async function tapAt(at) {
  await S("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
  await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(320);
}
const tipNow = () => ev(`(function(){
  var t = document.getElementById("matTip");
  /* ⚠ 없을 때도 **같은 모양**을 돌려준다. none 만 돌려줬더니
   * 대조군에서 t1.desc.trim() 이 터져 **뒤 판정이 통째로 안 돌았다**. */
  if (!t) return { none: true, vis: false, w: 0, h: 0, x: 0, y: 0,
                   outView: 0, outPane: 0, name: "", qty: "", desc: "" };
  var r = t.getBoundingClientRect();
  var p = document.getElementById("panel");
  var pr = p ? p.getBoundingClientRect() : null;
  var vis = !t.hidden && r.width > 1 && r.height > 1 &&
            getComputedStyle(t).display !== "none";
  return {
    vis: vis, w: Math.round(r.width), h: Math.round(r.height),
    x: Math.round(r.left), y: Math.round(r.top),
    outView: (r.left < -0.5 ? 1 : 0) + (r.right > window.innerWidth + 0.5 ? 1 : 0) +
             (r.top < -0.5 ? 1 : 0) + (r.bottom > window.innerHeight + 0.5 ? 1 : 0),
    outPane: (pr && pr.width > r.width + 8)
      ? ((r.left < pr.left - 0.5 ? 1 : 0) + (r.right > pr.right + 0.5 ? 1 : 0)) : 0,
    name: (t.querySelector(".mat-tip__n") || {}).textContent || "",
    qty: (t.querySelector(".mat-tip__q") || {}).textContent || "",
    desc: (t.querySelector(".mat-tip__d") || {}).textContent || ""
  };
})()`);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* ── 준비: 장비 가방 칸 크기를 먼저 재 둔다 ── */
await open(1440, 900, false);
const bagCell = await ev(`(function(){
  var s = document.querySelector(".arpg-bag-grid .arpg-slot");
  return s ? Math.round(s.getBoundingClientRect().width) : 0;
})()`);
await toMats();

const grid = await ev(`(function(){
  var c = document.querySelector(".mats-tab-container");
  if (!c) return { none: true };
  var cells = [].slice.call(c.querySelectorAll("[data-mat]"));
  var r = c.getBoundingClientRect();
  var tops = cells.map(function (e) { return Math.round(e.getBoundingClientRect().top); });
  var one = cells[0] ? Math.round(cells[0].getBoundingClientRect().width) : 0;
  /* \\uc608\\uc804\\uc758 \\ud070 \\uce74\\ub4dc\\uac00 \\ub0a8\\uc544 \\uc788\\ub294\\uac00 */
  var cards = document.querySelectorAll(".mat-card-item").length;
  return { n: cells.length, cell: one, h: Math.round(r.height),
           rows: [...new Set(tops)].length, cards: cards };
})()`);

add("장비 가방과 같은 칸", !grid.none && grid.cell === bagCell && bagCell > 0,
  "가방 칸 " + bagCell + "px · 재료 칸 " + (grid.cell || 0) + "px" +
  (grid.cell === bagCell ? " (같다)" : " (달라졌다)"));

add("늘어놓지 않는다", !grid.none && grid.n === 4 && grid.rows === 1 && grid.h <= 60 && grid.cards === 0,
  "재료 " + grid.n + "개가 " + grid.rows + "줄 · 묶음 높이 " + grid.h +
  "px (고치기 전 310px) · 옛 카드 " + grid.cards + "개");

/* ── ③ ④ 손을 올리면 뜨고, 글이 원문 그대로다 ── */
const at1 = await hoverNth(1);                     /* 마력 결정 */
const t1 = await tipNow();
const want = await ev(`(function(){
  /* \\u26a0 \\uae30\\ub300\\uac12\\uc744 \\uac80\\uc0ac\\uc5d0 \\ubc15\\uc9c0 \\uc54a\\ub294\\ub2e4 \\u2014 \\uc124\\uba85\\uc744 \\uace0\\uce58\\uba74 \\uac80\\uc0ac\\uac00 \\ube68\\uac1c\\uc9c4\\ub2e4.
   * \\ud654\\uba74\\uc774 \\uc4f0\\ub294 \\uadf8 \\ud45c\\ub97c \\uadf8\\ub300\\ub85c \\uc77d\\uc5b4 \\ub9de\\ub304\\ub2e4. */
  var el = document.querySelector('[data-mat="m_crystal"]');
  return { label: el ? el.getAttribute("aria-label") : "" };
})()`);
add("손을 올리면 뜬다", t1.vis && t1.name.length > 1 && t1.qty.indexOf("12") >= 0 && t1.desc.length > 20,
  t1.none ? "상자가 아예 없다"
    : ("[" + t1.name + "] " + t1.qty + " · 설명 " + t1.desc.length + "자 · 상자 " +
       t1.w + "x" + t1.h + " · 보이나 " + (t1.vis ? "✔" : "✘")));
add("설명을 안 버렸다", t1.desc.trim().length >= 30 && want.label.indexOf(t1.name.trim()) === 0,
  "뜬 글 " + t1.desc.trim().length + "자 · 칸의 이름표 [" + want.label + "] 와 이름이 맞는가 " +
  (want.label.indexOf(t1.name.trim()) === 0 ? "✔" : "✘"));

/* ── ⑥ 밖으로 안 나간다 ── */
add("밖으로 안 나간다", t1.outView === 0 && t1.outPane === 0,
  "화면 밖 " + t1.outView + "변 · 패널 밖 " + t1.outPane + "변 (자리 " + t1.x + "," + t1.y + ")");

/* ── ⑦ 떼면 사라진다 ── */
await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, button: "none", buttons: 0 });
await sleep(320);
const gone = await tipNow();
/* 패널을 닫아도 남지 않는가 — 상자는 body 에 붙어 있어 패널을 감춰도 그대로 뜬다.
 * ⚠ 먼저 **정말 떠 있는지** 보고 나서 닫는다. 안 뜬 것을 닫고 "사라졌다" 고
 *   읽으면 아무 것도 안 잰 검사가 된다(한 번 그랬다). */
const at2 = await hoverNth(0);
const beforeClose = await tipNow();
await ev("window.__closepanel()");
await sleep(250);
const goneClose = await tipNow();
add("떼면 사라진다", !gone.vis && beforeClose.vis && !goneClose.vis,
  "손을 떼면 " + (gone.vis ? "남아 있다" : "사라진다") +
  " · 패널을 닫기 전 " + (beforeClose.vis ? "떠 있고" : "안 떠 있고(재는 뜻이 없다)") +
  " 닫은 뒤 " + (goneClose.vis ? "남아 있다" : "사라진다"));

/* ── ⑤ 눌러도 뜬다 (좁은 화면 · 터치) ── */
await open(390, 844, true);
await toMats();
const at3 = await hoverNth(2);                     /* 심연의 정수 */
let tapTip = { vis: false };
if (at3) { await tapAt(at3); tapTip = await tipNow(); }
add("눌러도 뜬다", at3 && at3.mine && tapTip.vis && tapTip.outView === 0,
  at3 ? ("390px 터치에서 칸을 누르니 [" + tapTip.name + "] " + tapTip.qty +
         " · 상자 " + tapTip.w + "x" + tapTip.h + " · 화면 밖 " + tapTip.outView + "변")
      : "칸을 못 찾았다");

/* ── ⑧ 이름이 한 곳에서 온다 ── */
const bar = await ev(`(function(){
  window.__craft();
  var b = document.querySelector(".mats-bar");
  if (!b) return { none: true };
  var txt = b.innerText;
  var names = [].slice.call(document.querySelectorAll("[data-mat]"));
  return { txt: txt.replace(/\\n/g, " "), badges: b.querySelectorAll(".mat-badge").length };
})()`);
await sleep(250);
const barOk = !bar.none && bar.badges === 5 &&
  ["영혼의 가루", "마력 결정", "심연의 정수", "용의 비늘"].every(n => bar.txt.indexOf(n) >= 0);
add("이름이 한 곳에서", barOk,
  bar.none ? "연금술사 바가 없다"
    : ("연금술사 바 알약 " + bar.badges + "개(재료 넷 + 금화) · 네 이름 다 있음 " +
       (barOk ? "✔" : "✘")));

console.log(OLD ? "── 재료 가방 [대조군: 늘어놓고 설명 배선을 끊음] ──"
                : ("── 재료 가방" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + BASE);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
