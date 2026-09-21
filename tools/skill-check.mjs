/* 7단계 — 스킬이 **초 단위로** 제대로 도는가.
 *
 * 턴제의 "재사용 3턴" 은 시간이 아니라 행동 횟수였다. 실시간에서는 시계가 곧
 * 자원이다. 그래서 재는 것이 다르다 — **몇 초 뒤에 다시 쓸 수 있는가**,
 * **시전 중에 피할 수 있는가**, **시계가 프레임 수에 흔들리지 않는가**.
 *
 * ⚠ 쿨다운을 화면 타이머로 세면 창을 감췄다 돌아올 때 어긋난다.
 *   규칙 시계(world.time)로만 재는지 **프레임 크기를 바꿔 가며** 확인한다.
 * ⚠ "스킬이 나간다" 는 통과가 아니다. **얼마나 아픈지 · 언제 아픈지**를 잰다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-skill-"));
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
const reload = async () => { await S("Page.navigate", { url: URL0 }); await sleep(1100); };

await S("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await reload();
await ev(`localStorage.clear()`);
await reload();

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* 연습장 — 벽 없는 방. ⚠ 던전에서 재면 벽·다른 몬스터가 섞여
 * 무엇을 쟀는지 알 수 없다. */
await ev(`
  window.__arena = function (opts) {
    opts = opts || {};
    var W = window.WORLD, D = window.DUNGEON, SK = window.SKILLS;
    var h = window.__hero();
    h.level = 30; h.points = 99; h.skills = {};
    var w = new W.World({ seed: 99, w: 44, h: 32, mobs: 0, hero: h });
    w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
    w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.player.x = 22.5; w.player.y = 16.5;
    w.player.px = w.player.x; w.player.py = w.player.y;
    w.player.stam = SK.STAM_MAX;
    w.player.swing = { aps: 1, windup: 0.16, recover: 0.2, reach: 1.3,
                       arc: 100, dmg: 10, push: 0 };
    w.player.baseAps = 1; w.player.baseDmg = 10; w.player.baseDef = 0;
    (opts.foes || []).forEach(function (f) {
      w.ents.push(new W.Entity({ x: f.x, y: f.y, sprite: "rat", team: 1,
        hp: f.hp === undefined ? 99999 : f.hp, brain: f.brain || null,
        spd: f.spd === undefined ? 3 : f.spd, name: f.name || "허수아비",
        swing: f.swing || null }));
    });
    return w;
  };
  window.__run = function (w, secs, dt) {
    dt = dt || 1/60;
    var n = Math.round(secs / dt);
    for (var i = 0; i < n; i++) w.advance(dt);
    return w;
  };
`);

/* ── ① 표가 스스로 어긋나지 않았는가 ──────────────────── */
const audit = await ev(`window.SKILLS.audit()`);
add("표 자기 점검", audit.length === 0, audit.length ? audit.join(" / ") : "이상 없음");

/* ── ② 재사용 대기가 **초**인가 · 프레임 수에 안 흔들리는가 ──
 * ⚠ 같은 1초를 잘게/크게 먹였을 때 남은 시간이 같아야 한다. */
const cdTest = await ev(`(function(){
  var SK = window.SKILLS;
  function run(dt) {
    var w = window.__arena({ foes: [{ x: 23.6, y: 16.5 }] });
    w.useSkill("cleave", 40, 16.5, {});
    window.__run(w, 2.0, dt);
    return SK.cdLeft(w, "cleave", {});
  }
  var cd = SK.byId("cleave").cd;
  return { a: run(1/240), b: run(1/60), c: run(1/30), cd: cd };
})()`);
const cdSpread = Math.max(cdTest.a, cdTest.b, cdTest.c) - Math.min(cdTest.a, cdTest.b, cdTest.c);
add("쿨다운은 초다", cdSpread < 0.05 && Math.abs(cdTest.b - (cdTest.cd - 2)) < 0.06,
  "재사용 " + cdTest.cd + "초 · 2초 뒤 남은 시간 240Hz " + cdTest.a.toFixed(2) +
  " · 60Hz " + cdTest.b.toFixed(2) + " · 30Hz " + cdTest.c.toFixed(2) +
  " (2.00 이어야 하고 셋이 같아야 한다)");

