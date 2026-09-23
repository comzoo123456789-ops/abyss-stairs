/* 조준 · 몸 방향 · ESC 겹 · 공격 중 걸음 — **진짜 마우스와 진짜 키보드**로.
 *
 * 넷 다 "해 보면 안다" 로 넘어갔다가 되돌아온 자리다.
 *   ① ESC 한 번에 두 겹이 닫혔다 (물건 창을 닫으려다 가방까지)
 *   ② 활을 들고 물러나며 쏘면 **가는 쪽**으로 화살이 나갔다
 *   ③ 몸도 커서가 아니라 걸음을 따라 돌았다
 *   ④ 누르고 있으면 내내 30% 속도 — "공격하면 느려진다"
 *
 * ⚠ `.click()` 이나 `world.swing()` 직접 호출로는 못 잰다. 재려는 것이
 *   **입력에서 화면까지의 길**이다. CDP 로 진짜 이벤트를 넣는다.
 * ⚠ 각도는 8도로 끊는다. 눈으로는 8도가 안 보인다 — 그래서 재는 것이다.
 * ⚠ 대조군: `OLD=1` 로 돌리면 **고친 네 줄만 되돌린** 파일을 내준다.
 *   `git show HEAD` 를 통째로 내주면 검사용 갈고리(__give·__findBag·dirX)까지
 *   같이 사라져서, 빨개져도 "옛 동작이 나쁘다" 가 아니라 "갈고리가 없다" 다.
 *   그건 대조군이 아니다. 되돌릴 자리를 하나씩 못 찾으면 **터뜨린다** —
 *   조용히 원본을 내주면 대조군이 통과해 버리고, 그게 제일 나쁘다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ROOT = path.join(REPO, "public");
const OLD = process.env.OLD === "1";          /* 대조군 */
/* 배포본을 다시 잰다: node tools/aim-check.mjs --url https://...
 * 올렸다고 바뀐 것이 아니다. ?v= 를 안 올리면 브라우저가 옛것을 쓴다.
 * cb 로 CDN 을 비켜 간다. 대조군은 내 파일을 고쳐 내주는 것이라 같이 못 쓴다. */
const ui = process.argv.indexOf("--url");
const URL_ARG = ui >= 0 ? process.argv[ui + 1] : null;
if (URL_ARG && OLD) { console.error("--url 과 OLD=1 은 같이 못 쓴다"); process.exit(2); }

/* 고친 자리를 **하나씩** 되돌린다. [파일, 지금, 옛날] */
const REVERT = [
  ["/js/app.js",                       /* ① ESC 겹 닫기 */
   /if \(e\.code === "Escape"\) \{[\s\S]*?closePanel\(\);\s*return;\s*\}/,
   'if (e.code === "Escape") { closePanel(); return; }'],
  ["/js/app.js",                       /* ② 마우스 조준 */
   /if \(hasCursor\(\) && !touchAttacking && !touchMove\.x && !touchMove\.y\) \{[\s\S]*?return mw;\s*\}/,
   ""],
  ["/js/app.js",                       /* ③ 몸이 커서를 봄 */
   /if \(hasCursor\(\) && !touchAttacking && !touchMove\.x && !touchMove\.y && !world\.player\.dead\) \{[\s\S]*?world\.player\.face = world\.player\.dirX > 0 \? 1 : -1;\s*\}\s*\}/,
   ""],
  ["/js/world.js",                     /* ④ 공격 중 걸음 */
   /var slow = e\.atk \? 0\.55 : 1;/,
   "var slow = (e.atk || e.atkRest > 0) ? 0.30 : 1;"]
];
function oldify(urlPath, text) {
  let n = 0;
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리를 못 찾았다: " + urlPath + " :: " + re);
    text = text.replace(re, to); n++;
  }
  if (!n) return text;
  return text;
}
const OLDIFY = ["/js/app.js", "/js/world.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-aim-"));
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

/* ⚠ 예외를 삼키면 화면이 터져도 undefined 만 돌아온다. */
const ev = async x => {
  const r = await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("화면에서 터졌다 :: " + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const KEY = { d: { code: "KeyD", key: "d", vk: 68 }, a: { code: "KeyA", key: "a", vk: 65 } };
const keyDown = k => S("Input.dispatchKeyEvent", { type: "keyDown", code: KEY[k].code, key: KEY[k].key, windowsVirtualKeyCode: KEY[k].vk, nativeVirtualKeyCode: KEY[k].vk, text: KEY[k].key });
const keyUp = k => S("Input.dispatchKeyEvent", { type: "keyUp", code: KEY[k].code, key: KEY[k].key, windowsVirtualKeyCode: KEY[k].vk, nativeVirtualKeyCode: KEY[k].vk });
const esc = async () => {
  await S("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
};
const mMove = (x, y) => S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0, clickCount: 0 });
const mDown = (x, y) => S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
const mUp = (x, y) => S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });

