/* 5단계 — 마을 · 포탈 · 귀환 · 죽음에서 돌아오는 **한 바퀴**가 도는가.
 *
 * 여기서 처음으로 "게임" 이 된다. 지금까지는 층을 키로 갈아 끼우는 실험실이었다.
 * 그래서 이 검사는 부품이 아니라 **한 바퀴**를 본다:
 *   마을 → 포탈 → 던전 → 계단 → 더 깊이 → 귀환 → 마을 → 죽음 → 마을
 *
 * ⚠ 손으로 만든 지도는 **못 가는 칸**이 생기기 쉽다(벽으로 둘러싸인 구멍).
 *   눈으로는 안 보인다 — 걸어서 닿는지 세어야 한다.
 * ⚠ "버튼이 있다" 는 "눌러서 된다" 가 아니다. 실제로 눌러 본다.
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
const URL0 = "http://127.0.0.1:" + port + "/index.html";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-town-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
const errs = []; let id = 0; const wait = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errs.push(d.text + " " + ((d.exception && d.exception.description) || ""));
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
    errs.push(m.params.args.map(a => a.value === undefined ? a.description : a.value).join(" "));
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
/* 키를 **진짜로** 누른다 — 배선을 건너뛰고 함수만 부르면 배선이 죽어도 통과한다 */
const key = async (code) => {
  /* ⚠ **keyup 을 반드시 함께 보낸다.** 안 보내면 그 키가 눌린 채로 남아 그 뒤
   *   모든 시험이 오염된다 — 실제로 KeyD 하나가 남아 주인공이 계단에서 걸어
   *   나가고 벽에 박혀 **관계없는 검사 둘이 함께 빨개졌다.**
   *   진짜 키보드는 손을 뗀다. 검사도 떼야 한다. */
  await ev(`window.dispatchEvent(new KeyboardEvent("keydown", { code: "${code}", bubbles: true }))`);
  await sleep(70);
  await ev(`window.dispatchEvent(new KeyboardEvent("keyup", { code: "${code}", bubbles: true }))`);
  await sleep(40);
};

/* ⚠ **고정 대기로 단정하지 않는다.** 1,100ms 를 세고 물어보면 아직 스크립트가
 *   안 붙은 판에서 undefined 가 돌아오고, 그 다음 줄이 "undefined 의 length"
 *   로 죽는다 — 죽는 자리가 매번 달라 원인이 안 보인다(실제로 skill-check 가
 *   그렇게 간헐로 죽었다). 준비됐는지를 **물어보고** 기다린다. */
const ready = async (ms) => {
  const until = Date.now() + (ms || 15000);
  for (;;) {
    const ok = await ev("!!(window.WORLD && window.SKILLS && window.ITEMS && window.SAVE && window.__hero)");
    if (ok) return true;
    if (Date.now() > until) throw new Error("화면이 " + (ms || 15000) + "ms 안에 안 떴다");
    await sleep(60);
  }
};
const reload = async () => { await S("Page.navigate", { url: URL0 }); await ready(); };

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
/* ⚠ 앞선 검사가 남긴 저장이 있으면 결과가 흔들린다. 지우려면 **먼저 그 주소를
 *   열어야** 한다 — about:blank 에서 지우면 다른 저장소를 지운 것이다. */
await reload();
await ev(`localStorage.clear()`);
await reload();

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* ── ① 마을에서 시작하는가 · 안전한가 ─────────────────── */
const start = await ev(`(function(){
  var p = window.__peek();
  /* ⚠ 개수를 **못 박지 않는다.** 전에 2 로 적어 뒀다가 상인·창고를 놓자마자
   *   멀쩡한 제품이 빨개졌다 — 검사는 목록(TOWN.PROPS)에서 세어야 한다. */
  p.want = Object.keys(window.TOWN.PROPS).length;
  p.ids = window.__w().props.map(function (o) { return o.id; }).sort();
  return p;
})()`);
add("마을에서 시작", start.inTown && start.foes === 0 && start.props === start.want,
  "0층 " + (start.inTown ? "✔" : "⚠아니다") + " · 몬스터 " + start.foes +
  "마리 · 말 걸 것 " + start.props + "/" + start.want + "개 [" + start.ids.join(",") + "]");