/* ── ③ 쿨다운 동안 다시 안 나가는가 · 이유를 말하는가 ── */
const cdBlock = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 23.6, y: 16.5 }] });
  var first = w.useSkill("cleave", 40, 16.5, {});
  window.__run(w, 0.6);
  var second = w.useSkill("cleave", 40, 16.5, {});
  window.__run(w, 4.0);
  var third = w.useSkill("cleave", 40, 16.5, {});
  return { first: first, second: second, third: third };
})()`);
add("쿨다운이 막는다", cdBlock.first === null && !!cdBlock.second && cdBlock.third === null,
  "처음 " + (cdBlock.first || "성공") + " · 0.6초 뒤 “" + cdBlock.second +
  "” · 4.6초 뒤 " + (cdBlock.third || "성공"));

/* ── ④ **시전 중에 피할 수 있는가** — 이 단계의 핵심 ────
 * 시전이 0 이면 "먼저 누른 쪽이 이긴다" 가 되어 실시간 전투가 사라진다. */
const dodge = await ev(`(function(){
  function trial(run) {
    var w = window.__arena({ foes: [{ x: 23.6, y: 16.5 }] });
    var foe = w.ents[1], hp0 = foe.hp;
    w.useSkill("cleave", 40, 16.5, {});
    for (var i = 0; i < 60; i++) {
      /* 시전이 시작된 걸 보고 도망친다 */
      if (run) { foe.x += 0.12; foe.px = foe.x; }
      w.advance(1/60);
    }
    return hp0 - foe.hp;
  }
  return { stand: trial(false), flee: trial(true) };
})()`);
add("시전 중 피할 수 있다", dodge.stand > 0 && dodge.flee === 0,
  "가만히 " + dodge.stand + " 피해 · 시전 보고 물러서면 " + dodge.flee + " 피해");

/* ── ⑤ 위력이 **무기 피해의 배수**인가 ──────────────────
 * ⚠ 평값이면 무기를 바꿔도 스킬만 그대로라 후반에 평타보다 약해진다. */
const mult = await ev(`(function(){
  var SK = window.SKILLS;
  function hitWith(weaponDmg) {
    var w = window.__arena({ foes: [{ x: 23.4, y: 16.5 }] });
    w.player.swing.dmg = weaponDmg; w.player.baseDmg = weaponDmg;
    var foe = w.ents[1], hp0 = foe.hp;
    w.useSkill("cleave", 40, 16.5, {});
    window.__run(w, 0.6);
    return hp0 - foe.hp;
  }
  return { w10: hitWith(10), w30: hitWith(30), mult: SK.byId("cleave").mult };
})()`);
add("위력은 무기의 배수",
  Math.abs(mult.w10 - 10 * mult.mult) < 1.5 && Math.abs(mult.w30 - 30 * mult.mult) < 1.5,
  "무기 10 → " + mult.w10 + " 피해 · 무기 30 → " + mult.w30 +
  " (배수 " + mult.mult + " 이므로 19 / 57 이어야 한다)");

/* ── ⑥ 기력이 두 번째 문인가 ─────────────────────────
 * ⚠ 쿨다운만 두면 스킬 넷을 돌아가며 쉬지 않고 쓴다. */
const stam = await ev(`(function(){
  var SK = window.SKILLS;
  var w = window.__arena({ foes: [{ x: 23.6, y: 16.5 }] });
  w.player.stam = 20;                       /* 베어넘기기 18 · 충격파 30 */
  var ok = w.useSkill("cleave", 40, 16.5, {});
  window.__run(w, 0.5);
  var no = w.useSkill("nova", 40, 16.5, {});
  /* 차오르는가 */
  window.__run(w, 8.0);
  return { ok: ok, no: no, after: Math.round(w.player.stam), max: SK.STAM_MAX };
})()`);
add("기력", stam.ok === null && /기력/.test(stam.no || "") && stam.after > 50,
  "20 기력으로 베어넘기기(18) " + (stam.ok ? "⚠" + stam.ok : "성공") +
  " · 충격파(30) “" + stam.no + "” · 8초 뒤 " + stam.after + "/" + stam.max);

/* ── ⑦ 시너지가 **실제 수치를 바꾸는가** ────────────────
 * ⚠ 설명만 바뀌고 수치가 그대로인 것이 가장 흔한 사고다. */
const syn = await ev(`(function(){
  var SK = window.SKILLS;
  var plain = SK.resolve("cleave", {});
  var quick = SK.resolve("cleave", { cleave: ["quick"] });
  var heavy = SK.resolve("cleave", { cleave: ["heavy"] });
  var wide  = SK.resolve("cleave", { cleave: ["wide"] });
  /* 실제 피해로도 확인한다 */
  function dmgWith(taken) {
    var w = window.__arena({ foes: [{ x: 23.4, y: 16.5 }] });
    var foe = w.ents[1], hp0 = foe.hp;
    w.useSkill("cleave", 40, 16.5, taken);
    window.__run(w, 0.8);
    return hp0 - foe.hp;
  }
  return { cd: [plain.cd, quick.cd], mult: [plain.mult, heavy.mult],
           arc: [plain.arc, wide.arc],
           dmgPlain: dmgWith({}), dmgHeavy: dmgWith({ cleave: ["heavy"] }) };
})()`);
add("시너지가 수치를 바꾼다",
  syn.cd[1] < syn.cd[0] && syn.mult[1] > syn.mult[0] && syn.arc[1] > syn.arc[0] &&
  syn.dmgHeavy > syn.dmgPlain,
  "재사용 " + syn.cd[0] + "→" + syn.cd[1] + "초 · 위력 " + syn.mult[0] + "→" +
  syn.mult[1] + "배 · 각도 " + syn.arc[0] + "→" + syn.arc[1] + "° · 실제 피해 " +
  syn.dmgPlain + "→" + syn.dmgHeavy);

/* 스킬마다 **하나만** 고를 수 있어야 한다 — 셋 다 켜면 빌드가 사라진다 */
await ev(`(function(){ var h = window.__hero(); h.points = 9; h.skills = {}; })()`);
await ev(`window.__syn("cleave:quick")`);
await ev(`window.__syn("cleave:heavy")`);
const one = await ev(`(function(){ var h = window.__hero();
  return { got: (h.skills.cleave||[]).slice(), points: h.points }; })()`);
add("스킬당 하나만", one.got.length === 1 && one.points === 8,
  "둘을 눌러 봄 → 가진 것 [" + one.got.join(",") + "] · 남은 점수 " + one.points);

/* 되돌리기 — 잘못 찍은 것을 못 되돌리면 캐릭터를 버려야 한다 */
await ev(`window.__resetsk()`);
const reset = await ev(`(function(){ var h = window.__hero();
  return { got: Object.keys(h.skills).filter(function(k){return h.skills[k].length;}).length,
           points: h.points }; })()`);
add("되돌리기", reset.got === 0 && reset.points === 9,
  "되돌린 뒤 가진 시너지 " + reset.got + "개 · 점수 " + reset.points + "(9로 돌아와야 한다)");

/* ── ⑧ 돌진 — 실제로 움직이고, 스치는 것을 베는가 ─────── */
const dash = await ev(`(function(){
  var w = window.__arena({ foes: [
    { x: 24.5, y: 16.5, name: "길목" }, { x: 26.0, y: 16.5, name: "길목2" }
  ]});
  var p = w.player, x0 = p.x;
  var hp = w.ents.map(function(e){ return e.hp; });
  w.useSkill("dash", 40, 16.5, {});
  window.__run(w, 1.0);
  return { moved: p.x - x0,
           hurt: w.ents.slice(1).map(function(e,i){ return hp[i+1] - e.hp; }) };
})()`);
add("돌진", dash.moved > 3.5 && dash.hurt[0] > 0 && dash.hurt[1] > 0,
  "앞으로 " + dash.moved.toFixed(2) + "칸 · 길목 둘에 " + dash.hurt.join("/") + " 피해");

/* 무적 시너지 — **장판에도 안 맞아야** 한다(한 곳에서만 보는지) */
const iframe = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 26, y: 16.5 }] });
  var p = w.player, hp0 = p.hp;
  /* 몬스터가 때리는 상황을 만든다 */
  var foe = w.ents[1];
  w.useSkill("dash", 40, 16.5, { dash: ["guard"] });
  /* ⚠ 시전(0초)이라도 **다음 걸음에** 돌진이 시작된다. 걸음을 안 밟고
   *   바로 때리면 아직 돌진 중이 아니라 맞는 게 맞다 — 검사가 순서를 빠뜨렸던 자리다.
   * ⚠ 그리고 **돌진 중일 때만** 때려야 한다. 4.2칸 ÷ 22칸/초 = 0.19초 뿐이라
   *   12걸음을 밟으면 이미 끝난 뒤를 때리게 되고, 그 한 대를 "무적이 안 듣는다" 로
   *   오독한다(실측으로 정확히 한 대 = 20 이 나왔다). */
  w.advance(1/60);
  var hits = 0;
  while (p.dash && hits < 60) { window.COMBAT.damage(w, foe, p, 20); w.advance(1/60); hits++; }
  var duringDash = hp0 - p.hp;
  /* 돌진이 끝난 뒤에는 맞아야 한다 */
  window.__run(w, 1.0);
  var hp1 = p.hp;
  window.COMBAT.damage(w, foe, p, 20);
  return { duringDash: duringDash, after: hp1 - p.hp, hits: hits };
})()`);
add("무적 시너지", iframe.duringDash === 0 && iframe.after > 0 && iframe.hits > 5,
  "돌진 중 " + iframe.hits + "번 맞아 " + iframe.duringDash +
  " 피해(0이어야 한다) · 끝난 뒤 " + iframe.after + " 피해");

