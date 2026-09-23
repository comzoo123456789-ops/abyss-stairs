/* 8단계 — 30층 · 구역 다섯 · 몬스터 행동 다섯 · 보스가 **정말** 도는가.
 *
 * 콘텐츠 단계에서 가장 흔한 사고는 "표에는 있는데 화면에 안 나온다" 다.
 * 그래서 표를 읽는 것으로 끝내지 않고 **30층을 전부 만들어 본다**.
 *
 * ⚠ 몬스터 다섯 가지는 **행동이 달라야** 존재 이유가 있다. 이름만 다르면
 *   "쥐가 더 센 쥐" 다 — 그래서 사수는 물러서는지, 치유사는 고치는지,
 *   파괴자는 버프를 걷는지를 **따로따로** 잰다.
 * ⚠ 층 배수를 두 곳에서 곱하는 사고는 눈으로 절대 못 잡는다. 표와 실제를 대조한다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-world-"));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await reload();
await ev(`localStorage.clear()`);
await reload();

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* 연습장 — 벽 없는 방에 원하는 몬스터 하나. */
await ev(`
  window.__lab = function (mobId, dx, dy, opts) {
    opts = opts || {};
    var W = window.WORLD, D = window.DUNGEON, DT = window.DATA;
    var h = window.__hero();
    h.level = 30; h.skills = {}; h.bar = [null,null,null,null];
    var w = new W.World({ seed: 5, w: 50, h: 36, mobs: 0, hero: h, depth: opts.depth || 10 });
    w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
    w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    var p = w.player;
    p.x = 25.5; p.y = 18.5; p.px = p.x; p.py = p.y;
    p.maxHp = 100000; p.hp = 100000;         /* 재려는 것은 내 죽음이 아니다 */
    var def = DT.MOBS.filter(function (m) { return m.id === mobId; })[0];
    w.spawn(0);                               /* 보스 없음 · 잡몹 없음 */
    w.ents.length = 1;
    var st = DT.statsAt(def, opts.depth || 10);
    var sw = def.swing ? { aps: def.swing.aps, windup: def.swing.windup,
      recover: def.swing.recover, reach: def.swing.reach, arc: def.swing.arc,
      push: def.swing.push, dmg: st.dmg } : null;
    var e = new W.Entity({ x: p.x + dx, y: p.y + dy, sprite: def.sprite, team: 1,
      brain: def.brain, hp: opts.hp || st.hp, spd: def.spd, name: def.name,
      xp: st.xp, gold: st.gold, r: def.r, swing: sw });
    e.mob = def; e.dmgOut = st.dmg;
    w.ents.push(e);
    w.foe = e;
    return w;
  };
  window.__run = function (w, secs) {
    var n = Math.round(secs * 60);
    for (var i = 0; i < n; i++) w.advance(1/60);
    return w;
  };
`);

/* ── ① 표가 스스로 어긋나지 않았는가 ──────────────────── */
const audit = await ev(`window.DATA.audit()`);
add("표 자기 점검", audit.length === 0, audit.length ? audit.join(" / ") : "이상 없음");

/* ── ② 30층을 **전부 만들어 본다** ────────────────────
 * ⚠ "표에는 있는데 화면에 안 나온다" 가 콘텐츠 단계의 대표 사고다. */
