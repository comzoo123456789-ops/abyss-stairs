/* 2·3단계 — 전투 판정과 몬스터 하나가 **정말** 도는가.
 *
 * 실시간 전투에서 가장 조용히 망가지는 것 둘:
 *   ① 한 번 휘둘렀는데 **매 걸음 판정**이 나가 붙어 있는 동안 60번 맞는다
 *      (화면으로는 "좀 아프네" 로만 보인다)
 *   ② 선딜이 없어 **피할 방법이 없다** — 그러면 체력 큰 쪽이 이기는 게임이 된다
 * 둘 다 눈으로는 안 잡힌다. 그래서 잰다.
 *
 * ⚠ "때리면 죽는다" 만 보면 안 된다. 때린 **횟수**와 **시각**을 재야 한다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-fight-"));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1200);

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* 검사용 연습장 — 벽 없는 방, 원하는 자리에 허수아비.
 * ⚠ 던전에서 재면 벽·다른 몬스터가 섞여 무엇을 쟀는지 알 수 없다. */
const ARENA = `
  window.__arena = function (opts) {
    opts = opts || {};
    var W = window.WORLD, D = window.DUNGEON;
    var w = new W.World({ seed: 99, w: 40, h: 30, mobs: 0 });
    w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
    /* 시야를 통째로 열어 둔다 — 재려는 것은 시야가 아니다 */
    w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.player.x = 20.5; w.player.y = 15.5;
    w.player.px = w.player.x; w.player.py = w.player.y;
    (opts.foes || []).forEach(function (f) {
      var e = new W.Entity({
        x: f.x, y: f.y, sprite: "rat", team: 1,
        hp: f.hp === undefined ? 9999 : f.hp,
        spd: f.spd === undefined ? 3.0 : f.spd,
        brain: f.brain === undefined ? null : f.brain,
        name: f.name || "허수아비",
        swing: f.swing || null
      });
      w.ents.push(e);
    });
    return w;
  };
  window.__runFor = function (w, secs) {
    var n = Math.round(secs * 60);
    for (var i = 0; i < n; i++) w.advance(1/60);
    return w;
  };
`;
await ev(ARENA);

/* ── ① 한 번 휘두르면 한 번만 맞는가 ─────────────────── */
const once = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 21.3, y: 15.5 }] });
  var foe = w.ents[1];
  var before = foe.hp;
  w.swing(30, 15.5);                    /* 오른쪽으로 한 번 */
  window.__runFor(w, 1.0);              /* 다음 공격이 나가기 전까지만 */
  return { lost: before - foe.hp, dmg: window.COMBAT.SWING.dmg };
})()`);
add("한 번 = 한 번", once.lost === once.dmg,
  "한 번 휘둘러 " + once.lost + " 피해 (한 대 " + once.dmg + ") — 60번 판정되면 여기서 터진다");

/* ── ② 선딜이 있는가 · 판정 시점이 맞는가 ──────────────── */
const wind = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 21.3, y: 15.5 }] });
  var foe = w.ents[1];
  var m = window.COMBAT.SWING;
  w.swing(30, 15.5);
  var hitAt = null, t = 0;
  for (var i = 0; i < 120; i++) {
    var hp0 = foe.hp;
    w.advance(1/60); t += 1/60;
    if (foe.hp < hp0 && hitAt === null) hitAt = t;
  }
  return { hitAt: hitAt, windup: m.windup };
})()`);
add("선딜", wind.hitAt !== null && Math.abs(wind.hitAt - wind.windup) < 0.035,
  wind.hitAt === null ? "⚠ 아예 안 맞았다"
    : "휘두르고 " + wind.hitAt.toFixed(3) + "초 뒤 판정 (설정 선딜 " + wind.windup + "초)");

/* ── ③ 공격속도가 초당 수치와 맞는가 ─────────────────────
 * ⚠ 처음에 **맞은 횟수**를 셌다가 8초에 3번으로 빨개졌다. 주기는 맞는데
 *   밀림(0.35칸)이 허수아비를 세 대 만에 사거리 밖으로 밀어낸 것이었다 —
 *   제품이 아니라 검사가 엉뚱한 것을 재고 있었다. 재야 할 것은 **휘두른
 *   횟수**다. 허수아비는 매 걸음 제자리에 고정해 사거리 변수를 없앤다. */
