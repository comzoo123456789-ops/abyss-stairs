/* 걷는 그림 — 걸을 때 **정말 그림이 바뀌는가.**
 *
 * 고치기 전 실측(2026-09-25 · 칠한 칸만 셈):
 *
 *     직업      걷1↔걷2   섬↔걷1
 *     전사        6.8%       0%   ← 걸음 1틀이 선 자세의 **복사본**이었다
 *     기사        7.6%     4.3%
 *     도적        6.0%     6.7%
 *     마법사      3.7%     0.9%
 *
 * 걸을 때 1↔2 를 번갈아 쓰는데(view.js `frameOf`), 전사는 1 이 선 자세와
 * 한 칸도 안 달라 **절뚝이는 것처럼** 보였다. 플레이하는 내내 보이는 자리다.
 *
 *   ① 두 걸음이 다르다   걷1 ↔ 걷2 가 8% 이상
 *   ② 복사본이 없다      선 자세 ↔ 각 걸음이 4% 이상 (전사의 0% 를 잡는다)
 *   ③ 벌어지지 않는다    걸음 틀의 **가로폭이 선 자세와 같다**
 *   ④ 공격이 안 깨졌다   선 자세 ↔ 공격 두 틀이 15% 이상
 *   ⑤ 발이 안 뜬다       걸음 틀의 **맨 아랫줄이 선 자세와 같다**
 *
 * ⚠ **수치만 올리면 안 된다.** 정면 그림에서 발을 가로로 밀어 "앞으로 내민"
 *   것처럼 했더니 40.2% 가 나왔는데, 두 발이 양옆으로 벌어져 **걷는 것이
 *   아니라 뜀뛰기**가 됐다. 그래서 ③ 이 있다 — 가로폭이 늘면 벌어진 것이다.
 * ⚠ ⑤ 도 같은 결이다. 두 발을 함께 들면 차이는 크게 나오지만 공중에 뜬다.
 *   한쪽은 늘 바닥을 디뎌야 한다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(path.resolve(HERE, ".."), "public");
const OLD = process.env.OLD === "1";
const ui = process.argv.indexOf("--url");
const URL_ARG = ui >= 0 ? process.argv[ui + 1] : null;
if (URL_ARG && OLD) { console.error("--url 과 OLD=1 은 같이 못 쓴다"); process.exit(2); }

/* 대조군: 전사 걸음 1틀을 선 자세의 복사본으로 되돌리고, 마법사 자락을
 * 1칸만 흔들리게 되돌린다. */
const REVERT = [
  ["/js/sprites-art.js",
   /\["f", 1\],\n    \["rect", 10, 38, 4, 9, "m"\], \["rect", 18, 38, 4, 5, "m"\],\n    \["rect", 10, 38, 4, 1, "s"\], \["rect", 18, 38, 4, 1, "s"\],\n    \["rect", 10, 44, 4, 1, "D"\], \["rect", 18, 41, 4, 1, "D"\],\n    \["rect", 8, 46, 7, 2, "b"\],  \["rect", 18, 42, 6, 3, "b"\],\n    \["rect", 8, 46, 7, 1, "d"\],  \["rect", 18, 42, 6, 1, "d"\],/,
   '["f", 1],\n    ["rect", 10, 38, 4, 8, "m"], ["rect", 18, 39, 4, 6, "m"],\n    ["rect", 10, 38, 4, 1, "s"],  ["rect", 18, 39, 4, 1, "s"],\n    ["rect", 10, 43, 4, 1, "D"],  ["rect", 18, 43, 4, 1, "D"],\n    ["rect", 8, 45, 7, 3, "b"],  ["rect", 17, 45, 6, 2, "b"],\n    ["rect", 8, 45, 7, 1, "d"],  ["rect", 17, 45, 6, 1, "d"],'],
  ["/js/sprites-art.js",
   /\["poly", \[\[10, 33\], \[22, 33\], \[26, 46\], \[9, 42\]\], "r"\]/,
   '["poly", [[10, 33], [22, 33], [25, 46], [8, 45]], "r"]'],
  ["/js/sprites-art.js",
   /\["poly", \[\[10, 33\], \[22, 33\], \[23, 42\], \[6, 46\]\], "r"\]/,
   '["poly", [[10, 33], [22, 33], [24, 45], [7, 46]], "r"]']
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/sprites-art.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-wk-"));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1024, height: 800, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", {
  url: URL_ARG ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
               : "http://127.0.0.1:" + port + "/index.html"
});
for (let i = 0; i < 400; i++) { if (await ev("!!(window.SPRITES && window.CLASSES)")) break; await sleep(60); }
await sleep(400);

