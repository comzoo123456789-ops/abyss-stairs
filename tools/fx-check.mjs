/* 타격감이 **실제로 화면에 그려지는가**.
 *
 * ⚠ "이펙트 넣었다" 를 코드가 있다는 것으로 판정하지 않는다. 캔버스 픽셀을 직접
 *   읽어 **대조군**(치기 전)과 비교한다 — 신호만 쌓이고 아무것도 안 그려져도
 *   콘솔은 조용하다.
 * ⚠ 무기마다 궤적이 달라야 한다는 것도 잰다. 다 같은 그림이면 "무기별 모션" 이
 *   아니다. 무기별 픽셀 자국이 서로 다른지를 본다.
 * ⚠ 히트스톱이 **입력을 막지 않는지**를 반드시 잰다. 막으면 연타가 밀려
 *   "눌렀는데 안 움직인다" 가 된다.
 *
 *   사용:  node tools/fx-check.mjs [--shots <폴더>]
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "url";

const CHROME = process.env.MB_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const SHOTS = (() => { const i = process.argv.indexOf("--shots"); return i > 0 ? process.argv[i + 1] : ""; })();
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-fx-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
/* ⚠ 크롬이 ws:// 를 안 뱉으면 여기서 영원히 기다린다 — 시간 제한을 둔다 */
const wsUrl = await new Promise((res, rej) => {
  let b = "";
  const t = setTimeout(() => rej(new Error("Chrome 가 30초 안에 뜨지 않았습니다: " + CHROME)), 30000);
  ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
});
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
const shot = async n => { if (!SHOTS) return;
  const { data } = await S("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, n), Buffer.from(data, "base64")); };

let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };
const row = (n, good, note) => console.log(n.padEnd(15), ok(good), note);

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(900);
await ev('window.__start("warrior","free")');
await sleep(400);

/* 한 칸을 픽셀로 읽는다. 카메라와 devicePixelRatio 를 거쳐 화면 좌표를 만든다.
 * ⚠ dpr 을 빼먹으면 엉뚱한 자리를 읽고 "아무것도 안 그려졌다" 로 오진한다. */
await ev(`window.__pix = function (tx, ty, pad) {
  var cam = window.__cam(), T = cam.tile;
  var cv = document.getElementById("view");
  var dpr = cv.width / cv.clientWidth;
  var x = Math.round(((tx * T) - cam.x - pad) * dpr);
  var y = Math.round(((ty * T) - cam.y - pad) * dpr);
  var w = Math.round((T + pad * 2) * dpr), h = w;
  x = Math.max(0, Math.min(cv.width - 1, x)); y = Math.max(0, Math.min(cv.height - 1, y));
  w = Math.max(1, Math.min(w, cv.width - x)); h = Math.max(1, Math.min(h, cv.height - y));
  var d = cv.getContext("2d").getImageData(x, y, w, h).data;
  var sum = 0, lit = 0, r = 0, g = 0, b = 0, hash = 0;
  for (var i = 0; i < d.length; i += 4) {
    var v = d[i] + d[i + 1] + d[i + 2];
    sum += v; r += d[i]; g += d[i + 1]; b += d[i + 2];
    if (v > 470) lit++;
    hash = (hash * 31 + v) | 0;
  }
  return { sum: sum, lit: lit, r: r, g: g, b: b, hash: hash, n: d.length / 4 };
};
/* 칸이 아니라 **세계 픽셀 좌표**로 읽는다. 몬스터 체력 띠 같은 것을 피해
 * 원하는 띠만 잘라 보려면 이쪽이 필요하다. */
window.__pixBox = function (wx, wy, bw, bh) {
  var cam = window.__cam();
  var cv = document.getElementById("view");
  var dpr = cv.width / cv.clientWidth;
  var x = Math.round((wx - cam.x) * dpr), y = Math.round((wy - cam.y) * dpr);
  var w = Math.round(bw * dpr), h = Math.round(bh * dpr);
  x = Math.max(0, Math.min(cv.width - 1, x)); y = Math.max(0, Math.min(cv.height - 1, y));
  w = Math.max(1, Math.min(w, cv.width - x)); h = Math.max(1, Math.min(h, cv.height - y));
  var d = cv.getContext("2d").getImageData(x, y, w, h).data;
  var sum = 0, lit = 0, hash = 0;
  for (var i = 0; i < d.length; i += 4) {
    var v = d[i] + d[i + 1] + d[i + 2];
    sum += v; if (v > 470) lit++; hash = (hash * 31 + v) | 0;
  }
  return { sum: sum, lit: lit, hash: hash };
};
/* 정해진 색에 가까운 픽셀이 몇 개인가.
 * ⚠ "밝은 픽셀 수" 로 글자를 재면 머리 위 지형 밝기가 회차마다 달라 흔들린다
 *   (실측 대조군이 29~56 으로 널뛰었다). 글자 **색 자체**를 세면 지형과 무관하다.
 * ⚠ 글자가 흐려지는 구간에서는 배경과 섞여 색이 안 맞는다 — 알파가 1 인
 *   동안(떠오른 지 0.43초 안)에 재야 한다. */
window.__pixMatch = function (wx, wy, bw, bh, cols, tol) {
  var cam = window.__cam();
  var cv = document.getElementById("view");
  var dpr = cv.width / cv.clientWidth;
  var x = Math.round((wx - cam.x) * dpr), y = Math.round((wy - cam.y) * dpr);
  var w = Math.round(bw * dpr), h = Math.round(bh * dpr);
  x = Math.max(0, Math.min(cv.width - 1, x)); y = Math.max(0, Math.min(cv.height - 1, y));
  w = Math.max(1, Math.min(w, cv.width - x)); h = Math.max(1, Math.min(h, cv.height - y));
  var d = cv.getContext("2d").getImageData(x, y, w, h).data, hit = 0;
  for (var i = 0; i < d.length; i += 4) {
    for (var c = 0; c < cols.length; c++) {
      if (Math.abs(d[i] - cols[c][0]) <= tol &&
          Math.abs(d[i + 1] - cols[c][1]) <= tol &&
          Math.abs(d[i + 2] - cols[c][2]) <= tol) { hit++; break; }
    }
  }
  return hit;
};`);

const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
async function tapDir(dx, dy) {
  const key = dx ? (dx > 0 ? "ArrowRight" : "ArrowLeft") : (dy > 0 ? "ArrowDown" : "ArrowUp");
  await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: VK[key] });
  await S("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: VK[key] });
}
/* 앞 항목이 남긴 연출이 다 가라앉을 때까지 기다린다.
 * ⚠ 이게 없으면 **대조군이 오염된다.** 떠 있던 피해 숫자가 "치기 전" 값에
 *   그대로 섞여 들어와, 새로 뜬 숫자를 세도 차이가 안 난다(실제로 그랬다). */
