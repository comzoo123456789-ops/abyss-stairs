/* 6단계 — 아이템 엔진 · 전리품 · 장착이 **정말** 맞는가.
 *
 * 아이템은 조합 공간이 넓다(슬롯 7 × 베이스 × 등급 4 × 접사 16). 한두 개 굴려
 * 보고 "괜찮네" 하면 **수천 판 뒤에 터지는 것**을 못 잡는다. 그래서 많이 굴린다.
 *
 * ⚠ 표시와 실제가 갈리는 것이 이 단계의 대표 사고다("표시는 +30 인데 실제는 +24").
 *   화면 글자가 아니라 **몸에 적용된 값**을 잰다.
 * ⚠ 장비를 뺐다 끼는 것만으로 회복되면 물약이 필요 없어진다 — 실제로 해 본다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-gear-"));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
/* ⚠ 고정 대기로 단정하지 않는다 — 준비됐는지를 물어보고 기다린다.
 * 스크립트가 덜 붙은 판에서 undefined 가 돌아오면 한참 뒤 엉뚱한 줄에서 죽는다. */
const ready = async (ms) => {
  const until = Date.now() + (ms || 15000);
  for (;;) {
    const ok = await ev("!!(window.WORLD && window.SKILLS && window.ITEMS && window.SAVE && window.__hero)");
    if (ok) return true;
    if (Date.now() > until) throw new Error("화면이 안 떴다");
    await sleep(60);
  }
};
await S("Page.navigate", { url: URL0 }); await ready();
await ev(`localStorage.clear()`);
await S("Page.navigate", { url: URL0 }); await ready();

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* ── ① 표가 스스로 어긋나지 않았는가 ──────────────────── */
const audit = await ev(`window.ITEMS.audit()`);
add("표 자기 점검", audit.length === 0, audit.length ? audit.join(" / ") : "이상 없음");

/* ── ② 많이 굴려 본다 — 3,000개 ───────────────────────
 * 한두 개로는 "슬롯 하나에서만 터지는" 것을 못 잡는다. */
const bulk = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  var rng = D.makeRng(20260921);
  var bad = [], tierCount = {}, slotCount = {}, maxReq = 0, reqOverIlvl = 0;
  var roundTrip = 0, nameEmpty = 0, negVal = 0;
  for (var n = 0; n < 3000; n++) {
    var ilvl = 1 + (n % 30);
    var it = I.roll(rng, { ilvl: ilvl });
    tierCount[it.tier] = (tierCount[it.tier] || 0) + 1;
    slotCount[it.slot] = (slotCount[it.slot] || 0) + 1;
    if (!it.name || !it.name.length) nameEmpty++;
    if (!(it.val > 0)) negVal++;
    maxReq = Math.max(maxReq, it.req);
    /* ⚠ 물건 수준보다 **한참 높은** 요구 레벨이 나오면 "주웠는데 영영 못 쓰는"
     *   물건이 된다. 접사 il 이 ilvl 로 걸러지므로 원리상 없어야 한다. */
    if (it.req > ilvl + 2) reqOverIlvl++;
    /* 저장 왕복 — 다섯 칸으로 줄였다 되살렸을 때 같은가 */
    var back = I.rebuild(I.pack(it));
    if (!back || back.name !== it.name || back.req !== it.req ||
        JSON.stringify(back.s) !== JSON.stringify(it.s)) roundTrip++;
    /* 수치가 표에 없는 이름이면 아무도 안 읽는다 */
    for (var k in it.s) {
      if (["dmg","hp","armor","spdPct","apsPct","critPct","critDmgPct",
           "lifeOnHit","goldPct","xpPct"].indexOf(k) < 0) bad.push(it.name + " 의 " + k);
    }
  }
  return { bad: bad.slice(0,3), tierCount: tierCount, slots: Object.keys(slotCount).length,
           maxReq: maxReq, reqOverIlvl: reqOverIlvl, roundTrip: roundTrip,
           nameEmpty: nameEmpty, negVal: negVal };
})()`);
add("3,000개 굴리기", bulk.bad.length === 0 && bulk.slots === 7 &&
  bulk.nameEmpty === 0 && bulk.negVal === 0 && bulk.reqOverIlvl === 0,
  "슬롯 " + bulk.slots + "종 · 등급 " +
  Object.keys(bulk.tierCount).map(k => k + " " + bulk.tierCount[k]).join(" ") +
  " · 최고 요구 Lv." + bulk.maxReq +
  (bulk.bad.length ? " · ⚠읽는 이 없는 수치 " + bulk.bad.join(",") : "") +
  (bulk.reqOverIlvl ? " · ⚠수준보다 높은 요구 " + bulk.reqOverIlvl + "건" : ""));

add("저장 왕복", bulk.roundTrip === 0,
  "3,000개를 다섯 칸으로 줄였다 되살림 · 달라진 것 " + bulk.roundTrip + "개");

/* ── ③ 등급 분포가 뜻대로인가 ─────────────────────────
 * ⚠ 유물이 흔하면 가치가 없고, 안 나오면 세트를 영영 못 모은다. */
const dist = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  var rng = D.makeRng(777), c = {};
  for (var n = 0; n < 20000; n++) { var t = I.roll(rng, { ilvl: 20 }).tier; c[t] = (c[t]||0)+1; }
  var want = {};
  var tot = I.TIERS.reduce(function(a,t){return a+t.w;},0);
  I.TIERS.forEach(function(t){ want[t.id] = t.w / tot; });
  var worst = 0, worstId = "";
  for (var k in want) {
    var got = (c[k]||0) / 20000;
    var gap = Math.abs(got - want[k]) / want[k];
    if (gap > worst) { worst = gap; worstId = k; }
  }
  return { c: c, worst: worst, worstId: worstId };
})()`);
add("등급 분포", dist.worst < 0.12,
  Object.keys(dist.c).map(k => k + " " + (dist.c[k] / 200).toFixed(1) + "%").join(" · ") +
  " · 가장 어긋난 것 " + dist.worstId + " " + (dist.worst * 100).toFixed(1) + "%");

