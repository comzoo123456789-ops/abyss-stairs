/* 4단계 — 저장 · 불러오기 · 성장이 **정말** 믿을 만한가.
 *
 * 로그라이크는 저장할 것이 없었다. RPG 는 키우는 것이 목적이라 여기가 깨지면
 * 플레이한 시간이 통째로 사라진다 — 버그가 아니라 사고다. 그래서 험하게 밟는다:
 * 깨진 글자를 넣어 보고, 말도 안 되는 수치를 심어 보고, 앞선 판을 흉내 내고,
 * 저장소를 통째로 막아 본다.
 *
 * ⚠ "저장했다" 를 응답으로 믿지 말 것 — **다시 읽어** 확인한다.
 * ⚠ 새로고침을 실제로 해 봐야 한다. 메모리 안에서만 왕복하면 진짜 저장을 안 쟀다.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-save-"));
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
/* 진짜 새로고침 — 메모리 안 왕복이 아니라 **다시 띄운다** */
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
/* 저장소에 값을 **심고** 새로 띄운다.
 * ⚠ 심기 전에 저장을 잠가야 한다. 게임은 창을 닫을 때(beforeunload) 한 번 더
 *   저장하므로, 그냥 심고 새로고침하면 **내가 심은 값을 게임이 덮어쓴다**
 *   (실측: 세 항목이 앞 시험의 Lv.7 로 나왔다). 제품이 옳고 검사가 틀렸던 자리다. */
const implant = async (js) => {
  await ev("window.SAVE.save = function () { return false; };");
  await ev(js);
  await reload();
};

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await reload();

const out = []; const add = (n, ok, note) => out.push([n, !!ok, note]);

/* ── ① 경험치 곡선이 맞는가 (규칙만) ─────────────────────
 * ⚠ 필요량을 화면과 규칙이 따로 계산하면 "바가 꽉 찼는데 레벨이 안 오른다" 가 된다.
 *   한 함수(needFor)에서만 나오는지, 그 합과 정확히 맞는지를 본다. */
const curve = await ev(`(function(){
  var S = window.SAVE;
  var h = S.blank();
  var want = 0;
  for (var l = 1; l <= 9; l++) want += S.needFor(l);
  var ups = S.gainXp(h, want);          /* 정확히 9단계치 */
  var h2 = S.blank();
  S.gainXp(h2, want - 1);               /* 1 모자라면 8단계 */
  var h3 = S.blank();
  S.gainXp(h3, 1e9);                    /* 말도 안 되게 많이 */
  return { ups: ups, lv: h.level, xp: h.xp,
           lv2: h2.level, capLv: h3.level, capXp: h3.xp,
           max: S.FIELDS.level.max };
})()`);
add("경험치 곡선", curve.lv === 10 && curve.xp === 0 && curve.lv2 === 9 && curve.capLv === curve.max,
  "9단계치 → Lv." + curve.lv + " 남은 " + curve.xp + "xp · 1 모자라면 Lv." + curve.lv2 +
  " · 10억 넣으면 Lv." + curve.capLv + "(상한 " + curve.max + ")");

/* ── ② 잡으면 경험치·금화가 들어오는가 · 레벨업하면 체력이 느는가 ── */
const kill = await ev(`(function(){
  var W = window.WORLD, D = window.DUNGEON, S = window.SAVE;
  var hero = S.blank();
  var w = new W.World({ seed: 5, w: 40, h: 30, mobs: 0, hero: hero });
  w.level.tiles = new Uint8Array(w.level.w * w.level.h).fill(D.FLOOR);
  w.level.visible.fill(1); w.level.seen.fill(1);
  w.refreshFov = function () { this.level.visible.fill(1); return false; };
  w.player.x = 20.5; w.player.y = 15.5; w.player.px = 20.5; w.player.py = 15.5;
  var hp0 = w.player.maxHp, xp0 = hero.xp, g0 = hero.gold, lv0 = hero.level;
  /* 허수아비를 계속 세워 잡는다 — 레벨이 오를 때까지 */
  for (var k = 0; k < 14; k++) {
    var foe = new W.Entity({ x: 21.2, y: 15.5, sprite: "rat", team: 1,
      hp: 6, xp: 8, gold: 3, name: "쥐" });
    w.ents.push(foe);
    for (var i = 0; i < 300 && !foe.dead; i++) { w.swing(99, 15.5); w.advance(1/60); }
  }
  return { lv0: lv0, lv: hero.level, xp: hero.xp, gold: hero.gold,
           hp0: hp0, maxHp: w.player.maxHp, hp: w.player.hp };
})()`);
add("잡으면 자란다", kill.lv > kill.lv0 && kill.gold > 0 && kill.maxHp > kill.hp0,
  "Lv." + kill.lv0 + "→" + kill.lv + " · 금화 " + kill.gold +
  " · 최대체력 " + kill.hp0 + "→" + kill.maxHp);