/* ── ⑨ 장판 — 시간이 지나며 여러 번 때리고, 끝나면 멈추는가 ── */
const field = await ev(`(function(){
  var SK = window.SKILLS;
  var w = window.__arena({ foes: [{ x: 22.5, y: 14.5 }] });
  var foe = w.ents[1], hp0 = foe.hp;
  w.useSkill("burn", 22.5, 14.5, {});
  window.__run(w, 3.0);
  var mid = hp0 - foe.hp;
  window.__run(w, 5.0);
  var end = hp0 - foe.hp;
  var fieldsLeft = w.fields.length;
  window.__run(w, 3.0);
  var after = hp0 - foe.hp;
  return { mid: mid, end: end, after: after, left: fieldsLeft,
           dur: SK.byId("burn").dur, tick: SK.byId("burn").tick };
})()`);
add("장판", field.mid > 0 && field.end > field.mid && field.after === field.end &&
  field.left === 0,
  "3초에 " + field.mid + " · 8초에 " + field.end + " 피해 · 지속(" + field.dur +
  "초)이 끝난 뒤 " + field.after + "(더 안 늘어야 한다) · 남은 장판 " + field.left);

/* ── ⑩ 버프 — 걸리고, 끝나면 **원래대로 돌아가는가** ────
 * ⚠ 안 돌아가면 걸 때마다 방어가 쌓여 무적이 된다(고전 버그). */
