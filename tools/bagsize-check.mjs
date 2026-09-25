/* 가방 칸 크기 — 칸이 **물건 크기**에서 나오는가, 화면 폭에서 나오는가.
 *
 * 고치기 전 실측(2026-09-25): 1440px 에서 가방 칸이 **177x177** 인데 안의 그림은
 * **32x32** 였다. 칸이 그림의 5.5배다. `repeat(5, 1fr)` 이라 칸 크기가 물건이
 * 아니라 **패널 폭을 5로 나눈 값**이었고, 그래서 화면이 넓을수록 칸이 커졌다.
 * 스물한 개를 보는 데 다섯 화면을 굴려야 했다.
 *
 *   ① 폭을 안 탄다      1024 ~ 1920px 에서 칸 크기가 한 값이다
 *   ② 칸이 그림을 담는다 칸 ÷ 그림 <= 1.9 (헐렁한 빈 상자가 아니다)
 *   ③ 겹치지 않는다     고르기 네모 · 레벨 숫자 · 강화 뱃지가 서로 안 겹친다
 *   ④ 손가락이 닿는다   좁은 화면에서 칸 >= 48px · 고르기 네모 >= 17px
 *   ⑤ 한 화면에 든다    스물한 개가 굴리지 않고 보인다
 *   ⑥ 콘솔 오류 0
 *
 * ⚠ **칸 수를 박으면 이 사고가 돌아온다.** 칸은 고정 폭으로 두고 열 수를
 *   폭에 맡긴다(`repeat(auto-fill, 48px)`). `OLD=1` 이 옛 방식으로 되돌려
 *   ①과 ②가 정말 빨개지는지 보여 준다.
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

/* 대조군: 칸 수를 박던 옛 방식으로 되돌린다. */
const REVERT = [
  ["/css/rpg.css",
   /\.arpg-bag-grid \{\n  display: grid;\n  grid-template-columns: repeat\(auto-fill, var\(--bag-cell, 48px\)\);\n  justify-content: start;\n  gap: 6px;\n\}/,
   ".arpg-bag-grid {\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);\n  gap: 6px;\n}"],
  ["/css/rpg.css", /(\.arpg-slot \{\n  position: relative;\n  aspect-ratio: 1 \/ 1;\n)  min-height: 0;/, "$1  min-height: 48px;"],
  ["/css/rpg.css", /@media \(max-width: 700px\), \(pointer: coarse\) \{\n  \.arpg-bag-grid \{ --bag-cell: 56px; \}/,
   "@media (max-width: 700px), (pointer: coarse) {\n  .arpg-bag-grid { }"]
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-bg-"));
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

/* 한 폭에서 재고 온다. ⚠ 폭마다 문서를 **다시 읽는다** — 같은 문서에서 폭만
 *   바꾸면 앞 폭에서 연 상태를 그대로 물고 가 잘못 읽힌다. */
async function measure(w, h, touch) {
  await S("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: !!touch });
  await S("Page.navigate", { url: BASE + "?cb=" + Math.random().toString(36).slice(2) });
  for (let i = 0; i < 400; i++) {
    if (await ev("!!(window.__give && window.__bag && window.ITEMS)")) break;
    await sleep(60);
  }
  await sleep(400);
  await ev(`(function(){ window.__pick("warrior"); window.__give(); })()`);
  await sleep(250);
  await ev("window.__bag()");
  await sleep(550);
  return ev(`(function(){
    function box(e) { if (!e) return null; var r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), l: r.left, t: r.top, r: r.right, b: r.bottom }; }
    function hit(a, b) {
      if (!a || !b) return false;
      return a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    }
    var g = document.querySelector(".arpg-bag-grid");
    if (!g) return { none: true };
    var cells = [].slice.call(g.querySelectorAll(".arpg-slot"));
    var filled = cells.filter(function (c) { return c.classList.contains("filled"); });
    var s = filled[0] || cells[0];
    var img = s && s.querySelector(".item-sprite-img");
    var sel = s && s.querySelector(".sel-box");
    var lv = s && s.querySelector(".lv-badge");

    /* 칸 안의 것끼리 겹치는가 — 모든 차 있는 칸을 본다 */
    var over = 0;
    filled.forEach(function (c) {
      var parts = [".sel-box", ".lv-badge", ".enh-badge", ".lock-badge"]
        .map(function (q) { return box(c.querySelector(q)); }).filter(Boolean);
      for (var i = 0; i < parts.length; i++)
        for (var j = i + 1; j < parts.length; j++)
          if (hit(parts[i], parts[j])) over++;
    });

    /* 스물한 개를 보려면 얼마나 굴려야 하는가 */
    var p = document.getElementById("panel");
    var last = filled[filled.length - 1];
    var lb = box(last), need = 0;
    if (lb && p) {
      var pr = p.getBoundingClientRect();
      need = Math.max(0, Math.round(lb.b - Math.min(pr.bottom, window.innerHeight)));
    }
    var cols = getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length;
    return {
      cell: box(s), img: box(img), sel: box(sel), lv: box(lv),
      cols: cols, n: filled.length, over: over, need: need,
      gridW: Math.round(g.getBoundingClientRect().width),
      docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`);
}

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

const WIDE = [[1920, 1080], [1680, 1050], [1440, 900], [1280, 900], [1024, 800]];
const rows = [];
for (const [w, h] of WIDE) rows.push([w, await measure(w, h, false)]);
const mob = await measure(390, 844, true);
const mid = await measure(768, 900, false);

/* ── ① 폭을 안 탄다 ─────────────────────────────────── */
const sizes = rows.map(([w, r]) => (r.cell ? r.cell.w : 0));
const uniq = [...new Set(sizes)];
add("폭을 안 탄다", uniq.length === 1 && uniq[0] > 0,
  "1024 ~ 1920px 다섯 폭에서 칸 " + rows.map(([w, r]) => w + ":" + (r.cell ? r.cell.w : "-")).join(" · ") +
  " → " + (uniq.length === 1 ? "한 값" : uniq.length + "가지"));

/* ── ② 칸이 그림을 담는다 ───────────────────────────── */
const r0 = rows[2][1];                       /* 1440px */
const ratio = r0.cell && r0.img ? r0.cell.w / r0.img.w : 99;
add("칸이 그림을 담는다", ratio <= 1.9,
  "1440px 에서 칸 " + r0.cell.w + "px · 그림 " + r0.img.w + "px · 비율 " + ratio.toFixed(2) +
  "배 (1.9 이하여야 한다 · 고치기 전 5.53배)");

/* ── ③ 겹치지 않는다 ───────────────────────────────── */
const overAll = rows.reduce((a, [, r]) => a + r.over, 0) + mob.over + mid.over;
add("겹치지 않는다", overAll === 0,
  "일곱 폭 · 찬 칸 " + (rows[0][1].n) + "개씩 · 고르기네모 · 레벨 · 강화 · 자물쇠끼리 겹친 쌍 " + overAll + "개");

/* ── ④ 손가락이 닿는다 ─────────────────────────────── */
add("손가락이 닿는다", mob.cell.w >= 48 && mob.sel && mob.sel.w >= 17,
  "390px(터치) 칸 " + mob.cell.w + "px(48 이상) · 고르기 네모 " + (mob.sel ? mob.sel.w : 0) +
  "px(17 이상) · 열 " + mob.cols + " · 가로 넘침 " + mob.docOver + "px");

/* ── ⑤ 한 화면에 든다 ──────────────────────────────── */
add("한 화면에 든다", r0.need === 0,
  "1440x900 에서 " + r0.n + "개를 보는데 더 굴려야 하는 양 " + r0.need + "px · " +
  "열 " + r0.cols + " · 격자 폭 " + r0.gridW + "px");

/* ── ⑥ ── */
add("가로로 안 넘친다", rows.every(([, r]) => r.docOver === 0) && mid.docOver === 0 && mob.docOver === 0,
  "일곱 폭 전부 문서 넘침 " + Math.max(...rows.map(([, r]) => r.docOver), mid.docOver, mob.docOver) + "px");

console.log(OLD ? "── 가방 칸 크기 [대조군: 칸 수를 박던 옛 방식] ──"
                : ("── 가방 칸 크기" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + BASE);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(14) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
