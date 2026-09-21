/* 글씨가 왜 안 읽히는가 — 눈이 아니라 숫자로.
 *
 * "글씨가 잘 안 보인다" 는 신고는 원인이 셋 중 하나다.
 *   ① 너무 작다            (한글은 12px 아래로 내려가면 급격히 무너진다)
 *   ② 대비가 낮다          (어두운 바탕에 어두운 글자)
 *   ③ 픽셀 서체가 뭉갠다   (Galmuri11 은 11px 격자다 — 11·22 가 아니면 뭉갠다)
 *
 * 눈으로는 셋이 구분되지 않는다. 화면의 **모든 글자 상자**를 훑어 크기·대비·
 * 격자 정합을 재고, 무엇이 몇 개인지 센다.
 *
 * ⚠ 대비는 WCAG 상대휘도로 잰다. 본문은 4.5:1, 큰 글자(18.66px 이상 또는
 *   14px 이상 굵게)는 3:1 이 기준이다.
 * ⚠ 배경은 조상으로 거슬러 올라가 **투명이 아닌 첫 색**을 쓴다. 안 그러면
 *   전부 rgba(0,0,0,0) 으로 읽혀 대비가 무한대로 나온다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const W = parseInt(arg("--w", "1440"), 10);
const H = parseInt(arg("--h", "900"), 10);
const SHOT = arg("--shot", null);
const SCREEN = arg("--screen", "play");     /* play | start | help | gear */
function arg(k, d) { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; }

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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-font-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
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
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 900 });
/* ⚠ maxTouchPoints 는 0 을 안 받는다("Touch points must be between 1 and 16").
 *   끌 때는 enabled:false 만 보내고 개수는 1 로 둔다. */
await S("Emulation.setTouchEmulationEnabled", { enabled: W < 900, maxTouchPoints: W < 900 ? 5 : 1 });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1100);
if (SCREEN !== "start") { await ev('window.__start("rogue","free")'); await sleep(420); }
if (SCREEN === "help") { await ev('document.getElementById("help").hidden=false'); await sleep(250); }
if (SCREEN === "gear") { await ev('window.__gear && window.__gear(true)'); await sleep(250); }

/* 글꼴이 정말 내려받아졌는가 — 안 오면 대체 글꼴로 떨어져 모양이 통째로 달라진다 */
const loaded = await ev(`(async()=>{
  await document.fonts.ready;
  const want = ["Galmuri11","GalmuriMono11","Press Start 2P","VT323"];
  const have = new Set([...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family.replace(/"/g,"")));
  return want.map(n => n + (have.has(n) ? " ✔" : " ✘안옴"));
})()`);

const out = await ev(`(()=>{
  function rgb(s){ const m=String(s).match(/[\\d.]+/g)||[0,0,0,1];
    return {r:+m[0],g:+m[1],b:+m[2],a:m[3]===undefined?1:+m[3]}; }
  function lin(c){ c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); }
  function lum(c){ return 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b); }
  function ratio(a,b){ const L1=lum(a),L2=lum(b); const hi=Math.max(L1,L2),lo=Math.min(L1,L2);
    return (hi+0.05)/(lo+0.05); }
  /* 조상으로 올라가 투명이 아닌 첫 배경색 */
  function bgOf(el){
    let n=el;
    while(n && n!==document.documentElement){
      const c=rgb(getComputedStyle(n).backgroundColor);
      if(c.a>0.4) return c;
      n=n.parentElement;
    }
    return {r:11,g:9,b:7,a:1};
  }
  const rows=[];
  document.querySelectorAll("body *").forEach(el=>{
    if(el.closest("[hidden]")) return;
    const cs=getComputedStyle(el);
    if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity)<0.1) return;
    /* 이 요소가 **직접** 가진 글자만 센다(자식 글자를 두 번 세지 않게) */
    let own="";
    el.childNodes.forEach(n=>{ if(n.nodeType===3) own+=n.nodeValue; });
    own=own.replace(/\\s+/g," ").trim();
    if(!own) return;
    const r=el.getBoundingClientRect();
    if(r.width<1||r.height<1||r.bottom<0||r.top>innerHeight) return;
    const size=parseFloat(cs.fontSize);
    const weight=parseInt(cs.fontWeight,10)||400;
    const fam=cs.fontFamily.split(",")[0].replace(/["']/g,"").trim();
    const fg=rgb(cs.color), bg=bgOf(el);
    /* 글자색이 반투명이면 배경과 섞어서 실제로 보이는 색을 만든다 */
    const a=fg.a;
    const mixed={r:fg.r*a+bg.r*(1-a), g:fg.g*a+bg.g*(1-a), b:fg.b*a+bg.b*(1-a)};
    const cr=ratio(mixed,bg);
    const hangul=/[가-힣]/.test(own);
    const big = size>=18.66 || (size>=14 && weight>=700);
    rows.push({ sel:(el.id?"#"+el.id:"")+(el.className&&typeof el.className==="string"?"."+el.className.trim().split(/\\s+/).join("."):el.tagName.toLowerCase()),
      text: own.slice(0,22), size:Math.round(size*10)/10, weight, fam, hangul,
      cr: Math.round(cr*100)/100, need: big?3:4.5,
      y: Math.round(r.top) });
  });
  return rows;
})()`);

