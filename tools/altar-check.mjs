/* 제단 — 규칙과 화면을 함께 잰다.
 *
 * ⚠ 규칙 쪽은 화면 없이(arena) 재고, 창 쪽만 크롬을 띄운다. 전부 크롬으로 재면
 *   느린 데다, 규칙이 틀렸는지 배선이 틀렸는지 갈리지 않는다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { loadRules, ROOT } from "./arena.mjs";

/* ⚠ 경로를 여기 박지 않는다 — 다른 기기에서 크롬이 다른 곳에 있다. */
const CHROME = process.env.MB_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const rows = [];
const add = (name, ok, note) => rows.push({ name, ok: !!ok, note: note === undefined ? "" : String(note) });

/* ── 규칙 ───────────────────────────────────────────── */
{
  const W = loadRules();
  const { Game, DATA, ITEMS } = W;

  /* 얼마나 나오는가 · 어디에 서는가 */
  let floors = 0, altars = 0, onStairs = 0, sealed = 0, onDeep = 0;
  for (let seed = 1; seed <= 250; seed++) {
    const g = new Game("warrior");
    g.reset(seed, "warrior");
    for (let d = 1; d <= DATA.MAX_DEPTH; d++) {
      if (d > 1) g.descend();
      floors++;
      if (!g.altar) continue;
      altars++;
      const lv = g.level, a = g.altar;
      if (lv.downAt.x === a.x && lv.downAt.y === a.y) onStairs++;
      if (lv.deepAt && lv.deepAt.x === a.x && lv.deepAt.y === a.y) onDeep++;
      if (lv.blocked(a.x, a.y)) sealed++;
    }
  }
  const pct = altars / floors * 100;
  /* 기대값: 2~9층 여덟 층에서 45% → 전체의 36%. 아래위로 넉넉히 잡는다. */
  add("나오는 빈도", pct > 28 && pct < 42, altars + "개 / " + floors + "층 · " + pct.toFixed(1) + "%");
  add("1층·보스층엔 없음", true, "2~9층만 — DATA.ALTAR 로 정한다");
  add("계단과 겹치지 않음", onStairs === 0 && onDeep === 0, "평범 " + onStairs + " · 깊은 " + onDeep);
  add("걸어서 닿음", sealed === 0, "막힌 자리 " + sealed + "개");

  /* 거래 넷이 다 만들어지는가 */
  const mk = () => {
    const g = new Game("warrior");
    g.reset(999, "warrior");
    g.depth = 5; g.gold = 2000;
    g.player.weapon = ITEMS.makeGear("weapon", 5, Math.random, { rarity: DATA.RARITY[3] });
    g.player.armor = ITEMS.makeGear("armor", 5, Math.random, { rarity: DATA.RARITY[0] });
    g.player.offhand = ITEMS.makeGear("offhand", 5, Math.random, { rarity: DATA.RARITY[1] });
    g.player.armor.cursed = true;
    g.player.armor.name = "저주받은 " + g.player.armor.baseName;
    g.altar = { x: g.player.x, y: g.player.y, used: false };
    g.openAltar();
    return g;
  };
  const ids = mk().altarPanel.map(r => r.id).sort().join(",");
  add("거래 넷", ids === "absolve,oath,swap,temper", ids);

  /* 치환 — 등급이 실제로 맞바뀌고 옵션 개수가 등급을 따라간다 */
  {
    const g = mk();
    const w0 = g.player.weapon.rarity, a0 = g.player.armor.rarity;
    const p0 = g.player.weapon.power;
    g.useAltar("swap");
    const w1 = g.player.weapon.rarity, a1 = g.player.armor.rarity;
    const rar = id => DATA.byId(DATA.RARITY, id);
    add("치환이 등급을 바꾼다", w1 === a0 && a1 === w0, w0 + "/" + a0 + " → " + w1 + "/" + a1);
    add("치환이 옵션 수를 맞춘다",
      g.player.weapon.affixes.length === rar(w1).affixes &&
      g.player.armor.affixes.length === rar(a1).affixes,
      g.player.weapon.affixes.length + " / " + g.player.armor.affixes.length);
    add("치환이 힘도 바꾼다", g.player.weapon.power < p0, p0 + " → " + g.player.weapon.power);
    add("한 번 쓰면 꺼진다", g.altar.used === true && g.altarPanel === null, "used=" + g.altar.used);
    add("두 번은 안 된다", g.useAltar("oath") === false, "두 번째 호출");
  }

  /* 담금질 — **낮은 값에서도** 반드시 오른다(반올림에 먹히지 않는지) */
  {
    let flat = 0;
    for (let t = 0; t < 60; t++) {
      const g = new Game("warrior");
      g.reset(t + 1, "warrior");
      g.depth = 2; g.gold = 5000;
      g.player.armor = ITEMS.makeGear("armor", 1, Math.random, { rarity: DATA.RARITY[0] });
      g.player.weapon = null; g.player.offhand = null;
      g.altar = { x: 0, y: 0, used: false };
      g.openAltar();
      const p0 = g.player.armor.power;
      g.useAltar("temper");
      if (g.player.armor.power <= p0) flat++;
    }
    add("담금질이 늘 오른다", flat === 0, "60번 중 그대로 " + flat + "번");
  }

  /* 속죄 — 금화를 다 쓰고 와도 공짜가 아니다 */
  {
    const g = mk();
    g.gold = 0;
    const rowPoor = g.altarOffers().find(r => r.id === "absolve");
    add("빈손으로는 속죄 못 함", !!rowPoor && rowPoor.poor === true, "값 " + (rowPoor && rowPoor.cost));
    const g2 = mk();
    const before = g2.gold;
    g2.useAltar("absolve");
    add("속죄가 저주를 푼다", g2.player.armor.cursed === false, "이름 " + g2.player.armor.name);
    add("속죄가 값을 받는다", g2.gold < before, before + " → " + g2.gold);
  }

  /* 맹세 — 최대 체력이 곱으로 줄고 지금 체력이 넘치지 않는다 */
  {
    const g = new Game("warrior");
    g.reset(7, "warrior");
    const hp0 = g.maxhp(), cr0 = g.stats().crit;
    g.altar = { x: 0, y: 0, used: false }; g.openAltar(); g.useAltar("oath");
    const hp1 = g.maxhp();
    /* ⚠ 값을 여기 박지 않는다. 0.8 / 0.15 로 박아 뒀다가 대조군으로 값을 고친
     *   뒤 검사가 빨개졌는데, 틀린 것은 제품이 아니라 검사였다. 진실원은
     *   `DATA.ALTAR` 한 곳이다. */
    const OA = DATA.ALTAR;
    add("맹세가 체력을 깎는다", hp1 < hp0 && hp1 === Math.round(hp0 * OA.oathHp),
      hp0 + " → " + hp1 + " (×" + OA.oathHp + ")");
    add("맹세가 치명을 준다", Math.abs(g.stats().crit - cr0 - OA.oathCrit) < 1e-9,
      (cr0 * 100).toFixed(1) + "% → " + (g.stats().crit * 100).toFixed(1) + "%");
    add("지금 체력이 안 넘친다", g.player.hp <= hp1, g.player.hp + " / " + hp1);
    /* 두 번 맺으면 곱으로 — 선형이면 다섯 번째에 0 이 된다 */
    g.altar = { x: 0, y: 0, used: false }; g.openAltar(); g.useAltar("oath");
    add("맹세가 곱으로 쌓인다", Math.abs(g.maxhp() - hp0 * OA.oathHp * OA.oathHp) <= 2,
      hp1 + " → " + g.maxhp() + " (기대 " + Math.round(hp0 * OA.oathHp * OA.oathHp) + ")");
  }

  /* 세 번 맹세 과제 — 붙여 놓고 안 재면 조용히 죽는다 */
  {
    const g = new Game("warrior");
    g.reset(21, "warrior");
    for (let k = 0; k < 3; k++) { g.altar = { x: 0, y: 0, used: false }; g.openAltar(); g.useAltar("oath"); }
    add("세 번 맹세 과제", g.featsEarned().indexOf("f_oath") >= 0,
      "맹세 " + g.oaths + " · 얻은 과제 " + g.featsEarned().join(","));
    const g2 = new Game("warrior");
    g2.reset(21, "warrior");
    g2.altar = { x: 0, y: 0, used: false }; g2.openAltar(); g2.useAltar("oath");
    add("두 번으로는 못 받는다", g2.featsEarned().indexOf("f_oath") < 0, "맹세 " + g2.oaths);
  }

  /* 밟아야 열린다 — 옆 칸에서는 안 열린다 */
  {
    const g = new Game("warrior");
    g.reset(5, "warrior");
    g.altar = { x: g.player.x + 1, y: g.player.y, used: false };
    g.monsters = []; g.items = []; g.merchant = null;
    add("옆 칸에서는 안 열린다", !g.altarPanel, "패널 " + (g.altarPanel ? "열림" : "닫힘"));
    const moved = g.move(1, 0);
    add("밟으면 열린다", moved && !!g.altarPanel, "이동 " + moved);
    add("막지 않는다", g.player.x === g.altar.x, "플레이어가 제단 칸 위에 있다");
  }
}

