/* 대장간 — **강화(+1~+10)와 재련**이 정말 되는가.
 *
 * ⚠ 이름에 +1 이 붙는 것은 글자다. **피해·방어가 올랐는지**를 봐야 한다.
 * ⚠ 가방에서만 올라가면 소용없다 — world.gear(유일한 합산 자리)까지 닿아야 한다.
 * ⚠ 실패해도 잃지 않는다는 약속을 검사가 지킨다. 깨지면 회원이 몇 시간을 잃는다.
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

const reload = async () => { await S("Page.navigate", { url: URL0 }); await sleep(1100); };

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
/* ⚠ 앞선 검사가 남긴 저장이 있으면 결과가 흔들린다. 지우려면 **먼저 그 주소를
 *   열어야** 한다 — about:blank 에서 지우면 다른 저장소를 지운 것이다. */

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);
await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await reload(); await ev(`localStorage.clear()`); await reload();

/* 시험용 물건을 손에 쥐여 준다 — 굴려서 나오길 기다리면 검사가 흔들린다.
 * ⚠ 등급을 **못 박는다**(rare). 일반 등급은 접사가 없어 재련을 못 한다. */
const setup = await ev(`(function(){
  var h = window.__hero(), I = window.ITEMS;
  var rng = function(){ return 0.42; };
  var sword = I.roll(rng, { slot: "weapon", base: "sword", tier: "rare", ilvl: 10 });
  h.bag.length = 0; h.equip = {};
  h.bag.push(I.pack(sword));
  h.gold = 100000; h.level = 20;
  window.__w().applyHero();
  return { name: sword.name, dmg: sword.s.dmg, enh: sword.enh, af: sword.affixes.length };
})()`);
add("시험용 물건", setup.af >= 3 && setup.enh === 0,
  setup.name + " · 피해 " + setup.dmg + " · 접사 " + setup.af + " · 강화 +" + setup.enh);

/* ── ① 걸어가서 **E 로** 열리는가 ──────────────────────
 * ⚠ 함수를 직접 부르면 배선이 죽어도 통과한다. 프롭 앞으로 옮겨 E 를 누른다. */
await ev(`(function(){
  var w = window.__w();
  var pr = w.props.filter(function(o){ return o.id === "smith"; })[0];
  w.player.x = pr.x; w.player.y = pr.y + 1.0;
})()`);
await sleep(150);
const hint = await ev(`(document.getElementById("act")||{}).textContent || ""`);
await key("KeyE");
await sleep(180);
const opened = await ev(`(function(){
  var b = document.getElementById("panel");
  return { open: !b.hidden && b.style.display !== "none",
           title: (b.querySelector("h2")||{}).textContent || "",
           enh: b.querySelectorAll("[data-enh]").length,
           ref: b.querySelectorAll("[data-ref]").length };
})()`);
add("E 로 대장간이 열린다", opened.open && opened.title.indexOf("대장") >= 0 && opened.enh >= 1,
  "안내 " + JSON.stringify(hint.trim()) + " · 창 " + JSON.stringify(opened.title) +
  " · 강화 버튼 " + opened.enh + "개 · 재련 버튼 " + opened.ref + "개");

/* ── ② 강화가 **정말 수치를 올리는가** ─────────────────
 * ⚠ 이름에 +1 이 붙었는지만 보면 안 된다. 그건 글자다. 피해가 올라야 한다. */
const enh1 = await ev(`(function(){
  var h = window.__hero(), I = window.ITEMS;
  function sum(it){ var t=0; for (var k in it.s) if (it.s[k] > 0) t += it.s[k]; return t; }
  var before = I.rebuild(h.bag[0]), g0 = h.gold;
  var cost = I.enhCost(before);
  document.querySelector('[data-enh="bag:0"]').click();
  var after = I.rebuild(h.bag[0]);
  return { bd: before.s.dmg, ad: after.s.dmg, be: before.enh, ae: after.enh,
           bt: sum(before), at: sum(after),
           g0: g0, g1: h.gold, cost: cost, nm: after.name };
})()`);
add("강화 +1 — 물건이 오른다",
  enh1.ae === 1 && enh1.at > enh1.bt && enh1.g1 === enh1.g0 - enh1.cost,
  "수치 합 " + enh1.bt + " → " + enh1.at + "(피해 " + enh1.bd + "→" + enh1.ad +
  ") · 강화 +" + enh1.be + " → +" + enh1.ae +
  " · 금화 " + enh1.g0 + " → " + enh1.g1 + "(값 " + enh1.cost + ") · 이름 " + JSON.stringify(enh1.nm));

/* ⚠ 약속은 "**단계마다** 오른다" 다. 한 번만 보면 중간에 멈추는 구간을 놓친다 —
 *   실제로 피해 7 짜리 무기가 4% 반올림 때문에 **+1~+6 이 전부 같은 값**이었다.
 * ⚠ 무기는 **피해가** 올라야 값어치를 느낀다. 수치 합만 보면 이동속도만 오른
 *   무기를 통과시킨다 — 둘 다 본다. */
