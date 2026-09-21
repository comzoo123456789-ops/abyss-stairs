/* 프레임마다 몸이 통째로 사라지지 않았는가 — 눈이 아니라 픽셀로.
 *
 * ⚠ 프레임 필터(["f", n])는 **없는 프레임을 불러도 오류를 안 낸다.** 그 프레임
 *   전용 그림이 하나도 안 그려질 뿐이다 — 다리 없는 몸통, 팔 없는 몸이 나온다.
 *   실제로 공격 프레임(3·4)을 넣으며 서 있는 다리를 [0] 으로만 묶어 두어
 *   공격할 때마다 다리가 사라졌고, 화면에는 아무 단서가 없었다.
 *
 * 그래서 두 가지를 잰다:
 *   ① 칠해진 픽셀 수가 프레임끼리 크게 다르지 않은가 (한 프레임만 확 적으면 뭔가 빠졌다)
 *   ② 세로 구간(위 1/3 · 가운데 1/3 · 아래 1/3)마다 픽셀이 있는가
 *      — 다리는 아래 1/3, 머리는 위 1/3 이다. 한 구간이 비면 그 부위가 통째로 없는 것이다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-fr-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const w = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (me, p, s) => new Promise((res, rej) => { const i = ++id;
  w.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true })).result.value;
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await new Promise(r => setTimeout(r, 1200));

const rows = await ev(`(()=>{
  const out = [];
  const names = Object.keys(SPRITES.data).filter(n => SPRITES.framesOf(n).length > 0);
  for (const name of names) {
    const sz = SPRITES.sizeOf(name);
    const frames = SPRITES.framesOf(name);
    const all = [0].concat(frames).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
    const per = [];
    for (const f of all) {
      const img = SPRITES.bake(name, f);
      const c = document.createElement("canvas");
      c.width = sz.w; c.height = sz.h;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, sz.w, sz.h).data;
      const band = [0, 0, 0];
      let lit = 0;
      for (let y = 0; y < sz.h; y++) {
        for (let i = 0; i < sz.w; i++) {
          if (d[(y * sz.w + i) * 4 + 3] < 128) continue;
          lit++;
          band[Math.min(2, Math.floor(y / (sz.h / 3)))]++;
        }
      }
      per.push({ f, lit, band });
    }
    out.push({ name, w: sz.w, h: sz.h, per });
  }
  return out;
})()`);

let bad = 0;
const ok = b => { if (!b) bad++; return b ? "✔" : "✘"; };
console.log("── 프레임마다 몸이 온전한가 ──");
for (const r of rows) {
  const base = r.per.find(p => p.f === 0) || r.per[0];
  const problems = [];
  for (const p of r.per) {
    /* ⚠ **총 픽셀 수로는 못 잡는다.** 다리는 몸 전체의 10% 남짓이라, 다리가 통째로
     *   사라져도 총량은 90% 로만 줄어 문턱을 안 넘는다(실제로 그렇게 놓쳤다).
     *   **세로 구간마다 따로** 재야 한다 — 다리가 빠지면 아래 구간이 반 토막 난다. */
    const NAME = ["위", "가운데", "아래"];
    for (let bi = 0; bi < 3; bi++) {
      if (p.band[bi] === 0 && base.band[bi] > 0) {
        problems.push("프레임 " + p.f + " · " + NAME[bi] + " 가 통째로 비었다");
      } else if (base.band[bi] > 20 && p.band[bi] < base.band[bi] * 0.6) {
        problems.push("프레임 " + p.f + " · " + NAME[bi] + " 픽셀 " + p.band[bi] +
                      " (기준 " + base.band[bi] + ") — 뭔가 빠졌다");
      }
    }
  }
  console.log("  " + ok(problems.length === 0) + " " + r.name.padEnd(10) +
    r.w + "×" + r.h + " · 프레임 " + r.per.map(p => p.f).join(",") +
    " · 아래 구간 " + r.per.map(p => p.band[2]).join("/"));
  problems.forEach(p => console.log("      ✘ " + p));
}
console.log("");
console.log("살펴본 스프라이트:", rows.length + "개");
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
