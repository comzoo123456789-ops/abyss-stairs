/* 계정과 서버 저장 — 붙였는데 **게임이 그대로인가**, 그리고 안 날아가는가.
 *
 * 2026-09-23 에 직업 목록 하나를 빠뜨려 키워 둔 전사 저장을 통째로 날렸다.
 * 계정을 붙인 까닭이 그것이라, 여기서 제일 먼저 재야 할 것은 화려한 기능이
 * 아니라 **뒤로 가는 저장이 올라가지 않는가**다.
 *
 *   ① 로그인 없이도 그대로   계정을 안 만들어도 게임이 돌고 저장된다
 *   ② 계정 만들기 · 로그인   쿠키는 HttpOnly · Secure · SameSite
 *   ③ 올리고 내린다          한 기기에서 올린 것을 다른 기기가 받는다
 *   ④ 뒤로 안 간다           낮은 저장은 높은 것을 못 덮는다
 *   ⑤ 되돌릴 자리가 있다      덮어쓰기 전의 것이 이력에 남는다
 *   ⑥ 남의 것을 못 본다       다른 계정의 저장이 안 보인다
 *   ⑦ 막는다                 로그인 없이 부르면 401 · 틀린 비번을 세어 잠근다
 *
 * ⚠ 이 검사는 **운영 D1 에 쓴다.** 아이디를 `zz` 로 시작하게 만들고 끝나면
 *   지운다. 남기면 어드민 없는 게임에 치울 방법이 없다.
 * ⚠ 실패해도 치운다(finally). 검사가 죽었다고 쓰레기가 남으면 안 된다.
 */
import { spawn, execFileSync } from "child_process";
import fs from "fs"; import os from "os"; import path from "path";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ui = process.argv.indexOf("--url");
const BASE = (ui >= 0 ? process.argv[ui + 1] : "https://abyss-arpg.bhmoon.workers.dev")
  .replace(/\/+$/, "");

const tag = "zz" + Date.now().toString(36).slice(-6);
const RUN_AT = Date.now();          /* 이 실행이 만든 것만 치우는 기준 */
const A = { login: tag + "a", pw: "abyss-test-1234" };
const B = { login: tag + "b", pw: "abyss-test-1234" };

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* 쿠키를 손으로 들고 다닌다 — 계정 둘을 한 판에서 견주려면 이래야 한다 */
function jar() {
  let c = null;
  return {
    async go(p, opt) {
      const h = Object.assign({}, (opt && opt.headers) || {});
      if (c) h.Cookie = c;
      const res = await fetch(BASE + p, Object.assign({}, opt, { headers: h, redirect: "manual" }));
      const set = res.headers.get("set-cookie");
      if (set) {
        const m = set.match(/as_sid=([^;]*)/);
        if (m) c = m[1] ? "as_sid=" + m[1] : null;
      }
      let body = null;
      try { body = await res.json(); } catch (e) { body = null; }
      return { status: res.status, body, set };
    },
    get cookie() { return c; }
  };
}
const post = (j, p, o) => j.go(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o) });

function wrap(d) { return JSON.stringify({ v: 1, t: Date.now(), d }); }
function hero(cls, level, maxDepth, gold) {
  return { cls, level, maxDepth, gold, name: "시험", bag: [], equip: {}, skills: {}, bar: [] };
}

/* 배포본이 **반영될 때까지** 기다린다.
 * ⚠ 배포 직후 바로 재면 엣지가 옛 HTML 을 준다. 이것 때문에 멀쩡한 코드가
 *   두 번 빨갰다("항목 안 보임"). 내 파일의 ?v= 와 같아질 때까지 기다린다 —
 *   고정 대기로 때우면 느린 날 또 같은 일이 난다. */
async function waitDeployed() {
  let want = "";
  try {
    const m = fs.readFileSync(path.join(REPO, "public", "index.html"), "utf8").match(/\?v=(\d+)/);
    if (m) want = m[1];
  } catch (e) { return "(내 파일을 못 읽음)"; }
  if (!want) return "(?v= 없음)";
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + "/?cb=" + Math.random().toString(36).slice(2), { cache: "no-store" });
      const t = await r.text();
      if (t.indexOf("?v=" + want) >= 0) return "v" + want + (i ? " (" + (i * 3) + "초 기다림)" : "");
    } catch (e) { /* 다시 */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return "⚠ v" + want + " 가 2분 안에 안 올라왔다";
}
const deployed = await waitDeployed();