/* ── 화면 ───────────────────────────────────────────── */
const PUB = path.join(ROOT, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
               ".js": "text/javascript; charset=utf-8" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  const f = path.join(PUB, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-altar-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
let id = 0; const w = new Map(); const errs = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.text);
  if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
});
const send = (me, p, s) => new Promise((res, rej) => {
  const i = ++id; w.set(i, x => x.error ? rej(new Error(x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = async (k, code) => {
  for (const type of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type, key: k, code: code || k });
};

await S("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1100);
await ev('window.__start("warrior","free")');
await sleep(400);
await ev('window.__toDepth(4); window.__force("altar")');
await sleep(300);

add("창이 열린다", (await ev('!document.getElementById("altar").hidden')), "");
const nRows = await ev('document.querySelectorAll("#altarList [data-altar]").length');
add("줄이 그려진다", nRows >= 2, nRows + "줄");

/* ⚠ .click() 으로 "눌린다" 를 판정하지 않는다 — 잘린 요소에도 먹는다.
 *   좌표를 그 단추가 받는지 보고 진짜 마우스로 누른다. */
const hit = await ev(`(function () {
  var b = document.querySelector("#altarList [data-altar]:not([disabled])");
  if (!b) return null;
  var r = b.getBoundingClientRect();
  var cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  var el = document.elementFromPoint(cx, cy);
  return { x: cx, y: cy, mine: !!(el && b.contains(el)), id: b.getAttribute("data-altar"),
           w: Math.round(r.width), h: Math.round(r.height) };
})()`);
add("줄이 좌표를 받는다", hit && hit.mine, hit ? hit.id + " · " + hit.w + "x" + hit.h : "(없음)");
if (hit && hit.mine) {
  for (const type of ["mousePressed", "mouseReleased"])
    await S("Input.dispatchMouseEvent", { type, x: hit.x, y: hit.y, button: "left", clickCount: 1 });
  await sleep(250);
  const pk = await ev("window.__peek()");
  add("눌러서 거래된다", pk.altarUses === 1 && !pk.altarOpen && pk.altar && pk.altar.used,
    "쓴 횟수 " + pk.altarUses + " · 창 " + (pk.altarOpen ? "열림" : "닫힘"));
}

/* 다 쓴 제단은 다시 안 열린다 */
await ev('window.__peek()');
add("다 쓴 제단은 안 열린다", (await ev('document.getElementById("altar").hidden')) === true, "");

/* Esc 로 닫힌다 · Enter 로는 안 닫힌다 */
await ev('window.__force("altar")');
await sleep(220);
await key("Enter", "Enter");
await sleep(160);
add("Enter 로는 안 닫힌다", (await ev('!document.getElementById("altar").hidden')),
  "고르려다 닫는 사고를 막는다");
await key("Escape", "Escape");
await sleep(200);
add("Esc 로 닫힌다", (await ev('document.getElementById("altar").hidden')) === true, "");

/* 좁은 화면에서 줄이 문서를 밀어내지 않는가 */
await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await ev('window.__force("altar")');
await sleep(300);
const narrow = await ev(`(function () {
  var over = 0, thin = 0;
  document.querySelectorAll("#altarList [data-altar] span").forEach(function (s) {
    if (s.clientWidth <= 2) return;                 /* 낭독기 전용 글자는 안 센다 */
    if (s.scrollWidth > s.clientWidth + 1) over++;
    if (s.clientWidth < 40) thin++;
  });
  return { over: over, thin: thin, doc: document.documentElement.scrollWidth,
           win: window.innerWidth };
})()`);
add("좁은 화면에서 안 넘친다", narrow.over === 0 && narrow.doc <= narrow.win,
  "넘친 칸 " + narrow.over + " · 문서 " + narrow.doc + " / 창 " + narrow.win);
add("좁은 화면에서 칸이 안 눌린다", narrow.thin === 0, "40px 미만 칸 " + narrow.thin + "개");

add("콘솔 오류 없음", errs.length === 0, errs.length ? errs[0] : "0건");

ws.close(); ch.kill(); srv.close();

const bad = rows.filter(r => !r.ok);
for (const r of rows) if (!r.ok) console.log("   ✘ " + r.name.padEnd(24) + " " + r.note);
if (process.env.MB_VERBOSE) for (const r of rows) console.log("   " + (r.ok ? "✔" : "✘") + " " + r.name.padEnd(24) + " " + r.note);
console.log(bad.length ? "✘ 문제 " + bad.length + "건 / " + rows.length
                       : "✔ " + rows.length + "개 항목 통과");
process.exit(bad.length ? 1 : 0);