const buff = await ev(`(function(){
  var w = window.__arena({});
  var p = w.player;
  var before = { def: p.def, aps: p.swing.aps };
  w.useSkill("ward", 40, 16.5, {});
  window.__run(w, 0.5);
  var during = { def: p.def, aps: p.swing.aps };
  window.__run(w, 7.0);
  var after = { def: p.def, aps: p.swing.aps };
  /* 세 번 걸었다 풀어도 원래대로인가 */
  for (var i = 0; i < 3; i++) {
    w.cds = {}; p.stam = 100;
    w.useSkill("ward", 40, 16.5, {});
    window.__run(w, 7.0);
  }
  return { before: before, during: during, after: after,
           end: { def: p.def, aps: p.swing.aps } };
})()`);
add("버프가 쌓이지 않는다",
  buff.during.def > buff.before.def && buff.during.aps > buff.before.aps &&
  buff.after.def === buff.before.def && Math.abs(buff.end.aps - buff.before.aps) < 1e-6,
  "방어 " + buff.before.def + "→" + buff.during.def + "→" + buff.after.def +
  " · 공격속도 " + buff.before.aps.toFixed(2) + "→" + buff.during.aps.toFixed(2) +
  "→" + buff.after.aps.toFixed(2) + " · 세 번 더 걸었다 푼 뒤 " + buff.end.def +
  "/" + buff.end.aps.toFixed(2));

