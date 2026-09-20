/* 장비 창과 유물이 화면에서 도는가. 그리고 장비 창이 **턴을 안 쓰는가**. */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "url";
import { CHROME } from "./chrome.mjs";   /* 경로는 한 곳에서만 정한다 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const OUT = process.env.RL_SHOTS || "";      /* 스크린샷은 요청할 때만 */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-gear-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
const errs = []; let id = 0; const w = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.text || "예외");
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
const shot = async n => { if (!OUT) return;
  const { data } = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, n), Buffer.from(data, "base64")); };

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);
for (const [W, H, touch, tag] of [[390, 844, true, "휴대폰"], [1440, 900, false, "데스크톱"]]) {
  await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: touch });
  await S("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 1 });
  await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
  await sleep(900);
  await ev('window.__start("warrior","free")'); await sleep(320);

  const btn = await ev(`(()=>{const b=document.getElementById("gearBtn");
    const cs=getComputedStyle(b); return { shown: cs.display!=="none" && b.offsetParent!==null }; })()`);
  add(tag + " 장비 단추", touch ? btn.shown : !btn.shown,
    touch ? (btn.shown ? "보인다" : "✘ 안 보인다") : (btn.shown ? "✘ 넓은 화면에도 보인다" : "숨겨짐(정상)"));

  /* 유물 셋을 쥐여 주고 연다 */
  await ev('["r_brush","r_thorns","r_lordseye"].forEach(r=>window.__giveRelic(r))');
  await sleep(120);
  const t0 = await ev("window.__peek().turn");
  const g1 = await ev("window.__gear(true)");
  await sleep(250);
  const t1 = await ev("window.__peek().turn");
  add(tag + " 열림", g1.open, "열림=" + g1.open);
  add(tag + " 턴을 안 쓴다", t0 === t1, "턴 " + t0 + " → " + t1);
  add(tag + " 유물 3개 보임",
    /두 번 새기는 붓/.test(g1.text) && /가시 갑옷/.test(g1.text) && /군주의 눈/.test(g1.text),
    (g1.text.match(/유물/g) || []).length + "회 언급");
  add(tag + " 장비 3칸", /무기/.test(g1.text) && /갑옷/.test(g1.text) && /보조/.test(g1.text), "무기·갑옷·보조");
  add(tag + " 가방 보임", /가방/.test(g1.text), "");

  /* 열려 있는 동안 조작이 막히는가 */
  const p0 = await ev("window.__peek()");
  await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight" });
  await sleep(180);
  const p1 = await ev("window.__peek()");
  add(tag + " 열린 채 못 움직임", p0.x === p1.x && p0.y === p1.y && p0.turn === p1.turn,
    p0.x + "," + p0.y + " → " + p1.x + "," + p1.y);

  const box = await ev(`(()=>{
    const c=document.querySelector("#gear .card"); const r=c.getBoundingClientRect();
    const over=[...c.querySelectorAll("*")].filter(e=>{const b=e.getBoundingClientRect();
      return b.width>0 && (b.right>r.right+1 || b.left<r.left-1);}).length;
    return { over, scrolls: c.scrollHeight>c.clientHeight+1, h: Math.round(r.height) };
  })()`);
  add(tag + " 창 안에 다 들어감", box.over === 0, "넘침 " + box.over + " · 높이 " + box.h + (box.scrolls ? " · 스크롤" : ""));
  await shot("gear-" + W + ".png");

  /* 상태창이 표가 아니라 한 줄인가 */
  await ev("window.__gear(false)"); await sleep(150);
  const line = await ev(`(()=>{
    const grid=document.querySelector(".side .stat-grid");
    const ln=document.querySelector(".side .stat-line");
    return { grid: !!grid, line: !!ln, h: ln?Math.round(ln.getBoundingClientRect().height):0,
             text: ln?ln.textContent.replace(/\\s+/g," ").trim():"" };
  })()`);
  add(tag + " 수치가 한 줄", !line.grid && line.line && line.h <= 60,
    (line.grid ? "✘ 표가 남아 있다" : "표 없음") + " · 높이 " + line.h + "px · " + line.text);
}

for (const [n, ok, note] of out) console.log(ok ? "✔" : "✘", n.padEnd(24), note);
console.log("\n콘솔 오류:", errs.length, errs.slice(0, 3).join(" / "));
const bad = out.filter(o => !o[1]).length + (errs.length ? 1 : 0);
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