/* ── ④ 세트가 **정말 모아지는가** ─────────────────────
 * ⚠ 세트 조각이 같은 슬롯에 둘 있으면 영원히 3피스가 안 된다. 굴려서 확인한다. */
const setTest = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  var st = I.SETS[0];
  var eq = {};
  var rng = D.makeRng(31);
  for (var i = 0; i < st.pieces.length; i++) {
    var p = st.pieces[i];
    eq[p.slot] = I.roll(rng, { ilvl: 25, slot: p.slot, base: p.base, tier: "relic" });
  }
  var made = Object.keys(eq).filter(function(k){ return eq[k].set === st.id; }).length;
  var full = I.totals(eq);
  /* 3피스만 */
  var three = {};
  for (var j = 0; j < 3; j++) three[st.pieces[j].slot] = eq[st.pieces[j].slot];
  var t3 = I.totals(three);
  return { made: made, of: st.pieces.length,
           sets5: (full._sets[0]||{}).on ? full._sets[0].on.length : 0,
           sets3: (t3._sets[0]||{}).on ? t3._sets[0].on.length : 0,
           bonus5crit: full.critPct, bonus3spd: t3.spdPct };
})()`);
add("세트 완성", setTest.made === setTest.of && setTest.sets3 === 1 && setTest.sets5 === 2,
  "조각 " + setTest.made + "/" + setTest.of + " · 3피스에서 보너스 " + setTest.sets3 +
  "개(이동 +" + setTest.bonus3spd + "%) · 5피스에서 " + setTest.sets5 +
  "개(치명타 " + setTest.bonus5crit + "%)");

/* ── ⑤ 입으면 **몸이 정말 달라지는가** ───────────────
 * ⚠ 화면 글자가 아니라 적용된 값을 본다. 둘이 갈리는 것이 이 단계의 대표 사고다. */
const wear = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON, w = window.__w(), h = window.__hero();
  h.level = 30; h.bag = []; h.equip = {};
  w.applyHero();
  var before = { dmg: w.player.swing ? w.player.swing.dmg : window.COMBAT.SWING.dmg,
                 aps: w.player.swing ? w.player.swing.aps : window.COMBAT.SWING.aps,
                 reach: w.player.swing ? w.player.swing.reach : window.COMBAT.SWING.reach,
                 maxHp: w.player.maxHp, def: w.player.def, spd: w.player.spd };
  var rng = D.makeRng(99);
  /* 창 — 사거리가 길고 느리다 */
  var spear = I.roll(rng, { ilvl: 20, slot: "weapon", base: "spear", tier: "common" });
  h.equip.weapon = I.pack(spear);
  w.applyHero();
  var withSpear = { dmg: w.player.swing.dmg, aps: w.player.swing.aps, reach: w.player.swing.reach };
  /* 단검 — 짧고 빠르다 */
  var dagger = I.roll(rng, { ilvl: 20, slot: "weapon", base: "dagger", tier: "common" });
  h.equip.weapon = I.pack(dagger);
  w.applyHero();
  var withDagger = { dmg: w.player.swing.dmg, aps: w.player.swing.aps, reach: w.player.swing.reach };
  /* 방어구 한 벌 */
  var mail = I.roll(rng, { ilvl: 20, slot: "body", base: "mail", tier: "common" });
  h.equip.body = I.pack(mail);
  w.applyHero();
  var armored = { maxHp: w.player.maxHp, def: w.player.def, spd: w.player.spd };
  return { before: before, spear: withSpear, dagger: withDagger, armored: armored,
           spearBase: spear.s.dmg, mailArmor: mail.s.armor };
})()`);
add("무기가 규칙을 바꾼다",
  wear.spear.reach > wear.dagger.reach + 0.8 && wear.dagger.aps > wear.spear.aps + 0.5,
  "창 사거리 " + wear.spear.reach.toFixed(2) + "칸 / 초당 " + wear.spear.aps.toFixed(2) +
  "회 · 단검 " + wear.dagger.reach.toFixed(2) + "칸 / " + wear.dagger.aps.toFixed(2) + "회");
