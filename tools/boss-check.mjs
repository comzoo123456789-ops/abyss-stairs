/* 수문장 — 층마다 하나가 계단을 지키는가.
 *
 * 사용자 결정 2026-09-23:
 *   다음 층으로 내려가기 전에 **중간보스**가 있고, **10층마다 진짜 보스**다.
 *   수문장은 계단을 **막는다** — 쓰러뜨려야 열린다.
 *   10·20·30 으로 옮기며 자리를 잃은 무덤지기·사서는 그 구역의 중간보스로,
 *   예비로 놀던 관리인도 함께 쓴다.
 *
 *   ① 10층마다 진짜 보스    10·20·30 만 boss, 나머지는 mid
 *   ② 층마다 하나는 선다    1~30 어느 층에도 수문장이 있다
 *   ③ 계단 곁에 선다        계단에서 몇 칸 안이다(판을 뒤지게 하지 않는다)
 *   ④ 살아 있으면 잠긴다    밟고 눌러도 안 내려가고, 왜인지 말해 준다
 *   ⑤ 죽으면 열린다         정말 내려가진다
 *   ⑥ 세기가 알맞다         보통 몬스터보다 확실히 세고 진짜 보스보다 약하다
 *   ⑦ 구역마다 얼굴이 다르다  어디쯤 왔는지가 수문장으로 보인다
 *
 * ⚠ 중간보스 능력치를 보스 표에서 그대로 쓰면 안 된다. 무덤지기 체력 230 은
 *   1층 주인공(초당 7)에게 33초다. 표에서는 이름·그림·성격만 가져오고
 *   체력과 피해는 그 층에서 뽑는다 — ⑥이 그것을 지킨다.
 * ⚠ 대조군 `OLD=1` 은 보스를 옛 구역 끝(6·12·18·24·30)으로 되돌리고 계단
 *   잠금을 푼다. ①과 ④가 빨개져야 한다.
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
  ["/js/data.js",
   /if \(depth < 10 \|\| depth % 10 !== 0\) return null;/,
   "var z0 = zoneAt(depth); if (depth !== z0.to) return null;"],
  ["/js/app.js",
   /var g = world\.stairGuard\(\);\s*if \(g\) \{[\s\S]*?\}\s*var d = world\.depth \+ 1;/,
   "var d = world.depth + 1;"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/data.js", "/js/app.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-bs-"));
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
for (let i = 0; i < 300; i++) {
  if (await ev("!!(window.WORLD && window.DATA && window.__start && window.__hero)")) break;
  await sleep(60);
}
await ev(`window.__pick && window.__pick("warrior")`);
await sleep(500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* ── ① 10층마다 진짜 보스 ─────────────────────────── */
const kinds = await ev(`(function(){
  var DT = window.DATA, out = [];
  for (var d = 1; d <= 30; d++) {
    var g = DT.guardAt(d);
    out.push({ d: d, kind: g ? g.kind : null, name: g ? g.def.name : null,
               hp: g ? g.def.hp : 0, dmg: g ? g.def.dmg : 0 });
  }
  return out;
})()`);
const bossFloors = kinds.filter(k => k.kind === "boss").map(k => k.d);
const wantBoss = [10, 20, 30];
add("10층마다 진짜 보스",
  bossFloors.length === 3 && bossFloors.every((d, i) => d === wantBoss[i]),
  "진짜 보스 층 [" + bossFloors.join(",") + "] · " +
  kinds.filter(k => k.kind === "boss").map(k => k.d + "층 " + k.name).join(" · "));

/* ── ② 층마다 하나는 선다 ─────────────────────────── */
const none = kinds.filter(k => !k.kind).map(k => k.d);
add("층마다 하나는 있다", none.length === 0,
  "1~30층 전부 수문장 있음" + (none.length ? " · ⚠ 없는 층 [" + none.join(",") + "]" : "") +
  " · 중간보스 " + kinds.filter(k => k.kind === "mid").length + "층");

/* ── ⑥ 세기가 알맞다 · ⑦ 얼굴 ───────────────────────
 * ⚠ 표 값 그대로 쓰면 1층 무덤지기가 230 이다. 그 층 몬스터와 견준다. */
const power = await ev(`(function(){
  var DT = window.DATA, out = [];
  [1, 3, 7, 9, 13, 17, 21, 27].forEach(function (d) {
    var g = DT.guardAt(d), base = DT.midBaseAt(d);
    out.push({ d: d, name: g.def.name, hp: g.def.hp, base: Math.round(base.hp),
               x: +(g.def.hp / base.hp).toFixed(1) });
  });
  return out;
})()`);
const lo = Math.min(...power.map(p => p.x)), hi = Math.max(...power.map(p => p.x));
/* ⚠ "모든 중간보스 < 모든 진짜 보스" 로 재면 안 된다. 29층 중간보스가
 *   10층 보스보다 센 것은 **맞는 일**이다 — 깊은 층이 더 어려워야 한다.
 *   재야 할 것은 **바로 다음 보스와의 사이**다: 보스가 봉우리인가. */
const bossHp = kinds.filter(k => k.kind === "boss").map(k => k.hp);
const midHp = kinds.filter(k => k.kind === "mid").map(k => k.hp);
const steps = [9, 19, 29].map(d => {
  const mid = kinds[d - 1], boss = kinds[d];
  return { d: d, mid: mid.hp, boss: boss.hp, x: +(boss.hp / mid.hp).toFixed(2) };
});
const peak = steps.every(s2 => s2.x >= 1.8);
add("세기가 알맞다", lo >= 3 && hi <= 5 && peak,
  "보통 몬스터의 " + lo + "~" + hi + "배 (3~5배) · 보스가 봉우리인가: " +
  steps.map(s2 => s2.d + "층 " + s2.mid + " → " + (s2.d + 1) + "층 " + s2.boss +
    " (" + s2.x + "배)").join(" · ") + " (1.8배 이상)");