async function settle(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 2000)) {
    const st = JSON.parse(await ev("JSON.stringify(window.__fxState())"));
    if (!st.dmgs && !st.swings && !st.blooms && !st.whites && !st.bolts) return true;
    await sleep(90);
  }
  return false;
}

async function arena(opt) {
  const j = await ev("JSON.stringify(window.__arena(" + JSON.stringify(opt || {}) + "))");
  const a = j ? JSON.parse(j) : null;
  await settle();
  /* ⚠ 도중에 죽으면 그 뒤 입력이 전부 안 먹혀 **모든 검사가 거짓으로 실패한다.**
   *   조용히 넘기지 말고 여기서 크게 터뜨린다. */
  if (a && a.over) { console.log("   ✘ 판이 끝나 있다(플레이어 사망) — 이후 결과는 못 믿는다"); fails++; }
  return a;
}

console.log("── 타격감 (실제 캔버스 픽셀) ──");

/* ① 무기별 베기 궤적 — 대조군(치기 전)과 비교하고, 무기끼리도 비교한다 */
const marks = {};
for (const wk of ["sword", "axe", "dagger", "staff", "spear"]) {
  /* calm — 반격을 안 받게 재워 둔다. 붉은 막이 끼면 궤적을 못 잰다. */
  const a = await arena({ weapon: wk, hp: 99999, calm: true });
  if (!a) { row(wk + " 궤적", false, "옆에 빈 칸이 없어 판을 못 만들었다"); continue; }
  await sleep(160);
  const box = `window.__pix(${a.x}, ${a.y}, 22)`;
  const before = await ev(box);
  await tapDir(a.dx, a.dy);
  /* ⚠ 한 시점만 찍으면 **궤적이 화면에 올라오기 전 프레임**을 잡을 때가 있다.
   *   그러면 무기가 달라도 "흰 섬광만 있는 같은 그림" 이 되어 자국이 겹친다
   *   (실측: 다섯 중 넷만 달랐다). 여러 시점을 찍어 **가장 진한 순간**으로
   *   판정한다 — 무기마다 호의 크기와 색이 달라 그 순간이 서로 다른 그림이다. */
  let at = before;
  for (const wait of [22, 22, 25, 30, 40]) {
    await sleep(wait);
    const now = await ev(box);
    if (now.lit > at.lit) at = now;
  }
  await shot("fx-" + wk + ".png");
  marks[wk] = at.hash;
  row(wk + " 궤적", at.hash !== before.hash && at.lit > before.lit,
    "밝은 픽셀 " + before.lit + " → " + at.lit);
}
const sig = Object.keys(marks).map(k => marks[k]);
row("무기별로 다름", sig.length >= 4 && new Set(sig).size === sig.length,
  sig.length + "종 중 서로 다른 자국 " + new Set(sig).size + "가지");