/* ── ② 손으로 만든 지도에 **못 가는 칸**이 없는가 ───────
 * ⚠ 벽으로 둘러싸인 구멍은 눈으로는 안 보인다. 시작 자리에서 걸어서 닿는
 *   칸을 세어 전체 바닥과 맞춰 본다. */
const reach = await ev(`(function(){
  var w = window.__w(), lv = w.level, D = window.DUNGEON;
  var W = lv.w, H = lv.h;
  var floors = 0;
  for (var i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] !== D.WALL) floors++;
  var seen = new Uint8Array(W * H);
  var sx = Math.floor(w.player.x), sy = Math.floor(w.player.y);
  var q = [sy * W + sx]; seen[sy * W + sx] = 1;
  var got = 0;
  while (q.length) {
    var c = q.shift(); got++;
    var cx = c % W, cy = (c / W) | 0;
    var N = [[1,0],[-1,0],[0,1],[0,-1]];
    for (var k = 0; k < 4; k++) {
      var nx = cx + N[k][0], ny = cy + N[k][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      var id = ny * W + nx;
      if (seen[id] || lv.tiles[id] === D.WALL) continue;
      seen[id] = 1; q.push(id);
    }
  }
  /* 말 걸 것들에도 실제로 닿는가 */
  var propsOk = w.props.every(function (p) {
    return seen[Math.floor(p.y) * W + Math.floor(p.x)] === 1;
  });
  return { floors: floors, got: got, propsOk: propsOk, w: W, h: H };
})()`);
add("못 가는 칸 없음", reach.got === reach.floors && reach.propsOk,
  reach.w + "×" + reach.h + " · 바닥 " + reach.floors + "칸 중 걸어서 닿는 " + reach.got +
  "칸" + (reach.propsOk ? " · 포탈·샘 모두 닿음" : " · ⚠못 닿는 물건이 있다"));

/* ── ③ 마을은 전부 보이는가 ──────────────────────────── */
const lit = await ev(`(function(){
  var lv = window.__w().level, n = 0;
  for (var i = 0; i < lv.visible.length; i++) n += lv.visible[i];
  return { vis: n, all: lv.visible.length };
})()`);
add("마을엔 안개 없음", lit.vis === lit.all, lit.vis + " / " + lit.all + "칸이 보인다");

/* ── ④ 샘 — 다가가면 안내가 뜨고, 눌러서 체력이 찬다 ──── */
const well = await ev(`(function(){
  var w = window.__w(), p = w.player;
  var o = w.props.filter(function (x) { return x.id === "well"; })[0];
  p.x = o.x; p.y = o.y + 1.0; p.px = p.x; p.py = p.y;
  p.hp = 7;
  w.advance(1/60);
  return { near: window.__near(), hp0: p.hp };
})()`);
await sleep(120);
const wellTxt = await ev(`document.getElementById("act").textContent`);
await key("KeyE");
const wellAfter = await ev(`(function(){ var p = window.__w().player;
  return { hp: p.hp, max: p.maxHp }; })()`);
add("샘에서 회복", well.near === "well" && /회복의 샘/.test(wellTxt) &&
  wellAfter.hp === wellAfter.max,
  "안내 “" + wellTxt + "” · 체력 " + well.hp0 + " → " + wellAfter.hp + "/" + wellAfter.max);

/* ── ⑤ 포탈 — 창이 열리고, **가 본 층까지만** 열린다 ──── */
await ev(`window.__hero().maxDepth = 4`);
const portalNear = await ev(`(function(){
  var w = window.__w(), p = w.player;
  var o = w.props.filter(function (x) { return x.id === "portal"; })[0];
  p.x = o.x; p.y = o.y + 1.0; p.px = p.x; p.py = p.y;
  w.advance(1/60);
  return window.__near();
})()`);
await key("KeyE");
const panel = await ev(`window.__panel()`);
add("포탈 창", portalNear === "portal" && panel.open && panel.floors === 4,
  "창 " + (panel.open ? "열림" : "⚠안 열림") + " · 고를 수 있는 층 " + panel.floors +
  "개 (도달 4층이므로 4개여야 한다)");

