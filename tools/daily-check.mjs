/* 하루의 장부가 화면에서 실제로 도는가.
 *
 * ⚠ 논리 검사(verify.mjs)는 "씨앗이 같다" 까지만 본다. **하루 한 번 잠금**은
 *   화면·저장·모드가 함께 맞아야 성립하므로 브라우저에서 밟아야 한다.
 * ⚠ 새로고침 뒤에도 잠겨 있어야 한다 — 안 그러면 F5 한 번으로 무의미해진다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "public");
const OUT = process.env.RL_SHOTS || "";      /* 스크린샷은 요청할 때만 */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"
};

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-daily-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => {
  let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); });
});
const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener("open", r));
const errs = [];
let id = 0; const w = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.text || "예외");
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push("console.error");
  if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
});
const send = (me, p, s) => new Promise((res, rej) => {
  const i = ++id; w.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");

const ev = async x => (await S("Runtime.evaluate",
  { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = async n => {
  if (!OUT) return;                          /* RL_SHOTS 를 줬을 때만 찍는다 */
  const { data } = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, n), Buffer.from(data, "base64"));
};
const go = async () => {
  await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
  await sleep(950);
};

await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await S("Browser.grantPermissions", {
  permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  origin: "http://127.0.0.1:" + port
}).catch(() => {});
await go();
await ev("window.__clearDaily()");
await sleep(150);

const out = [];
const add = (name, good, note) => out.push([name, !!good, note]);

add("기본 모드", (await ev("window.__mode()")) === "daily", await ev("window.__mode()"));
add("시작 전 잠금 없음", (await ev("window.DAILY.doneToday()")) === false, "doneToday = false");
await shot("daily-1-start.png");

const started = await ev('window.__start("warrior","daily")');
await sleep(320);
const seedOk = await ev("window.__peek().seed === window.DAILY.seedToday()");
const seedShown = await ev('document.getElementById("seed").textContent');
add("일일 시작", started === true && seedOk, "씨앗 일치 · 화면 표시 " + JSON.stringify(seedShown));

/* ⚠ 판을 **끝내기 전에** 새로고침하고 다시 시작할 수 있으면 "하루 한 번" 이
 *   말뿐이 된다(판이 나쁘면 새로 켜면 되니까). 실제로 그 구멍이 있었다. */
{
  await go();
  const canRestart = await ev('window.__start("warrior","daily")');
  add("중간에 새로고침해도 못 함", canRestart === false, "__start → " + canRestart);
  const openEntry = await ev("(()=>{const e=window.DAILY.entryFor(window.DAILY.dayKey());return e?{open:!!e.open,depth:e.depth}:null;})()");
  add("중단한 판이 열린 채 남음", !!openEntry && openEntry.open === true,
    openEntry ? "open=" + openEntry.open + " · " + openEntry.depth + "층" : "(없음)");
  const openShare = await ev("window.DAILY.shareText(window.DAILY.entryFor(window.DAILY.dayKey()))");
  add("중단을 사실대로 적음", /중단/.test(openShare),
    String(openShare).split(String.fromCharCode(10))[1]);
  /* 다시 처음부터 — 아래 검사들이 깨끗한 상태에서 돌게 */
  await ev("window.__clearDaily()");
  await sleep(120);
  await ev('window.__start("warrior","daily")');
  await sleep(300);
}

const hashMap = "(()=>{const m=window.__map();let h=0;for(let i=0;i<m.walk.length;i++)h=(h*31+m.walk[i])>>>0;return h;})()";
const map1 = await ev(hashMap);
await ev('window.__start("rogue","daily")');
await sleep(280);
const map2 = await ev(hashMap);
add("직업을 바꿔도 같은 층", map1 === map2, "지도 해시 " + map1 + " / " + map2);

await ev("window.__endRun(false)");
await sleep(320);
const led = await ev("window.__ledger()");
const lines = String(led.text || "").split("\n");
add("끝나면 장부", led.shown && lines.length === 5 && /장부/.test(led.label),
  JSON.stringify(led.label) + " · " + lines.length + "줄");
add("장부 막대 10칸", [...(lines[2] || "")].length === 10, lines[2] || "(없음)");
await shot("daily-2-end.png");

const second = await ev('window.__start("mage","daily")');
add("두 번째 판 거절", second === false, "__start → " + second);
add("오늘 몫 알림", (await ev("window.__ledger().doneShown")) === true, "시작 화면에 장부가 다시 보인다");

const free = await ev('window.__start("mage","free")');
await sleep(280);
const freeSeed = await ev("window.__peek().seed !== window.DAILY.seedToday()");
add("자유 탐사는 계속", free === true && freeSeed, "다른 씨앗");
await ev("window.__endRun(false)");
await sleep(280);
const freeLed = await ev("window.__ledger()");
add("자유 탐사 머리글 분리", /자유 탐사/.test(freeLed.text) && !/장부/.test(freeLed.label),
  JSON.stringify(freeLed.label));

await go();
const afterReload = await ev("window.DAILY.doneToday()");
const doneAfter = await ev("window.__ledger().doneShown");
add("새로고침 뒤에도 잠김", afterReload === true && doneAfter === true,
  "모드 " + (await ev("window.__mode()")));
await shot("daily-3-locked.png");

/* ⚠ 끝낸 뒤 결과를 갈아치울 수 있으면 좋은 기록만 남길 수 있다 */
{
  const over = await ev(`(()=>{
    const d = window.DAILY, k = d.dayKey(), before = d.entryFor(k);
    d.finish({ day: k, mode: "daily", cls: "가짜", depth: 99, won: true, score: 999999 });
    const after = d.entryFor(k);
    return { same: after.depth === before.depth && after.cls === before.cls,
             closed: after.open === false, cls: after.cls, depth: after.depth };
  })()`);
  add("끝난 뒤 갈아치우기 막힘", over.same && over.closed,
    "남은 것: " + over.cls + " " + over.depth + "층 · open=" + !over.closed);
}

const keep = await ev(`(()=>{
  const d = window.DAILY, k = d.dayKey();
  const first = d.entryFor(k);
  d.record({ day: k, mode: "daily", cls: "가짜", depth: 99, won: true, score: 999999 });
  const now = d.entryFor(k);
  return { same: now.depth === first.depth && now.cls === first.cls, depth: now.depth, cls: now.cls };
})()`);
add("기록 덮어쓰기 안 됨", keep.same, "남은 것: " + keep.cls + " " + keep.depth + "층");

const copied = await ev(`(async()=>{
  const btn = document.getElementById("ddCopy");
  if (!btn || btn.offsetParent === null) return { skip: true };
  btn.click();
  await new Promise(r => setTimeout(r, 300));
  let read = "";
  try { read = await navigator.clipboard.readText(); } catch (e) { read = "(권한 없음)"; }
  return { skip: false, label: btn.textContent.trim(), read: read.split("\\n")[0] };
})()`);
add("장부 베끼기", copied.skip || /베꼈다/.test(copied.label),
  copied.skip ? "단추가 안 보인다" : "단추 " + JSON.stringify(copied.label) +
    " · 클립보드 " + JSON.stringify(copied.read));

for (const [n, good, note] of out) console.log(good ? "✔" : "✘", n.padEnd(22), note);
console.log("\n콘솔 오류:", errs.length, errs.slice(0, 3).join(" / "));
const bad = out.filter(o => !o[1]).length + (errs.length ? 1 : 0);
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