const aps = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 21.3, y: 15.5 }] });
  var foe = w.ents[1];
  var m = window.COMBAT.SWING;
  var swings = 0, hits = 0, secs = 8;
  for (var i = 0; i < secs * 60; i++) {
    foe.x = 21.3; foe.y = 15.5; foe.knock = null;   /* 밀림을 없앤다 */
    if (w.swing(30, 15.5)) swings++;
    var hp0 = foe.hp;
    w.advance(1/60);
    if (foe.hp < hp0) hits++;
  }
  return { hits: swings, taken: hits, want: m.aps * secs, secs: secs, aps: m.aps };
})()`);
const apsGap = Math.abs(aps.hits - aps.want) / aps.want;
add("공격속도", apsGap < 0.10,
  aps.secs + "초에 " + aps.hits + "번 휘두름 (설정 " + aps.aps + "회/초 → " +
  aps.want.toFixed(1) + "번 기대) · 차이 " + (apsGap * 100).toFixed(0) + "% · 명중 " + aps.taken + "번");

/* ── ④ 부채꼴 — 등 뒤는 안 맞는가 ──────────────────────── */
const arc = await ev(`(function(){
  var w = window.__arena({ foes: [
    { x: 21.4, y: 15.5, name: "앞" },
    { x: 19.6, y: 15.5, name: "뒤" },
    { x: 20.5, y: 14.4, name: "위" }
  ]});
  var f = w.ents.slice(1);
  var hp0 = f.map(function(e){ return e.hp; });
  w.swing(30, 15.5);                    /* 오른쪽을 본다 */
  window.__runFor(w, 0.5);
  return f.map(function(e,i){ return { n: e.name, lost: hp0[i] - e.hp }; });
})()`);
const front = arc.find(a => a.n === "앞"), back = arc.find(a => a.n === "뒤");
add("부채꼴", front.lost > 0 && back.lost === 0,
  arc.map(a => a.n + " " + a.lost).join(" · ") + " (뒤는 0이어야 한다)");

/* ── ⑤ 사거리 밖은 안 맞는가 ───────────────────────────── */
const reach = await ev(`(function(){
  var m = window.COMBAT.SWING;
  function hit(dx) {
    var w = window.__arena({ foes: [{ x: 20.5 + dx, y: 15.5 }] });
    var foe = w.ents[1], hp0 = foe.hp;
    w.swing(99, 15.5);
    window.__runFor(w, 0.5);
    return hp0 - foe.hp > 0;
  }
  return { inside: hit(m.reach + 0.3), outside: hit(m.reach + 1.2), reach: m.reach };
})()`);
add("사거리", reach.inside && !reach.outside,
  "사거리 " + reach.reach + "칸 · 안쪽 " + (reach.inside ? "맞음" : "⚠안 맞음") +
  " · 1칸 밖 " + (reach.outside ? "⚠맞음" : "안 맞음"));

/* ── ⑥ 몬스터가 쫓아오는가 ─────────────────────────────── */
const chase = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 27.5, y: 15.5, brain: "melee", hp: 9999 }] });
  var foe = w.ents[1];
  var d0 = Math.hypot(foe.x - w.player.x, foe.y - w.player.y);
  window.__runFor(w, 3);
  var d1 = Math.hypot(foe.x - w.player.x, foe.y - w.player.y);
  return { d0: d0, d1: d1 };
})()`);
add("쫓아온다", chase.d1 < 2.2,
  "거리 " + chase.d0.toFixed(1) + "칸 → " + chase.d1.toFixed(2) + "칸 (3초)");

