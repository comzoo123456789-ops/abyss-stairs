//  화면 점검기 — 실제 Chrome 으로 게임을 열어 콘솔 오류를 세고, 키를 눌러 보고, 찍는다.
//
//    사용:  node tools/check.mjs [--shot 파일명] [--w 1440] [--h 900]
//
//  왜 필요한가: 로직은 Node 로 검증되지만 "그려지는가" 는 그걸로 알 수 없다.
//  스프라이트가 투명하게 빠지거나 캔버스가 0px 여도 검사는 통과한다.
//  ⚠ 콘솔 오류 0 건을 반드시 확인할 것 — try/catch 에 삼켜진 예외는 반쪽 로드를 만든다.
//
//  준비물: Chrome(아래 경로) · Node 18+. 설치 패키지 없음.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
//  배포되는 것은 public/ 뿐이다(tools 는 웹에 올리지 않는다) — 점검기도 거기를 서빙한다.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const VW = parseInt(arg("--w", "1440"), 10);
const VH = parseInt(arg("--h", "900"), 10);
const SHOT = arg("--shot", null);
const PLAY = argv.includes("--play");
const TOUCH = argv.includes("--touch");
const CLS = arg("--cls", "warrior");   // 검사할 직업
//  --url 을 주면 로컬 파일이 아니라 그 주소를 잰다 — 배포가 정말 그렇게 도는지 확인용.
//  ⚠ 로컬만 재고 "배포됐다" 고 말하면 안 된다. 파일이 올라간 것과 화면이 도는 것은 다르다.
const URL_ARG = arg("--url", null);

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"
};

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rq) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file)) { rq.writeHead(404); rq.end("no"); return; }
      rq.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      rq.end(fs.readFileSync(file));
    });
    srv.listen(0, "127.0.0.1", () => res({ srv, port: srv.address().port }));
  });
}

async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-cdp-"));
  const ch = spawn(CHROME, [
    "--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--hide-scrollbars", "--force-device-scale-factor=1", "--disable-gpu",
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    const t = setTimeout(() => rej(new Error("Chrome 가 30초 안에 뜨지 않았습니다")), 30000);
    ch.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) { clearTimeout(t); res(m[0]); }
    });
  });
  return { ch, wsUrl, dir };
}

