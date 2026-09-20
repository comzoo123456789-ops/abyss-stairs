/* 부드러운 이동이 실제로 도는지 잰다.
 *
 * 확인할 것:
 *  ① 칸 사이에 있는 순간이 있다(보이는 좌표가 정수가 아니다)
 *  ② 걸음 프레임이 바뀐다(발이 번갈아 나간다)
 *  ③ 연타가 밀리지 않는다(애니메이션 중에 눌러도 턴이 즉시 는다)
 *  ④ 가만히 있으면 프레임 고리가 멈춘다(배터리)
 *  ⑤ 순간이동·층 이동은 보간하지 않는다(지도를 미끄러져 가면 안 된다)
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";

import { fileURLToPath } from "url";
import { CHROME } from "./chrome.mjs";   /* 경로는 한 곳에서만 정한다 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(res => srv.listen(0, "127.0.0.1", res));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener("open", r));
let id = 0; const w = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (me, p, s) => new Promise((res, rej) => { const i = ++id; w.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result)); ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
/* ⚠ **예외를 삼키지 않는다.** 전에는 result.value 만 읽어서, 화면 쪽이
 *   터지면 undefined 가 돌아왔다. 그러면 몇 줄 뒤에서 'undefined 의 turn 을
 *   읽을 수 없다' 로 터지는데, 진짜 원인은 그 자리가 아니다. 한 번 그러느라
 *   엉뚱한 곳을 팠다. 터진 자리에서 터진 이유를 말하게 한다. */
const ev = async (x) => {
  const r = await S("Runtime.evaluate", { expression: x, returnByValue: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("화면에서 터졌다 :: " + x + " :: " +
      ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await S("Page.enable"); await S("Runtime.enable");
await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/" });
await sleep(1500);
await ev("window.__start('warrior')");
await sleep(400);

let fails = 0;
const ok = b => { if (!b) fails++; return b ? "✔" : "✘"; };

const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, " ": 32, Enter: 13 };
/* ⚠ 스페이스는 key 가 " " 이고 code 는 "Space" 다. 둘을 같은 값으로 보내면
 *   제품의 e.code === "Space" 갈래가 안 걸려 조용히 아무 일도 안 일어난다. */
const CODE = { " ": "Space" };
async function tap(key) {
  const code = CODE[key] || key;
  await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: VK[key] });
  await S("Input.dispatchKeyEvent", { type: "keyUp", key, code });
}

/* ① 칸 사이에 있는 순간 — 여러 방향을 시도해 실제로 움직이는 걸음을 찾는다 */
let mid = null, strides = new Set();
for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) {
  const before = await ev("window.__peek()");
  await tap(key);
  await sleep(35);                       /* 115ms 중 약 1/3 지점 */
  const v = await ev("window.__vis()");
  const after = await ev("window.__peek()");
  if (after.turn > before.turn && v.moving) {
    if (!mid) mid = v;
    strides.add(v.stride);
  }
  await sleep(160);                      /* 다음 걸음 전에 끝나게 */
}
console.log("① 칸 사이 보간 :", ok(mid && (mid.vx % 1 !== 0 || mid.vy % 1 !== 0)),
  mid ? "보이는 자리 " + mid.vx.toFixed(2) + ", " + mid.vy.toFixed(2) + " (진행 " + (mid.t * 100).toFixed(0) + "%)"
      : "움직이는 순간을 못 잡음");

/* ② 걸음 프레임이 번갈아 바뀌는가 */
console.log("② 걸음 프레임  :", ok(strides.size >= 2), "나온 프레임 " + [...strides].sort().join(", "));