const all = await ev(`(function(){
  var W = window.WORLD, DT = window.DATA, h = window.__hero();
  var rows = [], bad = [];
  for (var d = 1; d <= 30; d++) {
    var w;
    try { w = new W.World({ seed: 1000 + d, depth: d, hero: h }); }
    catch (e) { bad.push(d + "층 생성 실패: " + e.message); continue; }
    var foes = w.ents.filter(function (x) { return x.team !== 0; });
    var kinds = {};
    foes.forEach(function (x) { kinds[x.name] = 1; });
    var boss = foes.filter(function (x) { return x.boss; })[0];
    var want = DT.bossAt(d);
    if (!foes.length) bad.push(d + "층에 몬스터가 없다");
    if (want && !boss) bad.push(d + "층 보스(" + want.def.name + ")가 안 나왔다");
    if (!want && boss) bad.push(d + "층에 있어선 안 될 보스가 나왔다");
    /* 몬스터가 벽 안에 박혀 있지 않은가 */
    foes.forEach(function (x) {
      if (!W.boxFree(w.level, x.x, x.y, x.r)) bad.push(d + "층 " + x.name + " 이 벽 안에 있다");
    });
    /* 주인공 바로 옆에 붙어 있지 않은가 */
    foes.forEach(function (x) {
      if (!x.boss && Math.hypot(x.x - w.player.x, x.y - w.player.y) < 8.5)
        bad.push(d + "층 " + x.name + " 이 시작 자리에 너무 가깝다");
    });
    rows.push({ d: d, zone: DT.zoneAt(d).id, n: foes.length,
                kinds: Object.keys(kinds).length, boss: boss ? boss.name : null });
  }
  return { rows: rows, bad: bad.slice(0, 5), badN: bad.length };
})()`);
const bossFloors = all.rows.filter(r => r.boss);
add("30층 전부 생성", all.badN === 0,
  "보스층 " + bossFloors.length + "개 [" + bossFloors.map(r => r.d + "층 " + r.boss).join(" · ") + "]" +
  (all.badN ? " · ⚠" + all.badN + "건: " + all.bad.join(" / ") : ""));

const zonesSeen = new Set(all.rows.map(r => r.zone));
add("구역이 다 쓰인다", zonesSeen.size === 5,
  "구역 " + zonesSeen.size + "종 [" + [...zonesSeen].join(",") + "] · 층당 몬스터 " +
  all.rows[0].n + " → " + all.rows[29].n + "마리");

/* ── ③ 층 배수를 **두 번 곱하지 않는가** ────────────────
 * ⚠ 이건 눈으로 절대 못 잡는다. 표와 실제 개체를 직접 대조한다. */
const scale = await ev(`(function(){
  var W = window.WORLD, DT = window.DATA, h = window.__hero();
  var bad = [];
  [1, 10, 20, 30].forEach(function (d) {
    var w = new W.World({ seed: 77, depth: d, hero: h });
    w.ents.filter(function (x) { return x.team !== 0 && !x.boss; }).forEach(function (e) {
      var want = DT.statsAt(e.mob, d);
      if (e.maxHp !== want.hp) bad.push(d + "층 " + e.name + " 체력 " + e.maxHp + " ≠ " + want.hp);
      if (e.swing && e.swing.dmg !== want.dmg)
        bad.push(d + "층 " + e.name + " 피해 " + e.swing.dmg + " ≠ " + want.dmg);
      if (e.dmgOut !== want.dmg) bad.push(d + "층 " + e.name + " dmgOut " + e.dmgOut + " ≠ " + want.dmg);
    });
  });
  /* 보스는 표 그대로여야 한다(배수를 또 곱하면 안 된다) */
  var w30 = new W.World({ seed: 77, depth: 30, hero: h });
  var b = w30.ents.filter(function (x) { return x.boss; })[0];
  var raw = DT.BOSSES.b_lord;
  if (b && b.maxHp !== raw.hp) bad.push("군주 체력 " + b.maxHp + " ≠ 표의 " + raw.hp);
  return { bad: bad.slice(0, 4), n: bad.length, bossHp: b ? b.maxHp : null };
})()`);
add("층 배수는 한 번만", scale.n === 0,
  "1·10·20·30층 전수 대조 · 어긋남 " + scale.n + "건 · 군주 체력 " + scale.bossHp +
  (scale.n ? " · " + scale.bad.join(" / ") : ""));