/* ⚠ **칠한 칸으로 나눈다.** 32x48 은 대부분 투명이라 전체 칸으로 나누면
 *   무엇을 고쳐도 늘 작은 수가 나와 "안 바뀌었다" 로 오독한다(한 번 그랬다). */
const M = await ev(`(function(){
  var SP = window.SPRITES;
  function px(c) { var g = c.getContext("2d"); return g.getImageData(0, 0, c.width, c.height).data; }
  function diffInk(a, b) {
    var n = 0, ink = 0;
    for (var i = 0; i < a.length; i += 4) {
      if (a[i+3] > 8 || b[i+3] > 8) ink++;
      if (Math.abs(a[i]-b[i]) + Math.abs(a[i+1]-b[i+1]) + Math.abs(a[i+2]-b[i+2]) + Math.abs(a[i+3]-b[i+3]) > 24) n++;
    }
    return ink ? Math.round(n / ink * 1000) / 10 : 0;
  }
  function bbox(a, w, h) {
    var lo = 999, hi = -1, top = 999, bot = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (a[i+3] > 8) { if (x < lo) lo = x; if (x > hi) hi = x; if (y < top) top = y; if (y > bot) bot = y; }
    }
    return { w: hi - lo + 1, bot: bot };
  }
  var res = [];
  /* ⚠ 직업 목록을 박지 않는다 — classes.js 에서 읽는다. 다섯째 직업이
   *   생기면 그날로 함께 재진다. */
  window.CLASSES.LIST.forEach(function (c) {
    var k = c.id;
    if (!SP.has(k)) { res.push({ k: k, miss: true }); return; }
    var f = [];
    for (var i = 0; i < 5; i++) { try { f.push(px(SP.bake(k, i))); } catch (e) { } }
    if (f.length < 5) { res.push({ k: k, miss: true, got: f.length }); return; }
    var b = [0,1,2].map(function (i) { return bbox(f[i], 32, 48); });
    res.push({
      k: k, name: c.name || k,
      w1w2: diffInk(f[1], f[2]), s1: diffInk(f[0], f[1]), s2: diffInk(f[0], f[2]),
      a3: diffInk(f[0], f[3]), a4: diffInk(f[0], f[4]),
      span: b.map(function (x) { return x.w; }),
      bot: b.map(function (x) { return x.bot; })
    });
  });
  return res;
})()`);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

const miss = M.filter(m => m.miss);
add("직업 그림이 다 있다", miss.length === 0,
  M.length + "직업 · 틀 다섯을 못 읽은 것 " + miss.length + "개" +
  (miss.length ? " (" + miss.map(m => m.k).join(",") + ")" : ""));

const ok = M.filter(m => !m.miss);
const w = ok.map(m => m.k + " " + m.w1w2 + "%").join(" · ");
add("두 걸음이 다르다", ok.every(m => m.w1w2 >= 8),
  "걷1↔걷2 — " + w + " (8% 이상이어야 한다 · 고치기 전 3.7~7.6%)");

const bad2 = ok.filter(m => m.s1 < 4 || m.s2 < 4);
add("복사본이 없다", bad2.length === 0,
  "섬↔걷1 / 섬↔걷2 — " + ok.map(m => m.k + " " + m.s1 + "/" + m.s2 + "%").join(" · ") +
  (bad2.length ? " ← " + bad2.map(m => m.k).join(",") + " 가 선 자세와 같다" : ""));

const bad3 = ok.filter(m => m.span[1] !== m.span[0] || m.span[2] !== m.span[0]);
add("벌어지지 않는다", bad3.length === 0,
  "가로폭(섬/걷1/걷2) — " + ok.map(m => m.k + " " + m.span.join("/")).join(" · ") +
  (bad3.length ? " ← 벌어졌다" : " (다 같아야 한다)"));

const bad4 = ok.filter(m => m.a3 < 15 || m.a4 < 15);
add("공격이 안 깨졌다", bad4.length === 0,
  "섬↔치켜 / 섬↔내려 — " + ok.map(m => m.k + " " + m.a3 + "/" + m.a4 + "%").join(" · "));

const bad5 = ok.filter(m => m.bot[1] !== m.bot[0] || m.bot[2] !== m.bot[0]);
add("발이 안 뜬다", bad5.length === 0,
  "맨 아랫줄(섬/걷1/걷2) — " + ok.map(m => m.k + " " + m.bot.join("/")).join(" · ") +
  (bad5.length ? " ← " + bad5.map(m => m.k).join(",") + " 가 공중에 떴다" : ""));

console.log(OLD ? "── 걷는 그림 [대조군: 전사 걸음1을 선 자세 복사본으로 · 마법사 자락 1칸] ──"
                : ("── 걷는 그림" + (URL_ARG ? " [배포본]" : "") + " ──"));
for (const [n, k, note] of out) console.log((k ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
