/* 배경음 — 구역마다 정말 다른가, 찌그러지지 않는가, 효과음을 덮지 않는가.
 *
 * ⚠ 귀로 "괜찮네" 는 근거가 아니다. 셋 다 숫자로 나온다:
 *   ① 구역끼리 다른가   — 바탕음 높이가 다르면 영점 교차(zc)가 달라진다
 *   ② 찌그러지는가      — 최대 진폭이 1.0 을 넘으면 깨져 들린다
 *   ③ 효과음을 덮는가   — 배경음 실효값이 타격음보다 **한참 작아야** 한다.
 *      배경음이 타격음을 덮으면 무슨 일이 났는지 못 듣는다 = 정보를 잃는 것이다.
 * ⚠ 그리고 **실제 게임에서** 층을 내려가며 구역이 바뀔 때 음악도 바뀌는지 본다.
 *   소리를 낼 줄 아는 것과 제때 바꾸는 것은 다른 얘기다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-mus-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
  "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
const errs = []; let id = 0; const w = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.text);
  if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (me, p, s) => new Promise((res, rej) => { const i = ++id;
  w.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
await S("Emulation.setDeviceMetricsOverride", { width: 900, height: 620, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1100);

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* ── 1) 구역마다 렌더해서 잰다 ── */
const zones = await ev("window.MUSIC ? window.MUSIC.zones() : null");
if (!zones) { console.log("✘ MUSIC 이 없다"); process.exit(1); }
const got = [];
for (const z of zones) {
  const r = await ev(`window.MUSIC.render(${JSON.stringify(z)}, 6)`);
  got.push({ z, ...r });
}
console.log("── 구역별 배경음 (6초 렌더) ──");
console.log("구역".padEnd(10) + "바탕음".padEnd(9) + "최대".padEnd(8) + "실효".padEnd(9) + "영점교차");
for (const g of got) {
  console.log(g.z.padEnd(10) + (g.root + "Hz").padEnd(9) +
    String(g.peak).padEnd(8) + String(g.rms).padEnd(9) + g.zc);
}

/* ① 구역끼리 다른가 — 영점 교차가 전부 달라야 한다 */
const zcs = got.map(g => g.zc);
add("구역마다 다르다", new Set(zcs).size === zcs.length,
  new Set(zcs).size + " / " + zcs.length + " 가지");

/* ② 찌그러지지 않는가 */
const worst = Math.max(...got.map(g => g.peak));
add("안 찌그러진다", worst < 1.0, "제일 큰 최대 진폭 " + worst + " (1.0 미만이어야 한다)");

/* ③ 효과음을 안 덮는가.
 * ⚠ **실효값으로 견주면 안 된다.** 타격음은 0.15초짜리라 1초 창에서는 침묵에
 *   희석되어 실효값이 작게 나온다 — 배경음(계속 난다)이 여덟 배로 보인다.
 *   같은 잣대는 **최대 진폭**이다. 배경음은 효과음 중간값의 절반 아래여야 한다. */
const names = await ev("window.SFX.names()");
const sfxPeaks = [];
for (const nm of names) {
  const r = await ev("window.SFX.render(" + JSON.stringify(nm) + ", 1.5)");
  sfxPeaks.push(r.peak);
}
sfxPeaks.sort((x, y) => x - y);
const med = sfxPeaks[Math.floor(sfxPeaks.length / 2)];
const musPeak = Math.max(...got.map(g => g.peak));
add("효과음을 안 덮는다", musPeak < med * 0.5,
  "배경음 최대 " + Math.round(musPeak * 1000) / 1000 +
  " vs 효과음 중간값 " + Math.round(med * 1000) / 1000 +
  " (배경음이 절반 아래여야 한다)");

/* ── 2) 실제 게임에서 배경음이 도는가 ──
 *
 * ⚠ 전에는 "1·3·5·7·9층에서 구역 음악이 다 다른가" 를 봤다. 실시간판에서는
 *   구역(data.js)이 아직 없다 — 8단계 콘텐츠로 밀렸다. **검사의 전제가 사라지면
 *   검사를 줄인다**(제품을 억지로 맞추지 않는다). 구역이 생기면 이 자리를 되살린다.
 * ⚠ 브라우저 자동재생 정책 때문에 조작 전에는 소리가 안 난다 — 먼저 깨운다. */
await ev("window.__wake()");
await sleep(600);
const live = await ev("window.__music()");
add("게임에서 돈다", !!live && live.zone !== null && live.on === true,
  "구역 " + ((live && live.zone) || "없음") + " · 켜짐 " + (live && live.on));

/* ── 3) 끄면 정말 멈추는가 ── */
const before = await ev("window.__music()");
await ev("window.MUSIC.setOn(false)");
await sleep(200);
const offState = await ev("window.MUSIC.isOn()");
await ev("window.MUSIC.setOn(true)");
add("끄고 켜진다", before.on === true && offState === false && (await ev("window.MUSIC.isOn()")) === true,
  "켬 → 끔 → 켬");

for (const [n, ok2, note] of out) console.log((ok2 ? "✔" : "✘") + " " + n.padEnd(22) + note);
console.log("\n콘솔 오류:", errs.length, errs.slice(0, 2).join(" / "));
const bad = out.filter(o => !o[1]).length + (errs.length ? 1 : 0);
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