/* ── ⑪ 시전 중에는 평타가 안 섞이는가 ─────────────────── */
const noMix = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 23.4, y: 16.5 }] });
  w.useSkill("nova", 40, 16.5, {});      /* 시전 0.40초 */
  var mixed = w.swing(40, 16.5);
  return { mixed: mixed };
})()`);
add("시전 중 평타 금지", noMix.mixed === false, "시전 중 평타 시도 → " + noMix.mixed);

/* ── ⑫ 레벨업이 점수를 주는가 ───────────────────────── */
const pts = await ev(`(function(){
  var W = window.WORLD, S = window.SAVE;
  /* ⚠ __arena 가 레벨·점수를 손대므로 **그 뒤에** 초기화해야 한다.
   *   먼저 하면 연습장이 도로 덮어써 "점수가 99" 로 나온다(검사의 순서 실수). */
  var w = window.__arena({});
  var h = window.__hero();
  h.level = 1; h.xp = 0; h.points = 0; h.skills = {};
  w.applyHero();
  var p = w.player;
  p.x = 22.5; p.y = 16.5; p.px = p.x; p.py = p.y;
  for (var k = 0; k < 14; k++) {
    var foe = new W.Entity({ x: 23.2, y: 16.5, sprite: "rat", team: 1,
      hp: 4, xp: 20, gold: 1 });
    w.ents.push(foe);
    for (var i = 0; i < 300 && !foe.dead; i++) { w.swing(99, 16.5); w.advance(1/60); }
  }
  return { level: h.level, points: h.points };
})()`);
add("레벨업이 점수를 준다", pts.points > 0 && pts.points === pts.level - 1,
  "Lv.1 → Lv." + pts.level + " · 점수 " + pts.points + "(레벨-1 이어야 한다)");

/* ── ⑬ 화면 — 스킬 줄이 쿨다운을 보여 주는가 ──────────── */
await ev(`(function(){
  var h = window.__hero();
  h.level = 20; h.points = 9; h.skills = {};
  h.bar = ["cleave", "dash", "nova", "ward"];
  window.__start({ depth: 1 });
})()`);
await sleep(600);
const barUI = await ev(`(function(){
  var els = document.querySelectorAll("#skillbar .sk");
  return { n: els.length, names: [].map.call(els, function(e){
    return e.querySelector(".nm").textContent; }) };
})()`);
await ev(`window.__cast(0)`);
await sleep(400);
const cooling = await ev(`(function(){
  var e = document.querySelector("#skillbar .sk");
  return { cls: e.className, cd: e.querySelector(".cd").textContent,
           fill: e.querySelector(".cool").style.height };
})()`);
add("스킬 줄", barUI.n === 4 && /cooling/.test(cooling.cls) && cooling.cd.length > 0,
  "칸 " + barUI.n + "개 [" + barUI.names.join(",") + "] · 쓴 뒤 " +
  cooling.cd + "초 표시 · 덮개 " + cooling.fill);

/* ── ⑭ 재주책이 열리고 눌리는가 ─────────────────────── */
await ev(`window.__book()`);
await sleep(250);
const book = await ev(`(function(){
  var b = document.getElementById("panel");
  return { open: !b.hidden, skills: b.querySelectorAll(".col.skill").length,
           syn: b.querySelectorAll("[data-syn]").length,
           bar: b.querySelectorAll("[data-bar]").length };
})()`);
add("재주책", book.open && book.skills === 5 && book.syn === 15 && book.bar === 20,
  "스킬 " + book.skills + "개 · 시너지 " + book.syn + "개 · 손잡이 단추 " + book.bar + "개");

/* 화면 밖으로 안 잘리는가 */
const fit = await ev(`(function(){
  var b = document.getElementById("panel");
  var r = b.getBoundingClientRect(), over = 0;
  b.querySelectorAll(".col, .itm").forEach(function (el) {
    if (el.getBoundingClientRect().right > r.right + 1) over++;
  });
  return { over: over, right: Math.round(r.right - window.innerWidth) };
})()`);
add("창이 안 잘린다", fit.over === 0 && fit.right <= 0,
  "밖으로 넘친 칸 " + fit.over + "개 · 오른쪽 " + fit.right + "px");

/* ── ⑮ 저장을 넘어 살아남는가 · 손으로 고쳐도 안 무너지는가 ── */
await ev(`(function(){
  var h = window.__hero();
  h.points = 3; h.skills = { cleave: ["heavy"], nova: ["slow"] };
  h.bar = ["nova", "cleave", null, "ward"];
  window.__save();
})()`);
await reload();
const kept = await ev(`(function(){ var h = window.__hero();
  return { skills: h.skills, bar: h.bar, points: h.points }; })()`);
add("저장을 넘어 남는다",
  kept.skills.cleave && kept.skills.cleave[0] === "heavy" &&
  kept.bar[0] === "nova" && kept.bar[2] === null && kept.points === 3,
  "시너지 " + JSON.stringify(kept.skills) + " · 손잡이 [" +
  kept.bar.map(function (x) { return x || "—"; }).join(",") + "] · 점수 " + kept.points);

/* 손으로 셋 다 켜 놓으면? — **하나만** 남아야 한다 */
await ev(`(function(){
  window.SAVE.save = function () { return false; };
  var raw = JSON.parse(localStorage.getItem(window.SAVE.KEY));
  raw.d.skills = { cleave: ["quick", "heavy", "wide"], nope: ["x"] };
  raw.d.bar = ["cleave", "cleave", "없는것", "dash"];
  localStorage.setItem(window.SAVE.KEY, JSON.stringify(raw));
})()`);
await reload();
const forged = await ev(`(function(){ var h = window.__hero();
  return { cleave: h.skills.cleave, nope: !!h.skills.nope, bar: h.bar }; })()`);
add("손으로 고쳐도 안 무너진다",
  forged.cleave.length === 1 && !forged.nope &&
  forged.bar[0] === "cleave" && forged.bar[1] === null && forged.bar[2] === null,
  "시너지 셋을 심음 → " + forged.cleave.length + "개만 남음 · 없는 스킬 " +
  (forged.nope ? "⚠남음" : "지워짐") + " · 손잡이 [" +
  forged.bar.map(function (x) { return x || "—"; }).join(",") + "]");

/* ── ⑯ 아이콘이 **정말 그려지는가** ─────────────────────
 * ⚠ "그림 이름이 표에 있다" 와 "화면에 보인다" 는 다른 얘기다. 이름이 틀리면
 *   bake() 가 null 을 돌려주고 캔버스는 **빈 채로 남는다** — 오류도 안 난다.
 *   그래서 이름을 세지 말고 **칠해진 픽셀을 센다.**
 * ⚠ 다섯이 서로 달라야 한다. 같은 그림을 다섯 번 쓰면 손잡이에서 구별이 안 된다. */
const icons = await ev(`(function(){
  var S = window.SPRITES, SK = window.SKILLS;
  var out = [];
  for (var i = 0; i < SK.LIST.length; i++) {
    var def = SK.LIST[i];
    var img = S.bake(def.icon);
    var row = { id: def.id, icon: def.icon, exists: !!img, lit: 0, colors: 0, sig: "" };
    if (img) {
      var c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      var g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, 32, 32);
      var d = g.getImageData(0, 0, 32, 32).data;
      var seen = {}, sum = 0;
      for (var k = 0; k < d.length; k += 4) {
        if (d[k + 3] < 20) continue;
        row.lit++;
        var key = (d[k] >> 4) + "," + (d[k+1] >> 4) + "," + (d[k+2] >> 4);
        if (!seen[key]) { seen[key] = 1; row.colors++; }
        sum += d[k] * 3 + d[k+1] * 5 + d[k+2] * 7 + k;
      }
      row.sig = String(sum);
    }
    out.push(row);
  }
  return out;
})()`);
const missing = icons.filter(i => !i.exists);
const blank = icons.filter(i => i.exists && i.lit < 200);
const dull = icons.filter(i => i.exists && i.colors < 3);
const sigs = new Set(icons.map(i => i.sig));
add("아이콘이 그려진다", missing.length === 0 && blank.length === 0 && dull.length === 0,
  icons.length + "종 · " + icons.map(i => i.icon + "(" + i.lit + "점)").join(" · ") +
  (missing.length ? " · ⚠없는 그림 " + missing.map(i => i.icon).join(",") : "") +
  (blank.length ? " · ⚠거의 빈 것 " + blank.map(i => i.icon).join(",") : "") +
  (dull.length ? " · ⚠색이 두 가지뿐 " + dull.map(i => i.icon).join(",") : ""));

add("아이콘이 서로 다르다", sigs.size === icons.length,
  sigs.size + " / " + icons.length + "종이 서로 다른 그림");

/* 손잡이 칸에 **실제로 칠해졌는가** — 캔버스를 그대로 읽는다 */
await ev(`(function(){
  var h = window.__hero();
  h.bar = ["cleave", "dash", "nova", "ward"];
})()`);
await sleep(300);
const painted = await ev(`(function(){
  var out = [];
  document.querySelectorAll("#skillbar .sk .ico").forEach(function (cv) {
    var g = cv.getContext("2d");
    var d = g.getImageData(0, 0, cv.width, cv.height).data;
    var lit = 0;
    for (var k = 0; k < d.length; k += 4) if (d[k + 3] > 20) lit++;
    out.push({ w: cv.width, lit: lit });
  });
  return out;
})()`);
const emptySlot = painted.filter(p => p.lit < 200);
add("손잡이에 칠해진다", painted.length === 4 && emptySlot.length === 0,
  "칸 " + painted.length + "개 · 칠해진 점 " + painted.map(p => p.lit).join("/") +
  (emptySlot.length ? " · ⚠빈 칸 " + emptySlot.length + "개" : ""));

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n7단계 — 스킬(초 단위)\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(20, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