/* ② 피해 숫자 — 적 **위쪽**에 없던 글자가 뜬다 */
{
  const a = await arena({ weapon: "sword", hp: 99999 });
  await sleep(160);
  /* ⚠ 칸 하나를 통째로 읽으면 **그 순간 새로 생긴 몬스터 체력 띠**(검은 바탕)가
   *   같이 들어와 밝은 픽셀이 오히려 줄어든다. 체력 띠는 칸 위 5px 안에 있으므로
   *   그보다 위쪽 띠만 잘라 읽는다(몬스터가 위아래로 까딱이므로 8px 를 비운다).
   * ⚠ 상자가 너무 얕으면 **글자의 검은 테두리 윗부분만** 들어와 오히려 어두워진다
   *   (실제로 48 → 23 으로 빨개졌다). 글자 몸통이 들어올 만큼 높이를 준다.
   * ⚠ 숫자는 떠오르며 자리가 계속 바뀐다. 한 시점만 찍으면 타이밍 운에 걸린다 —
   *   세 시점을 찍어 가장 밝을 때로 판정한다.
   * ⚠ 베기 궤적이 사라진 뒤(200ms 넘김)에 잰다 — 안 그러면 무엇이 밝힌 건지 모른다. */
  /* 실측한 글자 자리: 칸 기준 x 12~20, y −19~−9 이고 **위로 떠오른다.**
   * 상자를 그 길에 맞춘다(너무 위에 두면 글자가 아직 아래에 있어 못 잡는다). */
  const bx = a.x * 32 - 2, by = a.y * 32 - 26, bw = 36, bh = 30;
  /* 보통 피해 #f2ead2 · 치명타 #ffb347. 둘 다 센다 — 치명타가 터져도 통과해야 한다. */
  const COLS = "[[242,234,210],[255,179,71]]";
  const box = `window.__pixMatch(${bx}, ${by}, ${bw}, ${bh}, ${COLS}, 16)`;
  const before = await ev(box);
  await tapDir(a.dx, a.dy);
  let best = 0;
  for (const wait of [150, 110, 110]) {    /* 전부 알파가 1 인 구간(0.43초 안) */
    await sleep(wait);
    const now = await ev(box);
    if (now > best) best = now;
  }
  const st = JSON.parse(await ev("JSON.stringify(window.__fxState())"));
  row("피해 숫자", best > before + 6 && st.dmgs > 0,
    "쌓인 숫자 " + st.dmgs + "개 · 글자 색 픽셀 " + before + " → " + best + " (7 이상 늘어야 한다)");
}

