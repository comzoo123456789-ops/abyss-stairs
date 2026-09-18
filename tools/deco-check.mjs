/* 구역 장식이 그 구역 바닥과 얼마나 대비되는가 — 눈이 아니라 픽셀로. */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = "E:/소스/abyss-stairs/public";
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-deco-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const w = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (me, p, s) => new Promise((res, rej) => { const i = ++id; w.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result)); ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1000);

const out = await ev(`(function(){
  var DATA = window.DATA, S = window.SPRITES;
  function lum(h) {
    var n = parseInt(h.slice(1), 16);
    return ((n >> 16 & 255) * 0.299 + (n >> 8 & 255) * 0.587 + (n & 255) * 0.114);
  }
  var rows = [];
  for (var z = 0; z < DATA.ZONES.length; z++) {
    var zn = DATA.ZONES[z];
    /* 바닥 밝기 — 실제로 깔리는 색들의 평균 */
    var fl = zn.floor, keys = ["face", "lit", "dim", "grain1", "grain2"];
    var fsum = 0, fn = 0;
    for (var k = 0; k < keys.length; k++) if (fl[keys[k]]) { fsum += lum(fl[keys[k]]); fn++; }
    var floorL = fsum / fn;
    for (var p = 0; p < zn.props.length; p++) {
      var nm = zn.props[p];
      var c = S.bake("p_" + nm);
      if (!c) { rows.push({ zone: zn.name, prop: nm, err: "그림 없음" }); continue; }
      var d = c.getContext("2d").getImageData(0, 0, 32, 32).data;
      var sum = 0, n = 0, hi = -1, lo = 999;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        var L = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        sum += L; n++;
        if (L > hi) hi = L;
        if (L < lo) lo = L;
      }
      rows.push({ zone: zn.name, prop: nm, floorL: Math.round(floorL),
                  avg: Math.round(sum / n), hi: Math.round(hi), lo: Math.round(lo),
                  px: n, diff: Math.round(sum / n - floorL), hiDiff: Math.round(hi - floorL) });
    }
  }
  return JSON.stringify(rows);
})()`);

const rows = JSON.parse(out);
let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };

/* 문턱 — 실측으로 정했다. 2026-09-19 기준 가장 약한 것이 「군주의 방」 핏자국으로
 * 평균 +35 · 가장 밝은 곳 +46 이었고 그것도 화면에서 잘 보였다. 그 아래로
 * 내려가면 못 찾는다고 본다. */
const MIN_PEAK = 30, MIN_AVG = 18;

console.log("── 구역 장식 대비 (바닥 평균 밝기 기준 · 0~255) ──");
console.log("구역".padEnd(15) + "장식".padEnd(9) + "바닥".padEnd(5) +
            "장식".padEnd(5) + "평균차".padEnd(7) + "최대차");
let weak = 0;
for (const r of rows) {
  if (r.err) { console.log(r.zone.padEnd(15) + r.prop.padEnd(9) + "✘ " + r.err); fails++; continue; }
  const bad = r.hiDiff < MIN_PEAK || r.diff < MIN_AVG;
  if (bad) weak++;
  console.log(r.zone.padEnd(15) + r.prop.padEnd(9) + String(r.floorL).padEnd(5) +
              String(r.avg).padEnd(5) + String(r.diff).padEnd(7) + String(r.hiDiff) +
              (bad ? "  ✘ 바닥에 묻힌다" : ""));
}
console.log("");
console.log("묻히는 장식".padEnd(14), ok(weak === 0),
  weak + "종 / " + rows.length + " (평균차 " + MIN_AVG + " · 최대차 " + MIN_PEAK + " 이상이어야 한다)");
const NL = String.fromCharCode(10);
console.log(fails === 0 ? NL + "전부 통과" : NL + "✘ " + fails + "건");
ws.close(); ch.kill(); srv.close();
process.exit(fails === 0 ? 0 : 1);
