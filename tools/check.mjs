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
import { CHROME } from "./chrome.mjs";   /* 경로는 한 곳에서만 정한다 */

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
  let endCheck = null, stuckWhy = "";
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
    let depthSeen = st.depth, lastTurn = st.turn, stuckFor = 0;
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
      /* ⚠ **제단도 닫아야 한다.** 열려 있으면 busy() 가 모든 행동을 막는다.
       *   상점·레벨업만 닫고 있어서, 제단을 밟은 판은 4000번을 헛돌고
       *   "안 끝남" 으로 빨개졌다(여섯 번에 한 번꼴). 제품이 아니라 이
       *   고리가 제단을 모르고 있었던 것이다. */
      if (st.altarOpen) { await ev("window.__closeAltar && window.__closeAltar()"); st = await ev(`window.__peek()`); }
      if (st.depth !== depthSeen) { map = await ev(`window.__map()`); depthSeen = st.depth; }
      /* ⚠ 갇혔는지 본다. 턴이 안 오르는 채로 계속 돌면 원인을 말해 줘야 한다 —
       *   "안 끝남" 만 보면 어디가 막혔는지 알 길이 없다. */
      if (i > 60 && st.turn === lastTurn) stuckFor++; else { stuckFor = 0; lastTurn = st.turn; }
      if (stuckFor > 80) { stuckWhy = "턴이 " + st.turn + "에서 안 오른다 · " +
        "상점" + (st.shopOpen ? "열림" : "닫힘") + " 레벨업" + (st.perkOpen ? "열림" : "닫힘") +
        " 제단" + (st.altarOpen ? "열림" : "닫힘") + " · " + st.x + "," + st.y; break; }
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
    return { cdBefore: before.cooldown, logLen: document.querySelectorAll("#log .m").length,
             btnReady: btn ? !btn.disabled : null,
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
    return { cd: st.cooldown, logLen: document.querySelectorAll("#log .m").length,
             disabled: btn ? btn.disabled : null,
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
    /* ⚠ 스킬 칸은 사이드바(`.skills .skill`)가 아니라 **화면 아래 퀵슬롯**이다.
     *   선택자가 검사 안에 박혀 있으면 제품이 옮겨갔을 때 조용히 0을 센다. */
    "  var skillRows = document.querySelectorAll('.quick .qs').length;" +
    "  var ready = document.querySelectorAll('.quick .qs.ready').length;" +
    "  var invColored = [...document.querySelectorAll('.inv-item .nm')]" +
    "     .filter(function(e){ return e.style.color; }).length;" +
    /* ⚠ 금화를 `.who-gold` 에서 읽고 있었는데 그 줄을 감췄다. 감춰도
     *   textContent 는 그대로 나오므로 **검사는 조용히 통과한다** — 아무도 못
     *   보는 값을 재게 된다. 상단 상태줄에서 읽고, 눈에 보이는지까지 본다. */
    "  var gEl = document.querySelector('.hud-num .g');" +
    "  var gold = (gEl && gEl.checkVisibility && gEl.checkVisibility()) ? gEl : null;" +
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

  //  둥근 조작 패드가 **여덟 방향을 다 주는가**.
  //  ⚠ 예전에는 "대각선 버튼이 남아 있지 않은가" 를 봤다. 4방향이던 시절의
  //    전제다 — 지금은 8방향이 요구사항이라 그 검사는 거꾸로다.
  //    제품이 아니라 검사를 고친다.
  //  ⚠ 원판 가운데는 **죽은 구역**이어야 한다. 없으면 손가락을 올리는 순간
  //    방향을 정하기도 전에 한 칸이 튀어 나간다.
  const stick8 = await ev(`(()=>{
    const el = document.getElementById("stick");
    if (!el || !window.__stickDir) return null;
    /* ⚠ 패드는 터치 기기에서만 뜬다. 안 보이는데 재면 크기가 0 이라
     *   "방향이 하나뿐" 으로 나온다 — 잰 자리가 틀린 것이다. */
    if (el.getBoundingClientRect().width < 10) return { hidden: true };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const R = r.width * 0.42;
    const got = [];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const d = window.__stickDir(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      if (d) got.push(d.dx + "," + d.dy);
    }
    return { dirs: [...new Set(got)], center: window.__stickDir(cx, cy),
             size: Math.round(r.width) };
  })()`);
  const stickOk = !!stick8 && (stick8.hidden === true ||
                  (stick8.dirs.length === 8 && stick8.center === null));
  // ── 3-e) 모바일 연타 확대 — 방향 버튼을 빠르게 두 번 눌러도 배율이 안 변해야 한다 ──
  //    ⚠ 실제 신고: "방향키 연속으로 누르면 확대가 되고 있어서 이동하는데 불편해".
  //      touch-action 을 안 걸면 브라우저가 더블탭으로 보고 확대한다.
  let zoomCheck = null;
  /* ⚠ 확대 판정을 **출력과 최종 판정 두 곳에** 적어 두었더니 한쪽만 고쳐져
   *   화면에는 ✔ 인데 결과는 "확인 필요" 가 나왔다(원판의 touch-action 이
   *   manipulation → none 으로 바뀐 자리다). 한 변수로 묶어 다시 갈라지지 않게 한다. */
  let noZoomOK = true;
  if (TOUCH) {
    const before = await ev(
      "({ scale: window.visualViewport ? window.visualViewport.scale : 1," +
      "   ta: getComputedStyle(document.getElementById('stick')).touchAction })");
    /* ⚠ 한 방향만 두드리면 안 된다 — 그쪽이 벽이면 턴이 안 늘어 "터치가 안 먹는다" 로
     *   오진한다(실제로 그렇게 나왔다). 원판의 네 방향을 돌려 가며 두드린다. */
    const btns = await ev(
      "(function(){" +
      "  var r = document.getElementById('stick').getBoundingClientRect();" +
      "  var cx = r.left + r.width/2, cy = r.top + r.height/2, R = r.width*0.4;" +
      "  return [[1,0],[0,1],[-1,0],[0,-1]].map(function(d){" +
      "    return { x: Math.round(cx + d[0]*R), y: Math.round(cy + d[1]*R) }; });" +
      "})()");
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

  // ── 3-h) 칸을 눌러 걸어가기 ──
  //    ⚠ "눌러서 움직인다" 만 재면 안 된다. 자동으로 걷는 것은 **멈추는 조건이
  //      맞아야** 쓸 수 있는 기능이다 — 안 멈추면 걸어가다 맞아 죽는다.
  //      그래서 셋을 따로 잰다: ① 여러 칸을 실제로 걸었나 ② 목적지에 닿았나
  //      ③ 걷는 중에 키를 누르면 멈추나.
  //    ⚠ 목적지는 **지도를 읽어 이미 본 칸(seen)** 중에서 고른다. 안 본 칸을
  //      누르면 길을 모르는 것이 정상이라 "안 걷는다" 로 오진한다.
  let tapCheck = null;
  if (canAct) {
    const far = await ev(
      "(function(){" +
      "  var m = window.__map(), p = window.__peek();" +
      "  var best = null, bd = 0;" +
      "  for (var y = 0; y < m.h; y++) for (var x = 0; x < m.w; x++) {" +
      "    var i = y * m.w + x;" +
      "    if (!m.walk[i] || !m.seen[i]) continue;" +
      "    var d = Math.abs(x - p.x) + Math.abs(y - p.y);" +
      "    if (d > bd) { bd = d; best = { x: x, y: y, d: d }; }" +
      "  }" +
      "  return best;" +
      "})()");
    if (far && far.d >= 3) {
      const t0 = await ev("window.__peek()");
      /* 누르기 **직전**에 길이 있는지 본다. 누른 뒤에 보면 이미 움직여서 달라진다. */
      const pathLen = await ev(`window.__pathLen(${far.x}, ${far.y})`);
      await ev(`window.__tap(${far.x}, ${far.y})`);
      await sleep(140);
      const midTravel = await ev("window.__travel()");     /* 걷는 중이어야 한다 */
      await sleep(900);
      const t1 = await ev("window.__peek()");
      /* 걷는 중에 키를 누르면 멈추는가 — 멈춘 뒤에는 __travel() 이 null 이다 */
      await ev(`window.__tap(${far.x}, ${far.y})`);
      await sleep(120);
      const beforeKey = await ev("window.__travel()");
      await S("Input.dispatchKeyEvent", { type: "rawKeyDown", key: ".", code: "Period",
                                          windowsVirtualKeyCode: 190 });
      await S("Input.dispatchKeyEvent", { type: "keyUp", key: ".", code: "Period" });
      await sleep(120);
      const afterKey = await ev("window.__travel()");
      /* 좌표 변환을 **검사가 직접 뒤집어** 확인한다. 어떤 칸의 화면 좌표를
       * 카메라로 계산해 그 점을 눌러 보고, 같은 칸이 나오는지 본다.
       * ⚠ devicePixelRatio 를 잘못 쓰면(캔버스 실제 픽셀 ≠ CSS 픽셀) 2배 어긋나는데
       *   눈으로는 "엉뚱한 데로 걸어간다" 로만 나타난다. */
      const center = await ev(
        "(function(){" +
        "  var cam = window.__cam(), T = cam.tile, Z = cam.zoom || 1;" +
        "  var box = document.getElementById('view').getBoundingClientRect();" +
        "  var p = window.__peek();" +
        /* ⚠ 확대배를 곱한다. 빼먹으면 2배에서 누르는 자리가 절반으로 들어가
         *   엉뚱한 칸이 찍히는데, 검사는 "안 걸어갔다" 로만 말한다. */
        "  var px = box.left + ((p.x * T + T / 2) - cam.x) * Z;" +
        "  var py = box.top  + ((p.y * T + T / 2) - cam.y) * Z;" +
        "  var got = window.__tapAtPoint(px, py);" +
        "  return { ok: !!got && got.x === p.x && got.y === p.y," +
        "           want: p.x + ',' + p.y, got: got ? got.x + ',' + got.y : 'null' };" +
        "})()");
      /* ── 안전 규칙: 못 보던 적이 눈에 들어오면 멈춘다 ──
       * ⚠ 이게 안 되면 걸어가다 맞아 죽는다. 자동 이동에서 제일 중요한 규칙인데
       *   "걸었다" 만 재면 통과해 버린다. 적을 심어 직접 확인한다. */
      let stopOnMonster = null;
      const t2 = await ev("window.__peek()");
      if (!t2.over) {
        const far2 = await ev(
          "(function(){" +
          "  var m = window.__map(), p = window.__peek(), best = null, bd = 0;" +
          "  for (var y = 0; y < m.h; y++) for (var x = 0; x < m.w; x++) {" +
          "    var i = y * m.w + x;" +
          "    if (!m.walk[i] || !m.seen[i]) continue;" +
          "    var d = Math.abs(x - p.x) + Math.abs(y - p.y);" +
          "    if (d > bd) { bd = d; best = { x: x, y: y, d: d }; }" +
          "  }" +
          "  return best;" +
          "})()");
        if (far2 && far2.d >= 4) {
          await ev(`window.__tap(${far2.x}, ${far2.y})`);
          await sleep(130);
          const walking = await ev("window.__travel()");
          const put = await ev(`window.__putMonster("rat")`);
          await sleep(320);                      /* 걸음 두 번 — 그 사이에 멈춰야 한다 */
          const after = await ev("window.__travel()");
          stopOnMonster = { set: !!walking, put: put, stopped: !!walking && !!put && !after };
          await ev("window.__tap(" + t2.x + "," + t2.y + ")");   /* 남은 이동 정리 */
        }
      }

      tapCheck = {
        goal: far, started: !!midTravel, stopOnMonster: stopOnMonster, moved: Math.abs(t1.x - t0.x) + Math.abs(t1.y - t0.y),
        turns: t1.turn - t0.turn,
        foes: t0.foes, hp0: t0.hp, hp1: t1.hp,
        seen0: t0.foesSeen, seen1: t1.foesSeen, pathLen: pathLen,
        stoppedByKey: !!beforeKey && !afterKey,
        hadTravel: !!beforeKey, center: center.ok, centerWant: center.want, centerGot: center.got
      };
    }
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

  // ── 4-c) 체력·경험 막대 ──
  //    ⚠ 셋을 함께 본다. 하나라도 어긋나면 **화면에서는 멀쩡해 보인다**:
  //      ① 칸 눈금이 없는가 — 장부 느낌을 내려고 세로줄을 얹었다가 막대가
  //         칸으로 쪼개져 "피가 닳는 느낌" 이 사라졌다(사용자 지적).
  //      ② 숫자가 퍼센트인가 — 0~100 으로 읽혀야 한다(사용자 지시).
  //      ③ 정확한 값이 닿는가 — 퍼센트만 남으면 "12 남았다" 를 알 수 없다.
  //         손을 얹거나 누르면 44 / 62 가 나와야 하고 title 에도 있어야 한다.
  const bars = await ev(`(()=>{
    const out = [];
    document.querySelectorAll(".hud .meter").forEach(m => {
      const fill = m.querySelector("i");
      const num  = m.querySelector("b");
      const det  = m.querySelector(".meter-detail");
      /* 눈금은 ::after 로 깔렸었다 — 그 가짜 요소의 배경을 직접 본다 */
      const after = getComputedStyle(m, "::after").backgroundImage;
      const detHidden = det ? parseFloat(getComputedStyle(det).opacity) < 0.5 : null;
      /* ⚠ opacity 에 .12s 전환이 걸려 있다. 켜자마자 읽으면 **옛 값**이 나온다
       *   (실제로 "상세값 안 뜸" 으로 잘못 나왔다). 전환을 끄고 잰다. */
      if (det) det.style.transition = "none";
      m.classList.add("show");
      const detShown = det ? parseFloat(getComputedStyle(det).opacity) > 0.5 : null;
      m.classList.remove("show");
      if (det) det.style.transition = "";
      out.push({
        cls: m.className.replace("meter ", "").replace(" show", ""),
        ticks: /repeating-linear-gradient/.test(after),
        width: fill ? fill.style.width : "",
        num: num ? num.textContent.trim() : "",
        /* \d 가 두 겹인 이유: 이 문자열은 템플릿 리터럴을 거쳐 브라우저로 간다 */
        pct: num ? /^\\d+%$/.test(num.textContent.replace(/\\s+/g, "")) : false,
        title: m.getAttribute("title") || "",
        detail: det ? det.textContent.trim() : "",
        detHidden: detHidden, detShown: detShown
      });
    });
    return out;
  })()`);
  const barsOk = bars.length >= 2 &&
    bars.every(b => !b.ticks && b.pct && /\d+ \/ \d+/.test(b.detail) &&
                    b.detHidden === true && b.detShown === true && /\d/.test(b.title));

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
  console.log("체력·경험 막대:", ok(barsOk),
    bars.length ? bars.map(b => b.cls + " " + b.num + "(" + b.width + ")" +
      (b.ticks ? " ⚠칸 눈금 있음" : "") +
      (b.pct ? "" : " ⚠퍼센트 아님") +
      (b.detShown ? "" : " ⚠상세값 안 뜸")).join(" · ") : "⚠ 막대가 없다");
  if (bars.length) console.log("  상세값     :", bars.map(b => b.detail).join(" · "));
  console.log("가로 넘침    :", ok(!overflow.docScroll && overflow.count === 0),
              overflow.count + " 개" + (overflow.docScroll ? " · 문서 가로 스크롤 있음" : ""));
  overflow.sample.forEach(s => console.log("               " + s));
  if (endCheck) {
    if (stuckWhy) console.log("  갇힌 이유   :", stuckWhy);
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
  let padPass = true;
  if (TOUCH) {
    const pad = await ev(`(()=>{
      const p=document.querySelector(".pad");
      const btns=[...document.querySelectorAll(".pad button")];
      const cs=getComputedStyle(p);
      const small=btns.filter(b=>{const r=b.getBoundingClientRect();return r.width<40||r.height<40;});
      /* 배치 — **양손 엄지**다. 왼쪽 끝에 십자, 오른쪽 끝에 둥근 묶음.
       * "버튼이 있다" 로는 이걸 못 잡는다. 사각형을 재서 자리를 본다.
       * ⚠ .acts (줍기·쏘기·내려가기 셋)를 여기서 재고 있었다. 가운데
       *   통합 행동 하나로 합쳤으므로 그 선택자는 이제 없다. */
      const box = e => e.getBoundingClientRect();
      const st = document.getElementById("stick");
      const dp = box(document.querySelector(".dpad"));
      const rg = document.querySelector(".ring") ? box(document.querySelector(".ring")) : null;
      const pb = box(p);
      const act = document.querySelector("#btnAct");
      return { display:cs.display, count:btns.length, tooSmall:small.length, touchClass:document.body.classList.contains("is-touch"),
               hasStick: !!st,
               stickSize: st ? Math.round(box(st).width) : 0,
               minSide: btns.length?Math.round(Math.min(...btns.map(b=>Math.min(box(b).width,box(b).height)))):0,
               narrow: innerWidth <= 620,
               hasRing: !!rg,
               /* 십자는 왼쪽 끝, 묶음은 오른쪽 끝에 붙어 있는가 */
               leftEdge: rg ? Math.round(dp.left - pb.left) : -1,
               rightEdge: rg ? Math.round(pb.right - rg.right) : -1,
               apart: rg ? Math.round(rg.left - dp.right) : -1,
               /* 둘이 같은 높이에 있는가 — 한쪽이 위로 뜨면 엄지가 달라진다 */
               level: rg ? Math.abs(Math.round(dp.top - rg.top)) : -1,
               /* 가운데 행동이 지금 무엇을 하겠다고 말하는가 */
               actLabel: act ? (act.textContent || "").replace(/\s+/g, " ").trim() : "",
               actKind: act ? act.getAttribute("data-act") : "",
               geo: "십자 x"+Math.round(dp.left)+"~"+Math.round(dp.right)+
                    (rg ? " · 묶음 x"+Math.round(rg.left)+"~"+Math.round(rg.right) : "") };
    })()`);
    /* ⚠ 엄지가 닿으려면 **화면 끝에** 붙어야 한다. 가운데로 모으면 넓은
     *   화면에서 둘이 한 덩어리가 된다. 24px 는 패딩 여유다. */
    const padPlaced = pad.hasRing && pad.leftEdge >= 0 && pad.leftEdge <= 24 &&
                      pad.rightEdge >= 0 && pad.rightEdge <= 24 &&
                      pad.apart > 20 && pad.level <= 4;
    /* ⚠ 예전에는 **버튼 개수**(8개 이상)를 셌다. 십자가 버튼 다섯이던 시절의
     *   수다 — 원판은 <div> 하나라 버튼이 셋으로 줄면서 이 검사가 빨개졌다.
     *   제품이 아니라 검사의 전제가 낡은 것이었다. 세어야 할 것은 옛 모양이 아니라
     *   **있어야 할 것**이다: 원판이 있고 · 충분히 크고 · 버튼이 손가락에 맞는가.
     * ⚠ 원판은 100px 아래로 내려가면 여덟 방향을 손가락으로 가를 수 없다. */
    const padOK = pad.display !== "none" && pad.hasStick && pad.stickSize >= 100 &&
                  pad.tooSmall === 0 && padPlaced;
    console.log("터치 패드    :", ok(padOK),
      "display="+pad.display+" · 원판 "+(pad.hasStick?pad.stickSize+"px":"⚠없음")+
      " · 버튼 "+pad.count+"개 · 가장 작은 변 "+pad.minSide+"px" +
      (pad.tooSmall?" · 40px 미만 "+pad.tooSmall+"개":""));
    padPass = padOK;
    console.log("  패드 배치  :", ok(padPlaced),
      pad.geo + " · 왼끝에서 " + pad.leftEdge + "px · 오른끝에서 " + pad.rightEdge +
      "px · 사이 " + pad.apart + "px · 높이차 " + pad.level + "px" +
      (pad.hasRing ? "" : " · ⚠오른손 묶음이 없다"));
    /* 가운데 버튼이 **상태를 따라가는가.**
     *
     * ⚠ "버튼이 있다" 는 통과가 아니다. 글자가 「줍기」에 붙박여 있어도
     *   그건 통과한다. 세 상태를 실제로 만들어 보고 글자와 data-act 가
     *   따라오는지 본다.
     * ⚠ 순서가 핵심이다. **계단 위에 물건이 있으면 먼저 줍는다**(README 의
     *   Space 규칙). 계단 위에 서서 물건을 떨궈 놓고, 「줍기」가 나와야 한다 —
     *   「내려가기」가 나오면 그 물건을 영영 못 줍는 길이 열린 것이다.
     * ⚠ 쏘기는 활이 있어야 나온다. __arena 로 활을 쥐어 주고 적을 붙인다. */
    const act3 = await (async () => {
      const read = () => ev(`(function(){
        var b = document.querySelector("#btnAct");
        if (!b) return { kind: "", label: "" };
        return { kind: b.getAttribute("data-act") || "",
                 label: (b.textContent || "").replace(/\s+/g, " ").trim() };
      })()`);
      const out = {};
      /* ① 활도 물건도 계단도 없는 맨바닥 */
      await ev("window.__clearMonsters && window.__clearMonsters()");
      out.plain = await read();
      /* ② 활 + 붙은 적 → 쏘기 */
      await ev(`window.__arena({ mon: "rat", weapon: "bow", hp: 50 })`);
      await sleep(220);
      out.bow = await read();
      /* ③ 계단 위 → 내려가기 */
      await ev(`(function(){ var p = window.__peek(); window.__place && window.__place(p.stairs.x, p.stairs.y); })()`);
      await sleep(220);
      out.stairs = await read();
      return out;
    })();
    const actOK = act3.plain.kind === "pick" &&
                  act3.bow.kind === "shoot" &&
                  act3.stairs.kind === "down";
    console.log("  통합 행동  :", ok(!!pad.actKind && actOK),
      "맨바닥 「" + act3.plain.label + "」 · 활+적 「" + act3.bow.label +
      "」 · 계단 「" + act3.stairs.label + "」" +
      (actOK ? "" : " · ⚠상태를 안 따라간다"));
    if (!pad.actKind || !actOK) padPass = false;
  }

  /* ── 퀵슬롯이 **제자리에 있는가** ──────────────────────
   *
   * "칸이 넷 있다" 로는 부족하다. 캔버스 위에 떠 있는 띠라서 넘치거나
   * 캔버스 밖으로 나가도 DOM 에는 멀쩡히 넷이다.
   *
   * ⚠ `.click()` 으로 판정하지 않는다. 잘린 요소에도 먹는다. 칸 한가운데
   *   좌표를 **누가 받는지**(elementFromPoint) 본다.
   * ⚠ 뷰포트(캔버스가 든 칸) 기준으로 잰다. 화면 기준으로 재면 사이드바가
   *   덮고 있어도 통과한다. */
  const qk = await ev(`(()=>{
    const q = document.querySelector(".quick");
    if (!q) return { n: 0, why: "#quick 이 없다" };
    const vp = document.querySelector(".viewport").getBoundingClientRect();
    const cells = [...q.querySelectorAll(".qs")];
    const bs = cells.map(c => c.getBoundingClientRect());
    const rows = new Set(bs.map(b => Math.round(b.top))).size;
    /* 칸 한가운데를 그 칸이 받는가 — 덮였거나 잘리면 다른 것이 잡힌다.
     *
     * ⚠ **찬 칸만 센다.** 빈 칸은 pointer-events:none 이라 좌표가 지도로
     *   내려가야 정상이다. 처음에 넷 다 받아야 한다고 썼다가 빨개졌는데
     *   틀린 쪽은 제품이 아니라 이 전제였다 — 빈 칸이 지도 클릭을 삼키면
     *   캔버스 아래 가운데를 눌러 걸어갈 수가 없다.
     * ⚠ 그래서 빈 칸은 **반대로** 잰다. 삼키면 안 된다. */
    let owned = 0, filled = 0, swallow = 0;
    for (let i = 0; i < cells.length; i++) {
      const b = bs[i];
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const mine = hit && (hit === cells[i] || cells[i].contains(hit));
      if (cells[i].classList.contains("empty")) { if (mine) swallow++; }
      else { filled++; if (mine) owned++; }
    }
    const qb = q.getBoundingClientRect();
    return {
      n: cells.length, rows: rows, owned: owned, filled: filled, swallow: swallow,
      inside: qb.left >= vp.left - 1 && qb.right <= vp.right + 1 &&
              qb.bottom <= vp.bottom + 1 && qb.top >= vp.top - 1,
      centered: Math.abs((qb.left + qb.right) / 2 - (vp.left + vp.right) / 2) <= 2,
      minSide: bs.length ? Math.round(Math.min(...bs.map(b => Math.min(b.width, b.height)))) : 0,
      /* 단축키 글자와 이름이 **정말 그려졌는가.** 빈 칸이면 이름이 '빈 자리' 다 */
      keys: cells.map(c => (c.querySelector(".k") || {}).textContent || "").join(""),
      named: cells.filter(c => ((c.querySelector(".n") || {}).textContent || "").trim()).length,
      /* 남은 턴이 보이는가 */
      cds: cells.filter(c => ((c.querySelector(".cd") || {}).textContent || "").trim()).length,
      geo: "x" + Math.round(qb.left) + "~" + Math.round(qb.right) +
           " · 뷰포트 x" + Math.round(vp.left) + "~" + Math.round(vp.right) +
           " · 바닥에서 " + Math.round(vp.bottom - qb.bottom) + "px"
    };
  })()`);
  /* 스킬을 누를 수 있는 자리가 **정확히 하나**인가.
   *
   * ⚠ 휴대폰에서는 캔버스 아래 퀵슬롯을 감추고 오른손 묶음이 맡는다. 예전
   *   전제("퀵슬롯이 늘 보인다")로 두면 휴대폰에서 늘 빨갛다. 그렇다고
   *   지우면 **둘 다 사라진 판**을 아무도 못 잡는다 — 그때 스킬은 키보드로만
   *   쓸 수 있는데 휴대폰에는 키보드가 없다.
   *   "어느 쪽이든 하나는 눌린다, 둘이 같이 뜨지는 않는다" 로 바꾼다. */
  const ringSeen = await ev(`(function(){
    var r = document.querySelector(".ring");
    if (!r || !r.checkVisibility || !r.checkVisibility()) return 0;
    /* ⚠ **보이는 것만 센다.** 넓은 화면에서는 묶음의 스킬 칸이 display:none
     *   인데 DOM 에는 그대로 있다. querySelectorAll 로 세면 "둘이 같이 떴다" 가
     *   된다 — 실제로 그렇게 빨개졌다. */
    var n = 0;
    r.querySelectorAll("[data-skill]").forEach(function (b) {
      if (b.checkVisibility && b.checkVisibility()) n++;
    });
    return n;
  })()`);
  const quickShown = qk.n > 0 && qk.inside && qk.filled >= 1;
  const bothShown = quickShown && ringSeen > 0;
  const oneShown = (quickShown || ringSeen > 0) && !bothShown;
  const qkOK = oneShown && (!quickShown ||
               (qk.rows === 1 && qk.owned === qk.filled && qk.swallow === 0 &&
                qk.centered && qk.keys === "QWER" && qk.named === 4 &&
                (!TOUCH || qk.minSide >= 40)));
  console.log("스킬 누를 곳 :", ok(qkOK),
    (ringSeen > 0 ? "오른손 묶음 " + ringSeen + "칸" : "묶음 없음") + " · " +
    (quickShown ? "퀵슬롯 " + qk.n + "칸(찬 것 " + qk.filled + ")" : "퀵슬롯 감춤") +
    (bothShown ? " · ⚠둘이 같이 떴다" : "") +
    (oneShown ? "" : " · ⚠스킬을 누를 곳이 없다") + " · " +
    qk.owned + "/" + qk.filled +
    (qk.swallow ? " · ⚠빈 칸 " + qk.swallow + "개가 지도 클릭을 삼킨다" : "") +
    " · 가장 작은 변 " +
    qk.minSide + "px · 키 " + (qk.keys || "없음") + " · 이름 " + qk.named + " · 남은턴 " + qk.cds +
    (qk.inside ? "" : " · ⚠뷰포트를 넘는다") + (qk.centered ? " · 가운데" : " · ⚠가운데가 아니다") +
    " · " + (qk.geo || qk.why || ""));
  /* ── 조작 패드가 **있어야 할 곳에만** 뜨는가 ───────────
   *
   * ⚠ 판정이 `navigator.maxTouchPoints > 0` 하나였다. 그러면 터치 스크린이
   *   달린 **노트북이 전부 걸린다.** 실측으로 이 윈도우 데스크톱도 그 값이
   *   10 인데 hover 도 되고 정밀 포인터도 있다 — 마우스와 키보드가 있는데
   *   화면 아래 187px 를 패드가 먹고 지도 확대가 2배에서 1배로 떨어졌다.
   * ⚠ 이 검사가 도는 헤드리스 크롬이 **바로 그 기기**다(maxTouchPoints 10).
   *   `--touch` 없이 돌 때 패드가 뜨면 틀린 것이다.
   * ⚠ 반대쪽도 본다. 손가락이 주된 기기에서 패드가 안 뜨면 **조작 수단이
   *   아예 없어진다**(휴대폰에는 키보드가 없다). 그쪽이 더 큰 사고다. */
  const padWhen = await ev(`(function(){
    var pad = document.querySelector(".pad");
    return {
      touchPoints: navigator.maxTouchPoints,
      coarse: !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches),
      hover: !!(window.matchMedia && window.matchMedia("(hover: hover)").matches),
      shown: getComputedStyle(pad).display !== "none",
      isTouch: document.body.classList.contains("is-touch")
    };
  })()`);
  /* 손가락이 주된 기기면 반드시 떠야 하고, 마우스가 있는 넓은 화면이면 안 떠야 한다 */
  const wantPad = padWhen.coarse || !padWhen.hover || VW <= 820;
  const padWhenOK = padWhen.shown === wantPad;
  console.log("패드 뜨는 곳 :", ok(padWhenOK),
    "터치점 " + padWhen.touchPoints + " · coarse " + padWhen.coarse +
    " · hover " + padWhen.hover + " → 패드 " + (padWhen.shown ? "뜸" : "안 뜸") +
    (padWhenOK ? "" : " · ⚠" + (wantPad ? "떠야 하는데 안 뜬다" : "안 떠야 하는데 뜬다")));

  /* ── 지나간 기록을 **되돌려 볼 수 있는가** ─────────────
   *
   * ⚠ 좁은 화면에서는 기록 패널을 감췄고 토스트는 다섯 개까지만 떴다
   *   사라진다. 그래서 놓친 줄을 다시 볼 방법이 **아예 없었다.** 토스트가
   *   덮는 자리를 줄이면서 그 구멍이 더 커졌다.
   * ⚠ "어딘가에 log 라는 요소가 있다" 로는 부족하다. 감춰져 있으면 없는
   *   것과 같다. `checkVisibility()` 로 **보이는 것**만 세고, 줄이 실제로
   *   담겨 있는지도 본다.
   * ⚠ 두 군데 다 뜨면 그것도 잘못이다 — 어느 쪽을 봐야 할지 모른다. */
  const logWhere = await (async () => {
    function probe() {
      return `(function(){
        function vis(sel) {
          var e = document.querySelector(sel);
          if (!e || !e.checkVisibility || !e.checkVisibility()) return 0;
          return e.querySelectorAll(".m").length;
        }
        return { side: vis(".logpanel .log"), gear: vis("#gearLog") };
      })()`;
    }
    const closed = await ev(probe());
    await ev("window.__gear && window.__gear(true)");
    await sleep(320);
    const open = await ev(probe());
    await ev("window.__gear && window.__gear(false)");
    await sleep(200);
    return { closed: closed, open: open };
  })();
  /* 닫혀 있을 때 사이드바에 있거나, 장비 창을 열면 거기 있거나 — 하나는 있어야 한다 */
  const sideHas = logWhere.closed.side > 0;
  const gearHas = logWhere.open.gear > 0;
  const bothAtOnce = logWhere.open.side > 0 && logWhere.open.gear > 0;
  const logOK = (sideHas || gearHas) && !bothAtOnce;
  console.log("기록 되돌리기:", ok(logOK),
    (sideHas ? "사이드바 " + logWhere.closed.side + "줄" : "사이드바 없음") + " · " +
    (gearHas ? "장비 창 " + logWhere.open.gear + "줄" : "장비 창 없음") +
    (bothAtOnce ? " · ⚠둘이 같이 뜬다" : "") +
    (sideHas || gearHas ? "" : " · ⚠어디서도 못 본다"));

  /* ── 토스트가 지도를 얼마나 덮는가 ────────────────────
   *
   * ⚠ "몇 줄인가" 로는 못 잡는다. 같은 줄 수라도 화면이 작으면 훨씬 많이
   *   덮는다. **캔버스 세로의 몇 %** 를 재야 한다.
   * ⚠ 상한이 화면 높이에 걸려 있어서 390x509 휴대폰에서 22줄까지 열려
   *   있었다(실측으로 여섯 줄 = 세로의 24%). 걸어 다니는 자리다.
   * ⚠ 그렇다고 너무 줄이면 안 된다 — 휴대폰에서는 토스트가 **유일한
   *   기록**이다(기록 패널을 감췄다). 세 줄 아래로는 안 내려가야 한다. */
  /* ⚠ **가득 채운 뒤에 잰다.** 처음엔 그냥 쟀다가 마침 토스트가 둘뿐인
   *   순간을 보고 "세 줄 이상" 을 요구해 빨개졌다. 재려는 것은 지금 몇 줄이
   *   떠 있는가가 아니라 **상한이 얼마인가**다.
   * ⚠ 연달아 같은 글은 접히므로 서로 다른 글을 밀어 넣는다. */
  /* ⚠ **긴 글로 채운다.** 토스트는 이미 다섯 개로 묶여 있어서(drainLog)
   *   짧은 글을 열 개 밀어 넣어 봐야 늘 다섯 줄이다 — 대조군이 그래서
   *   그냥 통과했다. 화면을 덮는 것은 개수가 아니라 **접혀서 늘어난 줄 수**다.
   *   좁은 화면에서 서너 줄로 접히는 길이를 쓴다. */
  for (let i = 0; i < 6; i++) {
    await ev("window.__say('" + i + "번째 줄이다. 관리소 장부에 층수 칸만 비워 두고 " +
             "계단을 내려간다. 10층 아래에 심연의 군주가 있다고 적혀 있었다.', '')");
  }
  await sleep(200);
  const toast = await ev(`(function(){
    var r = document.getElementById("view").getBoundingClientRect();
    var boxes = window.__toastBoxes ? window.__toastBoxes() : [];
    if (!boxes.length) return { lines: 0, coverPct: 0, ok: true };
    var top = r.height;
    boxes.forEach(function(b){ if (b.top < top) top = b.top; });
    return { lines: boxes.length,
             coverPct: Math.round((r.height - top) / r.height * 100),
             ok: true };
  })()`);
  /* 문턱은 고치기 전후로 잡았다. 전 24% · 후 20%. 25% 를 넘으면 빨갛다 */
  const toastOK = toast.lines === 0 || (toast.coverPct <= 25 && toast.lines >= 3);
  console.log("토스트 자리  :", ok(toastOK),
    toast.lines + "줄 · 캔버스 세로의 " + toast.coverPct + "% 를 덮는다 (25% 이하 · 3줄 이상)");

  /* ── 문과 상자가 **갈리는가** ──────────────────────────
   *
   * 지도를 2배로 키우자 갈색 덩어리가 한 화면에 여섯 보였는데 셋만 문이었다.
   * 문 나무가 #7b5330/#96663c, 상자가 #7a5730/#966c3c — **눈으로 가를 수 없는
   * 차이**였다. 그래서 "문이 갑자기 많아졌다" 로 느껴졌다(문 수는 층당 4.7개로
   * 그대로였다).
   *
   * ⚠ **평균색으로 재면 안 된다.** 문은 밝은 석재 문틀이 평균을 지배해서,
   *   안쪽 나무가 상자와 똑같아도 평균 색 거리는 37 이 나왔다(그럭저럭
   *   달라 보이는 값이다). 정작 헷갈리는 **안쪽**을 떠서 견준다.
   * ⚠ 문턱은 대조군으로 잡았다. 고치기 전 안쪽 색 거리 17 · 밝기 차 6,
   *   고친 뒤 48 · 28. 그 사이에 둔다.
   * ⚠ 색만 보지 않는다. 색맹인 사람에게는 실루엣이 전부다 — 문은 칸을
   *   가득 채우고(32px 폭) 상자는 가운데 작게 앉는다(22px). 넓이 비도 본다. */
  const dc = await ev(`(function(){
    var S = window.SPRITES;
    function mean(name, x0, y0, w, h){
      var c = S.bake(name); if (!c) return null;
      var d = c.getContext("2d").getImageData(x0, y0, w, h).data;
      var n = 0, r = 0, g = 0, b = 0;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 40) continue;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
      return n ? { r: r / n, g: g / n, b: b / n, n: n } : null;
    }
    var dCore = mean("door", 11, 12, 10, 10);
    var cCore = mean("p_crate", 11, 12, 10, 10);
    var dAll = mean("door", 0, 0, 32, 32);
    var cAll = mean("p_crate", 0, 0, 32, 32);
    if (!dCore || !cCore || !dAll || !cAll) return { ok: false, why: "그림을 못 구웠다" };
    function lum(c){ return 0.2126*c.r + 0.7152*c.g + 0.0722*c.b; }
    return {
      dist: Math.round(Math.sqrt(Math.pow(dCore.r-cCore.r,2) +
                                 Math.pow(dCore.g-cCore.g,2) +
                                 Math.pow(dCore.b-cCore.b,2))),
      bri: Math.round(Math.abs(lum(dCore) - lum(cCore))),
      areaRatio: Math.round(dAll.n / cAll.n * 100) / 100
    };
  })()`);
  const dcOK = dc.dist >= 35 && dc.bri >= 18 && dc.areaRatio >= 2;
  console.log("문·상자 구별 :", ok(dcOK),
    "안쪽 색 거리 " + dc.dist + " (35 이상) · 밝기 차 " + dc.bri + " (18 이상) · " +
    "칠 넓이 " + dc.areaRatio + "배 (2배 이상)" + (dc.why ? " · " + dc.why : ""));

  /* ── 지도 확대 ────────────────────────────────────────
   *
   * 칸이 32px 로 굳어 있어 1920 화면에서 층의 63% 가 한꺼번에 보였다.
   * 이제 그리기 직전에 변환 한 번으로 확대한다.
   *
   * ⚠ **"확대배가 2 다" 는 통과가 아니다.** 변환만 걸고 좌표 되돌리기를
   *   안 고치면 화면은 커 보이는데 누른 칸이 절반으로 들어간다. 눈으로는
   *   "엉뚱한 데로 걸어간다" 로만 나타난다. 배율마다 **네 귀퉁이를 눌러**
   *   그 칸이 나오는지 본다.
   * ⚠ **보이는 칸 수를 공식으로 계산하면 안 된다.** 처음에 그렇게 썼다가
   *   대조군(변환을 아예 안 거는 판)이 **그냥 통과했다** — 공식은 그려진 것을
   *   안 본다. 캔버스에 **실제로 걸린 변환 행렬**을 읽는다. 그 값이 뒤따르는
   *   모든 그리기가 쓰는 값이다. 대조군에서 1 로 떨어져 빨개진다.
   * ⚠ 사람 둘레 칠해진 픽셀도 같이 찍지만 **판정에는 안 넣는다.** 판마다
   *   바닥 무늬가 달라 1배 대비 2배가 1.23배였다 — 안전한 문턱을 지을
   *   실측 바닥이 없다. 재 보지 않은 문턱을 박으면 언젠가 깜빡인다.
   */
  const zoomRows = [];
  for (const z of [1, 2, 3]) {
    const got = await ev(`(function(){
      var got = window.__zoom(` + z + `);
      var cv = document.getElementById("view"), cb = cv.getBoundingClientRect();
      var cam = window.__cam();
      var ctx = cv.getContext("2d");
      var dpr = cv.width / cb.width;
      /* 그리기가 **실제로 쓰는** 확대배. 변환을 안 걸면 여기서 1 이 나온다 */
      var drawn = Math.round(ctx.getTransform().a / dpr * 100) / 100;
      /* 사람 둘레 고정된 화면 상자를 읽는다. 상자 크기는 배율과 무관하게
       * 고정이라, 2배가 되면 안에 들어오는 칠이 는다. */
      var p = window.__peek();
      var sx = Math.round(((p.x * cam.tile + cam.tile / 2) - cam.x) * cam.zoom * dpr);
      var sy = Math.round(((p.y * cam.tile + cam.tile / 2) - cam.y) * cam.zoom * dpr);
      var half = Math.round(26 * dpr);
      var bx = Math.max(0, Math.min(cv.width - 1, sx - half));
      var by = Math.max(0, Math.min(cv.height - 1, sy - half));
      var bw = Math.max(1, Math.min(half * 2, cv.width - bx));
      var bh = Math.max(1, Math.min(half * 2, cv.height - by));
      var d = ctx.getImageData(bx, by, bw, bh).data, lit = 0;
      for (var i = 0; i < d.length; i += 4)
        if (d[i] + d[i + 1] + d[i + 2] > 210) lit++;
      var bad = [];
      [[0.12,0.15],[0.5,0.5],[0.88,0.85],[0.72,0.2]].forEach(function(f){
        var px = cb.left + cb.width * f[0], py = cb.top + cb.height * f[1];
        /* ⚠ 여기서 __tapAtPoint 를 쓰면 **걸어가기가 시작된다.** 그러면
         *   다음 점을 잴 때 카메라가 이미 움직여 있어 엉뚱하게 빨개진다.
         *   누르지 않고 바꾸기만 하는 창구를 쓴다. */
        var hit = window.__tileAt(px, py);
        var want = { x: Math.floor(((px - cb.left) / cam.zoom + cam.x) / cam.tile),
                     y: Math.floor(((py - cb.top) / cam.zoom + cam.y) / cam.tile) };
        if (!hit || hit.x !== want.x || hit.y !== want.y)
          bad.push(f.join(",") + " 원함 " + want.x + "," + want.y +
                   " 받음 " + (hit ? hit.x + "," + hit.y : "없음"));
      });
      return { zoom: got, drawn: drawn, lit: lit,
               cols: Math.floor(cb.width / (cam.tile * got)),
               rows: Math.floor(cb.height / (cam.tile * got)), bad: bad };
    })()`);
    zoomRows.push({ want: z, ...got });
  }
  /* 화면을 보고 고르는 쪽으로 되돌린다 — 뒤 검사들이 자동값에서 돌아야 한다 */
  const autoZ = await ev("window.__zoom(0)");
  const zoomOK = zoomRows.every(r => r.zoom === r.want && r.bad.length === 0 &&
                                     Math.abs(r.drawn - r.want) < 0.02);
  console.log("지도 확대    :", ok(zoomOK),
    zoomRows.map(r => r.zoom + "배 " + r.cols + "x" + r.rows +
      " 변환" + r.drawn + (r.lit ? " 칠" + r.lit : "") +
      (Math.abs(r.drawn - r.want) >= 0.02 ? " ⚠변환이 안 걸렸다" : "") +
      (r.bad.length ? " ⚠" + r.bad[0] : "")).join(" · ") + " · 자동 " + autoZ + "배");

  /* ── 고른 특화가 **화면에 보이는가** ────────────────────
   *
   * 특화 이름은 사이드바 "누구인가" 줄에만 있었다. 그 줄이 상단 상태줄과
   * 통째로 겹쳐서 없앴고, 특화만 상태줄로 옮겼다. 옮긴 것이 진짜 그려지는지
   * 재지 않으면 특화가 **어디에도 없는 채로** 검사가 파랗다.
   *
   * ⚠ 화면 글자에 들어 있나만 보면 안 된다. 특화를 안 골랐으면 기댓값도
   *   빈 문자열이라 늘 통과한다. `__peek().specName` 을 기댓값으로 삼고,
   *   그 값이 실제로 생겼는지부터 본다.
   * ⚠ textContent 로는 부족하다 — 감춘 요소도 글자를 준다(`.who` 가 바로
   *   그렇다). `checkVisibility()` 로 **보이는 것**만 읽는다.
   */
  const spec = await (async () => {
    const D = await ev("window.DATA.SPEC_DEPTH");
    await ev("window.__toDepth(" + D + ")");
    await sleep(260);
    /* 특화 고르기 창이 떴으면 첫 칸을 고른다. 레벨업 선택이 먼저 떠 있으면
     * 줄을 서므로(pendingQueue) 몇 번 더 고른다. */
    for (let i = 0; i < 4; i++) {
      if (!(await ev("window.__peek().perkOpen"))) break;
      await ev("window.__pickPerk && window.__pickPerk(0)");
      await sleep(200);
      if (await ev("window.__peek().specName")) break;
    }
    return await ev(`(function(){
      var p = window.__peek();
      function visText(sel) {
        var e = document.querySelector(sel);
        if (!e || !e.checkVisibility || !e.checkVisibility()) return "";
        return (e.textContent || "").replace(/\s+/g, " ").trim();
      }
      var hud = visText(".hud");
      var side = visText(".side .who");
      return { name: p.specName, depth: p.depth, inHud: !!(p.specName && hud.indexOf(p.specName) >= 0),
               inSide: !!(p.specName && side.indexOf(p.specName) >= 0),
               hud: hud.slice(0, 60) };
    })()`);
  })();
  const specOK = !!spec.name && spec.inHud;
  console.log("특화 표시    :", ok(specOK),
    spec.name ? "「" + spec.name + "」 · " + (spec.inHud ? "상단 상태줄에 있다" : "⚠상단 상태줄에 없다") +
                (spec.inSide ? " · 사이드바에도 있다(중복)" : "") + " · " + spec.hud
              : "⚠ " + spec.depth + "층까지 갔는데 특화를 못 골랐다");

  /* 스킬을 눌렀을 때 일어날 수 있는 일은 둘뿐이다.
   *   ① 터졌다  → 쿨다운이 생기고 버튼이 잠긴다
   *   ② 거절됐다 → 쿨다운이 그대로고 이유가 기록에 남는다("닿는 적이 없다")
   * ⚠ 예전 판정은 `__peek().cooldown` 을 봤는데 그 값이 **없었다** — undefined > 0 이
   *   늘 false 라 ① 갈래가 죽은 코드였고, 스킬이 실제로 터진 판이 오히려 실패로
   *   읽혔다(마법사 검사가 가끔 빨개진 이유). 창구에 값을 싣고 둘 다 제대로 가른다. */
  const fired = typeof feat2.cd === "number" && feat2.cd > 0;
  /* ⚠ 거절을 **문구로 맞히지 않는다.** 처음엔 /닿는|없다|준비/ 로 봤는데 실제 문구가
   *   "허공에서 흩어졌다." 라 안 걸렸다 — 문구는 언제든 바뀐다. 거절도 행동이므로
   *   **기록이 한 줄 늘었는지**로 본다. 그건 문구가 바뀌어도 그대로다. */
  const refused = feat2.logLen > feat.logLen;
  const abilityWorks = (feat.btnText !== "(없음)") &&
    (fired ? feat2.disabled === true : (refused || feat2.disabled === false));
  console.log("직업 능력    :", ok(abilityWorks), feat.btnText + " → " +
    (fired ? "터짐 · 쿨 " + feat2.cd + "턴 · 버튼 " + (feat2.disabled ? "잠김" : "⚠안 잠김")
           : "거절 · 기록 " + feat.logLen + " → " + feat2.logLen +
             " · \"" + (feat2.log || "(기록 없음)") + "\""));
  console.log("함정·보물방  :", ok(true), "이 층 함정 " + feat.traps + "개 · 보물방 " + (feat.treasure ? "있음" : "없음"));
  console.log("미식별 물약  :", ok(potions.looks.length >= potions.names.length),
    "물약 " + potions.names.length + "종 · 겉모습 후보 " + potions.looks.length + "개");
  console.log("옛 키 죽음   :", ok(oldKeysDead),
    oldKeysDead ? "YUBN·WASD·HJKL 무반응" : "⚠ 옛 키가 아직 움직인다");
  console.log("둥근 패드    :", ok(stickOk),
    !stick8 ? "⚠ 원판이 없다"
      : stick8.hidden ? "이 화면에서는 패드를 안 쓴다(정상) — 검사 안 함"
      : "지름 " + stick8.size + "px · 방향 " + stick8.dirs.length + "가지" +
        (stick8.dirs.length === 8 ? "" : " ⚠여덟이 아니다") +
        " · 가운데 " + (stick8.center === null ? "죽은 구역(정상)" : "⚠방향이 나온다"));
  console.log("우클릭 버리기:", ok(dropTest.skipped ? true : (dropTest.prevented && dropTest.after < dropTest.before)),
    dropTest.skipped ? "가방이 비어 검사 못 함"
      : "가방 " + dropTest.before + " → " + dropTest.after + " · 기본메뉴 " +
        (dropTest.prevented ? "막음" : "⚠안 막음") + " · \"" + dropTest.log.trim() + "\"");
  if (zoomCheck) {
    /* ⚠ 원판은 **none** 이어야 한다. manipulation 은 한 손가락 끌기를 브라우저가
     *   가져가 버려서 굴릴 때 화면이 따라 움직인다. */
    const noZoom = Math.abs(zoomCheck.scale1 - zoomCheck.scale0) < 0.01 &&
                   (zoomCheck.ta === "none" || zoomCheck.ta === "manipulation");
    noZoomOK = noZoom && zoomCheck.turn1 > zoomCheck.turn0;
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
  let tapPass = true;
  if (tapCheck) {
    //  900ms · 걸음 115ms → 여러 칸 갔어야 한다. 한 칸이면 걷지 않고 멈춘 것이다.
    const sm = tapCheck.stopOnMonster;
    //  적을 못 심었으면(시야 안에 빈 칸이 없음) 그 항목은 판정하지 않는다 —
    //  검사 못 한 것을 통과로도 실패로도 세지 않는다.
    const smOk = !sm || !sm.set || !sm.put || sm.stopped;
    /* ⚠ **맞으면 멈추는 것이 정답이다.** 옆에 붙은 적에게서 물러나면 기회 공격을
     *   맞고, 멀리 있는 투석꾼이 쏴도 맞는다 — 둘 다 "맞으면 멈춘다" 규칙이
     *   제대로 걸린 것이다. 그때 "여러 칸 걸어야 한다" 로 재면 멀쩡한 제품을
     *   고장으로 부른다(붙은 적으로 한 번, 원거리로 한 번 그렇게 빨개졌다).
     * ⚠ 그래서 **맞았는가**로 가른다. 붙었는지만 보면 원거리를 놓친다. */
    /* ⚠ 자동 이동이 멈추는 이유는 여섯이다(main.js travelTick 참조).
     *   그중 **맞았다**와 **못 보던 적이 나타났다**는 멀쩡히 멈춘 것이다.
     *   이 검사는 그 둘을 알아야 한다 — 모르면 규칙이 제대로 걸릴 때마다
     *   제품을 고장으로 부른다(붙은 적으로 한 번, 원거리로 한 번, 새 적으로
     *   한 번 그렇게 빨개졌다).
     * ⚠ 그래서 문턱을 낮추는 것이 아니라 **왜 멈췄는지를 함께 본다.** */
    const hurt = tapCheck.hp1 < tapCheck.hp0;
    const newFoe = tapCheck.seen1 > tapCheck.seen0;
    const nearFoe = tapCheck.foes > 0;
    /* ⚠ **길이 막혀 한 칸도 못 간 것**도 맞게 군 것이다. pathTo 는 몬스터가 선
     *   칸을 안 지나간다(지나가면 막힌 걸 모르고 걸어 들어가 얻어맞는다).
     *   몬스터가 늘면서 외길이 막히는 일이 늘었다 — 이걸 모르면 또 오진한다. */
    const noPath = tapCheck.pathLen <= 0;
    const stoppedRight = hurt || newFoe || noPath;
    const ok2 = noPath
      ? tapCheck.center
      : stoppedRight
      ? (tapCheck.moved >= 1 && tapCheck.center)
      : (tapCheck.started && tapCheck.moved >= 2 && tapCheck.turns >= 2 &&
         tapCheck.center && smOk && (!tapCheck.hadTravel || tapCheck.stoppedByKey));
    tapPass = ok2;
    console.log("탭 이동      :", ok(ok2),
      (noPath ? "길이 막혀 못 가는 것이 정상(몬스터가 외길을 막았다) · "
            : hurt ? "걷다 맞아 멈춰야 정상(" + (nearFoe ? "옆에 적 " + tapCheck.foes + "마리" : "원거리") +
              ") · 체력 " + tapCheck.hp0 + "→" + tapCheck.hp1 + " · "
            : (newFoe ? "못 보던 적이 나타나 멈춰야 정상 · 보이는 적 " +
                        tapCheck.seen0 + "→" + tapCheck.seen1 + " · " : "")) +
      "목적지 " + tapCheck.goal.x + "," + tapCheck.goal.y + "(" + tapCheck.goal.d + "칸) → " +
      tapCheck.moved + "칸 이동 · 턴 +" + tapCheck.turns +
      (tapCheck.started ? " · 자동 이동 시작됨" : " · ⚠자동 이동이 안 걸렸다") +
      (tapCheck.hadTravel ? (tapCheck.stoppedByKey ? " · 키로 멈춤" : " · ⚠키를 눌러도 안 멈춘다")
                          : " · (멈춤 검사 못 함 — 이미 도착)") +
      (tapCheck.center ? " · 좌표 변환 맞음" : " · ⚠좌표 변환 어긋남(원했다 " + tapCheck.centerWant + " 나왔다 " + tapCheck.centerGot + ")"));
    console.log("  적 보면 멈춤:", ok(smOk),
      !sm ? "검사 못 함(게임이 끝났거나 갈 곳이 없다)"
        : !sm.set ? "검사 못 함(자동 이동이 안 걸렸다)"
        : !sm.put ? "검사 못 함(시야에 적을 놓을 빈 칸이 없다)"
        : (sm.stopped ? "쥐를 " + sm.put.x + "," + sm.put.y + " 에 놓자 멈췄다"
                      : "⚠ 적이 나타났는데 계속 걸어간다 — 걸어가다 맞아 죽는다"));
  } else {
    console.log("탭 이동      : — 검사 못 함(게임이 끝났거나 갈 곳이 없다)");
  }
  console.log("기록 가시성  :", ok(logBox.inView && logBox.atBottom),
    logBox.mode === "panel"
      ? "패널 y" + logBox.top + "~" + logBox.bottom + " (높이 " + logBox.h + ") · " +
        logBox.lines + "줄 · 맨 아래로 " + (logBox.atBottom ? "따라감" : "⚠안 따라감") +
        (logBox.inView ? "" : " · ⚠화면 밖")
      : "좁은 화면 — 패널 없음(정상) · 캔버스 토스트로 띄운다 · 쌓인 기록 " +
        logBox.lines + "줄" + (logBox.inView ? "" : " · ⚠기록이 비었다"));
  console.log("상태창       :", ui.stats);
  console.log("마지막 기록  :", ui.lastLog);

  // ── 6) 캔버스에 그린 기록이 화면 밖으로 새지 않는가 ──
  //    ⚠ 위의 "가로 넘침" 은 DOM 만 본다. **캔버스에 그린 글자는 거기 안 잡힌다** —
  //      실제로 390px 에서 긴 문장이 오른쪽으로 새어 나가고 있었는데 검사는 전부
  //      초록이었다. 휴대폰에서는 토스트가 유일한 기록이라 잘리면 정보가 사라진다.
  //    ⚠ 이 검사는 기록을 **더럽힌다**(긴 문장을 밀어 넣는다) — 그래서 맨 끝이다.
  const toastFit = await ev(`(()=>{
    if (!window.__say || !window.__toastBoxes) return { skip: true };
    [ "관리소 장부에 층수 칸만 비워 두고 계단을 내려간다. 10층 아래에 심연의 군주가 있다.",
      "역병의곪은비늘갑옷을주웠고치명타확률이올랐다그리고상태이상피해도함께올랐다띄어쓰기가없다"
    ].forEach(t => window.__say(t, "item"));
    const cv = document.getElementById("view").getBoundingClientRect();
    const boxes = window.__toastBoxes();
    const over = boxes.filter(b => b.right > cv.width + 0.5 || b.top < 0);
    return { skip: false, lines: boxes.length, over: over.length,
             worst: boxes.length ? Math.round(Math.max(...boxes.map(b => b.right))) : 0,
             cw: Math.round(cv.width), sample: over.slice(0, 2).map(b => b.text.slice(0, 16)) };
  })()`);
  const toastOk = toastFit.skip || toastFit.over === 0;
  console.log("기록 넘침    :", ok(toastOk), toastFit.skip ? "창구 없음 — 검사 못 함"
    : "접힌 줄 " + toastFit.lines + "개 · 제일 오른쪽 " + toastFit.worst + "px / 캔버스 " + toastFit.cw + "px" +
      (toastFit.over ? " · ⚠새어 나감 " + toastFit.over + "줄: " + toastFit.sample.join(" / ") : ""));

  if (SHOT) {
    const { data } = await S("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(SHOT, Buffer.from(data, "base64"));
    console.log("스크린샷     :", SHOT);
  }

  const pass = errs.length === 0 && canvas.litPct > 3 && moved && turned && canvas2.hash !== canvas.hash &&
               !overflow.docScroll && overflow.count === 0 && helpOpen && helpClosed &&
               noZoomOK &&
               (!canAct || (heldTurns >= 2 && heldTurns <= 9)) && logBox.inView && logBox.atBottom &&
               oldKeysDead && stickOk &&
               (dropTest.skipped || (dropTest.prevented && dropTest.after < dropTest.before)) &&
               build.skillRows === 4 && build.skills >= 1 && build.crit > 0 && !!build.weapon &&
               qkOK && specOK && zoomOK && dcOK && toastOK && logOK && padWhenOK &&
               build.gold !== "(없음)" &&
               potions.looks.length >= potions.names.length &&
               startCheck.shown && startCheck.cards === 3 && startCheck.overflow === 0 && startCheck.hasSpace &&
               startCheck.art.every(a => a > 8) &&
               layout.wrapped.length === 0 && (layout.cut === 0 || layout.sideScroll) && !layout.pageOverflowY &&
               layout.laps.length === 0 && layout.spill.length === 0 &&
               /* ⚠ 새 검사를 여기 넣지 않으면 빨간 줄이 떠도 "통과" 가 나온다.
                *   실제로 탭 이동 실패가 통과로 나왔다 — 판정에 없었기 때문이다. */
               !hud.missing && hud.shown && hud.inView && hud.aboveCanvas &&
               hud.bars.length >= 2 && hud.bars.every(b => b.w > 60) &&
               (!tapCheck || tapPass) && padPass && toastOk && barsOk &&
               (!endCheck || (endCheck.over && endCheck.shown));
  ws.close(); ch.kill(); srv.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  console.log(pass ? "\n결과: 통과" : "\n결과: 확인 필요");
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