/* ── ③ 남이 죽인 것으로는 안 들어오는가 ─────────────────
 * ⚠ 안 막으면 몬스터끼리 싸움 붙이거나 함정에 죽는 것으로 무한 파밍이 된다. */
const steal = await ev(`(function(){
  var W = window.WORLD, S = window.SAVE;
  var hero = S.blank();
  var w = new W.World({ seed: 5, w: 40, h: 30, mobs: 0, hero: hero });
  var foe = new W.Entity({ x: 21, y: 15, sprite: "rat", team: 1, hp: 5, xp: 999, gold: 999 });
  var other = new W.Entity({ x: 22, y: 15, sprite: "rat", team: 1 });
  w.ents.push(foe); w.ents.push(other);
  window.COMBAT.damage(w, other, foe, 99);       /* 남이 죽였다 */
  return { xp: hero.xp, gold: hero.gold, dead: foe.dead };
})()`);
add("남의 사냥 무시", steal.dead && steal.xp === 0 && steal.gold === 0,
  "다른 몬스터가 죽임 → 경험치 " + steal.xp + " · 금화 " + steal.gold + " (둘 다 0이어야 한다)");

/* ── ④ 층을 옮겨도 캐릭터가 안 되감기는가 ────────────────
 * ⚠ World 가 hero 의 **사본**을 들면 층을 옮길 때마다 경험치가 되돌아간다.
 *   같은 객체를 가리키는지 실제로 층을 옮겨 본다. */
await ev(`window.__reload()`);
await sleep(200);
const carry = await ev(`(function(){
  var h = window.__hero();
  h.level = 5; h.xp = 77; h.gold = 1234;
  window.__peek();                    /* 지금 세계 */
  return { before: { lv: h.level, xp: h.xp, gold: h.gold } };
})()`);
/* ⚠ 전에는 `.` 키로 내려갔다. 5단계에서 그 키는 없어지고 **계단**이 됐다 —
 *   검사의 전제가 낡은 것이지 제품이 틀린 게 아니다. 지금 길로 내려간다.
 *   (게임은 마을에서 시작하므로 먼저 1층으로 들어간다.) */
await ev(`window.__depth(1)`);
await sleep(400);
await ev(`window.__descend()`);
await sleep(400);
const carried = await ev(`(function(){
  var h = window.__hero(), p = window.__peek();
  return { lv: h.level, xp: h.xp, gold: h.gold, depth: p.depth, maxDepth: p.maxDepth,
           sameObj: window.__w().hero === h };
})()`);
add("층 넘어도 유지", carried.lv === 5 && carried.xp === 77 && carried.gold === 1234 &&
  carried.depth === 2 && carried.sameObj,
  "Lv.5 77xp 1234금 → " + carried.depth + "층에서 Lv." + carried.lv + " " + carried.xp +
  "xp " + carried.gold + "금 · 최고층 " + carried.maxDepth +
  " · 같은 객체 " + (carried.sameObj ? "✔" : "⚠사본이다"));

/* ── ⑤ 새로고침해도 남는가 — **진짜** 새로고침 ────────── */
await ev(`(function(){
  var h = window.__hero();
  h.level = 7; h.xp = 123; h.gold = 4567; h.maxDepth = 4; h.deaths = 2;
  window.__save();
})()`);
await reload();
const kept = await ev(`(function(){
  var h = window.__hero();
  return { lv: h.level, xp: h.xp, gold: h.gold, maxDepth: h.maxDepth, deaths: h.deaths };
})()`);
add("새로고침 유지", kept.lv === 7 && kept.xp === 123 && kept.gold === 4567 &&
  kept.maxDepth === 4 && kept.deaths === 2,
  "Lv." + kept.lv + " " + kept.xp + "xp " + kept.gold + "금 · 최고 " + kept.maxDepth +
  "층 · 죽음 " + kept.deaths + "번");

/* ── ⑥ 손으로 고친 말도 안 되는 값을 잡는가 ─────────────
 * ⚠ 치트 방지가 아니다. **깨진 저장으로 게임이 안 켜지는 것**을 막는 것이다. */