/* ③ 연타가 밀리지 않는가 — 애니메이션이 끝나기 전에 계속 누른다 */
const t0 = await ev("window.__peek()");
for (let i = 0; i < 8; i++) {
  await tap(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"][i % 4]);
  await sleep(30);                       /* 애니메이션(115ms)보다 훨씬 빠르게 */
}
const t1 = await ev("window.__peek()");
console.log("③ 연타 즉시 반응:", ok(t1.turn - t0.turn >= 6), "8번 눌러 턴 " + t0.turn + " → " + t1.turn);

/* ④ 가만히 있을 때 **얼마나 그리는가**
 *
 * ⚠ 전에는 "고리가 아예 멈추는가" 였다. 횃불 일렁임이 들어오면서 그 전제가
 *   낡았다 — 일렁이려면 다시 그려야 한다. 그렇다고 검사를 지우면 안 된다.
 *   이 검사가 막던 진짜 사고는 "턴제인데 유휴에 60fps 로 돈다" 이고 그건
 *   여전히 막아야 한다. 그래서 **멈추는가 대신 초당 몇 번 그리는가**를 센다.
 * ⚠ 최근 메시지 토스트가 3.6초 동안 사라진다 — 그 동안은 60fps 가 정상이다.
 *   그게 끝난 뒤부터 센다.
 * ⚠ 횃불이 안 보이는 자리라면 아예 멈춰 있어야 한다. 두 갈래를 갈라 판정한다. */
await sleep(4200);
const idle = await ev("window.__vis()");
/* 2초 동안 실제 그린 횟수를 센다 — 플래그가 아니라 프레임을 센다 */
const drawn = await ev(`(function(){
  return new Promise(function (done) {
    var n = 0, t0 = performance.now();
    var id = 0;
    function tick() { n++; id = requestAnimationFrame(tick); }
    id = requestAnimationFrame(tick);
    setTimeout(function () {
      cancelAnimationFrame(id);
      done({ raf: n, ms: performance.now() - t0 });
    }, 2000);
  });
})()`);
/* rAF 로는 '화면이 몇 번 갱신됐나' 만 나온다. 게임이 몇 번 그렸는지는
 * 렌더러의 시계로 읽는다 — 시계는 그릴 때만 는다. */
const c0 = await ev("window.__clock ? window.__clock() : 0");
await sleep(2000);
const c1 = await ev("window.__clock ? window.__clock() : 0");
const frames = await ev("window.__drawCount ? window.__drawCount() : -1");
await sleep(1000);
const frames2 = await ev("window.__drawCount ? window.__drawCount() : -1");
const fps = frames2 >= 0 ? (frames2 - frames) : -1;
/* 횃불이 보이면 느린 박자(초당 20회 이하), 안 보이면 아예 0 이어야 한다 */
const want = idle.idleAnim ? 20 : 1;
console.log("④ 유휴 시 그리기:", ok(fps >= 0 && fps <= want),
  (idle.idleAnim ? "횃불 일렁임 중 · " : "일렁일 것 없음 · ") +
  "1초에 " + fps + "번 그림 (" + want + "번 이하여야 한다)" +
  (fps > want ? " · ⚠유휴인데 계속 돈다" : ""));

/* ⑤ 층을 내려갈 때 보간하지 않는가 — 지도 반대편으로 미끄러져 가면 안 된다.
 *    ⚠ "코드가 그렇게 돼 있다" 로 넘기지 말고 실제로 계단까지 걸어가 밟아 본다. */
function bfsStep(map, sx, sy, tx, ty) {
  const W = map.w, H = map.h, prev = new Int32Array(W * H).fill(-1);
  const start = sy * W + sx, goal = ty * W + tx;
  prev[start] = start;
  const q = [start]; let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === goal) {
      let n = cur;
      while (prev[n] !== start) n = prev[n];
      return [(n % W) - sx, ((n / W) | 0) - sy];
    }
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i2 = ny * W + nx;
      if (!map.walk[i2] || prev[i2] !== -1) continue;
      prev[i2] = cur; q.push(i2);
    }
  }
  return null;
}
const dirKey = (dx, dy) => dx > 0 ? "ArrowRight" : dx < 0 ? "ArrowLeft" : dy > 0 ? "ArrowDown" : "ArrowUp";

/* ⚠ 계단까지 걸어가는 동안 **맞아 죽으면 이 검사는 못 돈다.** 기회 공격이
 *   생긴 뒤 실제로 그랬다(48걸음에서 끊겼다). 여기서 보려는 것은 층 이동
 *   애니메이션이지 전투 생존이 아니다 — 길을 비우고 잰다. */
await ev("window.__clearMonsters()");
let map = await ev("window.__map()");
let st = await ev("window.__peek()");
const depth0 = st.depth;
let guard = 0;
let lastSt = null;
while (!st.onStairs && guard++ < 900 && !st.over) {
  const step = bfsStep(map, st.x, st.y, st.stairs.x, st.stairs.y);
  if (!step) break;
  await tap(dirKey(step[0], step[1]));
  await sleep(22);
  st = await ev("window.__peek()");
  lastSt = st;
}
let snap = null, enterDead = null;
if (st.onStairs) {
  const posBefore = { x: st.x, y: st.y };
  /* ⚠ 계단은 **Space** 다(2026-09-18 사용자 지시). Enter 는 더 안 받는다 —
   *   옛 키가 살아 있으면 규칙이 둘이 되므로 죽었는지도 함께 잰다. */
  await tap("Enter");
  await sleep(140);
  enterDead = (await ev("window.__peek()")).depth === depth0;

  await tap(" ");
  await sleep(30);                       /* 애니메이션이 있다면 아직 중간일 시각 */
  const v = await ev("window.__vis()");
  const p = await ev("window.__peek()");
  snap = { v, p, posBefore, depth0 };
}
console.log("⑤ 층 이동 스냅 :",
  ok(snap && snap.p.depth > snap.depth0 && !snap.v.moving &&
     snap.v.vx === snap.p.x && snap.v.vy === snap.p.y),
  snap ? (snap.depth0 + "층 → " + snap.p.depth + "층 · 보이는 자리 " +
          snap.v.vx + "," + snap.v.vy + " = 논리 " + snap.p.x + "," + snap.p.y +
          " · 보간 " + (snap.v.moving ? "함(⚠ 지도를 미끄러져 간다)" : "안 함"))
       : "계단에 못 닿아 검사 못 함 (guard=" + guard + " · " +
         (lastSt && lastSt.over ? "걸어가다 죽었다" : "길이 끊겼다") + ")");

console.log("⑥ 계단은 Space :",
  enterDead === null ? "— 계단에 못 닿아 검사 못 함"
    : ok(enterDead) + " Enter 로는 안 내려간다 · Space 로 " + depth0 + "층 → " +
      (snap ? snap.p.depth : "?") + "층");

console.log(fails === 0 ? "\n전부 통과" : "\n✘ 실패 " + fails + "건");
ws.close(); ch.kill(); srv.close();
process.exit(fails === 0 ? 0 : 1);