const W = 1280, H = 800;
await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Page.navigate", { url: TARGET });
await sleep(1500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* 던전으로 내려가 **사방이 트인 마당**으로 만든다.
 * ⚠ 벽에 막히면 걸음을 잴 수 없다. 재려는 것은 벽이 아니다. */
const setup = await ev(`(function(){
  window.__dev && window.__dev();
  window.__start({ depth: 1 });
  var w = window.__w();
  w.level.tiles.fill(window.DUNGEON.FLOOR);
  w.level.visible.fill(1); w.level.seen.fill(1);
  w.refreshFov = function () { this.level.visible.fill(1); return false; };
  w.ents.length = 1;                 /* 플레이어만 — 몬스터가 밀면 못 잰다 */
  w.player.x = Math.floor(w.level.w / 2) + 0.5;
  w.player.y = Math.floor(w.level.h / 2) + 0.5;
  w.player.px = w.player.x; w.player.py = w.player.y;
  /* 활을 쥔다. ⚠ 기본 무기는 근접이라 **화살이 안 나간다** — 조준을 못 잰다 */
  window.__give();
  var bi = window.__findBag("bow");
  if (bi >= 0) window.__equipBag(bi);
  return { bow: bi >= 0, lvl: window.__hero().level };
})()`);
await sleep(400);
await esc(); await sleep(250);          /* __equipBag 이 가방을 열어 둔다 */

const live = await ev("window.__peek().fps");

/* ── ① ESC 는 한 겹만 닫는다 ───────────────────────── */
await ev("window.__bag()");
await sleep(350);
const bagOpen0 = await ev("!document.getElementById('panel').hidden");
/* 가방 안의 첫 칸을 진짜 마우스로 누른다 */
const cell = await ev(`(function(){
  var c = document.querySelector('#panel [data-bag-idx]');
  if (!c) return null;
  var r = c.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
let escNote = "가방 칸을 못 찾았다";
let escOk = false;
if (cell) {
  await mMove(cell.x, cell.y); await mDown(cell.x, cell.y); await mUp(cell.x, cell.y);
  await sleep(300);
  const modal0 = await ev("!!document.getElementById('itemModal')");
  await esc(); await sleep(250);
  const modal1 = await ev("!!document.getElementById('itemModal')");
  const bag1 = await ev("!document.getElementById('panel').hidden");
  await esc(); await sleep(250);
  const bag2 = await ev("!document.getElementById('panel').hidden");
  escOk = modal0 && !modal1 && bag1 && !bag2;
  escNote = "물건창 " + (modal0 ? "열림" : "안 열림") +
    " → ESC → 물건창 " + (modal1 ? "열림" : "닫힘") + " · 가방 " + (bag1 ? "열림" : "닫힘") +
    " → ESC → 가방 " + (bag2 ? "열림" : "닫힘");
}
add("ESC 는 한 겹씩", escOk, escNote);

/* 다음 잼을 위해 **화면을 비운다.**
 * ⚠ 대조군에서는 ①이 실패하며 물건 창이 남는다. 그 덮개가 캔버스를 가리면
 *   ②③④ 가 "안 쏜다" 로 빨개져서, 무엇이 나빴는지가 아니라 앞 검사가
 *   남긴 쓰레기를 보게 된다. 잼마다 **같은 자리에서** 출발해야 한다. */
await ev(`(function(){
  ["itemModal", "itemCtx"].forEach(function (k) {
    var el = document.getElementById(k);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
  var p = document.getElementById("panel");
  if (p) { p.hidden = true; p.style.display = "none"; }
})()`);
await sleep(200);

/* 화면에서 플레이어가 그려지는 자리 */
const pxy = () => ev(`(function(){
  var w = window.__w(), v = window.__v();
  var s = v.toScreen ? v.toScreen(w.player.x, w.player.y) : null;
  return s ? { x: Math.round(s.x), y: Math.round(s.y) } : null;
})()`);

/* ── ② 걸어가는 중에도 **몸이 커서를 본다** ──────────────
 * 오른쪽(D)으로 걸으면서 커서는 **왼쪽 위**에 둔다.
 * 옛 코드는 걸음이 이겨서 dir 이 (1,0) 이었다. */
const scr = await pxy();
const CUR = scr ? { x: Math.max(20, scr.x - 320), y: Math.max(20, scr.y - 240) }
                : { x: 260, y: 200 };
await mMove(CUR.x, CUR.y);
await keyDown("d");
await sleep(500);
const facing = await ev(`(function(){
  var p = window.__peek(), w = window.__w(), v = window.__v();
  var tw = v.toWorld(${CUR.x}, ${CUR.y});
  var wx = tw.x - w.player.x, wy = tw.y - w.player.y;
  var wl = Math.hypot(wx, wy) || 1;
  var dot = (p.dirX * wx + p.dirY * wy) / wl;
  return { deg: +(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toFixed(1),
           dirX: p.dirX, dirY: p.dirY, moving: true };
})()`);
add("몸이 커서를 본다", facing.deg <= 8,
  "오른쪽으로 걷는 중 커서는 왼쪽 위 · 어긋난 각 " + facing.deg + "도 (8도 이하) · 몸 (" +
  facing.dirX + ", " + facing.dirY + ")");

/* ── ③ 걸어가는 중에도 **화살이 커서로 간다** ─────────────
 * ⚠ 쏘고 나서 재면 늦는다. 활은 9칸을 15칸/초로 날아가 **0.6초면 사라진다** —
 *   650ms 뒤에 보면 `shots` 가 비어 있고, 검사는 "안 쏜다" 고 말한다(그렇게
 *   한 번 속았다). 나가는 **그 순간**을 화면 안에서 지켜보게 한다. */
await ev(`(function(){
  window.__firstShot = null;
  var w = window.__w();
  var t = setInterval(function () {
    if (w.shots.length && !window.__firstShot) {
      var s = w.shots[0];
      window.__firstShot = { vx: s.vx, vy: s.vy, x: s.x, y: s.y };
      clearInterval(t);
    }
  }, 8);
  setTimeout(function () { clearInterval(t); }, 4000);
})()`);
await mDown(CUR.x, CUR.y);
await sleep(900);
const shot = await ev(`(function(){
  var w = window.__w(), v = window.__v();
  var s = window.__firstShot;
  if (!s) return { none: true, swung: !!w.player.atk || w.player.atkRest > 0,
                   ranged: window.__peek().ranged };
  var tw = v.toWorld(${CUR.x}, ${CUR.y});
  /* 화살이 **떠난 자리**에서 커서를 향한 벡터와 견준다 */
  var wx = tw.x - s.x, wy = tw.y - s.y;
  var wl = Math.hypot(wx, wy) || 1;
  var sl = Math.hypot(s.vx, s.vy) || 1;
  var dot = (s.vx * wx + s.vy * wy) / (sl * wl);
  return { deg: +(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI).toFixed(1),
           vx: +s.vx.toFixed(2), vy: +s.vy.toFixed(2) };
})()`);
add("화살이 커서로 간다", !shot.none && shot.deg <= 12,
  shot.none ? "화살이 안 나갔다 (원거리 무기 " + shot.ranged + " · 휘둘림 " + shot.swung + ")"
            : "걷는 중 쏜 화살이 커서와 " + shot.deg + "도 (12도 이하) · 속도 (" + shot.vx + ", " + shot.vy + ")");
await mUp(CUR.x, CUR.y);
await keyUp("d");
await sleep(300);

/* ── ④ 공격하면서도 **걷는다** ──────────────────────────
 * 같은 거리를 두 번 잰다: 그냥 걸을 때 / 누르고 있을 때.
 * ⚠ 비율로 봐야 한다. 절대 거리는 무기·직업·버프마다 다르다. */
async function walk(secs, attacking) {
  await ev(`(function(){
    var w = window.__w();
    w.player.x = Math.floor(w.level.w / 2) + 0.5;
    w.player.y = Math.floor(w.level.h / 2) + 0.5;
    w.player.px = w.player.x; w.player.py = w.player.y;
    w.player.atk = null; w.player.atkRest = 0;
    window.__mark = { x: w.player.x, y: w.player.y };
  })()`);
  await mMove(CUR.x, CUR.y);
  await keyDown("d");
  if (attacking) await mDown(CUR.x, CUR.y);
  await sleep(secs * 1000);
  const d = await ev(`(function(){
    var w = window.__w();
    return +Math.hypot(w.player.x - window.__mark.x, w.player.y - window.__mark.y).toFixed(3);
  })()`);
  if (attacking) await mUp(CUR.x, CUR.y);
  await keyUp("d");
  await sleep(250);
  return d;
}
const free = await walk(1.2, false);
const busy = await walk(1.2, true);
const ratio = free > 0 ? +(busy / free).toFixed(3) : 0;
add("공격해도 걷는다", ratio >= 0.45,
  "그냥 " + free + "칸 · 누르고 " + busy + "칸 → " + Math.round(ratio * 100) +
  "% (45% 이상) · 옛 값은 30% 였다");

console.log(OLD ? "── 조준 · 겹 · 걸음 [대조군: 고치기 전] ──"
                : ("── 조준 · 겹 · 걸음" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
console.log("   (프레임 " + live + "fps · 화면 " + W + "x" + H + " · 활 " + (setup.bow ? "쥠" : "없음") + " · Lv." + setup.lvl + ")");
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