/* ── ⑥ 창이 열려 있으면 게임 키가 안 먹는가 ──────────────
 * ⚠ 안 막으면 층을 고르는 동안 뒤에서 주인공이 걸어간다. */
const beforeMove = await ev(`(function(){ var p = window.__w().player; return { x: p.x, y: p.y }; })()`);
await key("KeyD"); await key("KeyD");
await sleep(300);
const afterMove = await ev(`(function(){ var p = window.__w().player; return { x: p.x, y: p.y }; })()`);
add("창 열리면 키 잠김", Math.abs(afterMove.x - beforeMove.x) < 0.01,
  "창이 열린 채 D 를 눌러 본 이동 거리 " + Math.abs(afterMove.x - beforeMove.x).toFixed(3) + "칸");

/* ── ⑦ 층을 골라 실제로 들어가는가 (버튼을 **누른다**) ── */
await ev(`document.querySelector('#panel button[data-depth="3"]').click()`);
await sleep(500);
const entered = await ev(`window.__peek()`);
add("포탈로 입장", !entered.inTown && entered.depth === 3 && entered.foes > 0,
  entered.depth + "층 · 몬스터 " + entered.foes + "마리 · 창 " +
  ((await ev(`window.__panel()`)).open ? "⚠아직 열림" : "닫힘"));

/* ── ⑧ 가 본 적 없는 층은 못 가는가 ─────────────────── */
await ev(`window.__depth(99)`);
await sleep(400);
const capped = await ev(`window.__peek()`);
add("안 가 본 층 차단", capped.depth === 4,
  "99층을 요청 → " + capped.depth + "층 (도달 " + capped.maxDepth + "층이므로 4가 맞다)");

/* ── ⑨ 계단 — 눌러서 내려가고 최고층이 는다 · 체력은 이어진다 ── */
/* ⚠ 자리를 손으로 옮기기 전에 눌린 키를 턴다 — 안 그러면 옮겨 놓자마자
 *   rAF 가 주인공을 걸어 보내 "계단 위에 없다" 가 된다. */
await ev(`window.__hold([])`);
const stair = await ev(`(function(){
  var w = window.__w(), lv = w.level, p = w.player;
  var s = lv.downAt || lv.deepAt;
  if (!s) return null;
  p.x = s.x + 0.5; p.y = s.y + 0.5; p.px = p.x; p.py = p.y;
  p.hp = 33;
  w.advance(1/60);
  return { near: window.__near(), hp: p.hp, depth: w.depth, maxDepth: window.__hero().maxDepth };
})()`);
await sleep(120);
const stairTxt = await ev(`document.getElementById("act").textContent`);
await key("KeyE");
await sleep(500);
const down = await ev(`window.__peek()`);
add("계단으로 하강", !!stair && stair.near === "stairs" && down.depth === stair.depth + 1 &&
  down.maxDepth === stair.depth + 1 && down.hp === 33,
  (stair ? stair.depth + "층 → " + down.depth + "층 · 최고 " + stair.maxDepth + "→" +
   down.maxDepth + " · 체력 33 유지 " + (down.hp === 33 ? "✔" : "⚠" + down.hp) +
   " · 안내 “" + stairTxt + "”" : "⚠계단을 못 찾았다"));

/* ── ⑩ 귀환 — 2초 서 있으면 마을. 움직이면 끊긴다. ────── */
await ev(`window.__hold([])`);
const recallMove = await ev(`(function(){
  var w = window.__w();
  /* ⚠ 벽에 박힌 채로 재면 "안 움직여서 안 끊긴 것" 을 "안 끊긴다" 로 오독한다.
   *   넉넉한 자리로 옮겨 놓고 잰다. */
  var r = w.level.rooms[0];
  w.player.x = r.x + r.w / 2; w.player.y = r.y + r.h / 2;
  w.player.px = w.player.x; w.player.py = w.player.y;
  w.recallStart();
  var on = !!w.recall;
  w.player.mx = 1;                       /* 걸어 본다 */
  for (var i = 0; i < 40; i++) w.advance(1/60);
  return { started: on, still: !!w.recall, why: w.recallBroke };
})()`);
add("귀환 — 움직이면 끊김", recallMove.started && !recallMove.still,
  "시작 " + (recallMove.started ? "✔" : "⚠") + " · 걷자 " +
  (recallMove.still ? "⚠아직 돈다" : "끊김(" + recallMove.why + ")"));

