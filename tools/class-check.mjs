/* 직업 셋이 **정말 다른 게임인가.**
 *
 * 전에는 `cls` 가 그림만 바꿨다. 그래서 이 검사는 "직업이 있다" 가 아니라
 * **"셋이 서로 다르게 논다"** 를 잰다 — 수치 · 적성 · 전용 재주 · 평타 사거리.
 *
 * ⚠ "표에 다른 숫자가 적혀 있다" 는 통과가 아니다. **몸에 적용된 값**과
 *   실제 피해를 잰다. 표와 실제가 갈리는 것이 이 단계의 대표 사고다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-cls-"));
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
const reload = async () => { await S("Page.navigate", { url: URL0 }); await sleep(1200); };
/* 저장을 **지우고** 새로 띄운다.
 * ⚠ 지우기 전에 게임의 저장을 잠가야 한다. 창을 닫을 때(beforeunload) 한 번 더
 *   저장하므로, 그냥 지우고 새로고침하면 **방금 지운 것이 되살아난다** —
 *   그러면 "처음 켠 사람" 이 아니라서 만들기 창이 안 뜬다(실측으로 4건이 빨개졌다).
 *   save-check 에서 똑같이 당한 적이 있다. */
const wipe = async () => {
  await ev("window.SAVE.save = function () { return false; };");
  await ev("localStorage.clear()");
  await reload();
};