/* ③ 흰 섬광 — 맞은 그림이 하얗게. 그 칸의 밝기가 확 뛴다. */
{
  const a = await arena({ weapon: "dagger", hp: 99999 });
  await sleep(160);
  const before = await ev(`window.__pix(${a.x}, ${a.y}, 0)`);
  await tapDir(a.dx, a.dy);
  await sleep(28);
  const at = await ev(`window.__pix(${a.x}, ${a.y}, 0)`);
  const up = (at.sum - before.sum) / Math.max(1, before.sum);
  row("흰 섬광", up > 0.06,
    "칸 밝기 " + before.sum + " → " + at.sum + " (" + (up * 100).toFixed(1) + "%)");
}

/* ④ 중독 색 — 때리지 않고 독만 걸어 대조군과 비교한다. 초록 비중이 늘어야 한다. */
{
  const c = await arena({ weapon: "sword", hp: 99999 });
  await sleep(240);
  const before = await ev(`window.__pix(${c.x}, ${c.y}, 0)`);
  const p = await arena({ weapon: "sword", hp: 99999, ail: "poison" });
  await sleep(260);
  const at = await ev(`window.__pix(${p.x}, ${p.y}, 0)`);
  await shot("fx-poison.png");
  const g0 = before.g / Math.max(1, before.r + before.b);
  const g1 = at.g / Math.max(1, at.r + at.b);
  row("중독 색", g1 > g0 * 1.03, "초록 비중 " + g0.toFixed(3) + " → " + g1.toFixed(3));
}

/* ⑤ 히트스톱이 **입력을 막지 않는가** */
{
  /* 대조군 먼저 — 적 없이 **같은 키**를 같은 간격으로 두 번.
   * ⚠ 다른 키 둘로 대조군을 잡으면 안 된다. 같은 키 연타에만 걸리는 제한이
   *   있을 수 있어 비교가 성립하지 않는다(처음에 그걸로 오진했다). */
  await ev("window.__clearMonsters()");
  await sleep(160);
  const c0 = await ev("window.__peek().turn");
  await tapDir(0, -1); await sleep(20); await tapDir(0, -1);
  await sleep(200);
  const cN = (await ev("window.__peek().turn")) - c0;

  const a = await arena({ weapon: "axe", hp: 99999 });
  await sleep(160);
  const t0 = await ev("window.__peek().turn");
  await tapDir(a.dx, a.dy);
  await sleep(20);                                  /* 히트스톱 한가운데 */
  await tapDir(a.dx, a.dy);
  await sleep(200);
  const hN = (await ev("window.__peek().turn")) - t0;
  row("히트스톱", hN >= cN && hN >= 2,
    "적 없이 두 번 → 턴 +" + cN + " · 멈춘 동안 두 번 → 턴 +" + hN + " (같아야 한다)");
}