/* ── ⑦ 몬스터가 때리는가 ───────────────────────────────── */
const bite = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 23.5, y: 15.5, brain: "melee", hp: 9999,
    swing: { aps: 0.85, windup: 0.32, recover: 0.3, reach: 0.95, arc: 120, dmg: 4, push: 0.15 } }] });
  var hp0 = w.player.hp;
  window.__runFor(w, 6);
  return { lost: hp0 - w.player.hp };
})()`);
add("몬스터 공격", bite.lost > 0, "6초 가만히 서 있어 체력 " + bite.lost + " 잃음");

/* ── ⑧ **선딜을 보고 피할 수 있는가** — 이 단계의 핵심 ──
 * 몬스터가 팔을 드는 것을 보고 비키면 안 맞아야 한다. 이게 안 되면
 * 실시간 전투가 아니라 "체력 큰 쪽이 이기는 대치" 가 된다. */
const dodge = await ev(`(function(){
  var SW = { aps: 0.85, windup: 0.32, recover: 0.3, reach: 0.95, arc: 120, dmg: 4, push: 0 };
  function trial(run) {
    var w = window.__arena({ foes: [{ x: 21.3, y: 15.5, brain: "melee", hp: 9999, swing: SW }] });
    var foe = w.ents[1];
    var hp0 = w.player.hp, fled = false;
    for (var i = 0; i < 300; i++) {
      /* 몬스터가 팔을 든 것을 **본 순간** 도망친다 */
      if (run && foe.atk && !fled) fled = true;
      w.player.mx = fled ? -1 : 0;
      w.player.my = 0;
      w.advance(1/60);
      if (fled && !foe.atk) break;      /* 그 한 번이 끝날 때까지만 본다 */
    }
    return hp0 - w.player.hp;
  }
  return { stand: trial(false), flee: trial(true) };
})()`);
add("선딜 보고 피함", dodge.stand > 0 && dodge.flee === 0,
  "가만히 있으면 " + dodge.stand + " 피해 · 팔 드는 것 보고 물러서면 " + dodge.flee +
  " 피해" + (dodge.flee === 0 ? "" : " ⚠피할 수 없다"));

/* ── ⑨ 몬스터끼리 완전히 포개지지 않는가 ───────────────── */
const sep = await ev(`(function(){
  var foes = [];
  for (var i = 0; i < 6; i++) foes.push({ x: 25.5, y: 15.5, brain: "melee", hp: 9999 });
  var w = window.__arena({ foes: foes });
  window.__runFor(w, 3);
  var list = w.ents.slice(1), worst = 99;
  for (var a = 0; a < list.length; a++)
    for (var b = a + 1; b < list.length; b++)
      worst = Math.min(worst, Math.hypot(list[a].x - list[b].x, list[a].y - list[b].y));
  return { worst: worst, n: list.length };
})()`);
add("겹침 방지", sep.worst > 0.15,
  sep.n + "마리를 같은 자리에 놓고 3초 · 가장 가까운 둘 " + sep.worst.toFixed(2) + "칸");

/* ── ⑩ 벽 너머에서는 안 쫓는가 ─────────────────────────── */
const blind = await ev(`(function(){
  var W = window.WORLD, D = window.DUNGEON;
  var w = new W.World({ seed: 3, w: 40, h: 30, mobs: 0 });
  var lv = w.level;
  lv.tiles = new Uint8Array(lv.w * lv.h).fill(D.FLOOR);
  for (var y = 0; y < lv.h; y++) lv.tiles[y * lv.w + 24] = D.WALL;   /* 가로막는 벽 */
  w.player.x = 20.5; w.player.y = 15.5;
  w.player.px = w.player.x; w.player.py = w.player.y;
  w.refreshFov(); w._fovAt = null; w.refreshFov();
  var e = new W.Entity({ x: 28.5, y: 15.5, sprite: "rat", team: 1, brain: "melee", hp: 9999 });
  w.ents.push(e);
  var d0 = e.x - w.player.x;
  for (var i = 0; i < 180; i++) w.advance(1/60);
  return { moved: Math.abs(e.x - 28.5), d0: d0 };
})()`);
add("벽 너머 무시", blind.moved < 0.3,
  "벽 반대편 몬스터가 3초간 움직인 거리 " + blind.moved.toFixed(2) + "칸 (0이어야 한다)");

/* ── ⑪ 죽으면 사라지는가 ───────────────────────────────── */
const die = await ev(`(function(){
  var w = window.__arena({ foes: [{ x: 21.2, y: 15.5, hp: 6 }] });
  var n0 = w.ents.length;
  for (var i = 0; i < 300; i++) { w.swing(99, 15.5); w.advance(1/60); }
  return { n0: n0, n1: w.ents.length, logged: w.log.filter(function(l){return l.what==="death";}).length };
})()`);
add("죽음 처리", die.n1 === die.n0 - 1 && die.logged >= 1,
  "개체 " + die.n0 + " → " + die.n1 + " · 죽음 기록 " + die.logged + "건");

/* ── ⑫ 실제 화면에서 돌려 본다 ─────────────────────────── */
await ev(`window.__start({ seed: 1234, mobs: 10 })`);
await sleep(400);
await ev(`window.__hold(["KeyD"])`);
await sleep(2500);
const live = await ev(`(function(){ window.__hold([]); return window.__peek(); })()`);
add("실제 구동", live.fps >= 30 && live.foes > 0,
  live.fps + "fps · 적 " + live.foes + "마리 · 체력 " + live.hp + "/" + live.maxHp +
  " · " + live.time.toFixed(1) + "초");

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n2·3단계 — 전투 판정 · 몬스터\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(16, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