const mono = await ev(`(function(){
  var I = window.ITEMS;
  function sum(it){ var t=0; for (var k in it.s) if (it.s[k] > 0) t += it.s[k]; return t; }
  var out = [], worst = null;
  ["dagger","sword","axe","staff"].forEach(function(base){
    [1, 12, 28].forEach(function(ilvl){
      var it = I.roll(function(){ return 0.42; }, { slot:"weapon", base:base, tier:"rare", ilvl:ilvl });
      var p = I.pack(it), prev = null, prevD = null, flat = 0, d0 = 0, d10 = 0;
      for (var n = 0; n <= 10; n++) {
        p.e = n; var r = I.rebuild(p), t = sum(r);
        if (prev !== null && t <= prev) flat++;
        if (n === 0) d0 = r.s.dmg; if (n === 10) d10 = r.s.dmg;
        prev = t;
      }
      if (flat || d10 <= d0) worst = base + " ilvl" + ilvl + " (안 오른 단계 " + flat +
        " · 피해 " + d0 + "→" + d10 + ")";
      out.push(base + ilvl + ":" + d0 + "→" + d10);
    });
  });
  return { worst: worst, out: out.join(" ") };
})()`);
add("단계마다 오른다 · 무기는 피해가 오른다", !mono.worst,
  mono.worst ? "⚠ " + mono.worst : "무기 4종 × 층 3단 모두 단조 증가 · " + mono.out);

/* ── ③ 입은 것도 올라가고 **실제 전투 수치에 반영되는가** ──
 * ⚠ 가방 안에서만 올라가면 아무 의미가 없다. world.gear 가 유일한 합산 자리다. */
const eqd = await ev(`(function(){
  var h = window.__hero(), w = window.__w();
  window.__equip(0);
  var g0 = w.gear.dmg;
  window.__smith();
  for (var i = 0; i < 3; i++) {
    var b = document.querySelector('[data-enh="eq:weapon"]');
    if (b) b.click();
  }
  return { g0: g0, g1: w.gear.dmg, enh: window.ITEMS.rebuild(h.equip.weapon).enh };
})()`);
add("입은 무기가 전투 수치에 반영",
  eqd.g1 > eqd.g0 && eqd.enh >= 2,
  "장착 피해 " + eqd.g0 + " → " + eqd.g1 + " · 강화 +" + eqd.enh + "(세 번 눌렀다)");

/* ── ④ 상한 — +10 을 넘지 않는가 ───────────────────── */
const cap = await ev(`(function(){
  var h = window.__hero(), I = window.ITEMS;
  var p = h.equip.weapon;
  /* 성공률을 1 로 고정해 **상한만** 본다(운으로 결과가 흔들리면 검사가 못 미덥다) */
  for (var i = 0; i < 40; i++) I.enhance(p, function(){ return 0; });
  var r = I.enhance(p, function(){ return 0; });
  window.__w().applyHero();
  return { enh: I.rebuild(p).enh, err: r.err || "", max: I.ENH_MAX };
})()`);
add("강화 상한 +" + cap.max, cap.enh === cap.max && !!cap.err,
  "40번 더 눌러도 +" + cap.enh + " · 거절 문구 " + JSON.stringify(cap.err));

/* ── ⑤ 실패해도 **잃지 않는가** ───────────────────────
 * ⚠ 이게 이 기능의 약속이다. 깨지면 회원이 몇 시간을 잃는다. */
const fail = await ev(`(function(){
  var I = window.ITEMS;
  var it = I.roll(function(){ return 0.42; }, { slot: "body", base: "mail", tier: "rare", ilvl: 10 });
  var p = I.pack(it); p.e = 5;
  var before = I.rebuild(p);
  var r = I.enhance(p, function(){ return 0.999; });   /* 반드시 실패 */
  var after = I.rebuild(p);
  return { ok: r.ok, be: before.enh, ae: after.enh, ba: before.s.armor, aa: after.s.armor,
           ch: Math.round(I.enhChance(5) * 100) };
})()`);
add("실패해도 단계·수치 그대로",
  fail.ok === false && fail.ae === fail.be && fail.aa === fail.ba,
  "+5 에서 실패(성공률 " + fail.ch + "%) → 강화 +" + fail.be + " → +" + fail.ae +
  " · 방어 " + fail.ba + " → " + fail.aa);

/* ── ⑥ 재련 — 접사가 **정말 바뀌는가** ────────────────── */
const ref = await ev(`(function(){
  var I = window.ITEMS, h = window.__hero();
  var it = I.roll(function(){ return 0.42; }, { slot: "weapon", base: "axe", tier: "rare", ilvl: 12 });
  h.bag.length = 0; h.bag.push(I.pack(it));
  var before = I.rebuild(h.bag[0]);
  var changed = 0, tries = 0;
  for (; tries < 12 && !changed; tries++) {
    I.reforge(h.bag[0]);
    var now = I.rebuild(h.bag[0]);
    if (now.affixes.join(",") !== before.affixes.join(",")) changed = 1;
  }
  var after = I.rebuild(h.bag[0]);
  var tier = I.tierOf(after.tier);
  return { changed: changed, tries: tries, ba: before.affixes.length, aa: after.affixes.length,
           lo: tier.affixes[0], hi: tier.affixes[1], bn: before.name, an: after.name };
})()`);
add("재련 — 접사가 바뀐다",
  ref.changed && ref.aa >= ref.lo && ref.aa <= ref.hi,
  ref.tries + "번 만에 바뀜 · 접사 " + ref.ba + "→" + ref.aa + "개 (희귀는 " +
  ref.lo + "~" + ref.hi + "개) · " + JSON.stringify(ref.bn) + " → " + JSON.stringify(ref.an));