const recallHit = await ev(`(function(){
  var W = window.WORLD, w = window.__w();
  w.player.mx = 0; w.player.my = 0;
  w.recallStart();
  for (var i = 0; i < 30; i++) w.advance(1/60);
  window.COMBAT.damage(w, w.ents[1] || w.player, w.player, 3);
  w.advance(1/60);
  return { still: !!w.recall, why: w.recallBroke };
})()`);
add("귀환 — 맞으면 끊김", !recallHit.still,
  recallHit.still ? "⚠맞아도 돈다" : "끊김(" + recallHit.why + ")");

await ev(`(function(){ var w = window.__w(); w.player.mx = 0; w.player.my = 0;
  w.player.hp = w.player.maxHp; w.ents.length = 1; w.recallStart(); })()`);
await sleep(2600);
const back = await ev(`window.__peek()`);
add("귀환 — 마을 도착", back.inTown, back.inTown ? "마을에 있다" : "⚠아직 " + back.depth + "층");

/* ── ⑪ 죽으면 마을에서 깬다 ──────────────────────────── */
await ev(`window.__depth(2)`);
await sleep(450);
const deaths0 = await ev(`window.__hero().deaths`);
await ev(`(function(){ var w = window.__w();
  window.COMBAT.damage(w, w.ents[1] || w.player, w.player, 99999); })()`);
await sleep(1800);
const died = await ev(`window.__peek()`);
add("죽으면 마을에서", died.inTown && died.deaths === deaths0 + 1 && died.hp === died.maxHp,
  "마을 " + (died.inTown ? "✔" : "⚠") + " · 죽음 " + deaths0 + "→" + died.deaths +
  " · 체력 " + died.hp + "/" + died.maxHp + "(가득 차야 한다)");

/* ── ⑫ 상인 — 팔고 되산다 ─────────────────────────────
 * ⚠ **되사기가 없으면 실수로 판 것이 영구 손실**이다. 그 순간 게임을 끈다. */
