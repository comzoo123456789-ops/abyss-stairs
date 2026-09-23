/* 화면 아래 세 줄이 겹치지 않는가 — 그리고 안내가 자판으로 읽히는가.
 *
 * 사용자 신고: "체력바 아래 도움말 보기 좋게 바꿔" + 던전에서 늘 떠 있던
 * "[T] 마을로 귀환 (2초간 가만히)" 를 지워 달라.
 *
 * 겹친 까닭은 **기준이 둘**이었다. 안내 줄(.hint)은 그려진 판(--stage-b)에
 * 붙고 행동 안내(.act)는 창 바닥에 붙어 있었다. 기준이 다르면 어떤 창
 * 크기에서는 반드시 만난다 — 실측으로 창 높이 1,040~1,120px 에서 19px 겹쳤다.
 *
 *   ① 어느 높이에서도 안 겹친다   창 높이 여덟 가지 x 세 줄
 *   ② 자판으로 읽힌다             .hk b 가 알로 서 있다(네모·테두리)
 *   ③ 늘 떠 있는 말이 없다        빈손으로 던전에 서면 행동 안내가 비어 있다
 *   ④ 할 말이 있으면 뜬다         계단·문 위에서는 뜬다
 *   ⑤ 판 밖으로 안 나간다         좁은 화면 포함
 *
 * ⚠ 높이 하나만 재면 못 잡는다. 겹침은 **구간**으로 난다 — 860 과 1400 은
 *   멀쩡했고 1,060~1,100 만 겹쳤다. 사용자가 딱 그 구간을 쓰고 있었다.
 * ⚠ 대조군 `OLD=1` 은 .act 를 창 바닥에 되돌린다. ①이 빨개져야 한다.
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

const REVERT = [
  /* .act 를 창 바닥으로 되돌린다(예전 모습) */
  ["/css/rpg.css",
   /bottom: calc\(var\(--stage-b, 0px\) \+ var\(--hint-h, 32px\) \+ 78px\);/,
   "bottom: 100px;"],
  /* 구슬 줄도 손으로 적은 옛 값으로 */
  ["/css/rpg.css",
   /bottom: calc\(var\(--stage-b\) \+ var\(--hint-h, 32px\) \+ 8px\);/,
   "bottom: calc(var(--stage-b) + 30px);"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/css/rpg.css"];

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  if (OLD && OLDIFY.indexOf(p) >= 0) {
    const body = oldify(p, fs.readFileSync(path.join(ROOT, p), "utf8"));
    r.writeHead(200, { "content-type": MIME[".css"] }); r.end(body); return;
  }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-hint-"));
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

const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: TARGET });
for (let i = 0; i < 300; i++) {
  if (await ev("!!(window.__start && window.__pick && window.__w)")) break;
  await sleep(60);
}
await ev(`window.__pick && window.__pick("warrior")`);
await sleep(500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

const RECT = `(function(){
  function R(s) {
    var e = document.querySelector(s); if (!e) return null;
    var b = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return { t: Math.round(b.top), b2: Math.round(b.bottom),
             l: Math.round(b.left), r: Math.round(b.right),
             h: Math.round(b.height), w: Math.round(b.width),
             vis: cs.visibility, pos: cs.position,
             txt: (e.textContent || "").trim() };
  }
  function gap(a, b) {
    /* 안 보이는 것은 안 센다. 겹친 높이를 px 로 돌려준다 */
    if (!a || !b || a.vis === "hidden" || b.vis === "hidden" || a.h < 1 || b.h < 1) return 0;
    var h = Math.min(a.b2, b.b2) - Math.max(a.t, b.t);
    return h > 0 ? h : 0;
  }
  var A = R("#act"), H = R(".hint"), B = R(".bottom");
  var sb = getComputedStyle(document.documentElement).getPropertyValue("--stage-b").trim();
  return { sb: sb, act: A, hint: H, bottom: B,
           actHint: gap(A, H), bottomHint: gap(B, H), bottomAct: gap(B, A),
           over: document.documentElement.scrollWidth - window.innerWidth };
})()`;

/* 판 위에 서되 **아무 것도 없는 자리**로 옮긴다 — 늘 떠 있는 말이 없는지 본다 */
const CLEAR = `(function(){
  window.__start({ depth: 3 });
  var p = document.getElementById("panel"); if (p) { p.hidden = true; p.style.display = "none"; }
  var w = window.__w(), lv = w.level, D = window.DUNGEON;
  /* 계단·물건·소품에서 먼 빈 바닥 */
  var best = null, bd = -1;
  for (var y = 1; y < lv.h - 1; y++) for (var x = 1; x < lv.w - 1; x++) {
    if (lv.at(x, y) !== D.FLOOR) continue;
    var d = Math.hypot(x - lv.downAt.x, y - lv.downAt.y);
    if (d > bd) { bd = d; best = { x: x, y: y }; }
  }
  if (best) { w.player.x = best.x + 0.5; w.player.y = best.y + 0.5;
              w.player.px = w.player.x; w.player.py = w.player.y; }
  w.drops.length = 0;
  return true;
})()`;

/* ── ① 어느 높이에서도 안 겹친다 ───────────────────── */
/* ⚠ **글이 떠 있는 상태로 재야 한다.** 빈 바닥에 세워 놓고 재면 #act 가
 *   비어 있어(높이 0) 겹칠 수가 없다 — 대조군마저 초록으로 나온다.
 *   계단 위에 세운다: 사용자가 겹침을 본 바로 그 상태다. */
const ONSTAIR = `(function(){
  var w = window.__w();
  w.player.x = w.level.downAt.x + 0.5; w.player.y = w.level.downAt.y + 0.5;
  w.player.px = w.player.x; w.player.py = w.player.y;
  w.advance(1 / 60);
  return true;
})()`;
/* ⚠ 글은 **다음 프레임**에 바뀐다(hud 가 rAF 에서 돈다). 옮기자마자 읽으면
 *   늘 비어 있다 — 옮기고 나서 기다렸다 읽는다. */
const actLen = `((document.getElementById("act").textContent || "").trim().length)`;
const HS = [780, 860, 940, 1000, 1040, 1060, 1100, 1160, 1240, 1400];
const rows = [];
for (const H of HS) {
  await S("Emulation.setDeviceMetricsOverride", { width: 1440, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await ev(CLEAR);
  await sleep(260);
  await ev(ONSTAIR);
  let said = 0;
  for (let t = 0; t < 30; t++) { said = await ev(actLen); if (said) break; await sleep(60); }
  if (!said) throw new Error(H + "px 에서 행동 안내가 비었다 — 겹침을 잴 수가 없다");
  const r = await ev(RECT);
  rows.push({ H: H, sb: r.sb, a: r.actHint, b: r.bottomHint, c: r.bottomAct,
              pos: r.act.pos, over: r.over });
}
const bad = rows.filter(r => r.a > 0 || r.b > 0 || r.c > 0);
add("어느 높이에서도 안 겹친다", bad.length === 0,
  "창 높이 " + HS.length + "가지 · 겹친 높이 " +
  (bad.length ? bad.map(r => r.H + "px에서 " + Math.max(r.a, r.b, r.c) + "px").join(" / ")
              : "0px (판 아래 여백 " + rows[0].sb + "~" + rows[rows.length - 1].sb + ")"));

/* ⚠ 자리잡기가 살아 있는가 — 옛 블록을 걷다 position 을 잃은 적이 있다 */
const posOk = rows.every(r => r.pos === "absolute");
add("자리잡기가 살아 있다", posOk,
  "#act position " + rows[0].pos + " (absolute 여야 한다 · static 이면 화면 맨 아래로 내려앉는다)");

/* ── ② 자판으로 읽힌다 ────────────────────────────── */
await S("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
await sleep(250);
await ev(CLEAR);
await sleep(400);
const caps = await ev(`(function(){
  var ks = [].slice.call(document.querySelectorAll(".hint .hk b"));
  if (!ks.length) return { none: true };
  var bad = 0, sizes = [];
  ks.forEach(function (k) {
    var cs = getComputedStyle(k), b = k.getBoundingClientRect();
    var framed = cs.borderTopWidth !== "0px" && cs.borderRadius !== "0px" &&
                 cs.backgroundColor !== "rgba(0, 0, 0, 0)";
    if (!framed || b.height < 14) bad++;
    sizes.push(Math.round(b.width) + "x" + Math.round(b.height));
  });
  var one = getComputedStyle(ks[0]);
  return { n: ks.length, bad: bad, groups: document.querySelectorAll(".hint .hk").length,
           sample: sizes.slice(0, 4).join(" "),
           bw: one.borderBottomWidth, br: one.borderRadius, bg: one.backgroundColor };
})()`);
add("자판으로 읽힌다", !caps.none && caps.bad === 0 && caps.n >= 12,
  caps.none ? "자판 알이 하나도 없다"
    : "알 " + caps.n + "개 · 묶음 " + caps.groups + "개 · 테두리 아래 " + caps.bw +
      " 둥글기 " + caps.br + " · 크기 " + caps.sample + " · 모양 어긋난 알 " + caps.bad);

/* ── ③ 늘 떠 있는 말이 없다 ───────────────────────── */
const idle = await ev(`(function(){
  var el = document.getElementById("act");
  return { txt: (el.textContent || "").trim(), vis: getComputedStyle(el).visibility,
           inTown: window.__w().inTown };
})()`);
add("늘 떠 있는 말이 없다", idle.txt === "" && !idle.inTown,
  "던전 빈 바닥 · 행동 안내 \\u201c" + idle.txt + "\\u201d (비어 있어야 한다)" +
  (/귀환/.test(idle.txt) ? " · \\u26a0 귀환 안내가 남아 있다" : ""));

/* ── ④ 할 말이 있으면 뜬다 ────────────────────────── */
const onStair = await ev(`(function(){
  var w = window.__w();
  w.player.x = w.level.downAt.x + 0.5; w.player.y = w.level.downAt.y + 0.5;
  w.player.px = w.player.x; w.player.py = w.player.y;
  w.advance(1 / 60);
  return true;
})()`);
await sleep(350);
const stairTxt = await ev(`(function(){
  var el = document.getElementById("act");
  return { txt: (el.textContent || "").trim(), vis: getComputedStyle(el).visibility };
})()`);
add("할 말이 있으면 뜬다", stairTxt.txt.length > 0 && stairTxt.vis === "visible",
  "계단 위 · \\u201c" + stairTxt.txt.slice(0, 44) + "\\u201d");

/* ── ⑤ 판 밖으로 안 나간다 ────────────────────────── */
const widths = [1920, 1440, 1100, 900, 760, 640];
const narrow = [];
for (const W of widths) {
  await S("Emulation.setDeviceMetricsOverride", { width: W, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  await ev(CLEAR);
  await sleep(330);
  const r = await ev(`(function(){
    var h = document.querySelector(".hint"), b = h.getBoundingClientRect();
    var cs = getComputedStyle(h);
    var outside = 0;
    [].slice.call(h.querySelectorAll(".hk")).forEach(function (k) {
      var kb = k.getBoundingClientRect();
      if (kb.right > b.right + 1 || kb.left < b.left - 1) outside++;
    });
    return { w: Math.round(b.width), h: Math.round(b.height), outside: outside,
             shown: cs.display !== "none",
             over: document.documentElement.scrollWidth - window.innerWidth };
  })()`);
  narrow.push({ W: W, r: r });
}
const spill = narrow.filter(n => n.r.shown && (n.r.outside > 0 || n.r.over > 0));
add("판 밖으로 안 나간다", spill.length === 0,
  narrow.map(n => n.W + "px " + (n.r.shown ? n.r.h + "px높이" : "감춤")).join(" · ") +
  (spill.length ? " · ⚠ " + spill.map(n => n.W + "px").join(",") : " · 넘침 0"));

console.log(OLD ? "── 화면 아래 안내 [대조군: .act 가 창 바닥에] ──"
                : ("── 화면 아래 안내" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(18) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 4).forEach(e => console.log("  " + e)); fails++; }
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