/* ── ⑦ 일반 등급은 재련 못 한다 — **왜 못 하는지 말하는가** ──
 * ⚠ 버튼만 없애면 회원은 이유를 모른다. 자리에 글자가 남아 있어야 한다. */
const common = await ev(`(function(){
  var I = window.ITEMS, h = window.__hero();
  var it = I.roll(function(){ return 0.42; }, { slot: "weapon", base: "dagger", tier: "common", ilvl: 5 });
  h.bag.length = 0; h.equip = {}; h.bag.push(I.pack(it));
  window.__smith();
  var r = I.reforge(h.bag[0]);
  var b = document.getElementById("panel");
  var row = b.querySelector(".smrow");
  return { err: r.err || "", ref: b.querySelectorAll('[data-ref]').length,
           says: (row ? row.textContent : "").indexOf("재련") >= 0 };
})()`);
add("일반 등급은 이유를 보여 준다", !!common.err && common.ref === 0 && common.says,
  "거절 " + JSON.stringify(common.err) + " · 재련 버튼 " + common.ref + "개 · 자리에 설명 " +
  (common.says ? "있다" : "⚠없다"));

/* ── ⑧ 금화가 모자라면 **아무 일도 안 일어나는가** ───── */
const poor = await ev(`(function(){
  var I = window.ITEMS, h = window.__hero();
  var it = I.roll(function(){ return 0.42; }, { slot: "weapon", base: "sword", tier: "rare", ilvl: 10 });
  h.bag.length = 0; h.bag.push(I.pack(it)); h.gold = 1;
  window.__smith();
  document.querySelector('[data-enh="bag:0"]').click();
  var t = document.getElementById("toast");
  return { gold: h.gold, enh: I.rebuild(h.bag[0]).enh, toast: (t.textContent || "").trim() };
})()`);
add("금화 부족 — 깎지도 올리지도 않는다",
  poor.gold === 1 && poor.enh === 0 && /모자/.test(poor.toast),
  "금화 " + poor.gold + " 그대로 · 강화 +" + poor.enh + " · 안내 " + JSON.stringify(poor.toast));

/* ── ⑨ 새로고침해도 **남는가** ───────────────────────── */
await ev(`(function(){
  var I = window.ITEMS, h = window.__hero();
  var it = I.roll(function(){ return 0.42; }, { slot: "weapon", base: "sword", tier: "rare", ilvl: 10 });
  h.bag.length = 0; h.equip = {}; h.gold = 100000;
  var p = I.pack(it); p.e = 7;
  h.bag.push(p);
  window.__save();
})()`);
await reload();
const kept = await ev(`(function(){
  var h = window.__hero(), I = window.ITEMS;
  var it = I.rebuild(h.bag[0]);
  return { enh: it ? it.enh : -1, nm: it ? it.name : "", dmg: it ? it.s.dmg : 0 };
})()`);
add("강화가 저장에 남는다", kept.enh === 7,
  "새로고침 뒤 강화 +" + kept.enh + " · " + JSON.stringify(kept.nm) + " 피해 " + kept.dmg);

/* ── ⑩ 손으로 고친 저장은 **잘려 들어오는가** ────────── */
const forged = await ev(`(function(){
  var I = window.ITEMS;
  var a = I.rebuild({ u:"x1", sl:"weapon", b:"sword", t:"rare", il:10, a:[], e: 999 });
  var b = I.rebuild({ u:"x2", sl:"weapon", b:"sword", t:"rare", il:10, a:[], e: -5 });
  var c = I.rebuild({ u:"x3", sl:"weapon", b:"sword", t:"rare", il:10, a:[], e: "열" });
  return { a: a.enh, b: b.enh, c: c.enh, max: I.ENH_MAX };
})()`);
add("위조한 강화 단계는 잘린다",
  forged.a === forged.max && forged.b === 0 && forged.c === 0,
  "999 → +" + forged.a + " · -5 → +" + forged.b + " · 글자 → +" + forged.c);

add("콘솔 오류", errs.length === 0, errs.length + "건" + (errs.length ? " — " + errs.slice(0, 2).join(" | ") : ""));

console.log("\n대장간 — 강화 · 재련\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔ " : "✘ ") + n.padEnd(26, " ") + (note || ""));
}
console.log(bad ? "\n✘ " + bad + "건 실패" : "\n✔ 모두 통과");
try { ws.close(); } catch {}
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
