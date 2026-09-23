/* 던전 판 크기 — 줄이되 **밀도와 길은 그대로**인가.
 *
 * 사용자 신고: "던전에 들어가면 맵이 너무 크게 나온다."
 * 재 보니 배율은 마을과 똑같았다(1.0). 크게 그려지는 것이 아니라 판이
 * 넓었던 것이다 — 마을 30x22 의 3.4배인 56x40.
 *
 *   ① 판이 작아졌다        40x28 · 1280 화면 한 장에 거의 들어온다
 *   ② 배율은 안 건드렸다   마을과 던전이 같은 배율 (전에 확대를 금하셨다)
 *   ③ 길이 늘 있다         계단에서 계단까지 걸어서 닿는다
 *   ④ 밀도가 그대로다      한 마리당 걷는 칸이 예전과 같다
 *   ⑤ 방이 모자라지 않다   보스방·보물방을 넣고도 고를 방이 남는다
 *
 * ⚠ 닫힌 문을 막힌 것으로 세면 "길 없는 판이 20%" 라는 거짓이 나온다
 *   (실제로 한 번 그렇게 읽었다). 문은 열고 지나간다 — 막는 것은 벽뿐이다.
 * ⚠ 대조군 `OLD=1` 은 옛 판 크기(56x40)와 옛 마릿수 셈으로 되돌린다.
 *   ①이 빨개지고 ④는 초록이어야 한다 — 옛 판에서는 밀도도 옛 값이 맞다.
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
  ["/js/world.js",
   /D\.generate\(opt\.w \|\| 40, opt\.h \|\| 28, this\.depth, seed\)/,
   "D.generate(opt.w || 56, opt.h || 40, this.depth, seed)"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/world.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-map-"));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Page.navigate", { url: TARGET });
await sleep(1600);
await ev(`window.__pick && window.__pick("warrior")`);
await sleep(500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* ── ① 판 크기와 화면 ──────────────────────────────── */
const size = await ev(`(function(){
  window.__start({ depth: 3 });
  var p = document.getElementById("panel"); if (p) { p.hidden = true; p.style.display = "none"; }
  var w = window.__w(), v = window.__v(), lv = w.level;
  window.__start({ depth: 0 });
  var tl = window.__w().level;
  window.__start({ depth: 3 });
  return { lw: lv.w, lh: lv.h, px: lv.w * 32, py: lv.h * 32,
           townW: tl.w, townH: tl.h,
           viewW: Math.round(v.viewW), viewH: Math.round(v.viewH),
           zoom: +v.zoom.toFixed(3) };
})()`);
await sleep(300);
/* 1280 화면에서 가로가 한 장에 들어와야 한다 */
add("판이 한 화면에 든다", size.lw <= 44 && size.px <= size.viewW,
  "던전 " + size.lw + "x" + size.lh + " = " + size.px + "x" + size.py +
  "px · 보이는 칸 " + Math.round(size.viewW / 32) + "x" + Math.round(size.viewH / 32) +
  " · 마을은 " + size.townW + "x" + size.townH +
  " · 세로는 " + (size.py <= size.viewH ? "다 든다" : (size.py - size.viewH) + "px 굴러간다"));

/* ── ② 배율은 안 건드렸다 ──────────────────────────── */
const zoomSame = await ev(`(function(){
  window.__start({ depth: 0 });
  var a = window.__v().zoom;
  window.__start({ depth: 7 });
  var b = window.__v().zoom;
  return { town: +a.toFixed(3), dun: +b.toFixed(3) };
})()`);
await sleep(300);
add("배율은 그대로", Math.abs(zoomSame.town - zoomSame.dun) < 0.001 && zoomSame.dun === 1,
  "마을 " + zoomSame.town + " · 던전 " + zoomSame.dun +
  " (확대로 푼 것이 아니다 — 판을 줄였다)");

/* ── ③ 길이 늘 있는가 · ④ 밀도 · ⑤ 방 ───────────────
 * ⚠ 문은 열고 지나간다. 막는 것은 벽뿐이다. */