function cdp(ws) {
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, (m) => m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result));
    ws.send(JSON.stringify({ id: i, method, params: params || {}, sessionId }));
  });
  return { send, events };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srvObj = URL_ARG ? { srv: { close(){} }, port: 0 } : await serve();
  const { srv } = srvObj;
  const base = URL_ARG || ("http://127.0.0.1:" + srvObj.port + "/");
  const { ch, wsUrl, dir } = await launch();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const { send, events } = cdp(ws);

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  const ev = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expr);
    return r.result.value;
  };

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Log.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: TOUCH });
  if (TOUCH) {
    //  ⚠ setEmulatedMedia 는 pointer 를 못 바꾼다(지원 목록에 없다) — 터치 에뮬레이션을 켜야
    //    pointer:coarse 가 실제로 먹는다. 이걸 몰라 "패드가 안 뜬다" 로 오진할 뻔했다.
    await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await S("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
  }

  await S("Page.navigate", { url: base });
  await sleep(1400);

  //  ── 0) 시작 화면: 처음 켠 사람이 보는 유일한 설명이다 ──
  const startCheck = await ev(`(()=>{
    const s = document.getElementById("start");
    const cards = [...document.querySelectorAll(".cls-card")];
    const guides = document.querySelectorAll(".guide-row").length;
    const art = cards.map(c => { const cv=c.querySelector("canvas"); if(!cv) return 0;
      const d=cv.getContext("2d").getImageData(0,0,cv.width,cv.height).data;
      let lit=0; for(let i=3;i<d.length;i+=4) if(d[i]>10) lit++;
      return Math.round(lit/(d.length/4)*100); });
    const over = [...document.querySelectorAll("#start *")].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>0 && (r.right>innerWidth+1 || r.left<-1); }).length;
    const card = document.querySelector(".start-card");
    return { shown: !s.hidden, cards: cards.length, guides, art, overflow: over,
             fits: card.scrollHeight <= card.clientHeight + 2,
             keys: document.querySelectorAll(".guide-row kbd").length,
             hasSpace: /Space/.test(document.querySelector(".guide").textContent) };
  })()`);

  //  시작 화면(직업 선택)을 지난다. 이게 없으면 모든 검사가 시작 화면 위에서 돈다.
  await S("Runtime.evaluate", { expression: "window.__start && window.__start('" + CLS + "')" }, sessionId);
  await sleep(500);

  // ── 콘솔 오류 / 예외 ──
  const errs = [];
  for (const e of events) {
    if (e.method === "Runtime.exceptionThrown") {
      const d = e.params.exceptionDetails;
      errs.push("예외: " + (d.exception?.description || d.text));
    }
    if (e.method === "Runtime.consoleAPICalled" && e.params.type === "error") {
      errs.push("console.error: " + e.params.args.map(a => a.value ?? a.description).join(" "));
    }
    if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
      errs.push("로그: " + e.params.entry.text + " " + (e.params.entry.url || ""));
    }
  }


  // ── 1) 실제로 그려졌는가: 캔버스 크기와 비어 있지 않은 픽셀 ──
  const canvas = await ev(`(()=>{
    const c=document.getElementById("view");
    const x=c.getContext("2d");
    const d=x.getImageData(0,0,c.width,c.height).data;
    let lit=0,h=0; const colors=new Set();
    for(let i=0;i<d.length;i+=4){
      h=(h*31 + d[i]+d[i+1]*3+d[i+2]*7)|0;
      if(d[i]+d[i+1]+d[i+2] > 40){ lit++; if(colors.size<400) colors.add(d[i]+","+d[i+1]+","+d[i+2]); }
    }
    return { w:c.width, h:c.height, cssW:c.clientWidth, cssH:c.clientHeight, hash:h,
             litPct:+(lit/(d.length/4)*100).toFixed(1), colors:colors.size };
  })()`);

  // ── 2) 게임 상태 ──
  const ui = await ev(`(()=>{
    const txt = el => (el ? el.textContent.trim() : "(없음)");
    return {
      stats: txt(document.getElementById("stats")).replace(/\\s+/g," ").slice(0,90),
      logLines: document.querySelectorAll("#log .m").length,
      lastLog: txt(document.querySelector("#log .m:last-child")),
      invItems: document.querySelectorAll("#inv .inv-item").length,
      endHidden: document.getElementById("end").hidden,
      helpHidden: document.getElementById("help").hidden
    };
  })()`);

  // ── 3) 키를 실제로 눌러 본다.
  //    ⚠ 판정을 "로그 줄이 늘었나" 로 두면 안 된다 — 그냥 걷는 것은 로그를 안 남기므로
  //      멀쩡히 움직이는데도 "키가 안 먹는다" 로 나온다(실제로 그렇게 오진했다).
  //      좌표와 턴이 실제로 변했는지를 본다.
  const before = await ev(`window.__peek()`);
  for (const key of ["ArrowRight","ArrowRight","ArrowDown","ArrowDown","ArrowLeft","ArrowUp",
                     "ArrowRight","ArrowDown","ArrowRight","ArrowDown","ArrowRight","ArrowRight"]) {
    await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode:
      { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39 }[key] });
    await S("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
    await sleep(40);
  }
  const after = await ev(`window.__peek()`);
  const moved = (after.x !== before.x || after.y !== before.y);
  const turned = after.turn > before.turn;

  // 화면이 실제로 다시 그려졌는지 — 픽셀을 해시해 비교한다(밝기 비율은 한 칸 이동에 안 변한다)
  const canvas2 = await ev(`(()=>{
    const c=document.getElementById("view");
    const d=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    let lit=0,h=0;
    for(let i=0;i<d.length;i+=4){ if(d[i]+d[i+1]+d[i+2]>40) lit++; h=(h*31 + d[i]+d[i+1]*3+d[i+2]*7)|0; }
    return { litPct:+(lit/(d.length/4)*100).toFixed(1), hash:h };
  })()`);

  // ── 3-b) --play: 죽을 때까지 실제로 두드려 종료 화면까지 간다 ──
  //    종료 화면은 사람이 가장 늦게 보는 화면이라 가장 안 고쳐진다. 실제로 밟아 본다.
  let endCheck = null;
  if (PLAY) {
    //  ⚠ 무작위 키로는 끝나지 않는다 — 1층은 쥐만 나오는 연습 층이라 다 잡고 나면
    //    안전하고, 62×38 맵에서 계단 한 칸을 우연히 밟을 확률이 거의 없다
    //    (실측: 1473턴 동안 1층에 그대로 있었다). 계단 쪽으로 걸어 내려가게 몬다.
    const vk = { ArrowUp:38, ArrowDown:40, ArrowLeft:37, ArrowRight:39, g:71, ">":190 };
    const tap = async (key) => {
      await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: vk[key] });
      await S("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
    };
    //  통행 격자를 받아 BFS 로 계단까지의 첫 걸음을 낸다. 입력은 계속 진짜 키보드다.
    const stepToward = (map, sx, sy, tx, ty) => {
      const W = map.w, H = map.h, prev = new Int32Array(W * H).fill(-1);
      const start = sy * W + sx, goal = ty * W + tx;
      prev[start] = start;
      const q = [start];
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        if (cur === goal) {
          let n = cur;
          while (prev[n] !== start) n = prev[n];
          return [(n % W) - sx, ((n / W) | 0) - sy];
        }
        const cx = cur % W, cy = (cur / W) | 0;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const id = ny * W + nx;
          if (!map.walk[id] || prev[id] !== -1) continue;
          prev[id] = cur; q.push(id);
        }
      }
      return null;
    };
    const dirKey = (dx, dy) => dx > 0 ? "ArrowRight" : dx < 0 ? "ArrowLeft"
                             : dy > 0 ? "ArrowDown" : "ArrowUp";

    let st = await ev(`window.__peek()`);
    let map = await ev(`window.__map()`);
    let depthSeen = st.depth;
    for (let i = 0; i < 4000 && !st.over; i++) {
      if (st.onStairs) await tap(">");
      else {
        const step = stepToward(map, st.x, st.y, st.stairs.x, st.stairs.y);
        if (!step) break;                       // 길이 없으면 생성기 쪽 문제다
        await tap(dirKey(step[0], step[1]));
      }
      if (i % 4 === 0) await tap("g");
      st = await ev(`window.__peek()`);
      /* ⚠ 상인을 밟으면 상점이 열리고 그 동안 모든 행동이 막힌다 — 닫아 줘야 계속 간다.
       *   레벨업 선택도 같다(열려 있으면 뒤에서 아무 것도 못 한다). */
      if (st.shopOpen) { await ev("window.__closeShop && window.__closeShop()"); st = await ev(`window.__peek()`); }
      if (st.perkOpen) { await ev("window.__pickPerk && window.__pickPerk(0)"); st = await ev(`window.__peek()`); }
      if (st.depth !== depthSeen) { map = await ev(`window.__map()`); depthSeen = st.depth; }
    }
    endCheck = await ev(`(()=>{
      const e = document.getElementById("end");
      const txt = el => (el ? el.textContent.replace(/\\s+/g," ").trim() : "");
      return { shown: !e.hidden, title: txt(document.getElementById("endTitle")),
               body: txt(document.getElementById("endBody")).slice(0,140),
               best: txt(document.getElementById("best")) };
    })()`);
    endCheck.over = st.over;
    endCheck.depth = st.depth;
    endCheck.turn = st.turn;
    /* ⚠ 끝까지 돌린 뒤에는 **종료 화면이 키를 다 먹는다**(Enter·R 만 받는다).
     *   그 상태로 뒤의 검사를 이어 돌렸더니 도움말(? 키)·연타 확대·누르고 걷기가
     *   전부 빨갰다 — 제품이 아니라 검사 순서가 문제였다. 한 판을 새로 켠다. */
    await ev(`window.__start("${CLS}")`);
    await sleep(160);
  }

  // ── 3-c) 새 기능이 실제로 도는가: 능력 쿨다운 · 함정 · 미식별 물약 ──
  //    로직 검사로는 "값이 맞다" 까지만 안다. 버튼이 잠기고 풀리는지는 화면에서 봐야 한다.
  const feat = await ev(`(()=>{
    const before = window.__peek();
    const btn = document.querySelector("[data-skill]");
    return { cdBefore: before.cooldown, btnReady: btn ? !btn.disabled : null,
             btnText: btn ? btn.textContent.replace(/s+/g," ").trim() : "(없음)",
             traps: before.traps, treasure: before.treasure, bag: before.bag };
  })()`);
  //  Q 를 눌러 본다. 닿는 적이 없으면 거절되는 것이 정상이므로 둘 다 받아들인다.
  await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "q", code: "KeyQ", windowsVirtualKeyCode: 81 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", key: "q", code: "KeyQ" });
  await sleep(120);
  const feat2 = await ev(`(()=>{
    const st = window.__peek();
    const btn = document.querySelector("[data-skill]");
    const last = document.querySelector("#log .m:last-child");
    return { cd: st.cooldown, disabled: btn ? btn.disabled : null,
             text: btn ? btn.textContent.replace(/s+/g," ").trim() : "",
             log: last ? last.textContent.trim() : "" };
  })()`);
  //  물약 이름이 미식별로 보이는가 — 정체가 그대로 보이면 미식별 장치가 죽은 것이다
  const potions = await ev(`(()=>{
    const names = window.DATA.ITEMS.filter(i=>i.kind==="potion").map(i=>i.name);
    const looks = window.DATA.POTION_LOOKS.map(l=>l.label);
    return { names, looks };
  })()`);
  //  ⚠ 빌드 검사는 **버리기 검사보다 앞**에 둔다. 우클릭 검사가 무기를 내려놓아서
  //    뒤에 재면 장비가 null 로 보인다(실제로 그렇게 오진했다).
  // ── 3-f) 빌드 시스템이 실제로 화면에 붙었는가 ──
  const build = await ev(
    "(function(){" +
    "  var p = window.__peek();" +
    "  var skillRows = document.querySelectorAll('.skills .skill').length;" +
    "  var ready = document.querySelectorAll('.skills .skill.ready').length;" +
    "  var invColored = [...document.querySelectorAll('.inv-item .nm')]" +
    "     .filter(function(e){ return e.style.color; }).length;" +
    "  var gold = document.querySelector('.who-gold');" +
    "  return { skillRows: skillRows, ready: ready, invColored: invColored," +
    "           gold: gold ? gold.textContent.trim() : '(없음)'," +
    "           skills: p.skills.length, crit: p.crit, weapon: p.weapon, rarity: p.rarity," +
    "           merchant: p.merchant };" +
    "})()");
  // ── 3-d) 4방향 조작과 우클릭 버리기 ──
  //    ⚠ 대각선 키(YUBN)가 정말 죽었는지, 우클릭이 브라우저 메뉴만 띄우고
  //      끝나지 않는지는 화면에서 눌러 봐야 안다.
  //  ⚠ --play 뒤에는 게임이 끝나 있어 이동도 버리기도 거절된다 — 그때는 건너뛴다.
  //  (--play 뒤에는 위에서 한 판을 새로 켰으므로 여기서도 조작이 먹는다)
  const canAct = !(await ev(`window.__peek().over`));
  const diagBefore = await ev(`window.__peek()`);
  for (const k of ["y","u","b","n","w","a","s","d","h","j","k","l"]) {
    await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code: "Key" + k.toUpperCase(),
      windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
    await S("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: "Key" + k.toUpperCase() });
  }
  await sleep(150);
  const diagAfter = await ev(`window.__peek()`);
  const oldKeysDead = !canAct || (diagAfter.x === diagBefore.x && diagAfter.y === diagBefore.y);

  //  가방에 물건이 있으면 우클릭으로 버려 본다(시작 장비가 있으니 항상 하나는 있다)
  const dropTest = await ev(`(()=>{
    const before = window.__peek().bag;
    const btn = document.querySelector(".inv-item");
    if (!btn) return { skipped: true };
    if (window.__peek().over) return { skipped: true };
    const ev2 = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    const notCancelled = btn.dispatchEvent(ev2);
    return { before: before, after: window.__peek().bag, prevented: !notCancelled,
             log: (document.querySelector("#log .m:last-child")||{}).textContent || "" };
  })()`);

  //  터치 패드에 대각선 버튼이 남아 있지 않은가
  const padDirs = await ev(`[...document.querySelectorAll(".pad [data-dir]")].map(b=>b.getAttribute("data-dir"))`);
  const noDiagButtons = padDirs.every(d => d.split(",").some(v => v === "0"));
  // ── 3-e) 모바일 연타 확대 — 방향 버튼을 빠르게 두 번 눌러도 배율이 안 변해야 한다 ──
  //    ⚠ 실제 신고: "방향키 연속으로 누르면 확대가 되고 있어서 이동하는데 불편해".
  //      touch-action 을 안 걸면 브라우저가 더블탭으로 보고 확대한다.
  let zoomCheck = null;
  if (TOUCH) {
    const before = await ev(
      "({ scale: window.visualViewport ? window.visualViewport.scale : 1," +
      "   ta: getComputedStyle(document.querySelector('.dpad button')).touchAction })");
    /* ⚠ 한 방향만 두드리면 안 된다 — 그쪽이 벽이면 턴이 안 늘어 "터치가 안 먹는다" 로
     *   오진한다(실제로 그렇게 나왔다). 네 방향을 돌려 가며 두드린다. */
    const btns = await ev(
      "['.p-right','.p-down','.p-left','.p-up'].map(function(s){" +
      "  var r = document.querySelector(s).getBoundingClientRect();" +
      "  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })");
    const st0 = await ev("window.__peek()");
    for (let i = 0; i < 8; i++) {
      const b = btns[i % btns.length];
      await S("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x, y: b.y }] });
      await S("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(60);   /* 더블탭으로 오인될 만큼 빠르게 */
    }
    await sleep(250);
    const after = await ev("({ scale: window.visualViewport ? window.visualViewport.scale : 1 })");
    const st1 = await ev("window.__peek()");
    zoomCheck = { ta: before.ta, scale0: before.scale, scale1: after.scale,
                  turn0: st0.turn, turn1: st1.turn, x0: st0.x, x1: st1.x };
  }
  // ── 3-g) 누르고 있을 때의 걸음 속도 + 기록 가시성 ──
  //    ⚠ 둘 다 사용자가 직접 신고한 문제다:
  //      "화살표 쭉 누르면 캐릭터가 한번에 슝 간다" · "기록이 실시간으로 안 따라온다"
  //    OS 키 반복은 30ms 간격이라 그대로 받으면 1초에 30칸을 간다.
  //  ⚠ 한 방향만 누르면 그쪽이 벽일 때 0걸음이 나와 "입력이 안 먹는다" 로 오진한다
  //    (실제로 그렇게 나왔다). 지도를 읽어 **열린 방향**을 골라 누른다.
  const openDir = await ev(
    "(function(){" +
    "  var m = window.__map(), p = window.__peek();" +
    "  var opts = [[0,-1,'ArrowUp',38],[0,1,'ArrowDown',40],[-1,0,'ArrowLeft',37],[1,0,'ArrowRight',39]];" +
    "  for (var i=0;i<opts.length;i++) {" +
    "    var nx = p.x + opts[i][0], ny = p.y + opts[i][1];" +
    "    var run = 0;" +
    "    while (run < 5 && m.walk[(ny+opts[i][1]*run)*m.w + (nx+opts[i][0]*run)]) run++;" +
    "    if (run >= 3) return { key: opts[i][2], vk: opts[i][3], run: run };" +
    "  }" +
    "  return null;" +
    "})()");
  const hold = await ev("window.__peek()");
  let heldTurns = -1;
  if (openDir && canAct) {
    await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: openDir.key, code: openDir.key,
                                        windowsVirtualKeyCode: openDir.vk });
    for (let i = 0; i < 20; i++) {   /* OS 반복을 흉내 낸다 — 600ms 동안 20번 */
      await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: openDir.key, code: openDir.key,
                                          windowsVirtualKeyCode: openDir.vk, autoRepeat: true });
      await sleep(30);
    }
    await S("Input.dispatchKeyEvent", { type: "keyUp", key: openDir.key, code: openDir.key });
    await sleep(80);
    const hold2 = await ev("window.__peek()");
    heldTurns = hold2.turn - hold.turn;
  }

  //  기록이 눈에 들어오는가.
  //  ⚠ 판정이 화면 폭에 따라 **다르다**. 좁은 화면에서는 기록 패널을 아예 감췄고
  //    (사용자 지시) 대신 캔버스 위 토스트가 그 일을 한다 — 그쪽에서 패널을
  //    찾으면 "기록이 없다" 는 오진이 난다. 무엇으로 재는지를 화면이 정한다.
  const logBox = await ev(
    "(function(){" +
    "  var panel = document.querySelector('.logpanel');" +
    "  var shown = panel && getComputedStyle(panel).display !== 'none';" +
    "  var el = document.getElementById('log');" +
    "  var r = el.getBoundingClientRect();" +
    "  var lines = el.querySelectorAll('.m').length;" +
    "  var atBottom = Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 4;" +
    "  var toasts = window.__toasts ? window.__toasts() : -1;" +
    "  return { mode: shown ? 'panel' : 'toast'," +
    "           top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height)," +
    "           inView: shown ? (r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 40) : lines > 0," +
    "           lines: lines, atBottom: shown ? atBottom : true, toasts: toasts };" +
    "})()");
  // ── 4) 도움말이 열리고 닫히는가 ──
  //    ⚠ 헤더 버튼(소리·조작 패드·도움말)을 지웠으므로 **키**로 연다.
  //      버튼을 누르는 검사를 그대로 두면 "도움말이 없어졌다" 로 나온다.
  await S("Input.dispatchKeyEvent", { type: "keyDown", key: "?", code: "Slash", text: "?",
                                      windowsVirtualKeyCode: 191, modifiers: 8 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", key: "?", code: "Slash",
                                      windowsVirtualKeyCode: 191, modifiers: 8 });
  await sleep(60);
  const helpOpen = await ev(`!document.getElementById("help").hidden`);
  await ev(`document.getElementById("helpClose").click()`);
  const helpClosed = await ev(`document.getElementById("help").hidden`);
  //   없앤 버튼이 되살아나지 않았는지도 함께 본다(되살리면 헤더가 다시 터진다)
  const deadBtns = await ev(`["soundBtn","padBtn","helpBtn"].filter(id=>document.getElementById(id))`);

  // ── 4-b) 상단 상태줄 — 체력·경험이 **화면 맨 위**에 늘 보이는가 ──
  //    ⚠ 전에는 사이드바 안에만 있어서 좁은 화면에서는 스크롤해야 보였다.
  //      "있다" 가 아니라 **헤더 바로 아래에서, 화면 안에서** 보이는지를 잰다.
  const hud = await ev(`(()=>{
    const h = document.getElementById("hud");
    if (!h) return { missing: true };
    const r = h.getBoundingClientRect(), cs = getComputedStyle(h);
    const bars = [...h.querySelectorAll(".meter")].map(m => ({
      cls: m.className.replace("meter ",""),
      w: Math.round(m.getBoundingClientRect().width),
      fill: Math.round(parseFloat(m.querySelector("i").style.width) || 0),
      txt: (m.querySelector("b")||{}).textContent || ""
    }));
    const cv = document.getElementById("view").getBoundingClientRect();
    return { shown: cs.display !== "none", top: Math.round(r.top), h: Math.round(r.height),
             aboveCanvas: r.bottom <= cv.top + 1, inView: r.top >= 0 && r.bottom <= innerHeight + 1,
             bars, text: h.textContent.replace(/s+/g," ").trim().slice(0, 70) };
  })()`);

  // ── 5) 가로 넘침 ──
  const overflow = await ev(`(()=>{
    let bad=[];
    document.querySelectorAll("body *").forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width>0 && (r.right > innerWidth+1 || r.left < -1))
        bad.push((el.id||el.className||el.tagName)+" right="+Math.round(r.right));
    });
    return { docScroll: document.documentElement.scrollWidth > innerWidth,
             count: bad.length, sample: bad.slice(0,8) };
  })()`);

  // ── 출력 ──
  const ok = (b) => b ? "✔" : "✘";
  console.log("── 화면 점검 (" + VW + "×" + VH + ") ──");
  console.log("시작 화면    :", ok(startCheck.shown && startCheck.cards === 3 && startCheck.overflow === 0 && startCheck.hasSpace),
    "직업 카드 " + startCheck.cards + "개 · 조작 " + startCheck.guides + "줄(키 " + startCheck.keys + "개)" +
    " · 넘침 " + startCheck.overflow + (startCheck.fits ? "" : " · 카드 스크롤 있음"));
  console.log("직업 그림    :", ok(startCheck.art.every(a => a > 8)), "칠해진 픽셀 " + startCheck.art.join("% / ") + "%");
  console.log("콘솔 오류    :", errs.length === 0 ? "✔ 0 건" : "✘ " + errs.length + " 건");
  errs.slice(0, 6).forEach(e => console.log("               " + e));
  console.log("캔버스       :", ok(canvas.cssW > 300 && canvas.cssH > 200),
              canvas.cssW + "×" + canvas.cssH + " css · " + canvas.w + "×" + canvas.h + " 픽셀");
  console.log("그려진 픽셀  :", ok(canvas.litPct > 3), canvas.litPct + "% · 색 " + canvas.colors + "가지");
  console.log("키 입력      :", ok(moved && turned), (moved?"이동 ":"이동 안 함 ") + before.x+","+before.y+" → "+after.x+","+after.y + " · 턴 "+before.turn+" → "+after.turn);
  console.log("화면 갱신    :", ok(canvas2.hash !== canvas.hash), "픽셀 해시 " + (canvas2.hash!==canvas.hash ? "바뀜":"그대로(다시 안 그려짐)") + " · 밝은 픽셀 " + canvas.litPct + "% → " + canvas2.litPct + "%");
  console.log("도움말(? 키) :", ok(helpOpen && helpClosed && deadBtns.length === 0),
    (helpOpen ? "열림·닫힘 정상" : "안 열림") +
    (deadBtns.length ? " · ⚠지운 버튼이 남아 있다: " + deadBtns.join(",") : " · 헤더 버튼 없음(정상)"));
  console.log("상단 상태줄  :", ok(!hud.missing && hud.shown && hud.inView && hud.aboveCanvas &&
                                   hud.bars.length >= 2 && hud.bars.every(b => b.w > 60)),
    hud.missing ? "⚠ #hud 가 없다"
      : "y" + hud.top + " 높이 " + hud.h + "px · 막대 " +
        hud.bars.map(b => b.cls + " " + b.w + "px/" + b.fill + "%").join(" · ") +
        (hud.aboveCanvas ? " · 캔버스 위(정상)" : " · ⚠캔버스보다 아래") +
        (hud.inView ? "" : " · ⚠화면 밖"));
  console.log("  상태줄 내용:", hud.text || "(빈칸)");
  console.log("가로 넘침    :", ok(!overflow.docScroll && overflow.count === 0),
              overflow.count + " 개" + (overflow.docScroll ? " · 문서 가로 스크롤 있음" : ""));
  overflow.sample.forEach(s => console.log("               " + s));
  if (endCheck) {
    console.log("끝까지 진행  :", ok(endCheck.over && endCheck.shown),
      (endCheck.over ? "게임 종료됨" : "안 끝남") + " · " + (endCheck.shown ? "종료 화면 뜸" : "종료 화면 안 뜸") +
      " · " + endCheck.depth + "층 " + endCheck.turn + "턴");
    console.log("  제목       :", endCheck.title);
    console.log("  내용       :", endCheck.body);
    console.log("  최고 점수  :", endCheck.best);
  }
  // ── 5-b) 좁은 화면 레이아웃: 헤더가 한 줄인가 · 패널이 글자를 자르지 않는가 ──
  //    ⚠ 실측 390px 에서 헤더가 4줄로 터지고("새 게/임") 사이드바가 글자 한가운데를
  //      잘랐다. 스크린샷을 눈으로 보지 않으면 놓치는 종류라 수치로 못박는다.
  const layout = await ev(`(()=>{
    const h1 = document.querySelector(".top h1");
    const top = document.querySelector(".top");
    // 줄 수는 높이로 어림잡으면 안 된다 — 버튼 패딩이 섞여 한 줄도 두 줄로 나온다.
    // Range 의 클라이언트 사각형 개수가 곧 줄 상자 개수다.
    const lineCount = el => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; };
    const wrapped = [...document.querySelectorAll(".top h1, .top .ghost")]
      .filter(el => lineCount(el) > 1).map(el => el.textContent.trim() + "(" + lineCount(el) + "줄)");
    const side = document.querySelector(".side");
    /* ⚠ 스크롤하는 것은 .side 가 아니라 안쪽 .side-scroll 이다(기록 패널을 바닥에
     *   고정하면서 바뀌었다). 바깥을 보면 "스크롤 없음" 으로 나와 오진한다. */
    const scroller = document.querySelector(".side-scroll") || side;
    const sr = side.getBoundingClientRect();
    // 패널 경계가 글자를 자르는지: 사이드바 바닥에 걸친 패널이 있는가
    const cut = [...document.querySelectorAll(".side .panel")].filter(pl => {
      const r = pl.getBoundingClientRect();
      return r.top < sr.bottom - 4 && r.bottom > sr.bottom + 4;
    }).length;
    // 패널이 찌그러져 자식이 밖으로 새어 나와 겹치는지 — 이게 진짜로 났던 결함이다.
    // (flex 항목 기본값이 줄어드는 것이라 상자만 작아지고 내용은 그대로 그려진다)
    /* ⚠ 스크롤 영역 안의 요소는 컨테이너 밖으로 나간 부분이 **잘려서** 안 보인다.
     *   그걸 겹침으로 세면 오탐이다(실측: inv ↔ log 가 그렇게 빨개졌다).
     *   그래서 같은 스크롤 컨테이너 안에서만, 그리고 보이는 범위로 잘라서 비교한다. */
    function clipOf(e) {
      let n2 = e.parentElement;
      while (n2 && n2 !== document.body) {
        const ov = getComputedStyle(n2).overflowY;
        if (ov === "auto" || ov === "scroll" || ov === "hidden") return n2;
        n2 = n2.parentElement;
      }
      return null;
    }
    const blocks = [...document.querySelectorAll(".side .stats, .side .stat-grid, .side .equip, .side .inv, .side .log, .side h2")]
      .map(e => ({ n: (e.className||e.tagName)+"", r: e.getBoundingClientRect(), clip: clipOf(e) }))
      .filter(b => {
        if (b.r.height <= 0) return false;
        if (!b.clip) return true;
        const cr = b.clip.getBoundingClientRect();
        return b.r.bottom > cr.top && b.r.top < cr.bottom;   /* 잘려 안 보이는 것은 뺀다 */
      });
    const laps = [];
    for (let i=0;i<blocks.length;i++) for (let j=i+1;j<blocks.length;j++) {
      const a=blocks[i].r, b=blocks[j].r;
      if (blocks[i].clip !== blocks[j].clip) continue;   /* 다른 스크롤 영역끼리는 비교하지 않는다 */
      if (a.top < b.top && a.bottom > b.top + 2 && !(a.top <= b.top && a.bottom >= b.bottom))
        laps.push(blocks[i].n + " ↔ " + blocks[j].n);
    }
    const spill = [...document.querySelectorAll(".side .panel")].filter(pl => {
      const pr = pl.getBoundingClientRect();
      if (getComputedStyle(pl).overflowY !== "visible") return false;
      return [...pl.children].some(c => c.getBoundingClientRect().bottom > pr.bottom + 2);
    }).map(pl => pl.className);
    const cv = document.getElementById("view").getBoundingClientRect();
    return { topH: Math.round(top.getBoundingClientRect().height), wrapped,
             sideH: Math.round(sr.height),
             sideScroll: scroller.scrollHeight > scroller.clientHeight + 1,
             cut, canvasH: Math.round(cv.height), laps: laps.slice(0,4), spill,
             pageOverflowY: document.documentElement.scrollHeight > innerHeight + 1 };
  })()`);
  console.log("헤더 한 줄   :", ok(layout.wrapped.length === 0), "높이 " + layout.topH + "px" + (layout.wrapped.length ? " · 줄바꿈: " + layout.wrapped.join(" / ") : ""));
  // 스크롤되는 사이드바가 경계에서 패널을 자르는 것은 정상이다 — 손이 닿는다.
  // 스크롤이 없는데 잘렸다면 그건 영영 못 보는 내용이다.
  console.log("사이드바     :", ok(layout.cut === 0 || layout.sideScroll), "높이 " + layout.sideH + "px · 경계에 걸린 패널 " + layout.cut + "개" + (layout.sideScroll ? " · 스크롤 있음(정상)" : " · 스크롤 없음"));
  console.log("패널 겹침    :", ok(layout.laps.length === 0 && layout.spill.length === 0),
    layout.laps.length || layout.spill.length
      ? (layout.laps.length ? "겹침 " + layout.laps.join(", ") : "") + (layout.spill.length ? " · 내용이 패널 밖으로: " + layout.spill.join(", ") : "")
      : "없음");
  console.log("세로 넘침    :", ok(!layout.pageOverflowY), layout.pageOverflowY ? "페이지가 화면보다 길다" : "없음");
  if (TOUCH) {
    const pad = await ev(`(()=>{
      const p=document.querySelector(".pad");
      const btns=[...document.querySelectorAll(".pad button")];
      const cs=getComputedStyle(p);
      const small=btns.filter(b=>{const r=b.getBoundingClientRect();return r.width<40||r.height<40;});
      /* 배치 — 사용자가 자리까지 지정했다(십자 맨 왼쪽 · 행동 한 줄 · 그 아래 QWER).
       * "버튼이 있다" 로는 이걸 못 잡는다. 사각형을 재서 줄과 좌우를 확인한다. */
      const box = e => e.getBoundingClientRect();
      const dp = box(document.querySelector(".dpad"));
      const ac = box(document.querySelector(".acts:not(.skillpad)"));
      const sk = box(document.querySelector(".skillpad"));
      const rowOf = list => {
        const ys = list.map(e => Math.round(box(e).top));
        return new Set(ys).size;                    /* 한 줄이면 1 */
      };
      return { display:cs.display, count:btns.length, tooSmall:small.length, touchClass:document.body.classList.contains("is-touch"),
               minSide: btns.length?Math.round(Math.min(...btns.map(b=>Math.min(box(b).width,box(b).height)))):0,
               narrow: innerWidth <= 620,
               dpadLeftmost: dp.left <= ac.left + 1 && dp.left <= sk.left + 1,
               actsRows: rowOf([...document.querySelectorAll(".acts:not(.skillpad) button")]),
               skillRows: rowOf([...document.querySelectorAll(".skillpad button")]),
               skillsBelowActs: sk.top >= ac.bottom - 2,
               dpadSpansBoth: dp.top <= ac.top + 2 && dp.bottom >= sk.bottom - 2,
               geo: "십자 x"+Math.round(dp.left)+"~"+Math.round(dp.right)+
                    " · 행동 y"+Math.round(ac.top)+" · 스킬 y"+Math.round(sk.top) };
    })()`);
    /* 좁은 화면에서만 격자 배치를 요구한다 — 넓은 터치 화면은 한 줄이 정상이다 */
    const padPlaced = !pad.narrow ||
      (pad.dpadLeftmost && pad.actsRows === 1 && pad.skillRows === 1 &&
       pad.skillsBelowActs && pad.dpadSpansBoth);
    console.log("터치 패드    :", ok(pad.display!=="none" && pad.count>=8 && pad.tooSmall===0 && padPlaced),
      "display="+pad.display+" · 버튼 "+pad.count+"개 · 가장 작은 변 "+pad.minSide+"px" + (pad.tooSmall?" · 40px 미만 "+pad.tooSmall+"개":""));
    console.log("  패드 배치  :", ok(padPlaced), pad.narrow
      ? pad.geo + " · 행동 " + pad.actsRows + "줄 · 스킬 " + pad.skillRows + "줄" +
        (pad.dpadLeftmost ? " · 십자 맨 왼쪽" : " · ⚠십자가 왼쪽이 아니다") +
        (pad.skillsBelowActs ? " · 스킬이 행동 아래" : " · ⚠스킬이 행동 아래가 아니다")
      : "넓은 화면 — 한 줄 배치(정상) · " + pad.geo);
  }
  const abilityWorks = (feat.btnText !== "(없음)") &&
    (feat2.cd > 0 ? feat2.disabled === true : /준비|없다|닿는/.test(feat2.log) || feat2.disabled === false);
  console.log("직업 능력    :", ok(abilityWorks), feat.btnText + " → " +
    (feat2.cd > 0 ? "쿨 " + feat2.cd + "턴 · 버튼 " + (feat2.disabled ? "잠김" : "안 잠김") : "거절(닿는 적 없음)"));
  console.log("함정·보물방  :", ok(true), "이 층 함정 " + feat.traps + "개 · 보물방 " + (feat.treasure ? "있음" : "없음"));
  console.log("미식별 물약  :", ok(potions.looks.length >= potions.names.length),
    "물약 " + potions.names.length + "종 · 겉모습 후보 " + potions.looks.length + "개");
  console.log("대각선 제거  :", ok(oldKeysDead && noDiagButtons),
    (oldKeysDead ? "YUBN·WASD·HJKL 무반응" : "⚠ 옛 키가 아직 움직인다") +
    " · 패드 방향 " + padDirs.length + "개" + (noDiagButtons ? "(대각 없음)" : " ⚠대각 남음"));
  console.log("우클릭 버리기:", ok(dropTest.skipped ? true : (dropTest.prevented && dropTest.after < dropTest.before)),
    dropTest.skipped ? "가방이 비어 검사 못 함"
      : "가방 " + dropTest.before + " → " + dropTest.after + " · 기본메뉴 " +
        (dropTest.prevented ? "막음" : "⚠안 막음") + " · \"" + dropTest.log.trim() + "\"");
  if (zoomCheck) {
    const noZoom = Math.abs(zoomCheck.scale1 - zoomCheck.scale0) < 0.01 && zoomCheck.ta === "manipulation";
    const moved6 = zoomCheck.turn1 > zoomCheck.turn0;
    console.log("연타 확대    :", ok(noZoom && moved6),
      "touch-action=" + zoomCheck.ta + " · 배율 " + zoomCheck.scale0 + " → " + zoomCheck.scale1 +
      " · 8번 눌러 턴 " + zoomCheck.turn0 + " → " + zoomCheck.turn1);
  }
  console.log("스킬 4칸     :", ok(build.skillRows === 4 && build.skills >= 1),
    "칸 " + build.skillRows + "개 · 배운 것 " + build.skills + "개 · 준비됨 " + build.ready + "개");
  console.log("치명타·장비  :", ok(build.crit > 0 && !!build.weapon),
    "치명 " + Math.round(build.crit * 100) + "% · 무기 \"" + build.weapon + "\" (" + build.rarity + ")" +
    " · 가방 색칠 " + build.invColored + "개");
  console.log("금화 표시    :", ok(build.gold !== "(없음)"), build.gold);
  //  600ms 동안 OS 반복 20번 → 걸음 간격(115ms)이면 5~7걸음이 정상이다.
  console.log("누르고 걷기  :", ok(!canAct || (heldTurns >= 2 && heldTurns <= 9)),
    heldTurns < 0 ? "열린 방향을 못 찾아 검사 못 함"
      : "600ms 에 " + heldTurns + "걸음 (OS 반복 20번을 그대로 받으면 20걸음)");
  console.log("기록 가시성  :", ok(logBox.inView && logBox.atBottom),
    logBox.mode === "panel"
      ? "패널 y" + logBox.top + "~" + logBox.bottom + " (높이 " + logBox.h + ") · " +
        logBox.lines + "줄 · 맨 아래로 " + (logBox.atBottom ? "따라감" : "⚠안 따라감") +
        (logBox.inView ? "" : " · ⚠화면 밖")
      : "좁은 화면 — 패널 없음(정상) · 캔버스 토스트로 띄운다 · 쌓인 기록 " +
        logBox.lines + "줄" + (logBox.inView ? "" : " · ⚠기록이 비었다"));
  console.log("상태창       :", ui.stats);
  console.log("마지막 기록  :", ui.lastLog);

  if (SHOT) {
    const { data } = await S("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(SHOT, Buffer.from(data, "base64"));
    console.log("스크린샷     :", SHOT);
  }

  const pass = errs.length === 0 && canvas.litPct > 3 && moved && turned && canvas2.hash !== canvas.hash &&
               !overflow.docScroll && overflow.count === 0 && helpOpen && helpClosed &&
               (!zoomCheck || (Math.abs(zoomCheck.scale1 - zoomCheck.scale0) < 0.01 && zoomCheck.ta === "manipulation" && zoomCheck.turn1 > zoomCheck.turn0)) &&
               (!canAct || (heldTurns >= 2 && heldTurns <= 9)) && logBox.inView && logBox.atBottom &&
               oldKeysDead && noDiagButtons &&
               (dropTest.skipped || (dropTest.prevented && dropTest.after < dropTest.before)) &&
               build.skillRows === 4 && build.skills >= 1 && build.crit > 0 && !!build.weapon &&
               build.gold !== "(없음)" &&
               potions.looks.length >= potions.names.length &&
               startCheck.shown && startCheck.cards === 3 && startCheck.overflow === 0 && startCheck.hasSpace &&
               startCheck.art.every(a => a > 8) &&
               layout.wrapped.length === 0 && (layout.cut === 0 || layout.sideScroll) && !layout.pageOverflowY &&
               layout.laps.length === 0 && layout.spill.length === 0 &&
               (!endCheck || (endCheck.over && endCheck.shown));
  ws.close(); ch.kill(); srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(pass ? "\n결과: 통과" : "\n결과: 확인 필요");
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