await implant(`localStorage.setItem(window.SAVE.KEY, JSON.stringify({ v: 1, d: {
    level: 99999, xp: -50, gold: "많이", maxDepth: 9e9, cls: "신",
    name: null, deaths: NaN
  }}))`);
const fixed = await ev(`(function(){
  var h = window.__hero(), F = window.SAVE.FIELDS;
  return { lv: h.level, xp: h.xp, gold: h.gold, maxDepth: h.maxDepth, cls: h.cls,
           name: h.name, deaths: h.deaths, maxLv: F.level.max, maxD: F.maxDepth.max,
           booted: !!window.__w() };
})()`);
add("망가진 값 잡기", fixed.booted && fixed.lv === fixed.maxLv && fixed.xp === 0 &&
  fixed.gold === 0 && fixed.maxDepth === fixed.maxD && fixed.cls === "warrior" &&
  typeof fixed.name === "string" && fixed.deaths === 0,
  "Lv." + fixed.lv + "(상한) · xp " + fixed.xp + " · 금화 " + fixed.gold +
  " · 최고 " + fixed.maxDepth + "층(상한) · 직업 " + fixed.cls + " · 죽음 " + fixed.deaths);

/* ── ⑦ 깨진 글자 — 게임이 켜지고, 옛 글자는 치워 두는가 ── */
await implant(`localStorage.setItem(window.SAVE.KEY, "{이건 JSON 이 아니다")`);
const broke = await ev(`(function(){
  return { booted: !!window.__w(), lv: window.__hero().level,
           kept: localStorage.getItem(window.SAVE.KEY + ":broken") };
})()`);
add("깨진 저장", broke.booted && broke.lv === 1 && !!broke.kept,
  "게임 켜짐 · 새 캐릭터 Lv." + broke.lv + " · 옛 글자 " +
  (broke.kept ? "치워 둠(" + broke.kept.length + "자)" : "⚠날렸다"));

/* ── ⑧ 앞선 판의 저장은 **건드리지 않는가** ──────────────
 * ⚠ 내려 읽으려다 망가뜨리면 나중에 새 판으로 돌아가도 못 쓴다. */
await implant(`localStorage.setItem(window.SAVE.KEY, JSON.stringify({ v: 999, d: { level: 40 } }))`);
const future = await ev(`(function(){
  var raw = localStorage.getItem(window.SAVE.KEY);
  var o = null; try { o = JSON.parse(raw); } catch (e) {}
  return { booted: !!window.__w(), lv: window.__hero().level, stillV: o && o.v,
           stillLv: o && o.d && o.d.level };
})()`);
add("앞선 판 보존", future.booted && future.lv === 1 && future.stillV === 999 && future.stillLv === 40,
  "새 캐릭터로 켜짐 · 옛 저장 v" + future.stillV + " Lv." + future.stillLv + " 그대로");

/* ── ⑨ 저장소가 막혀도 게임이 도는가 ─────────────────────
 * ⚠ 저장이 안 된다고 게임이 안 켜지면 그게 더 나쁘다. */
await ev("window.SAVE.save = function () { return false; };");
await ev(`localStorage.removeItem(window.SAVE.KEY)`);
await S("Page.addScriptToEvaluateOnNewDocument", { source: `
  Object.defineProperty(window, "localStorage", {
    get: function () { throw new Error("차단됨"); }
  });
` });
await reload();
const blocked = await ev(`(function(){
  return { booted: !!window.__w(), lv: window.__hero().level,
           blocked: window.SAVE.blocked(), saved: window.__save(),
           fps: window.__fps() };
})()`);
add("저장 막혀도 돈다", blocked.booted && blocked.blocked === true && blocked.saved === false,
  "게임 켜짐 · 막힘 감지 " + blocked.blocked + " · 저장 시도 " + blocked.saved + "(false 가 맞다)");

add("콘솔 오류", errs.length === 0, errs.length ? errs.slice(0, 3).join(" / ") : "0건");

console.log("\n4단계 — 저장 · 불러오기 · 성장\n");
let bad = 0;
for (const [n, ok, note] of out) {
  if (!ok) bad++;
  console.log((ok ? "✔" : "✘") + " " + n.padEnd(16, " ") + " " + (note || ""));
}
console.log("\n" + (bad ? "✘ 실패 " + bad + "건" : "✔ 모두 통과"));
try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(bad ? 1 : 0);