add("방어구가 몸을 바꾼다",
  wear.armored.def > wear.before.def && wear.armored.maxHp > wear.before.maxHp &&
  wear.armored.spd < wear.before.spd,
  "방어 " + wear.before.def + "→" + wear.armored.def +
  " · 최대체력 " + wear.before.maxHp + "→" + wear.armored.maxHp +
  " · 속도 " + wear.before.spd.toFixed(2) + "→" + wear.armored.spd.toFixed(2) + "칸/초(사슬갑옷은 느려야 한다)");

/* ── ⑥ 장비를 뺐다 끼는 것이 **회복이 되면 안 된다** ──── */
const cheese = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON, w = window.__w(), h = window.__hero();
  var p = w.player;
  p.hp = 20;
  var hp0 = p.hp, cyc = [];
  for (var n = 0; n < 8; n++) {
    var keep = h.equip.body;
    delete h.equip.body; w.applyHero();
    h.equip.body = keep;  w.applyHero();
    cyc.push(p.hp);
  }
  return { hp0: hp0, end: p.hp, path: cyc.slice(0, 3) };
})()`);
add("장비로 회복 못 함", cheese.end <= cheese.hp0,
  "체력 " + cheese.hp0 + " 에서 갑옷을 8번 뺐다 낌 → " + cheese.end +
  " (늘어나면 물약이 필요 없어진다)");

/* ── ⑦ 레벨이 모자라면 못 입는가 ─────────────────────── */
const req = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON, w = window.__w(), h = window.__hero();
  h.level = 1; h.equip = {}; h.bag = [];
  var rng = D.makeRng(5);
  var hard = I.roll(rng, { ilvl: 20, slot: "amulet", base: "talisman", tier: "common" });
  h.bag.push(I.pack(hard));
  w.applyHero();
  window.__equip(0);
  return { req: hard.req, level: h.level, wore: !!h.equip.amulet, bag: h.bag.length };
})()`);
add("레벨 제한", req.req > req.level && !req.wore && req.bag === 1,
  "Lv." + req.level + " 가 Lv." + req.req + " 물건을 " +
  (req.wore ? "⚠입었다" : "못 입음") + " · 가방에 " + req.bag + "개 남음");

