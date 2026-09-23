/* 기사 — **막고 되받아친다**가 정말 도는가.
 *
 * 새 직업은 수치만 바꾸면 "같은 게임을 숫자만 바꿔 하는 것" 이 된다.
 * 기사가 전사와 갈리는 축은 **되돌리기**다 — 맞은 만큼을 때린 쪽에 돌려준다.
 * 그 한 가지가 안 돌면 기사는 느린 전사일 뿐이다.
 *
 *   ① 목록에 있다        직업 넷 · 재주 넷 + 공용 둘
 *   ② 되돌리기가 돈다    방패를 올리고 맞으면 때린 쪽이 깎인다
 *   ③ 무한 되돌이가 아니다  둘 다 방패를 올려도 한 번에 끝난다
 *   ④ 버프가 끝나면 0    남아서 영영 되돌리는 몸이 되면 안 된다
 *   ⑤ 도발이 시선을 끈다  주변 적이 나를 보고 느려진다 (전사의 함성도 함께)
 *   ⑥ 전사와 다른 게임    수치 · 적성 · 재주가 겹치지 않는다
 *   ⑦ 도트가 다르다      전사와 한눈에 갈리고 걸음이 움직인다
 *
 * ⚠ 되돌린 피해에 치명타를 굴리지 않는다. 되돌리는 것은 받은 만큼이지
 *   새로 때리는 것이 아니다 — 굴리면 방패 하나로 상대가 녹는다.
 * ⚠ 대조군 `OLD=1` 은 combat.js 의 되돌리기를 걷는다. ②가 빨개져야 한다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const ROOT = path.join(REPO, "public");
const OLD = process.env.OLD === "1";
const ui = process.argv.indexOf("--url");
const URL_ARG = ui >= 0 ? process.argv[ui + 1] : null;
if (URL_ARG && OLD) { console.error("--url 과 OLD=1 은 같이 못 쓴다"); process.exit(2); }

const REVERT = [
  ["/js/combat.js",
   /if \(!opt\.noReflect && to\.reflect > 0 && from && from !== to && !from\.dead\) \{[\s\S]*?\n    \}/,
   "/* 되돌리기 없음 (대조군) */"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/combat.js"];

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p === "/") p = "/index.html";
  if (OLD && OLDIFY.indexOf(p) >= 0) {
    const body = oldify(p, fs.readFileSync(path.join(ROOT, p), "utf8"));
    r.writeHead(200, { "content-type": MIME[".js"] }); r.end(body); return;
  }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
  r.end(fs.readFileSync(f));
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-kn-"));
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
  const i = ++id; wait.set(i, x => x.error ? rej(new Error(me + ": " + x.error.message)) : res(x.result));
  ws.send(JSON.stringify({ id: i, method: me, params: p || {}, sessionId: s }));
});
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = (m, p) => send(m, p, sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev = async x => {
  const r = await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error("화면에서 터졌다 :: " + ((d.exception && d.exception.description) || d.text));
  }
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Page.navigate", { url: TARGET });
for (let i = 0; i < 300; i++) {
  if (await ev("!!(window.CLASSES && window.SKILLS && window.WORLD && window.COMBAT && window.SPRITES)")) break;
  await sleep(60);
}
await sleep(300);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* ── ① 목록에 있다 ───────────────────────────────── */
const info = await ev(`(function(){
  var CL = window.CLASSES, SK = window.SKILLS;
  var k = CL.byId("knight");
  if (!k || k.id !== "knight") return { none: true };
  var own = k.skills, all = CL.skillsOf("knight");
  var missing = all.filter(function (s) { return !SK.byId(s); });
  return { name: k.name, tag: k.tag, own: own, all: all, missing: missing,
           n: CL.LIST.length, sprite: k.sprite,
           hp: k.hp, spd: k.spd, armor: k.armor, likes: k.likes };
})()`);
add("목록에 있다", !info.none && info.own.length === 4 && info.all.length === 6 && info.missing.length === 0,
  info.none ? "기사가 없다"
    : "직업 " + info.n + "개 · " + info.name + " \\u201c" + info.tag + "\\u201d · 전용 " +
      info.own.join("·") + " + 공용 " + info.all.slice(4).join("·") +
      (info.missing.length ? " · \\u26a0 표에 없는 재주 " + info.missing.join(",") : ""));

/* ── ② 되돌리기가 도는가 ───────────────────────────
 * ⚠ 수치를 읽지 말고 **실제로 맞혀** 본다. p.reflect 만 보면 combat.js 가
 *   그것을 안 읽어도 초록이다. */
const REFL = `(function (pct, noBuff) {
  var W = window.WORLD, C = window.COMBAT;
  var w = new W.World({ seed: 5, depth: 2, mobs: 0 });
  var p = w.player;
  p.maxHp = 9999; p.hp = 9999;
  /* 때리는 쪽 — 허수아비가 아니라 진짜 몬스터여야 되돌아간다 */
  var foe = new W.Entity({ x: p.x + 1, y: p.y, team: 1, hp: 9999, maxHp: 9999,
                           spd: 0, name: "시험대" });
  w.ents.push(foe);
  if (!noBuff) {
    w.buffs.push({ until: w.time + 99, armor: 0, apsPct: 0, dmgPct: 0, reflect: pct, id: "shieldup" });
    w.refreshBuffs();
  }
  var f0 = foe.hp, p0 = p.hp;
  var got = C.damage(w, foe, p, 100, { canCrit: false });
  return { reflect: p.reflect || 0, took: p0 - p.hp, gotBack: f0 - foe.hp, dealt: got };
})`;
await ev("window.__refl = " + REFL + ";");
const on = await ev("window.__refl(60, false)");
const off = await ev("window.__refl(60, true)");
add("되돌리기가 돈다",
  on.reflect === 60 && on.gotBack > 0 &&
  Math.abs(on.gotBack - Math.round(on.took * 0.6)) <= 1 && off.gotBack === 0,
  "방패 올림: 100 을 맞아 " + on.took + " 깎이고 때린 쪽이 " + on.gotBack +
  " 깎임(60% 면 " + Math.round(on.took * 0.6) + ") · 방패 없음: " + off.gotBack +
  " (0 이어야 한다)");

/* ── ③ 무한 되돌이가 아닌가 ──────────────────────── */
const loop = await ev(`(function(){
  var W = window.WORLD, C = window.COMBAT;
  var w = new W.World({ seed: 6, depth: 2, mobs: 0 });
  var p = w.player; p.maxHp = 9999; p.hp = 9999;
  var foe = new W.Entity({ x: p.x + 1, y: p.y, team: 1, hp: 9999, maxHp: 9999, spd: 0, name: "시험대" });
  foe.reflect = 100;                       /* 상대도 되돌린다 */
  w.ents.push(foe);
  w.buffs.push({ until: w.time + 99, armor: 0, apsPct: 0, dmgPct: 0, reflect: 100, id: "shieldup" });
  w.refreshBuffs();
  var p0 = p.hp, f0 = foe.hp;
  var died = false;
  try { C.damage(w, foe, p, 50, { canCrit: false }); }
  catch (e) { died = true; }
  return { died: died, p: p0 - p.hp, f: f0 - foe.hp };
})()`);
add("무한 되돌이가 아니다", !loop.died && loop.p > 0 && loop.f > 0 && loop.p < 200 && loop.f < 200,
  loop.died ? "스택이 터졌다 (되돌이가 안 끊긴다)"
    : "둘 다 100% 로 올려도 나 " + loop.p + " · 상대 " + loop.f + " 로 끝난다 (한 번만 되돌린다)");

/* ── ④ 버프가 끝나면 0 ──────────────────────────── */
const gone = await ev(`(function(){
  var W = window.WORLD;
  var w = new W.World({ seed: 7, depth: 2, mobs: 0 });
  w.buffs.push({ until: w.time + 0.2, armor: 0, apsPct: 0, dmgPct: 0, reflect: 80, id: "shieldup" });
  w.refreshBuffs();
  var mid = w.player.reflect;
  for (var i = 0; i < 40; i++) w.advance(1 / 60);
  return { mid: mid, end: w.player.reflect, buffs: w.buffs.length };
})()`);
add("버프가 끝나면 0", gone.mid === 80 && gone.end === 0 && gone.buffs === 0,
  "켤 때 " + gone.mid + " → 끝나고 " + gone.end + " (남은 버프 " + gone.buffs + "개)");

/* ── ⑤ 도발이 시선을 끈다 ───────────────────────── */
const taunt = await ev(`(function(){
  var W = window.WORLD, SK = window.SKILLS;
  function run(skillId, cls) {
    var w = new W.World({ seed: 8, depth: 2, mobs: 0, hero: { cls: cls, level: 20, skills: {}, bar: [] } });
    var p = w.player;
    var foes = [];
    for (var i = 0; i < 3; i++) {
      var e = new W.Entity({ x: p.x + 1 + i, y: p.y, team: 1, hp: 500, maxHp: 500,
                             spd: 3, name: "시험대" + i });
      e.target = null; w.ents.push(e); foes.push(e);
    }
    /* ⚠ 서명은 use(world, id, aimX, aimY, taken, cls) 다. 그리고 **바로
     *   안 터진다** — p.cast 에 담겼다가 시전 시간이 지나야 fire 가 돈다.
     *   처음에 cast 객체를 넘기고 6프레임만 돌렸다가 0/3 으로 빨갰다. */
    w.buffs.length = 0;
    p.stam = 999;
    var no = SK.use(w, skillId, p.x + 1, p.y, {}, cls);
    if (no) return [{ blocked: no }];
    for (var t = 0; t < 90; t++) w.advance(1 / 60);
    return foes.map(function (f) {
      return { mine: f.target === p, slow: (f.slowUntil || 0) > w.time, pct: f.slowPct || 0 };
    });
  }
  return { knight: run("provoke", "knight"), warrior: run("shout", "warrior") };
})()`);
const kBlk = taunt.knight[0] && taunt.knight[0].blocked;
const wBlk = taunt.warrior[0] && taunt.warrior[0].blocked;
const kOk = kBlk ? 0 : taunt.knight.filter(f => f.mine && f.slow).length;
const wOk = wBlk ? 0 : taunt.warrior.filter(f => f.mine && f.slow).length;
add("도발이 시선을 끈다", kOk === 3 && wOk === 3,
  (kBlk ? "기사 도발이 막혔다(" + kBlk + ")" : "기사 도발 " + kOk + "/3 (둔화 " + taunt.knight[0].pct + "%)") +
  " · " +
  (wBlk ? "전사 함성이 막혔다(" + wBlk + ")" : "전사 함성 " + wOk + "/3 (둔화 " + taunt.warrior[0].pct + "%)") +
  " — 함성은 박아 둔 id 를 걷고 같은 길로 바꿨다");

/* ── ⑥ 전사와 다른 게임인가 ─────────────────────── */
const vs = await ev(`(function(){
  var CL = window.CLASSES;
  var k = CL.byId("knight"), w = CL.byId("warrior");
  var shareSkill = k.skills.filter(function (s) { return w.skills.indexOf(s) >= 0; });
  var shareLike = k.likes.filter(function (s) { return w.likes.indexOf(s) >= 0; });
  return { shareSkill: shareSkill, shareLike: shareLike,
           kHp: k.hp, wHp: w.hp, kSpd: k.spd, wSpd: w.spd, kArm: k.armor, wArm: w.armor,
           kIsSlowest: CL.LIST.every(function (c) { return c.spd >= k.spd; }),
           kIsTank: CL.LIST.every(function (c) { return c.armor <= k.armor; }) };
})()`);
add("전사와 다른 게임", vs.shareSkill.length === 0 && vs.kIsSlowest && vs.kIsTank && vs.kHp < vs.wHp,
  "겹치는 재주 " + vs.shareSkill.length + "개 · 겹치는 적성 " + vs.shareLike.join(",") +
  " · 기사 체력 " + vs.kHp + " vs 전사 " + vs.wHp +
  " · 이동 " + vs.kSpd + " (가장 느림 " + vs.kIsSlowest + ")" +
  " · 방어 " + vs.kArm + " (가장 높음 " + vs.kIsTank + ")");

/* ── ⑦ 도트가 다르다 ───────────────────────────── */
const art = await ev(`(function(){
  var S = window.SPRITES;
  function px(n, f) {
    var sz = S.sizeOf(n), im = S.bake(n, f);
    var c = document.createElement("canvas"); c.width = sz.w; c.height = sz.h;
    var g = c.getContext("2d"); g.imageSmoothingEnabled = false;
    if (im) g.drawImage(im, 0, 0);
    return g.getImageData(0, 0, sz.w, sz.h).data;
  }
  function diff(a, b) {
    var n = 0;
    for (var i = 0; i < a.length; i += 4)
      if (Math.abs(a[i]-b[i]) > 8 || Math.abs(a[i+1]-b[i+1]) > 8 ||
          Math.abs(a[i+2]-b[i+2]) > 8 || Math.abs(a[i+3]-b[i+3]) > 8) n++;
    return n;
  }
  var k0 = px("knight", 0), lit = 0;
  for (var i = 3; i < k0.length; i += 4) if (k0[i] > 20) lit++;
  return { lit: lit, vsWarrior: diff(k0, px("warrior", 0)),
           walk: diff(px("knight", 1), px("knight", 2)),
           atk: diff(k0, px("knight", 3)) };
})()`);
add("도트가 다르다", art.lit > 500 && art.vsWarrior > 400 && art.walk > 30 && art.atk > 100,
  "칠해진 " + art.lit + "칸 · 전사와 " + art.vsWarrior + "칸 다름 · 걸음 1↔2 " +
  art.walk + "칸(" + (art.walk / art.lit * 100).toFixed(1) + "%) · 치켜듦 " + art.atk + "칸");

console.log(OLD ? "── 기사 [대조군: 되돌리기 없음] ──"
                : ("── 기사" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 4).forEach(e => console.log("  " + e)); fails++; }
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