/* ── 판정 ── */
const PIXEL = new Set(["Galmuri11", "GalmuriMono11"]);
const grid = r => PIXEL.has(r.fam) && Math.abs(r.size % 11) > 0.01;   /* 11 배수가 아니다 */
const tiny = r => r.hangul ? r.size < 12 : r.size < 10;
const dim = r => r.cr < r.need;

console.log("── 글씨 점검 (" + W + "×" + H + " · " + SCREEN + ") ──");
console.log("글꼴 로드   :", loaded.join(" · "));
console.log("잰 글자 상자:", out.length + "개");

function table(title, list, fmt) {
  console.log("\n" + title + " — " + list.length + "개");
  list.slice(0, 12).forEach(r => console.log("   " + fmt(r)));
  if (list.length > 12) console.log("   … 그 밖 " + (list.length - 12) + "개");
}

const tinyRows = out.filter(tiny);
const dimRows = out.filter(dim);
const gridRows = out.filter(grid);

if (tinyRows.length) table("너무 작다 (한글 12px · 라틴 10px 미만)", tinyRows,
  r => r.size + "px  " + r.fam.padEnd(14) + '"' + r.text + '"  ' + r.sel.slice(0, 34));
if (dimRows.length) table("대비가 모자라다 (WCAG)", dimRows,
  r => r.cr.toFixed(2) + ":1 (필요 " + r.need + ")  " + r.size + "px  \"" + r.text + '"  ' + r.sel.slice(0, 30));
if (gridRows.length) table("픽셀 격자에서 벗어났다 (Galmuri 는 11px 격자)", gridRows,
  r => r.size + "px  " + r.fam.padEnd(14) + '"' + r.text + '"  ' + r.sel.slice(0, 34));

const ok = b => b ? "✔" : "✘";
console.log("");
console.log("너무 작음   :", ok(tinyRows.length === 0), tinyRows.length + "개");
console.log("대비 모자람 :", ok(dimRows.length === 0), dimRows.length + "개" +
  (dimRows.length ? " · 가장 낮은 것 " + Math.min(...dimRows.map(r => r.cr)).toFixed(2) + ":1" : ""));
console.log("격자 벗어남 :", ok(gridRows.length === 0), gridRows.length + "개" +
  (gridRows.length ? " · 크기 " + [...new Set(gridRows.map(r => r.size))].sort((a, b) => a - b).join(", ") : ""));

if (SHOT) {
  const { data } = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(SHOT, Buffer.from(data, "base64"));
  console.log("스크린샷    :", SHOT);
}

const bad = tinyRows.length + dimRows.length + gridRows.length;
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
ch.kill(); srv.close(); process.exit(bad ? 1 : 0);
