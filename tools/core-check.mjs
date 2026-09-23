/* 1단계 — 시간 축 · 자유 이동 · 벽 충돌이 **정말** 맞는가.
 *
 * 실시간은 턴제보다 버그가 훨씬 안 보인다. 턴제에서는 한 번 누르면 한 칸이라
 * 눈으로 세어지지만, 실시간은 "조금 빠른 것 같다" 로만 보인다. 그래서 잰다.
 *
 * ⚠ 눈으로 보고 "부드럽다" 고 판정하지 말 것. 대각이 1.41배 빠른 버그는
 *   화면으로는 거의 안 보이는데 게임을 통째로 망가뜨린다(모두가 지그재그로만 다닌다).
 * ⚠ 주사율에 따라 결과가 달라지는 버그는 **이 컴퓨터에서는 영원히 안 보인다.**
 *   프레임 시간을 손으로 먹여서 잰다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-core-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
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
  const i = ++id; wait.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
/* ⚠ 고정 대기로 단정하지 않는다. 1,200ms 를 세고 물어보면 아직 스크립트가
 *   안 붙은 판에서 "전역이 없다" 로 빨개진다 — 제품은 멀쩡한데 검사가
 *   성급했던 것이다. 준비됐는지를 물어보고 기다린다. */
for (let i = 0; i < 300; i++) {
  if (await ev("!!(window.WORLD && window.VIEW && window.__w && window.__w())")) break;
  await sleep(60);
}

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* ── 띄우기 ─────────────────────────────────────────── */
const up = await ev("!!(window.WORLD && window.VIEW && window.__w && window.__w())");
add("띄우기", up, up ? "WORLD · VIEW · 세계 생성됨" : "⚠ 전역이 없다 — 스크립트 순서를 보라");