const walkProbe = `
window.__walkTest = function (depth, seeds) {
  var D = window.DUNGEON, DT = window.DATA, W2 = window.WORLD;
  var noPath = 0, dists = [], walks = [], rooms = [], perMob = [];
  for (var s = 0; s < seeds; s++) {
    var w = new W2.World({ seed: 7000 + s * 65537, depth: depth, mobs: 0 });
    var lv = w.level;
    var walk = 0, i;
    for (i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] !== D.WALL) walk++;
    walks.push(walk);
    rooms.push((lv.rooms || []).length);
    perMob.push(walk / Math.max(1, DT.countAt(depth, walk)));
    var W = lv.w, H = lv.h, q = [lv.upAt.x + lv.upAt.y * W];
    var seen = new Int32Array(W * H).fill(-1); seen[q[0]] = 0;
    var got = -1;
    for (var qi = 0; qi < q.length; qi++) {
      var c = q[qi], cx = c % W, cy = (c / W) | 0;
      if (cx === lv.downAt.x && cy === lv.downAt.y) { got = seen[c]; break; }
      var nb = [[1,0],[-1,0],[0,1],[0,-1]];
      for (var k = 0; k < 4; k++) {
        var nx = cx + nb[k][0], ny = cy + nb[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        var ni = nx + ny * W;
        if (seen[ni] >= 0 || lv.tiles[ni] === D.WALL) continue;
        seen[ni] = seen[c] + 1; q.push(ni);
      }
    }
    if (got < 0) noPath++; else dists.push(got);
  }
  function avg(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
  dists.sort(function (a, b) { return a - b; });
  return { noPath: noPath, n: seeds,
           med: dists.length ? dists[dists.length >> 1] : -1,
           max: dists.length ? dists[dists.length - 1] : -1,
           walk: Math.round(avg(walks)), rooms: +avg(rooms).toFixed(1),
           roomsMin: Math.min.apply(null, rooms),
           perMob: +avg(perMob).toFixed(1), mobs: DT.countAt(depth, Math.round(avg(walks))) };
};`;
await ev(walkProbe);
const depths = [1, 5, 12, 20, 30];
const rows = [];
for (const d of depths) rows.push(await ev(`window.__walkTest(${d}, 24)`));

const anyNoPath = rows.reduce((a, r) => a + r.noPath, 0);
add("길이 늘 있다", anyNoPath === 0,
  "층 " + depths.join("·") + " 각 24판 = " + (depths.length * 24) + "판 · 길 없음 " + anyNoPath +
  " · 계단→계단 중앙 " + rows.map(r => r.med).join("/") + "걸음 (가장 먼 판 " +
  Math.max(...rows.map(r => r.max)) + ")");

/* 예전 밀도 = 한 마리당 31.2칸(20층 기준, 56x40 실측). 층마다 다르므로
 * ⚠ 한 숫자로 못 박지 않는다 — REF_WALK 로 되짚어 **예전 값을 그 자리에서 셈한다.** */
const dens = await ev(`(function(){
  var DT = window.DATA, out = [];
  [1, 5, 12, 20, 30].forEach(function (d) {
    var old = Math.min(22, 8 + Math.floor(d * 0.7));
    out.push({ d: d, was: +(DT.REF_WALK / old).toFixed(1) });
  });
  return out;
})()`);
const gaps = rows.map((r, i) => Math.abs(r.perMob - dens[i].was) / dens[i].was);
const densOk = Math.max(...gaps) <= 0.12;
add("밀도가 그대로", densOk,
  rows.map((r, i) => depths[i] + "층 " + r.perMob + "칸/마리(예전 " + dens[i].was + ")").join(" · ") +
  " · 가장 큰 차이 " + Math.round(Math.max(...gaps) * 100) + "% (12% 이내)");

const roomsOk = Math.min(...rows.map(r => r.roomsMin)) >= 5;
add("방이 남는다", roomsOk,
  "층마다 가장 적을 때 " + rows.map((r, i) => depths[i] + "층 " + r.roomsMin).join(" · ") +
  " · 보스방 하나와 보물방 하나를 빼도 고를 방이 남아야 한다(5 이상)");

/* 몬스터가 정말 그만큼 서는가 — 셈만 맞고 안 세워지면 뜻이 없다 */
const spawned = await ev(`(function(){
  var out = [];
  [1, 12, 30].forEach(function (d) {
    window.__start({ depth: d });
    var w = window.__w();
    var n = w.ents.filter(function (e) { return e.team !== 0 && !e.dead && e.kind !== "dummy"; }).length;
    var walk = 0, D = window.DUNGEON;
    for (var i = 0; i < w.level.tiles.length; i++) if (w.level.tiles[i] !== D.WALL) walk++;
    out.push({ d: d, n: n, want: window.DATA.countAt(d, walk) });
  });
  return out;
})()`);
await sleep(300);
const spawnOk = spawned.every(x => x.n >= Math.max(1, x.want - 2) && x.n <= x.want + 1);
add("정말 그만큼 선다", spawnOk,
  spawned.map(x => x.d + "층 " + x.n + "마리(셈은 " + x.want + ")").join(" · "));

console.log(OLD ? "── 던전 판 크기 [대조군: 옛 56x40] ──"
                : ("── 던전 판 크기" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(14) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); fails++; }
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