/* ── ⑧ 바꿔 낄 때 쓰던 것이 **가방으로 돌아오는가** ────
 * ⚠ 안 돌려주면 바꿔 끼는 순간 전에 쓰던 것이 영영 사라진다. */
const swap = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON, w = window.__w(), h = window.__hero();
  h.level = 30; h.equip = {}; h.bag = [];
  var rng = D.makeRng(11);
  var a = I.roll(rng, { ilvl: 10, slot: "weapon", base: "sword", tier: "common" });
  var b = I.roll(rng, { ilvl: 10, slot: "weapon", base: "axe", tier: "common" });
  h.bag.push(I.pack(a)); h.bag.push(I.pack(b));
  w.applyHero();
  window.__equip(0);                    /* 검을 낀다 */
  var afterFirst = { eq: h.equip.weapon.b, bag: h.bag.length };
  window.__equip(h.bag.findIndex(function(x){ return x.b === "axe"; }));
  var afterSwap = { eq: h.equip.weapon.b, bag: h.bag.map(function(x){ return x.b; }) };
  return { afterFirst: afterFirst, afterSwap: afterSwap };
})()`);
add("바꿔 껴도 안 잃음",
  swap.afterSwap.eq === "axe" && swap.afterSwap.bag.indexOf("sword") >= 0,
  "검 착용 → 도끼로 교체 → 지금 " + swap.afterSwap.eq +
  " · 가방 [" + swap.afterSwap.bag.join(",") + "] (검이 있어야 한다)");

/* ── ⑨ 실제 사냥 — 잡으면 떨어지고, 금화는 알아서 들어오는가 ── */
const hunt = await ev(`(function(){
  var W = window.WORLD, D = window.DUNGEON;
  window.__depth && 0;
  var w = window.__w();
  return 1;
})()`);
await ev(`window.__hero().maxDepth = 5; window.__hero().level = 30; window.__depth(3)`);
await sleep(500);
const loot = await ev(`(function(){
  var W = window.WORLD, w = window.__w(), h = window.__hero();
  var D = window.DUNGEON;
  w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
  w.level.visible.fill(1); w.level.seen.fill(1);
  w.refreshFov = function () { this.level.visible.fill(1); return false; };
  w.ents.length = 1;
  w.drops.length = 0;
  h.bag = []; h.gold = 0;
  var p = w.player;
  p.x = 20.5; p.y = 15.5; p.px = p.x; p.py = p.y;
  /* 허수아비 20마리를 차례로 잡는다 */
  for (var k = 0; k < 20; k++) {
    var foe = new W.Entity({ x: 21.2, y: 15.5, sprite: "rat", team: 1,
      hp: 4, xp: 5, gold: 6, name: "쥐" });
    w.ents.push(foe);
    for (var i = 0; i < 400 && !foe.dead; i++) { w.swing(99, 15.5); w.advance(1/60); }
  }
  /* 금화가 자동으로 들어올 시간을 준다 */
  for (var t = 0; t < 120; t++) w.advance(1/60);
  var items = w.drops.filter(function(d){ return d.item; });
  return { gold: h.gold, itemsOnFloor: items.length, goldOnFloor: w.drops.length - items.length,
           bag: h.bag.length };
})()`);
add("전리품", loot.gold > 0 && loot.itemsOnFloor > 0 && loot.goldOnFloor === 0,
  "20마리 잡음 → 금화 " + loot.gold + "(자동으로 들어옴 · 바닥에 남은 금화 " +
  loot.goldOnFloor + ") · 바닥의 물건 " + loot.itemsOnFloor + "개");

/* 물건은 **눌러야** 줍는다 */
const pick = await ev(`(function(){
  var w = window.__w(), h = window.__hero(), p = w.player;
  var d = w.drops.filter(function(x){ return x.item; })[0];
  if (!d) return null;
  p.x = d.x; p.y = d.y; p.px = p.x; p.py = p.y;
  w.advance(1/60);
  var before = h.bag.length, near = window.__near();
  window.__act();
  return { before: before, after: h.bag.length, near: near, name: d.item.name };
})()`);
add("물건은 눌러 줍는다", !!pick && pick.after === pick.before + 1,
  pick ? "“" + pick.name + "” 위에서 E → 가방 " + pick.before + "→" + pick.after
       : "⚠떨어진 물건이 없다");

/* ── ⑩ 치명타가 실제로 터지는가 ──────────────────────── */
const crit = await ev(`(function(){
  var W = window.WORLD, w = window.__w();
  var p = w.player;
  /* ⚠ 앞 시험이 주인공을 전리품 자리로 옮겨 놨다. 자리를 **다시 잡지 않으면**
   *   허수아비가 사거리 밖이라 0 피해가 나오고, 그걸 "치명타가 안 터진다" 로
   *   오독한다(실측으로 그렇게 빨개졌다). 시험마다 자리를 못 박는다. */
  p.x = 20.5; p.y = 15.5; p.px = p.x; p.py = p.y;
  p.knock = null; p.atk = null; p.atkRest = 0;
  p.critPct = 100; p.critDmgPct = 0;           /* 늘 치명타 · 배수 150% */
  p.swing = { aps: 4, windup: 0.05, recover: 0.05, reach: 2, arc: 180, dmg: 10, push: 0 };
  var foe = new W.Entity({ x: 21.0, y: 15.5, sprite: "rat", team: 1, hp: 99999 });
  w.ents.push(foe);
  var h0 = foe.hp;
  w.swing(99, 15.5);
  for (var i = 0; i < 20; i++) w.advance(1/60);
  var critHit = h0 - foe.hp;
  p.critPct = 0;
  var h1 = foe.hp;
  for (var j = 0; j < 40; j++) { w.swing(99, 15.5); w.advance(1/60); if (foe.hp < h1) break; }
  var normal = h1 - foe.hp;
  return { critHit: critHit, normal: normal };
})()`);
add("치명타", crit.critHit === 15 && crit.normal === 10,
  "한 대 10 · 치명타 " + crit.critHit + "(150% 여야 한다) · 평타 " + crit.normal);

/* ── ⑪ 가방 화면이 실제로 열리고 눌리는가 ─────────────── */
await ev(`window.__bag()`);
await sleep(200);
const ui = await ev(`(function(){
  var box = document.getElementById("panel");
  return { open: !box.hidden, wide: box.className.indexOf("wide") >= 0,
           /* 옛 표시([data-off] / .itm.empty / [data-on])를 세고 있었다.
            * 가방 화면을 다시 그리면서 data-eq-slot / data-bag-idx 로 바뀌었는데
            * 검사만 옛것을 봤다 - 늘 0개라 화면이 멀쩡해도 빨갰다.
            * 검사 안에 박힌 목록은 제품의 진실이 아니라 검사의 기억이다.
            * (여기는 지문 안이다. 홑따옴표 기울임표를 쓰면 지문이 거기서 끊긴다.) */
           slots: box.querySelectorAll("[data-eq-slot]").length,
           bagBtns: box.querySelectorAll("[data-bag-idx]").length,
           text: box.textContent.slice(0, 40) };
})()`);
add("가방 화면", ui.open && ui.wide && ui.slots === 7,
  "열림 " + ui.open + " · 장착 칸 " + ui.slots + "개(7이어야 한다) · 가방 항목 " + ui.bagBtns + "개");

/* 화면 밖으로 잘리지 않는가 — 넓은 창의 고전 사고 */
const fit = await ev(`(function(){
  var box = document.getElementById("panel");
  var r = box.getBoundingClientRect();
  var over = 0;
  box.querySelectorAll(".itm, .col").forEach(function (el) {
    var b = el.getBoundingClientRect();
    if (b.right > r.right + 1) over++;
  });
  return { w: Math.round(r.width), vw: window.innerWidth, over: over,
           offRight: Math.round(r.right - window.innerWidth) };
})()`);
add("창이 안 잘린다", fit.over === 0 && fit.offRight <= 0,
  "창 " + fit.w + "px / 화면 " + fit.vw + "px · 밖으로 넘친 칸 " + fit.over +
  "개 · 오른쪽 " + fit.offRight + "px");

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n6단계 — 아이템 · 전리품 · 장착\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(18, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