/* ── ④ 사수 — **거리를 두고 쏘는가** ──────────────────── */
const arch = await ev(`(function(){
  var w = window.__lab("archer", 2.0, 0, { hp: 99999 });
  var e = w.foe, p = w.player;
  var d0 = Math.hypot(e.x - p.x, e.y - p.y);
  window.__run(w, 3.0);
  var d1 = Math.hypot(e.x - p.x, e.y - p.y);
  var shots = 0, hpLost = 0, hp0 = p.hp;
  for (var i = 0; i < 60 * 8; i++) { w.advance(1/60); if (w.shots.length) shots = Math.max(shots, 1); }
  return { d0: d0, d1: d1, shots: shots, hurt: hp0 - p.hp, keep: e.mob.shot.keep };
})()`);
add("사수는 물러선다", arch.d1 > arch.d0 + 0.8 && arch.hurt > 0,
  "거리 " + arch.d0.toFixed(1) + " → " + arch.d1.toFixed(1) + "칸(유지 " + arch.keep +
  ") · 가만히 서서 " + arch.hurt + " 피해를 입음");

/* 화살이 **벽을 못 뚫는가** */
const wallShot = await ev(`(function(){
  var W = window.WORLD, D = window.DUNGEON;
  var w = window.__lab("archer", 6.0, 0, { hp: 99999 });
  var lv = w.level, p = w.player;
  /* 사이에 벽을 세운다 */
  for (var y = 0; y < lv.h; y++) lv.tiles[y * lv.w + Math.floor(p.x) + 3] = D.WALL;
  var hp0 = p.hp;
  window.__run(w, 8.0);
  return { hurt: hp0 - p.hp, shots: w.shots.length };
})()`);
add("화살이 벽을 못 뚫는다", wallShot.hurt === 0,
  "벽 너머 사수에게 8초 · 입은 피해 " + wallShot.hurt + " (0이어야 한다)");

/* ── ⑤ 술사 — 장판을 깔고 **붙지 않는가** ─────────────── */
const mg = await ev(`(function(){
  var w = window.__lab("wraith", 4.0, 0, { hp: 99999, depth: 20 });
  var e = w.foe, p = w.player;
  var hp0 = p.hp, sawField = 0, minD = 99;
  for (var i = 0; i < 60 * 10; i++) {
    w.advance(1/60);
    if (w.fields.length) sawField = 1;
    minD = Math.min(minD, Math.hypot(e.x - p.x, e.y - p.y));
  }
  return { field: sawField, hurt: hp0 - p.hp, minD: minD };
})()`);
add("술사는 장판을 깐다", mg.field === 1 && mg.hurt > 0 && mg.minD > 1.8,
  "장판 " + (mg.field ? "깔림" : "⚠안 깔림") + " · 10초에 " + mg.hurt +
  " 피해 · 가장 가까웠던 거리 " + mg.minD.toFixed(2) + "칸(붙지 않아야 한다)");

/* ── ⑥ 치유사 — **동료를 고치는가** ──────────────────── */
const hl = await ev(`(function(){
  var W = window.WORLD, DT = window.DATA;
  var w = window.__lab("inkling", 5.0, 0, { hp: 99999, depth: 15 });
  /* 다친 동료를 옆에 둔다 */
  var hurt = new W.Entity({ x: w.foe.x + 1.0, y: w.foe.y, sprite: "rat", team: 1, hp: 100 });
  hurt.hp = 20;
  w.ents.push(hurt);
  var before = hurt.hp;
  window.__run(w, 6.0);
  return { before: before, after: hurt.hp, max: hurt.maxHp };
})()`);
add("치유사는 고친다", hl.after > hl.before,
  "다친 동료 " + hl.before + " → " + hl.after + " / " + hl.max);

/* 사람이 붙으면 도망치는가 */
const hlFlee = await ev(`(function(){
  var w = window.__lab("inkling", 1.4, 0, { hp: 99999, depth: 15 });
  var e = w.foe, p = w.player;
  var d0 = Math.hypot(e.x - p.x, e.y - p.y);
  window.__run(w, 2.5);
  return { d0: d0, d1: Math.hypot(e.x - p.x, e.y - p.y) };
})()`);
add("치유사는 도망친다", hlFlee.d1 > hlFlee.d0 + 0.8,
  "거리 " + hlFlee.d0.toFixed(1) + " → " + hlFlee.d1.toFixed(1) + "칸");

