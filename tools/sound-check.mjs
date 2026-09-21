/* 소리가 **실제로 어떻게 울리는가** — 귀가 아니라 파형으로.
 *
 * 소리는 "고쳤다" 를 확인하기 제일 어려운 자리다. 들어 보고 "괜찮네" 하면
 * 다음 사람이 바꿨을 때 뭐가 틀어졌는지 아무도 모른다. `OfflineAudioContext`
 * 로 **틀지 않고 렌더해서** 진폭을 센다.
 *
 * 재는 것 넷.
 *   1. 소리표의 모든 이름이 실제로 소리를 낸다 — 이름 오타는 조용히 지나간다
 *      (실제로 `sfx("levelup")` 이 그랬다. 표에는 `level` 뿐이라 제단이 무음이었다)
 *   2. 게임이 부르는 이름이 전부 소리표에 있다 — 반대 방향도 막는다
 *   3. 너무 작지도 너무 크지도 않다
 *   4. **겹쳐도 안 찌그러진다** — 싸움 중에는 서넛이 같이 난다
 *
 * ⚠ 문턱은 대조군으로 잡았다. compressor 를 빼고 재면 다섯 번 겹칠 때
 *   최대 2.809 까지 간다(옛 구조가 그랬다). 붙이면 0.791 이다. 그 사이에 둔다.
 * ⚠ 자주 나는 소리는 작아야 하고 드문 소리는 커도 된다. `deny` 는 부르는
 *   곳이 25군데다 — 그게 크면 게임 전체가 거슬린다. 같은 잣대로 재지 않는다.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { CHROME } from "./chrome.mjs";   /* 경로는 한 곳에서만 정한다 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-snd-"));
const ch = spawn(CHROME, [
  "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--mute-audio", "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise((res, rej) => {
  let b = "";
  const t = setTimeout(() => rej(new Error("Chrome 이 30초 안에 안 떴다")), 30000);
  ch.stderr.on("data", (d) => {
    b += d;
    const m = b.match(/ws:\/\/[^\s]+/);
    if (m) { clearTimeout(t); res(m[0]); }
  });
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const wait = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
});
const send = (me, p, s) => new Promise((res, rej) => {
  const i = ++id;
  wait.set(i, (x) => x.error ? rej(new Error(me + ": " + x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable");
await S("Runtime.enable");

/* ⚠ 예외를 삼키지 않는다. result.value 만 읽으면 화면이 터져도 undefined 가
 *   돌아와, 한참 뒤 엉뚱한 줄에서 "undefined 의 무엇" 으로 죽는다. */
const ev = async (x) => {
  const r = await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("화면에서 터졌다 :: " + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1200);

let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };

console.log("── 소리 (실제 파형) ──");

/* ① 소리표의 모든 이름이 정말 소리를 내는가 */
const names = JSON.parse(await ev("JSON.stringify(window.SFX.names())"));
const got = {};
for (const n of names) {
  got[n] = await ev("window.SFX.render('" + n + "', 2)");
}
const silent = names.filter((n) => got[n].peak < 0.01);
console.log("모든 소리가 난다:", ok(silent.length === 0),
  names.length + "종" + (silent.length ? " · ⚠무음 " + silent.join(",") : " · 무음 0"));

/* ② 게임이 부르는 이름이 전부 표에 있는가.
 * ⚠ 반대 방향이다. 표에 있는데 안 부르는 것은 괜찮지만, 부르는데 표에
 *   없으면 **조용히 아무 일도 안 일어난다** — 그게 제단에서 일어난 일이다. */
/* ⚠ 전에는 game.js 한 파일만 훑었다. 실시간판에서는 소리를 부르는 자리가
 *   여러 곳이다(전투·세계·화면) — **한 곳만 보면 나머지가 조용히 샌다.**
 *   부르는 파일이 늘면 여기에 이름을 더한다. */