/* ⑥ 상단 체력 띠가 뒤따라 닳는가 */
{
  const a = await arena({ mon: "orc", hp: 99999, php: 40 });
  await sleep(200);
  await tapDir(a.dx, a.dy);                         /* 치고 반격을 맞는다 */
  await sleep(70);
  const read = `(function(){
    var m = document.querySelector(".hud .meter.hp");
    if (!m) return null;
    var i = m.querySelector("i"), gh = m.querySelector("em.ghost");
    return { cur: i ? i.getBoundingClientRect().width : -1,
             ghost: gh ? gh.getBoundingClientRect().width : -1 };
  })()`;
  const b1 = await ev(read);
  const s1 = JSON.parse(await ev("JSON.stringify(window.__fxState())"));
  await sleep(900);
  const b2 = await ev(read);
  const drained = !!b1 && b1.ghost > b1.cur + 0.5;
  const caught = !b2 || b2.ghost < 0 || b2.ghost <= b2.cur + 1.5;
  row("체력 띠", drained && caught,
    b1 ? "맞은 직후 현재 " + Math.round(b1.cur) + "px · 유령 " + Math.round(b1.ghost) +
         "px → 0.9초 뒤 유령 " + (b2 && b2.ghost >= 0 ? Math.round(b2.ghost) + "px" : "사라짐")
       : "막대를 못 찾음 (붙잡은 요소 " + (s1.ghostEl ? "있음" : "없음") + " · 값 " + s1.hudGhost + ")");
}

/* ⑦ 스킬 모션 — 화염 폭발을 쥐여 주고 Q 로 쏜다 */
{
  const a = await arena({ weapon: "staff", hp: 99999, skill: "blast" });
  await sleep(200);
  const before = await ev(`window.__pix(${a.x}, ${a.y}, 26)`);
  await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "q", code: "KeyQ", windowsVirtualKeyCode: 81 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", key: "q", code: "KeyQ", windowsVirtualKeyCode: 81 });
  await sleep(110);
  const at = await ev(`window.__pix(${a.x}, ${a.y}, 26)`);
  await shot("fx-skill.png");
  const sst = JSON.parse(await ev("JSON.stringify(window.__fxState())"));
  row("스킬 모션", at.hash !== before.hash && sst.blooms > 0,
    "터짐 " + sst.blooms + "개 · 밝은 픽셀 " + before.lit + " → " + at.lit);
}

/* ⑧ 갑옷 등급이 **외형을 바꾸는가**.
 * ⚠ "덧그림 스프라이트를 만들었다" 는 통과가 아니다. 같은 자리에서 일반 갑옷과
 *   유물 갑옷의 픽셀을 비교해 **정말 달라지는지** 본다. */
{
  const a = await arena({ mon: "orc", calm: true, armor: "common" });
  if (!a) row("갑옷 외형", false, "판을 못 만들었다");
  else {
    await sleep(240);
    const px = `window.__pix(window.__peek().x, window.__peek().y, 0)`;
    const plain = await ev(px);
    await arena({ mon: "orc", calm: true, armor: "relic" });
    await sleep(240);
    const deck = await ev(px);
    row("갑옷 외형", plain.hash !== deck.hash && deck.lit !== plain.lit,
      "일반 → 유물 · 밝은 픽셀 " + plain.lit + " → " + deck.lit);
  }
}

/* ⑨ 구운 판이 새지 않는가 — 색을 값에서 만들면 여기가 끝없이 는다 */
{
  for (let i = 0; i < 6; i++) {
    const a = await arena({ weapon: "sword", hp: 99999, ail: i % 2 ? "poison" : "bleed" });
    await tapDir(a.dx, a.dy);
    await sleep(70);
  }
  const cc = JSON.parse(await ev("JSON.stringify(window.__bakes())"));
  row("구운 판", cc.worst <= 8,
    '가장 많은 것 "' + cc.name + '" ' + cc.worst + "벌 · 전체 " + cc.total + "벌 (한 그림당 8 이하)");
}

console.log("\n콘솔 오류:", errs.length ? "✘ " + errs.length + "건 · " + errs[0] : "✔ 0 건");
if (errs.length) fails++;
console.log(fails === 0 ? "\n결과: 통과" : "\n결과: ✘ " + fails + "건");
ws.close(); ch.kill(); srv.close();
process.exit(fails === 0 ? 0 : 1);