if (up) {
  /* ── 고정 걸음: 주사율이 달라도 같은 거리 ───────────
   * 같은 1초를 **잘게** 먹일 때와 **크게** 먹일 때 결과가 같아야 한다.
   * 다르면 주사율 높은 기기가 유리해진다(실시간 게임의 고전 버그). */
  const rate = await ev(`(function(){
    var W = window.WORLD, D = window.DUNGEON;
    function run(dt, n) {
      var w = new W.World({ seed: 12345, w: 60, h: 40, mobs: 0 });
      /* 벽을 지운다 — 재려는 것은 **속도**지 벽이 아니다 */
      w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
      w.player.x = 20.5; w.player.y = 20.5;
      w.player.px = w.player.x; w.player.py = w.player.y;
      w.player.mx = 1; w.player.my = 0;
      var x0 = w.player.x;
      for (var i = 0; i < n; i++) w.advance(dt);
      return { d: w.player.x - x0, steps: w.steps, t: w.time };
    }
    return { a: run(1/240, 240), b: run(1/60, 60), c: run(1/30, 30),
             spd: new W.World({ seed: 1, mobs: 0 }).player.spd };
  })()`);
  const ds = [rate.a.d, rate.b.d, rate.c.d];
  const spread = (Math.max.apply(null, ds) - Math.min.apply(null, ds)) / Math.max.apply(null, ds);
  add("주사율 무관", spread < 0.03,
    "240Hz " + rate.a.d.toFixed(3) + "칸 · 60Hz " + rate.b.d.toFixed(3) +
    " · 30Hz " + rate.c.d.toFixed(3) + " · 벌어짐 " + (spread * 100).toFixed(1) + "%");

  add("속도 단위", Math.abs(rate.b.d - rate.spd) / rate.spd < 0.05,
    "1초에 " + rate.b.d.toFixed(2) + "칸 (설정 " + rate.spd + "칸/초)");

  /* ── 대각선이 더 빠르지 않은가 ─────────────────────── */
  const diag = await ev(`(function(){
    var W = window.WORLD, D = window.DUNGEON;
    function run(mx, my) {
      var w = new W.World({ seed: 12345, w: 60, h: 40, mobs: 0 });
      w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
      w.player.x = 20.5; w.player.y = 20.5;
      w.player.px = w.player.x; w.player.py = w.player.y;
      var x0 = w.player.x, y0 = w.player.y;
      w.player.mx = mx; w.player.my = my;
      for (var i = 0; i < 60; i++) w.advance(1/60);
      return Math.sqrt(Math.pow(w.player.x - x0, 2) + Math.pow(w.player.y - y0, 2));
    }
    return { straight: run(1, 0), diagonal: run(1, 1) };
  })()`);
  const dgap = Math.abs(diag.diagonal - diag.straight) / diag.straight;
  add("대각 정규화", dgap < 0.02,
    "직선 " + diag.straight.toFixed(3) + "칸 · 대각 " + diag.diagonal.toFixed(3) +
    "칸 · 차이 " + (dgap * 100).toFixed(1) + "%");

  /* ── 벽을 뚫지 않는가 ──────────────────────────────── */
  const wall = await ev(`(function(){
    var W = window.WORLD;
    var dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
    var stuck = 0, tries = 0;
    for (var s = 1; s <= 6; s++) {
      for (var k = 0; k < dirs.length; k++) {
        var w = new W.World({ seed: s, w: 50, h: 36, mobs: 0 });
        w.player.mx = dirs[k][0]; w.player.my = dirs[k][1];
        for (var i = 0; i < 300; i++) w.advance(1/60);
        tries++;
        if (!W.boxFree(w.level, w.player.x, w.player.y, w.player.r)) stuck++;
      }
    }
    return { stuck: stuck, tries: tries };
  })()`);
  add("벽 통과 없음", wall.stuck === 0,
    wall.tries + "가지 시도 · 벽 안에 들어간 경우 " + wall.stuck + "건");

  /* ── 빠른 돌진에도 얇은 벽을 안 뚫는가 ─────────────── */
  const fast = await ev(`(function(){
    var W = window.WORLD;
    var dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    var bad = 0, n = 0;
    for (var s = 1; s <= 8; s++) {
      var w = new W.World({ seed: s, w: 50, h: 36, mobs: 0 });
      w.player.spd = 40;                /* 나중에 붙을 돌진 스킬 정도 */
      for (var k = 0; k < dirs.length; k++) {
        w.player.mx = dirs[k][0]; w.player.my = dirs[k][1];
        for (var i = 0; i < 120; i++) {
          w.advance(1/60); n++;
          if (!W.boxFree(w.level, w.player.x, w.player.y, w.player.r)) { bad++; break; }
        }
      }
    }
    return { bad: bad, n: n };
  })()`);
  add("빠른 이동 터널링", fast.bad === 0,
    "속도 40칸/초로 " + fast.n + "걸음 · 벽 안 " + fast.bad + "건");

  /* ── 벽을 타고 미끄러지는가 ────────────────────────── */
  const slide = await ev(`(function(){
    var W = window.WORLD, D = window.DUNGEON;
    /* 손으로 만든 복도: 위가 막힌 자리에서 오른쪽위로 밀면 **오른쪽으로는 가야** 한다 */
    var w = new W.World({ seed: 7, w: 40, h: 30, mobs: 0 });
    var lv = w.level;
    lv.tiles = new Uint8Array(lv.w * lv.h).fill(D.WALL);
    for (var x = 5; x < 30; x++) lv.tiles[10 * lv.w + x] = D.FLOOR;
    w.player.x = 6.5; w.player.y = 10.5;
    w.player.px = w.player.x; w.player.py = w.player.y;
    w.player.mx = 1; w.player.my = -1;
    var x0 = w.player.x, y0 = w.player.y;
    for (var i = 0; i < 60; i++) w.advance(1/60);
    return { dx: w.player.x - x0, dy: w.player.y - y0,
             top: w.player.y - w.player.r, r: w.player.r };
  })()`);
  /* ⚠ 처음에 "세로 0" 을 기대했다가 빨개졌다. **검사의 전제가 틀렸다** —
   *   몸 너비가 0.68칸인데 복도가 1칸이라 위아래로 0.16칸의 여유가 실제로 있다.
   *   그만큼 올라붙는 것이 정상이다. 재야 할 것은 "안 움직였는가" 가 아니라
   *   **벽면에 딱 붙어 멈췄는가**다(틈이 남으면 벽을 따라 걸을 때 덜덜거린다). */
  const slack = 0.5 - slide.r;
  const flush = Math.abs(slide.top - 10) < 0.01;     /* 위 칸(9)의 아랫변이 y=10 */
  add("벽 타고 미끄러짐", slide.dx > 2.5 && flush && slide.dy <= 0 && -slide.dy <= slack + 0.01,
    "오른쪽위로 1초 → 가로 " + slide.dx.toFixed(2) + "칸 · 위로 " +
    (-slide.dy).toFixed(3) + "칸(여유 " + slack.toFixed(2) + "칸) · 벽면에 " +
    (flush ? "딱 붙음" : "⚠틈 " + (slide.top - 10).toFixed(3)));

  /* ── 실제 화면에서 걸으면 시야가 따라오는가 ────────── */
  /* ⚠ 씨앗을 고정하고 **네 방향을 돌린다.** 전에는 무작위 씨앗에서 오른쪽만
   *   눌렀는데, 시작 자리 오른쪽이 벽인 판에서는 한 칸도 못 가 "시야가 안 는다" 로
   *   빨개졌다(단독으로는 통과, 묶어 돌리면 가끔 실패 — 가장 나쁜 종류다).
   *   제품이 아니라 검사가 불안정했던 자리다. */
  /* ⚠ 씨앗 하나에 기대지 않는다. 2026-09-23 에 던전 판을 40x28 로 줄이자
   *   씨앗 4242 의 시작 방이 좁아져 **네 방향이 다 막혔고**, 한 칸도 못 간 채
   *   "시야가 안 는다" 로 빨개졌다 — 제품은 멀쩡했다. 판 크기가 바뀔 때마다
   *   씨앗을 다시 고르는 것은 검사가 아니라 메모다.
   * ⚠ **움직였는지를 먼저 본다.** 한 칸도 못 간 판에서는 시야가 늘 이유가
   *   없으므로, 그 판으로는 아무 것도 판정하지 않고 다음 씨앗으로 넘어간다. */
  const SEEDS = [4242, 7, 1337, 99, 20260923, 55501];
  let fov = null;
  for (const sd of SEEDS) {
    await ev(`window.__start({ seed: ${sd} })`);
    await sleep(300);
    const at0 = await ev(`(function(){
      var w = window.__w(); var n = 0;
      for (var i = 0; i < w.level.seen.length; i++) n += w.level.seen[i];
      return { seen: n, x: w.player.x, y: w.player.y };
    })()`);
    for (const k of ["KeyD", "KeyS", "KeyA", "KeyW"]) {
      await ev(`window.__hold(["` + k + `"])`);
      await sleep(420);
    }
    const at1 = await ev(`(function(){
      window.__hold([]); var w = window.__w(); var n = 0;
      for (var i = 0; i < w.level.seen.length; i++) n += w.level.seen[i];
      return { seen: n, x: w.player.x, y: w.player.y, steps: w.steps, fps: window.__fps() };
    })()`);
    const moved = Math.hypot(at1.x - at0.x, at1.y - at0.y);
    fov = { seed: sd, seen0: at0.seen, seen: at1.seen, moved: +moved.toFixed(2), fps: at1.fps };
    /* 네 방향을 돌면 제자리로 오므로 마지막 위치가 아니라 **시야가 늘었는가**로
     * 본다. 움직임은 "이 판에서 판정할 수 있는가" 를 가르는 데만 쓴다. */
    if (at1.seen > at0.seen) break;
    if (moved > 1.5) break;              /* 움직였는데도 안 늘었다면 진짜 문제다 */
  }
  const after = { fps: fov.fps };
  add("시야 갱신", fov.seen > fov.seen0,
    "씨앗 " + fov.seed + " · 걸어가며 알게 된 칸 " + fov.seen0 + " → " + fov.seen +
    " · 움직인 거리 " + fov.moved + "칸" +
    (fov.seen > fov.seen0 ? "" : (fov.moved <= 1.5 ? " · ⚠ 사방이 막혀 판정 못 함" : "")));
  add("프레임", after.fps >= 30, after.fps + "fps (헤드리스 기준)");

  /* ── 정말 그려지는가 — 빈 화면이면 위가 다 통과해도 소용없다 ── */
  const painted = await ev(`(function(){
    var c = document.getElementById("view");
    var g = c.getContext("2d");
    var d = g.getImageData(0, 0, c.width, c.height).data;
    var seen = {}, colors = 0, lit = 0;
    for (var i = 0; i < d.length; i += 4 * 37) {
      var k = d[i] + "," + d[i+1] + "," + d[i+2];
      if (!seen[k]) { seen[k] = 1; colors++; }
      if (d[i] + d[i+1] + d[i+2] > 60) lit++;
    }
    return { colors: colors, lit: lit, w: c.width, h: c.height };
  })()`);
  add("화면에 그려짐", painted.colors > 20 && painted.lit > 200,
    painted.w + "×" + painted.h + " · 색 " + painted.colors + "가지 · 밝은 점 " + painted.lit + "개");
}

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n1단계 — 시간 축 · 자유 이동 · 벽 충돌\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(16, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 이미 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