await ev(`window.__town()`); await sleep(400);
const shop = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON, h = window.__hero(), w = window.__w();
  var rng = D.makeRng(1234);
  h.bag = []; h.gold = 500; h.potions = 0;
  h.bag.push(I.pack(I.roll(rng, { ilvl: 10, slot: "weapon", base: "sword", tier: "common" })));
  h.bag.push(I.pack(I.roll(rng, { ilvl: 10, slot: "body", base: "mail", tier: "relic" })));
  var o = w.props.filter(function (x) { return x.id === "shop"; })[0];
  var p = w.player;
  p.x = o.x; p.y = o.y + 1.0; p.px = p.x; p.py = p.y;
  w.advance(1/60);
  return { near: window.__near(), gold: h.gold, bag: h.bag.length };
})()`);
await key("KeyE");
const shopUI = await ev(`(function(){
  var b = document.getElementById("panel");
  return { open: !b.hidden, sell: b.querySelectorAll("[data-sell]").length,
           buy: b.querySelectorAll("[data-buy]").length };
})()`);
add("상인 창", shop.near === "shop" && shopUI.open && shopUI.sell === 2 && shopUI.buy === 1,
  "창 " + (shopUI.open ? "열림" : "⚠안 열림") + " · 팔 것 " + shopUI.sell +
  "개 · 살 것 " + shopUI.buy + "개");

await ev(`document.querySelector("[data-sell=\\"0\\"]").click()`);
await sleep(200);
const sold = await ev(`(function(){
  var h = window.__hero();
  return { gold: h.gold, bag: h.bag.length, buyback: window.__buyback(),
           can: document.querySelectorAll("[data-buyback]").length };
})()`);
add("팔면 되살 수 있다", sold.gold > shop.gold && sold.bag === 1 && sold.can === 1,
  "금화 " + shop.gold + "→" + sold.gold + " · 가방 " + shop.bag + "→" + sold.bag +
  " · 되사기 목록 " + sold.can + "개");

await ev(`document.querySelector("[data-buyback=\\"0\\"]").click()`);
await sleep(200);
const rebought = await ev(`(function(){ var h = window.__hero();
  return { gold: h.gold, bag: h.bag.length }; })()`);
add("되사기", rebought.bag === 2 && rebought.gold === shop.gold,
  "가방 " + sold.bag + "→" + rebought.bag + " · 금화 " + sold.gold + "→" + rebought.gold +
  "(판 값 그대로 돌아와야 한다)");

/* ⚠ 쓸어 팔기가 **희귀·유물까지 쓸어 가면** 한 번의 실수로 다 잃는다 */
await ev(`document.querySelector("[data-selljunk]").click()`);
await sleep(200);
const junk = await ev(`(function(){
  var S = window.SAVE, h = window.__hero();
  var left = S.liveBag(h);
  return { n: left.length, tiers: left.map(function(x){ return x.tier; }) };
})()`);
add("쓸어 팔기는 일반만", junk.n === 1 && junk.tiers[0] === "relic",
  "일반 1 + 유물 1 에서 쓸어 팔기 → 남은 " + junk.n + "개 [" + junk.tiers.join(",") + "]");

/* ── ⑬ 창고 — 넣고 꺼낸다 ───────────────────────────────
 * ⚠ 앞 시험이 상인 창을 **열어 둔 채**였다. 창이 열려 있으면 키가 잠기므로
 *   E 를 눌러도 아무 일이 없다(그게 맞는 동작이다 — 제품이 아니라 검사가
 *   순서를 빠뜨린 것이다). 먼저 닫는다. */
await key("Escape");
const stash = await ev(`(function(){
  var w = window.__w(), h = window.__hero();
  var o = w.props.filter(function (x) { return x.id === "stash"; })[0];
  var p = w.player;
  p.x = o.x; p.y = o.y + 1.0; p.px = p.x; p.py = p.y;
  w.advance(1/60);
  return { near: window.__near(), bag: h.bag.length, st: h.stash.length };
})()`);
await key("KeyE");
await sleep(150);
await ev(`document.querySelector("[data-put=\\"0\\"]").click()`);
await sleep(200);
const put = await ev(`(function(){ var h = window.__hero();
  return { bag: h.bag.length, st: h.stash.length,
           get: document.querySelectorAll("[data-get]").length }; })()`);
await ev(`document.querySelector("[data-get=\\"0\\"]").click()`);
await sleep(200);
const got = await ev(`(function(){ var h = window.__hero();
  return { bag: h.bag.length, st: h.stash.length }; })()`);
add("창고", stash.near === "stash" && put.st === 1 && put.bag === 0 &&
  got.bag === 1 && got.st === 0,
  "가방→창고 " + stash.bag + "/" + stash.st + " → " + put.bag + "/" + put.st +
  " → 꺼내서 " + got.bag + "/" + got.st);

/* 창고는 **새로고침해도** 남아야 한다 — 그게 창고의 뜻이다 */
await ev(`(function(){ var h = window.__hero();
  h.stash = h.bag.slice(); h.bag = []; window.__save(); })()`);
await reload();
const kept2 = await ev(`(function(){ var h = window.__hero();
  return { st: h.stash.length, bag: h.bag.length }; })()`);
add("창고는 남는다", kept2.st === 1, "새로고침 뒤 창고 " + kept2.st + "개 · 가방 " + kept2.bag + "개");

/* ── ⑭ 마을에서는 귀환이 안 걸리는가 ─────────────────── */
const inTownRecall = await ev(`(function(){ var w = window.__w(); return w.recallStart(); })()`);
add("마을선 귀환 없음", inTownRecall === false, "마을에서 T → " + inTownRecall);

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n5단계 — 마을 · 포탈 · 귀환 · 한 바퀴\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(18, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
