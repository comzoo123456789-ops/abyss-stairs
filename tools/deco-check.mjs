/* 구역 장식이 그 구역 바닥과 얼마나 대비되는가 — 눈이 아니라 픽셀로. */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { CHROME } from "./chrome.mjs";   /* 경로는 한 곳에서만 정한다 */

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
/* ── 벽과 바닥이 **갈리는가** ──────────────────────────
 *
 * 장식이 바닥에 안 묻히는 것만 재고 있었다. 정작 더 중요한 것은 **어디가
 * 길인가**다. 실측해 보니 다섯 구역 전부 벽과 바닥이 같은 색 계열이었다 —
 * 색상차 1~8도, 대비 1.35~1.65:1. 밝기만 조금 다른 한 덩어리라 이름의
 * 도서관 층은 어디가 벽인지 한눈에 안 들어왔다.
 *
 * ⚠ **밝기만 보면 안 된다.** 밝기차가 30 이어도 색이 같으면 한 재질로
 *   읽힌다. 색상차를 같이 본다.
 * ⚠ 팔레트 숫자가 아니라 **구운 타일**을 떠서 잰다. 돌결·벽돌 하이라이트·
 *   이끼가 섞이면 값이 달라진다.
 * ⚠ 문턱은 고치기 전후로 잡았다. 전 1.35~1.65:1 / 1~8도, 후 2.0~3.4:1 /
 *   9~23도. 그 사이에 둔다. */
const MIN_RATIO = 1.9, MIN_HUE = 8;
const zc = await ev(`(function(){
  var DATA = window.DATA, S = window.SPRITES;
  function mean(cv){
    var d = cv.getContext("2d").getImageData(0,0,32,32).data;
    var r=0,g=0,b=0,n=0;
    for (var i=0;i<d.length;i+=4){ if(d[i+3]<40) continue; r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; }
    return { r:r/n, g:g/n, b:b/n };
  }
  function ratio(a,b){
    function ch(v){ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }
    function L(c){ return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b); }
    var l1=L(a), l2=L(b);
    return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
  }
  function hue(c){
    var mx=Math.max(c.r,c.g,c.b), mn=Math.min(c.r,c.g,c.b), d=mx-mn;
    if(!d) return 0;
    var h;
    if(mx===c.r) h=((c.g-c.b)/d)%6; else if(mx===c.g) h=(c.b-c.r)/d+2; else h=(c.r-c.g)/d+4;
    h*=60; if(h<0) h+=360; return h;
  }
  function avg(list){ var r=0,g=0,b=0; list.forEach(function(c){r+=c.r;g+=c.g;b+=c.b;});
                      return {r:r/list.length,g:g/list.length,b:b/list.length}; }
  var out = [];
  for (var z=0; z<DATA.ZONES.length; z++){
    var zone = DATA.ZONES[z], f=[], w=[], wf=[];
    for (var v=0; v<16; v++) f.push(mean(S.terrain("floor", v, zone)));
    for (var v2=0; v2<6; v2++){
      w.push(mean(S.terrain("wall", v2, zone)));
      wf.push(mean(S.terrain("wallface", v2, zone)));
    }
    var F=avg(f), W=avg(w), WF=avg(wf);
    var dh = Math.abs(hue(F)-hue(W)); if (dh>180) dh=360-dh;
    out.push({ name: zone.name,
               ratio: Math.round(ratio(W,F)*100)/100,
               faceRatio: Math.round(ratio(WF,F)*100)/100,
               hue: Math.round(dh) });
  }
  return out;
})()`);
console.log("");
let weakZone = 0;
for (const r of zc) {
  const bad = r.ratio < MIN_RATIO || r.hue < MIN_HUE || r.faceRatio < MIN_RATIO;
  if (bad) weakZone++;
  console.log(r.name.padEnd(15) + "벽/바닥 " + String(r.ratio).padEnd(6) +
              " 앞면/바닥 " + String(r.faceRatio).padEnd(6) +
              " 색상차 " + String(r.hue).padEnd(4) + "도" +
              (bad ? "  ✘ 벽과 바닥이 안 갈린다" : ""));
}
console.log("");
console.log("벽·바닥 대비".padEnd(13), ok(weakZone === 0),
  weakZone + "종 / " + zc.length + " (대비 " + MIN_RATIO + ":1 · 색상차 " + MIN_HUE + "도 이상이어야 한다)");

/* ── 바닥이 **되풀이돼 보이는가** ──────────────────────
 *
 * "바닥이 밋밋하다" 의 원인은 색이 아니라 반복이었다. 변종이 4장뿐인 데다
 * 고르는 식이 `(x*73856093) ^ (y*19349663)` 을 그대로 나머지 연산해서,
 * 실측으로 **가로 4칸마다 같은 그림**이 깔렸다 — 25칸 화면에 여섯 번이다.
 * 사람 눈은 그걸 질감이 아니라 격자 무늬로 읽는다.
 *
 * ⚠ 장 수만 세면 안 된다. 16장이어도 식이 4칸 주기면 화면에는 넉 장만 보인다.
 *   **주기**와 **제일 많이 깔린 장의 비율**을 같이 본다.
 * ⚠ 식을 여기 다시 적는다. render.js 안에 있어 밖에서 못 부른다 — 그래서
 *   값이 어긋나면 이 검사가 못 잡는다. 대신 주기가 짧아지면 잡힌다. */
const VAR_MIN_PERIOD = 24;      /* 한 화면(25칸) 안에서 되풀이되면 눈에 띈다 */
const VAR_MAX_SHARE = 0.14;     /* 제일 많은 장이 화면의 14% 를 넘으면 무늬로 읽힌다 */
const fv = await ev(`(function(){
  function variantAt(x, y, n) {
    var h = (x | 0) * 374761393 + (y | 0) * 668265263;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h % n;
  }
  var N = window.SPRITES.FLOOR_VARIANTS;
  var c = {}, cols = 25, rows = 15;
  for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
    var v = variantAt(x, y, N);
    c[v] = (c[v] || 0) + 1;
  }
  var vals = Object.keys(c).map(function(k){ return c[k]; });
  var period = 0;
  for (var p = 1; p <= 64 && !period; p++) {
    var same = true;
    for (var x2 = 0; x2 < 30 && same; x2++)
      for (var y2 = 0; y2 < 8 && same; y2++)
        if (variantAt(x2, y2, N) !== variantAt(x2 + p, y2, N)) same = false;
    if (same) period = p;
  }
  return { n: N, kinds: vals.length, most: Math.max.apply(null, vals),
           tiles: cols * rows, period: period };
})()`);
const share = fv.most / fv.tiles;
const fvOK = fv.n >= 8 && share <= VAR_MAX_SHARE &&
             (fv.period === 0 || fv.period >= VAR_MIN_PERIOD);
console.log("");
console.log("바닥 되풀이".padEnd(13), ok(fvOK),
  "변종 " + fv.n + "장 · 한 화면에 " + fv.kinds + "종 · 제일 많은 장 " +
  fv.most + "/" + fv.tiles + " (" + Math.round(share * 100) + "%, " +
  Math.round(VAR_MAX_SHARE * 100) + "% 이하) · 가로 주기 " +
  (fv.period ? fv.period + "칸 ⚠" : "64칸 안에 없음"));

const NL = String.fromCharCode(10);
console.log(fails === 0 ? NL + "전부 통과" : NL + "✘ " + fails + "건");
ws.close(); ch.kill(); srv.close();
process.exit(fails === 0 ? 0 : 1);