const faces = await ev(`(function(){
  var DT = window.DATA, seen = {};
  [3, 9, 15, 21, 27].forEach(function (d) { seen[d] = DT.guardAt(d).def.name; });
  return seen;
})()`);
const faceList = Object.keys(faces).map(d => d + "층 " + faces[d]);
const uniq = new Set(Object.values(faces)).size;
add("구역마다 얼굴이 다르다", uniq === 5, faceList.join(" · ") + " · 서로 다른 얼굴 " + uniq + "/5");

/* ── ③ 계단 곁에 선다 ─────────────────────────────── */
const near = await ev(`(function(){
  var W = window.WORLD, out = [];
  [2, 5, 10, 14, 20, 26, 30].forEach(function (d) {
    var w = new W.World({ seed: 900 + d * 31, depth: d });
    var g = w.ents.filter(function (e) { return e.guardian; })[0];
    if (!g) { out.push({ d: d, miss: true }); return; }
    var dist = Math.hypot(g.x - (w.level.downAt.x + 0.5), g.y - (w.level.downAt.y + 0.5));
    out.push({ d: d, dist: +dist.toFixed(2), name: g.name, kind: g.guardKind });
  });
  return out;
})()`);
const missed = near.filter(x => x.miss);
const far = near.filter(x => !x.miss && x.dist > 2.9);
add("계단 곁에 선다", missed.length === 0 && far.length === 0,
  near.filter(x => !x.miss).map(x => x.d + "층 " + x.dist + "칸").join(" · ") +
  " (2.9칸 이내)" + (missed.length ? " · ⚠ 안 선 층 " + missed.map(x => x.d).join(",") : "") +
  (far.length ? " · ⚠ 먼 층 " + far.map(x => x.d + "층 " + x.dist).join(",") : ""));

/* ── ④ 살아 있으면 잠긴다 · ⑤ 죽으면 열린다 ──────────
 * ⚠ 내부 값만 보지 않는다. **계단에 올라서서 E 를 눌러** 본다. */
const lock = await ev(`(function(){
  window.__hero().maxDepth = 30;
  window.__start({ depth: 4 });
  var w = window.__w();
  var p = document.getElementById("panel"); if (p) { p.hidden = true; p.style.display = "none"; }
  w.player.x = w.level.downAt.x + 0.5;
  w.player.y = w.level.downAt.y + 0.5;
  w.player.px = w.player.x; w.player.py = w.player.y;
  var g = w.stairGuard();
  return { onStairs: !!w.onStairs(), guard: g ? g.name : null, depth: w.depth };
})()`);
await sleep(400);
const promptTxt = await ev(`(document.getElementById("act") || {}).textContent || ""`);
await S("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyE", key: "e", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69, text: "e" });
await S("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyE", key: "e", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
await sleep(500);
const afterLocked = await ev(`window.__w().depth`);
add("살아 있으면 잠긴다",
  lock.onStairs && !!lock.guard && afterLocked === lock.depth && /지키고 있다/.test(promptTxt),
  "4층 계단 위 · 수문장 " + (lock.guard || "(없다)") + " · E 를 눌러도 " + afterLocked +
  "층 그대로 · 안내 \\u201c" + promptTxt.trim().slice(0, 40) + "\\u201d");

const opened = await ev(`(function(){
  var w = window.__w();
  var g = w.ents.filter(function (e) { return e.guardian; })[0];
  if (g) { g.hp = 0; g.dead = true; }
  return { guard: !!w.stairGuard(), depth: w.depth,
           onStairs: !!w.onStairs() };
})()`);
/* ⚠ **다시 계단 위에 세운다.** 살아 있는 수문장이 바로 옆에 서서 앞 판정
 *   동안 주인공을 계단 밖으로 **밀어낸다** — 그러면 눌러도 안 내려가고
 *   "죽었는데 안 열린다" 로 읽힌다(드물게 그렇게 빨갰다). 여기서 재려는
 *   것은 밀림이 아니라 "죽으면 열리는가" 다. */
await ev(`(function(){
  var w = window.__w();
  w.player.x = w.level.downAt.x + 0.5; w.player.y = w.level.downAt.y + 0.5;
  w.player.px = w.player.x; w.player.py = w.player.y;
})()`);
await sleep(400);
const promptOpen = await ev(`(document.getElementById("act") || {}).textContent || ""`);
await S("Input.dispatchKeyEvent", { type: "keyDown", code: "KeyE", key: "e", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69, text: "e" });
await S("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyE", key: "e", windowsVirtualKeyCode: 69, nativeVirtualKeyCode: 69 });
await sleep(600);
const afterOpen = await ev(`window.__w().depth`);
add("죽으면 열린다", !opened.guard && afterOpen === opened.depth + 1,
  "수문장을 쓰러뜨리니 " + opened.depth + "층 → " + afterOpen + "층 · 안내 \\u201c" +
  promptOpen.trim().slice(0, 40) + "\\u201d");

console.log(OLD ? "── 수문장 [대조군: 옛 구역 끝 보스 · 잠금 없음] ──"
                : ("── 수문장" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
console.log();
console.log("   층별 수문장:");
for (const k of kinds)
  if (k.d <= 12 || k.kind === "boss")
    console.log("     " + String(k.d).padStart(2) + "층 " + (k.kind === "boss" ? "★" : "·") + " " +
      String(k.name).padEnd(16) + " 체력 " + String(k.hp).padStart(5) + " 피해 " + k.dmg);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); fails++; }
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