await S("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await reload();
await wipe();

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* 연습장 — 직업과 무기를 정해 세운다 */
await ev(`
  window.__lab = function (cls, weapon, opts) {
    opts = opts || {};
    var W = window.WORLD, D = window.DUNGEON, I = window.ITEMS, S = window.SAVE;
    var h = window.__hero();
    h.cls = cls; h.level = opts.level || 20; h.equip = {}; h.bag = [];
    h.skills = {}; h.points = 0;
    h.bar = window.CLASSES.skillsOf(cls).slice(0, 4);
    if (weapon) {
      var r = D.makeRng(4242);
      h.equip.weapon = I.pack(I.roll(r, { ilvl: 10, slot: "weapon",
                                          base: weapon, tier: "common" }));
    }
    var w = new W.World({ seed: 55, w: 46, h: 34, mobs: 0, hero: h, depth: 10 });
    w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
    w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.player.x = 23.5; w.player.y = 17.5;
    w.player.px = w.player.x; w.player.py = w.player.y;
    w.player.hp = w.player.maxHp;
    (opts.foes || []).forEach(function (f) {
      w.ents.push(new W.Entity({ x: f.x, y: f.y, sprite: "rat", team: 1,
        hp: f.hp === undefined ? 99999 : f.hp, name: "허수아비" }));
    });
    return w;
  };
  window.__run = function (w, secs) {
    var n = Math.round(secs * 60);
    for (var i = 0; i < n; i++) w.advance(1/60);
    return w;
  };
`);

/* ── ① 표가 스스로 어긋나지 않았는가 ──────────────────── */
const audit = await ev(`window.CLASSES.audit()`);
add("표 자기 점검", audit.length === 0, audit.length ? audit.join(" / ") : "이상 없음");

/* ── ② 셋이 **몸에 다른 값**을 주는가 ────────────────────
 * ⚠ 표에 다른 숫자가 있다는 것과 몸에 적용된다는 것은 다르다. */
const stats = await ev(`(function(){
  var out = [];
  ["warrior", "rogue", "mage"].forEach(function (c) {
    var w = window.__lab(c, null, { level: 20 });
    var p = w.player;
    out.push({ cls: c, name: window.CLASSES.byId(c).name,
               hp: p.maxHp, spd: +p.spd.toFixed(2), def: p.def,
               crit: p.critPct, stam: p.stamMax, regen: p.stamRegen });
  });
  return out;
})()`);
const uniq = k => new Set(stats.map(s => s[k])).size;
add("셋이 다른 몸을 가진다",
  uniq("hp") === 3 && uniq("spd") === 3 && uniq("stam") === 3 &&
  uniq("def") >= 2 && uniq("crit") === 3,
  stats.map(s => s.name + " 체력" + s.hp + "·속도" + s.spd + "·방어" + s.def +
    "·치명" + s.crit + "%·기력" + s.stam).join(" / "));

/* ── ③ 적성 무기가 **실제로 더 아픈가** ──────────────────
 * ⚠ 표시만 바뀌고 피해가 그대로인 것이 가장 흔한 사고다. 때려서 잰다. */
const adept = await ev(`(function(){
  function hit(cls, weapon) {
    var w = window.__lab(cls, weapon, { foes: [{ x: 24.6, y: 17.5 }] });
    var foe = w.ents[1], hp0 = foe.hp;
    w.swing(40, 17.5);
    window.__run(w, 0.8);
    return { dmg: hp0 - foe.hp, adept: !!w.player.adept, one: w.player.swing.dmg };
  }
  return {
    warAxe:  hit("warrior", "axe"),      /* 적성 */
    warStaff: hit("warrior", "staff"),   /* 아님 */
    rogDagger: hit("rogue", "dagger"),   /* 적성 */
    rogAxe:  hit("rogue", "axe"),        /* 아님 */
    bonus: window.CLASSES.ADEPT_BONUS
  };
})()`);
const warGap = adept.warAxe.one / (adept.warAxe.one / 1.25);
add("적성 무기가 더 아프다",
  adept.warAxe.adept && !adept.warStaff.adept &&
  adept.rogDagger.adept && !adept.rogAxe.adept,
  "전사+도끼 적성" + (adept.warAxe.adept ? "✔" : "⚠") + " 한 대 " + adept.warAxe.one +
  " · 전사+지팡이 " + (adept.warStaff.adept ? "⚠적성" : "아님") +
  " · 도적+단검 적성" + (adept.rogDagger.adept ? "✔" : "⚠") +
  " · 도적+도끼 " + (adept.rogAxe.adept ? "⚠적성" : "아님") + " (보너스 " + adept.bonus + "%)");

/* 같은 무기를 적성인 직업과 아닌 직업이 들면 피해가 갈리는가 */
const sameWeapon = await ev(`(function(){
  function one(cls) {
    var w = window.__lab(cls, "axe", { level: 20 });
    return { one: w.player.swing.dmg, adept: !!w.player.adept };
  }
  return { war: one("warrior"), rog: one("rogue") };
})()`);
const gap = sameWeapon.war.one / sameWeapon.rog.one;
add("같은 도끼도 직업 따라 다르다", gap > 1.15 && gap < 1.35,
  "전사 " + sameWeapon.war.one + " vs 도적 " + sameWeapon.rog.one +
  " (" + ((gap - 1) * 100).toFixed(0) + "% 차이)");

/* ── ④ 원거리 평타 — **정말 날아가서 맞히는가** ────────── */
const ranged = await ev(`(function(){
  /* 6칸 밖 — 근접으로는 절대 안 닿는 거리 */
  var w = window.__lab("mage", "staff", { foes: [{ x: 29.5, y: 17.5 }] });
  var foe = w.ents[1], hp0 = foe.hp;
  var sawShot = 0;
  w.swing(40, 17.5);
  for (var i = 0; i < 180; i++) { w.advance(1/60); if (w.shots.length) sawShot = 1; }
  return { dmg: hp0 - foe.hp, shot: sawShot, reach: w.player.swing.reach,
           isRanged: !!w.player.swing.ranged, d: 6 };
})()`);
add("지팡이는 날아간다",
  ranged.isRanged && ranged.shot === 1 && ranged.dmg > 0,
  "6칸 밖 허수아비 · 날아간 것 " + (ranged.shot ? "보임" : "⚠없음") +
  " · 입힌 피해 " + ranged.dmg + " · 사거리 " + ranged.reach + "칸");

/* 근접 무기를 든 마법사는 **안** 날아가야 한다 */
const melee = await ev(`(function(){
  var w = window.__lab("mage", "sword", { foes: [{ x: 29.5, y: 17.5 }] });
  var foe = w.ents[1], hp0 = foe.hp;
  w.swing(40, 17.5);
  window.__run(w, 3);
  return { dmg: hp0 - foe.hp, isRanged: !!w.player.swing.ranged, shots: w.shots.length };
})()`);
add("근접 무기는 안 날아간다", !melee.isRanged && melee.dmg === 0,
  "마법사+장검으로 6칸 밖 · 날아간 것 " + melee.shots + "개 · 피해 " + melee.dmg);

/* 사거리 밖은 안 닿아야 한다 — 무한 사거리면 마법사가 무적이 된다 */
const tooFar = await ev(`(function(){
  var w = window.__lab("mage", "staff", { foes: [{ x: 23.5 + 12, y: 17.5 }] });
  var foe = w.ents[1], hp0 = foe.hp;
  for (var k = 0; k < 6; k++) { w.swing(99, 17.5); window.__run(w, 1.2); }
  return { dmg: hp0 - foe.hp, reach: w.player.swing.reach };
})()`);
add("사거리 밖은 못 맞힌다", tooFar.dmg === 0,
  "12칸 밖(사거리 " + tooFar.reach + "칸) · 피해 " + tooFar.dmg);

/* ── ⑤ 직업 밖 재주는 못 쓰는가 ─────────────────────── */
const locked = await ev(`(function(){
  var w = window.__lab("warrior", "sword");
  return {
    mine: w.useSkill("cleave", 40, 17.5, {}, "warrior"),
    theirs: w.useSkill("burn", 30, 17.5, {}, "warrior"),
    canWar: window.CLASSES.canUse("warrior", "burn"),
    canMage: window.CLASSES.canUse("mage", "burn"),
    shared: window.CLASSES.canUse("warrior", "dash") &&
            window.CLASSES.canUse("mage", "dash")
  };
})()`);
add("직업 밖 재주 잠김",
  locked.mine === null && !!locked.theirs && !locked.canWar &&
  locked.canMage && locked.shared,
  "전사가 베어넘기기 " + (locked.mine || "성공") + " · 불바다 “" + locked.theirs +
  "” · 공용(돌진)은 " + (locked.shared ? "둘 다 됨" : "⚠막힘"));

/* ── ⑥ 캐릭터 만들기 — 셋이 나오고 **눌러서 만들어지는가** ── */
await wipe();
const create = await ev(`(function(){
  var b = document.getElementById("panel");
  return { open: !b.hidden, cards: b.querySelectorAll(".col.cls").length,
           picks: b.querySelectorAll("[data-cls]").length,
           faces: b.querySelectorAll(".face").length };
})()`);
/* ⚠ 개수를 못 박지 않는다. 기사를 더하자 "3개여야 한다" 로 빨개졌는데
 *   제품은 넷을 멀쩡히 그리고 있었다 — 검사 안에 박힌 숫자는 제품의
 *   진실이 아니라 검사의 기억이다. 목록에서 세어 맞춘다. */
const wantCls = await ev("window.CLASSES.LIST.length");
add("처음 켜면 직업부터", create.open && create.cards === wantCls && create.picks === wantCls,
  "창 " + (create.open ? "열림" : "⚠안 열림") + " · 직업 " + create.cards +
  "개 · 그림 " + create.faces + "개");

/* 그림이 정말 칠해졌는가 — 빈 캔버스면 누가 누군지 모른다 */
const faces = await ev(`(function(){
  var out = [];
  document.querySelectorAll("#panel .face").forEach(function (cv) {
    var d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    var lit = 0;
    for (var k = 0; k < d.length; k += 4) if (d[k + 3] > 20) lit++;
    out.push(lit);
  });
  return out;
})()`);
add("직업 그림이 칠해진다", faces.length === wantCls && faces.every(f => f > 400),
  "칠해진 점 " + faces.join(" / "));

await ev(`document.querySelector('[data-cls="mage"]').click()`);
await sleep(600);
const made = await ev(`(function(){
  var h = window.__hero(), p = window.__peek();
  var I = window.ITEMS;
  var wep = I.rebuild(h.equip.weapon);
  return { cls: h.cls, level: h.level, inTown: p.inTown,
           weapon: wep ? wep.base : null, ranged: p.ranged,
           bar: h.bar.slice(), panel: !document.getElementById("panel").hidden };
})()`);
add("고르면 그 직업으로 시작",
  made.cls === "mage" && made.weapon === "staff" && made.ranged &&
  made.inTown && !made.panel,
  "직업 " + made.cls + " · 시작 무기 " + made.weapon + " · 원거리 " + made.ranged +
  " · 마을 " + made.inTown + " · 손잡이 [" + made.bar.join(",") + "]");

/* ── ⑦ 새로고침을 넘어 남는가 ──────────────────────── */
await ev(`window.__save()`);
await reload();
const kept = await ev(`(function(){
  var h = window.__hero();
  return { cls: h.cls, bar: h.bar.slice(),
           panel: !document.getElementById("panel").hidden };
})()`);
add("직업이 저장에 남는다",
  kept.cls === "mage" && kept.bar.indexOf("burn") >= 0 && !kept.panel,
  "직업 " + kept.cls + " · 손잡이 [" + kept.bar.join(",") +
  "] · 만들기 창 " + (kept.panel ? "⚠또 뜸" : "안 뜸"));

/* ⚠ 저장을 손으로 고쳐 남의 직업 재주를 심으면? */
await ev(`(function(){
  window.SAVE.save = function () { return false; };
  var raw = JSON.parse(localStorage.getItem(window.SAVE.KEY));
  raw.d.cls = "mage";
  raw.d.bar = ["cleave", "whirl", "burn", "dash"];    /* 앞 둘은 전사 것 */
  raw.d.skills = { cleave: ["heavy"], burn: ["long"] };
  localStorage.setItem(window.SAVE.KEY, JSON.stringify(raw));
})()`);
await reload();
const forged = await ev(`(function(){ var h = window.__hero();
  return { bar: h.bar.slice(), war: !!h.skills.cleave, mine: !!h.skills.burn }; })()`);
/* ⚠ 기대를 고쳤다. 전에는 "걸러진 칸이 **비어 있어야** 한다" 였는데, 지금은
 *   걸러낸 자리를 **그 직업 재주로 메운다**(더 나은 동작이다 — 빈 칸으로 두면
 *   새 캐릭터가 반쯤 빈 손잡이로 시작한다). 재는 것을 바꾼다:
 *   ① 남의 재주가 하나도 없다  ② 겹친 칸이 없다  ③ 칸이 다 찼다 */
/* 쓸 수 있는 재주를 **목록에서** 가져온다.
 * 전에는 여기에 넷을 손으로 박아 두었다. 직업에 재주가 하나 늘자
 * (전사에 stomp, 마법사도 같은 식) 멀쩡한 배치를 "남의 것" 이라고
 * 불렀다. 검사 안에 박힌 목록은 제품의 진실이 아니라 검사의 기억이다. */
const legal = await ev("window.CLASSES.skillsOf(window.__hero().cls)");
const wrong = forged.bar.filter(x => x && legal.indexOf(x) < 0);
const dup = forged.bar.filter((x, i) => x && forged.bar.indexOf(x) !== i);
add("남의 직업 재주는 걸러진다",
  wrong.length === 0 && dup.length === 0 &&
  forged.bar.filter(Boolean).length === 4 && !forged.war && forged.mine,
  "전사 재주를 심음 → 손잡이 [" + forged.bar.map(x => x || "—").join(",") +
  "] · 남의 것 " + wrong.length + "개 · 겹침 " + dup.length + "개" +
  " · 전사 시너지 " + (forged.war ? "⚠남음" : "지워짐") +
  " · 내 시너지 " + (forged.mine ? "남음" : "⚠지워짐"));

/* ── 골라서 정말 그 직업이 되는가 ─────────────────────
 * ⚠ 이것이 없어서 **기사를 못 고르는 채로 배포됐다.** 창이 뜨고 그림이
 *   칠해지는 것만 봤지, 눌렀을 때 바뀌는지는 아무도 안 쟀다.
 *   save.js 에 직업 목록이 박혀 있어 고르는 순간 전사로 되돌아갔는데
 *   오류는 한 줄도 안 났다. */
await wipe();
const picked = await ev(`(function(){
  var CL = window.CLASSES, out = [];
  CL.LIST.forEach(function (c) {
    window.__pick(c.id);
    var h = window.__hero();
    out.push({ want: c.id, got: h.cls, sprite: window.__w().player.sprite,
               bar: h.bar.filter(Boolean).length });
  });
  return out;
})()`);
const wrongPick = picked.filter(p => p.got !== p.want || p.sprite !== p.want);
add("골라서 그 직업이 된다", wrongPick.length === 0,
  picked.map(p => p.want + (p.got === p.want ? "✔" : "→" + p.got + "✘")).join(" · ") +
  " · 손잡이 " + picked.map(p => p.bar).join("/") + "칸");

/* ── 새 직업을 골라도 키워 둔 것이 안 날아가는가 ───────
 * 2026-09-23 에 실제로 난 사고다. 기사를 고르자 빈 전사가 만들어지며
 * **진짜 전사 칸을 덮어썼다.** 되돌릴 자리가 하나도 없었다. */
await wipe();
const survive = await ev(`(function(){
  var S = window.SAVE;
  window.__pick("warrior");
  var h = window.__hero();
  h.level = 24; h.gold = 7777; h.maxDepth = 19;
  S.save(h);
  var before = S.loadSlot("warrior");
  /* 새 직업으로 갔다가 돌아온다 */
  window.__pick("knight");
  var mid = window.__hero();
  window.__pick("warrior");
  var back = window.__hero();
  return { before: before ? before.level : -1,
           midCls: mid.cls, midLv: mid.level,
           backCls: back.cls, backLv: back.level, backGold: back.gold, backDepth: back.maxDepth };
})()`);
add("키운 것이 안 날아간다",
  survive.before === 24 && survive.midCls === "knight" && survive.midLv === 1 &&
  survive.backCls === "warrior" && survive.backLv === 24 && survive.backGold === 7777,
  "전사 Lv.24 7777금 → 기사(" + survive.midCls + " Lv." + survive.midLv + ") → 전사로 돌아오니 " +
  survive.backCls + " Lv." + survive.backLv + " " + survive.backGold + "금 " + survive.backDepth + "층");

/* ── 레벨이 내려가는 덮어쓰기는 사본을 남기는가 ────────
 * 원인은 고쳤지만 저장을 덮어쓰는 길은 앞으로도 있다. 되돌릴 자리가
 * 하나도 없던 것이 진짜 문제였다. */
const bak = await ev(`(function(){
  var S = window.SAVE;
  window.__pick("warrior");
  var h = window.__hero();
  h.level = 31; h.gold = 4242; S.save(h);
  /* 사고를 흉내낸다 — 빈 전사로 덮어쓴다 */
  var blank = S.blank("warrior");
  S.save(blank);
  var now = S.loadSlot("warrior");
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(S.KEY + ":cls:warrior:bak")); } catch (e) {}
  return { now: now ? now.level : -1,
           bak: raw && raw.d ? raw.d.level : -1,
           bakGold: raw && raw.d ? raw.d.gold : -1 };
})()`);
add("덮어써도 사본이 남는다", bak.now === 1 && bak.bak === 31 && bak.bakGold === 4242,
  "Lv.31 을 빈 것으로 덮으니 지금 Lv." + bak.now + " · 사본에 Lv." + bak.bak +
  " " + bak.bakGold + "금 (되돌릴 자리가 남는다)");

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n직업 셋 — 전사 · 도적 · 마법사\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(20, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