const CALLERS = ["combat.js", "world.js", "app.js", "view.js", "ai.js"];
const src = CALLERS
  .filter((f) => fs.existsSync(path.join(ROOT, "js", f)))
  .map((f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8"))
  .join("\n");
const called = new Set();
const re = /SFX\.play\(\s*(?:[^)]*\?\s*)?"([a-z]+)"(?:\s*:\s*"([a-z]+)")?/g;
let m;
while ((m = re.exec(src))) {
  if (m[1]) called.add(m[1]);
  if (m[2]) called.add(m[2]);
}
const missing = [...called].filter((n) => names.indexOf(n) < 0);
console.log("부르는 이름이 있다:", ok(missing.length === 0),
  "게임이 부르는 " + called.size + "종" + (missing.length ? " · ⚠표에 없다: " + missing.join(",") : ""));

/* ③ 크기. 자주 나는 소리와 드문 소리를 같은 잣대로 재지 않는다 */
const OFTEN = ["deny", "hit", "hurt"];
const tooQuiet = names.filter((n) => got[n].peak < 0.05);
const tooLoud = names.filter((n) => got[n].peak > 0.8);
const harsh = OFTEN.filter((n) => got[n] && got[n].peak > 0.35);
console.log("크기가 알맞다  :", ok(tooQuiet.length === 0 && tooLoud.length === 0 && harsh.length === 0),
  "최대 " + Math.min(...names.map((n) => got[n].peak)) + " ~ " +
  Math.max(...names.map((n) => got[n].peak)) +
  (tooQuiet.length ? " · ⚠너무 작다 " + tooQuiet.join(",") : "") +
  (tooLoud.length ? " · ⚠너무 크다 " + tooLoud.join(",") : "") +
  (harsh.length ? " · ⚠자주 나는데 크다 " + harsh.join(",") : ""));

/* ④ 겹쳐도 안 찌그러지는가 — compressor 가 일하는지 보는 자리다 */
const MIX = [
  "hit,hurt",
  "hit,crit,gold",
  "hit,hurt,kill,gold,level",
  "hit,hit,hit,hit,hit",
  "die,win,level,trap,kill,crit"
];
const mixed = [];
for (const mx of MIX) {
  const r = await ev("window.SFX.render('" + mx + "', 3)");
  mixed.push({ mx, peak: r.peak });
}
const clipped = mixed.filter((r) => r.peak >= 1);
console.log("겹쳐도 안 깨짐:", ok(clipped.length === 0),
  mixed.map((r) => r.peak).join(" · ") + " (1.0 미만이어야 한다)" +
  (clipped.length ? " · ⚠" + clipped.map((r) => r.mx).join(" / ") : ""));

/* ⑤ 같은 소리가 **매번 똑같지는 않은가.** 똑같으면 스무 번에 귀가 지친다.
 *
 * ⚠ 처음에 실효값(크기)으로 쟀다가 틀렸다. 음정이 흔들려도 **에너지는 거의
 *   그대로**라 세 번 다 0.008 로 같게 나왔다 — 흔들림이 멀쩡히 있는데도
 *   빨갛다고 했다. **영점 교차 수**로 잰다. 음정이 바뀌면 거기가 바뀐다.
 * ⚠ 잡음이 섞인 소리로 재면 안 된다. 잡음은 매번 다르니 흔들림이 없어도
 *   통과한다. `pickup` 은 **순수한 음 둘**뿐이라 음정 변화만 잡힌다. */
const z = [];
for (let i = 0; i < 3; i++) z.push((await ev("window.SFX.render('pickup', 2)")).zc);
const varied = new Set(z).size > 1;
console.log("매번 조금 다름:", ok(varied),
  "영점 교차 " + z.join(" / ") + (varied ? "" : " · ⚠세 번 다 같다"));

console.log();
for (const n of names) {
  console.log("  " + n.padEnd(9) + " 최대 " + String(got[n].peak).padEnd(6) +
              " 실효 " + String(got[n].rms).padEnd(6) + " " + got[n].ms + "ms");
}
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