/* ── ⑦ 파괴자 — **내 버프를 걷는가** ─────────────────── */
const brk = await ev(`(function(){
  var w = window.__lab("eraser", 3.0, 0, { hp: 99999, depth: 18 });
  var p = w.player;
  p.stam = 100;
  w.useSkill("ward", p.x + 3, p.y, {});
  window.__run(w, 0.5);
  var had = w.buffs.length;
  var armorOn = p.def;
  window.__run(w, 4.0);
  return { had: had, armorOn: armorOn, left: w.buffs.length, armorNow: p.def };
})()`);
add("파괴자는 버프를 걷는다", brk.had === 1 && brk.left === 0 && brk.armorNow < brk.armorOn,
  "버프 " + brk.had + "개(방어 " + brk.armorOn + ") → 4초 뒤 " + brk.left +
  "개(방어 " + brk.armorNow + ")");

/* 버프가 없을 때는 **그냥 때리러 와야** 한다(멍하니 서 있으면 안 된다) */
const brkIdle = await ev(`(function(){
  var w = window.__lab("eraser", 6.0, 0, { hp: 99999, depth: 18 });
  var e = w.foe, p = w.player;
  var d0 = Math.hypot(e.x - p.x, e.y - p.y);
  window.__run(w, 3.0);
  return { d0: d0, d1: Math.hypot(e.x - p.x, e.y - p.y) };
})()`);
add("버프 없으면 때리러 온다", brkIdle.d1 < brkIdle.d0 - 2,
  "거리 " + brkIdle.d0.toFixed(1) + " → " + brkIdle.d1.toFixed(2) + "칸");

/* ── ⑧ 보스 — 잡을 수 있고, 잡으면 크게 준다 ─────────── */
const boss = await ev(`(function(){
  var W = window.WORLD, DT = window.DATA, S = window.SAVE, h = window.__hero();
  h.level = 30; h.xp = 0; h.gold = 0;
  var w = new W.World({ seed: 42, depth: 6, hero: h });
  var b = w.ents.filter(function (x) { return x.boss; })[0];
  if (!b) return null;
  var p = w.player;
  p.maxHp = 999999; p.hp = 999999;
  p.swing = { aps: 6, windup: 0.02, recover: 0.02, reach: 3, arc: 360, dmg: 60, push: 0 };
  /* 보스 옆으로 가서 팬다 */
  p.x = b.x + 0.6; p.y = b.y; p.px = p.x; p.py = p.y;
  var g0 = h.gold, xp0 = h.xp, lv0 = h.level;
  for (var i = 0; i < 60 * 30 && !b.dead; i++) { w.swing(b.x, b.y); w.advance(1/60); }
  /* ⚠ **죽는 순간 멈추면 안 된다.** 금화는 바닥에 떨어지고 걸음을 더 밟아야
   *   주워진다 — 그걸 안 밟고 재서 "보상이 0" 으로 빨개졌다(검사의 실수).
   *   레벨도 마찬가지로 Lv.30 에 420xp 는 한참 모자라다 — 경험치를 봐야 한다. */
  /* ⚠ 금화는 **죽은 자리**에 떨어지는데, 보스가 밀어내 주인공이 1.8칸 밖에
   *   있었다. 걸어가서 줍는 것까지가 한 바퀴다 — 안 걸으면 "보상이 0" 으로 읽힌다. */
  /* ⚠ **금화만** 쫓는다. 물건은 눌러야 줍는 것이라, 물건 쪽으로 걸어가면
   *   영원히 안 줄어들어 걸음을 다 써 버린다(실측: 400걸음을 쓰고 금화 +5). */
  for (var k = 0; k < 600; k++) {
    var golds = w.drops.filter(function (x) { return x.gold; });
    if (!golds.length) break;
    var g = golds[0];
    var gx = g.x - p.x, gy = g.y - p.y, gl = Math.hypot(gx, gy) || 1;
    p.mx = gx / gl; p.my = gy / gl;
    w.advance(1/60);
  }
  p.mx = 0; p.my = 0;
  for (var k2 = 0; k2 < 60; k2++) w.advance(1/60);
  var logged = w.log.filter(function (l) { return l.what === "boss"; }).length;
  return { name: b.name, hp: b.maxHp, dead: b.dead, logged: logged,
           gold: h.gold - g0, xp: h.xp - xp0 };
})()`);
add("보스", !!boss && boss.dead && boss.logged === 1 && boss.gold > 100 && boss.xp > 300,
  boss ? boss.name + " 체력 " + boss.hp + " · 잡음 " + (boss.dead ? "✔" : "⚠") +
    " · 기록 " + boss.logged + "건 · 금화 +" + boss.gold + " · 경험치 +" + boss.xp
    : "⚠보스를 못 찾았다");