try {
  /* ── ① 로그인 없이도 그대로 ─────────────────────────
   * ⚠ 이것이 제일 중요하다. 계정을 붙이며 게임을 못 하게 만들면 본말전도다. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-cl-"));
  const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
    "--no-first-run", "--disable-gpu", "--mute-audio", "--hide-scrollbars", "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"] });
  const wsUrl = await new Promise((res, rej) => {
    let b = ""; const t = setTimeout(() => rej(new Error("Chrome 이 30초 안에 안 떴다")), 30000);
    ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) { clearTimeout(t); res(m[0]); } });
  });
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
  const errs = []; let id = 0; const wait = new Map();
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errs.push(d.text + " " + ((d.exception && d.exception.description) || ""));
    }
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  });
  const send = (me, p, s) => new Promise((res, rej) => {
    const i = ++id; wait.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
    ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await S("Page.navigate", { url: BASE + "/?cb=" + Math.random().toString(36).slice(2) });
  for (let i = 0; i < 400; i++) {
    if (await ev("!!(window.SAVE && window.CLASSES && window.__pick)")) break;
    await sleep(60);
  }
  const anon = await ev(`(function(){
    window.__pick("warrior");
    var h = window.__hero();
    h.level = 12; h.gold = 345; window.SAVE.save(h);
    var back = window.SAVE.loadSlot("warrior");
    return { cloud: !!window.CLOUD, login: window.CLOUD ? window.CLOUD.state().login : "(없음)",
             lv: back ? back.level : -1, gold: back ? back.gold : -1,
             btn: !!document.getElementById("btnAcct") };
  })()`);
  add("로그인 없이도 그대로",
    anon.cloud && anon.login === null && anon.lv === 12 && anon.gold === 345 && anon.btn,
    "계정 창 " + (anon.btn ? "있음" : "없음") + " · 로그인 " + anon.login +
    " · 로컬 저장 Lv." + anon.lv + " " + anon.gold + "금 (그대로 돌아야 한다)");
  /* ── 휴대폰에서 계정을 여는 길이 있는가 ─────────────
   * ⚠ 680px 아래에서는 위 줄 단추가 통째로 감춰진다
   *   (`.top-menu button:not(#btnHamb) { display: none !important }`).
   *   붙여만 놓고 이 길을 안 재서 **휴대폰에서 계정을 여는 길이 하나도
   *   없는 채로 배포됐다**(사용자 신고). 진짜로 눌러서 연다. */
  async function tap(sel) {
    const at = await ev(`(function(){
      var e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null;
      e.scrollIntoView({ block: "center" });
      var r = e.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return { hidden: true };
      var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      var hit = document.elementFromPoint(x, y);
      return { x: x, y: y, mine: !!(hit && (hit === e || e.contains(hit))) };
    })()`);
    if (!at || at.hidden || !at.mine) return at;
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(320);
    return at;
  }
  await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const hid = await ev(`(function(){
    function vis(s) {
      var e = document.querySelector(s); if (!e) return "없음";
      var r = e.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? "보임" : "감춤";
    }
    return { top: vis("#btnAcct"), hamb: vis("#btnHamb"), item: vis("#mBtnAcct") };
  })()`);
  await tap("#btnHamb");
  const opened = await ev(`(function(){
    var d = document.getElementById("mobileDropdown");
    var e = document.getElementById("mBtnAcct");
    var r = e ? e.getBoundingClientRect() : null;
    return { drop: !!(d && d.classList.contains("open")),
             item: !!(r && r.width > 0 && r.height > 0),
             txt: e ? e.textContent.trim() : "" };
  })()`);
  await tap("#mBtnAcct");
  const modal = await ev(`(function(){
    var d = document.getElementById("mobileDropdown");
    var m = document.getElementById("acctModal");
    return { modal: !!m, dropStillOpen: !!(d && d.classList.contains("open")),
             hasId: !!document.getElementById("acId") };
  })()`);
  add("휴대폰에서 연다",
    hid.top === "감춤" && hid.hamb === "보임" && opened.drop && opened.item &&
    modal.modal && modal.hasId && !modal.dropStillOpen,
    "390px · 위 줄 단추 " + hid.top + " · 햄버거 " + hid.hamb +
    " → 차림표 " + (opened.drop ? "열림" : "안 열림") + " · 항목 " +
    (opened.item ? "보임" : "안 보임") + " “" + opened.txt + "”" +
    " → 계정 창 " + (modal.modal ? "열림" : "안 열림") +
    " · 차림표 " + (modal.dropStillOpen ? "⚠ 남음" : "닫힘"));

  add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 2).join(" / ") : "0건");
  try { ws.close(); } catch (e) {}
  ch.kill();

  /* ── ② 계정 만들기 · 로그인 ─────────────────────── */
  const ja = jar();
  const up = await post(ja, "/api/signup", A);
  const cookieOk = /HttpOnly/i.test(up.set || "") && /Secure/i.test(up.set || "") &&
                   /SameSite=Lax/i.test(up.set || "");
  add("계정 만들기", up.status === 200 && up.body && up.body.login === A.login && cookieOk,
    "가입 " + up.status + " · " + (up.body && up.body.login) +
    " · 쿠키 HttpOnly·Secure·SameSite " + (cookieOk ? "✔" : "⚠"));

  const dup = await post(jar(), "/api/signup", A);
  const short = await post(jar(), "/api/signup", { login: tag + "c", pw: "1234" });
  const hangul = await post(jar(), "/api/signup", { login: "한글아이디", pw: "abyss-test-1234" });
  add("아무 아이디나 못 만든다",
    dup.status === 409 && short.status === 400 && hangul.status === 400,
    "같은 아이디 " + dup.status + " · 짧은 비번 " + short.status + " · 한글 " + hangul.status);

  /* ── ③ 올리고 내린다 ─────────────────────────────── */
  const sv = await post(ja, "/api/save", { saves: [
    JSON.parse(wrap(hero("warrior", 24, 19, 7777))),
    JSON.parse(wrap(hero("knight", 5, 3, 100)))
  ] });
  const jb = jar();               /* 다른 기기인 척 — 같은 계정으로 다시 로그인 */
  const li = await post(jb, "/api/login", A);
  const ld = await jb.go("/api/load");
  const got = {};
  for (const r of (ld.body && ld.body.saves) || []) got[r.cls] = r.level;
  add("올리고 내린다",
    sv.status === 200 && li.status === 200 && ld.status === 200 &&
    got.warrior === 24 && got.knight === 5,
    "올림 " + JSON.stringify((sv.body || {}).saved) + " → 다른 기기에서 받은 것 " +
    JSON.stringify(got));

  /* ── ④ 뒤로 안 간다 ──────────────────────────────
   * 사고 그대로를 흉내낸다: 빈 Lv.1 전사를 올려 본다. */
  const back = await post(jb, "/api/save", { save: JSON.parse(wrap(hero("warrior", 1, 1, 0))) });
  const after = await jb.go("/api/load");
  let lvNow = -1;
  for (const r of (after.body && after.body.saves) || []) if (r.cls === "warrior") lvNow = r.level;
  const skipped = ((back.body || {}).saved || []).some(x => x.skipped === "behind");
  add("뒤로 안 간다", lvNow === 24 && skipped,
    "빈 Lv.1 전사를 올렸더니 " + (skipped ? "막혔고" : "⚠ 안 막혔고") +
    " 서버는 Lv." + lvNow + " (24 여야 한다)");

  /* ── ⑤ 되돌릴 자리 ───────────────────────────────── */
  await post(jb, "/api/save", { save: JSON.parse(wrap(hero("warrior", 26, 21, 9000))) });
  const hist = await jb.go("/api/history?cls=warrior");
  const levels = ((hist.body || {}).log || []).map(r => r.level);
  add("되돌릴 자리가 있다", hist.status === 200 && levels.indexOf(24) >= 0,
    "이력 " + levels.length + "벌 · 레벨 [" + levels.join(",") + "] (덮기 전 24 가 있어야 한다)");

  /* ── ⑥ 남의 것을 못 본다 ─────────────────────────── */
  const jc = jar();
  await post(jc, "/api/signup", B);
  const mine = await jc.go("/api/load");
  add("남의 것을 못 본다", mine.status === 200 && ((mine.body || {}).saves || []).length === 0,
    "새 계정으로 받은 저장 " + ((mine.body || {}).saves || []).length + "벌 (0 이어야 한다)");

  /* ── ⑦ 막는다 ──────────────────────────────────── */
  const bare = jar();
  const noAuth = await bare.go("/api/load");
  const noAuth2 = await post(bare, "/api/save", { save: JSON.parse(wrap(hero("warrior", 99, 30, 1))) });
  let lockAt = 0;
  for (let i = 0; i < 12; i++) {
    const r = await post(jar(), "/api/login", { login: A.login, pw: "wrong-" + i });
    if (r.status === 429) { lockAt = i + 1; break; }
  }
  /* 잠갔어도 **맞는 비밀번호**까지 막혀 있어야 한다 — 그게 잠금의 뜻이다 */
  const evenRight = await post(jar(), "/api/login", A);
  add("막는다",
    noAuth.status === 401 && noAuth2.status === 401 && lockAt > 0 && lockAt <= 12 &&
    evenRight.status === 429,
    "로그인 없이 내려받기 " + noAuth.status + " · 올리기 " + noAuth2.status +
    " · 틀린 비번 " + lockAt + "번에 잠김(429) · 잠긴 뒤엔 맞는 비번도 " + evenRight.status);

} finally {
  /* ── 치운다 ── 남기면 치울 길이 없다 */
  let cleaned = "치움";
  try {
    const sql =
      "DELETE FROM sessions WHERE player_id IN (SELECT id FROM players WHERE login LIKE '" + tag + "%');" +
      "DELETE FROM saves     WHERE player_id IN (SELECT id FROM players WHERE login LIKE '" + tag + "%');" +
      "DELETE FROM save_log  WHERE player_id IN (SELECT id FROM players WHERE login LIKE '" + tag + "%');" +
      /* ⚠ **IP 잠금 기록도 지운다.** 마지막 판정이 일부러 여러 번 틀리므로
       *   안 지우면 이 컴퓨터가 15분 잠겨 **다음 실행이 제 잠금에 걸린다**
       *   (실제로 그랬다 — 둘째 실행이 "1번에 잠김" 으로 빨갰다).
       * ⚠ 표를 통째로 비우지 않는다. 이 실행이 만든 것만 지운다. */
      "DELETE FROM auth_fail WHERE at >= " + RUN_AT + ";" +
      "DELETE FROM players   WHERE login LIKE '" + tag + "%';";
    /* ⚠ `--command` 로 넘기지 않는다. 윈도우 셸을 거치며 따옴표가 깨져
     *   치우기가 조용히 실패했다(검사는 초록인데 시험 계정이 남았다).
     *   파일로 넘기면 셸이 손댈 것이 없다. */
    const tmp = path.join(os.tmpdir(), "as-clean-" + tag + ".sql");
    fs.writeFileSync(tmp, sql, "utf8");
    execFileSync("npx", ["wrangler", "d1", "execute", "abyss-arpg-db", "--remote", "--file", tmp],
      { cwd: REPO, stdio: "pipe", shell: true, timeout: 120000 });
    fs.unlinkSync(tmp);
  } catch (e) {
    cleaned = "⚠ 못 치웠다 — 손으로 지울 것: login LIKE '" + tag + "%'";
    fails++;
  }
  console.log("── 계정과 서버 저장 ──");
  console.log("   " + BASE + " · " + deployed + " · 시험 계정 " + tag + "* · " + cleaned);
  for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
  console.log();
  console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");
  process.exit(fails ? 1 : 0);
}