/* ── ⑨ 몬스터가 많아도 프레임이 버티는가 ────────────────
 * ⚠ 22마리 × 길찾기 × 투사체가 겹치는 30층이 가장 무겁다. */
const perf = await ev(`(function(){
  var W = window.WORLD, h = window.__hero();
  var w = new W.World({ seed: 9, depth: 30, hero: h });
  w.level.visible.fill(1);
  w.player.maxHp = 999999; w.player.hp = 999999;
  var t0 = performance.now();
  for (var i = 0; i < 600; i++) w.advance(1/60);   /* 10초치 */
  var ms = performance.now() - t0;
  return { ms: Math.round(ms), perStep: +(ms / 600).toFixed(3),
           foes: w.ents.filter(function (x) { return x.team !== 0 && !x.dead; }).length };
})()`);
add("무거운 층도 버틴다", perf.perStep < 3.0,
  "30층 " + perf.foes + "마리 · 10초치 규칙에 " + perf.ms + "ms · 한 걸음 " +
  perf.perStep + "ms (16.7ms 안에 들어야 한다)");

/* ── ⑩ 화면 — 구역마다 색이 다른가 ───────────────────── */
/* ⚠ **눈금 위에 선 값으로 판정하지 않는다.** 53픽셀마다 한 점씩 한 판만
 *   재면 층이 무작위라 같은 코드가 어떤 날은 13, 어떤 날은 12 로 나온다
 *   (문턱이 12 라 그대로 뒤집혔다). 촘촘히(7픽셀마다) 재고 판을 셋 돌려
 *   평균한다 — 재는 값이 흔들리면 문턱을 아무리 잘 잡아도 소용없다. */
const colors = await ev(`(async function(){
  var out = [];
  var deps = [3, 9, 15, 21, 27];
  for (var i = 0; i < deps.length; i++) {
    var r = 0, gg = 0, b = 0, n = 0;
    for (var t = 0; t < 3; t++) {
      window.__hero().maxDepth = 30;
      window.__depth(deps[i]);
      await new Promise(function (res) { setTimeout(res, 260); });
      var c = document.getElementById("view");
      var g = c.getContext("2d");
      var px = g.getImageData(0, 0, c.width, c.height).data;
      for (var k = 0; k < px.length; k += 4 * 7) {
        if (px[k] + px[k+1] + px[k+2] < 40) continue;
        r += px[k]; gg += px[k+1]; b += px[k+2]; n++;
      }
    }
    out.push(n ? [Math.round(r/n), Math.round(gg/n), Math.round(b/n)] : null);
  }
  return out;
})()`);
let minGap = 1e9;
for (let i = 0; i < colors.length; i++)
  for (let j = i + 1; j < colors.length; j++)
    if (colors[i] && colors[j])
      minGap = Math.min(minGap, Math.abs(colors[i][0] - colors[j][0]) +
        Math.abs(colors[i][1] - colors[j][1]) + Math.abs(colors[i][2] - colors[j][2]));
add("구역마다 색이 다르다", minGap > 12,
  colors.map((c, i) => [3,9,15,21,27][i] + "층 rgb(" + (c || []).join(",") + ")").join(" · ") +
  " · 가장 비슷한 둘의 차이 " + minGap);

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n8단계 — 30층 · 구역 · 몬스터 다섯 · 보스\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(20, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
