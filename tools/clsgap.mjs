/* 직업 격차가 **게임 탓인가 봇 탓인가.**
 *
 * 직업 격차를 재다 봇을 세 번 고쳤는데, 그때마다 격차가 50 → 8 → 33%p 로
 * 흔들렸다. 그 말은 **봇이 지배 변수**라는 뜻이고, 그러면 "전사가 세다" 는
 * 결론을 쓸 수 없다.
 *
 * 그래서 격차를 **봇 실력별로** 잰다:
 *   봇이 좋아질수록 격차가 줄면  → **봇 탓**이다(사람은 더 고를 것이다)
 *   봇이 좋아져도 격차가 그대로면 → **게임 탓**이다(수치를 고쳐야 한다)
 *
 * ⚠ 이 도구 하나가 "봇의 밸런스는 봇의 밸런스다" 라는 경고를 **숫자로** 만든다.
 *   경고만 적어 두고 재지 않으면 아무 뜻이 없다.
 *
 * 쓰기:  node tools/clsgap.mjs [판수]      기본 12판/칸
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "public");
const N = Math.max(4, parseInt(process.argv[2] || "12", 10));
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-gap-"));
const ch = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + dir,
  "--no-first-run", "--disable-gpu", "--mute-audio", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const wsUrl = await new Promise(res => { let b = ""; ch.stderr.on("data", d => { b += d; const m = b.match(/ws:\/\/[^\s]+/); if (m) res(m[0]); }); });
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener("open", r));
const errs = []; let id = 0; const wait = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown")
    errs.push(m.params.exceptionDetails.text);
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
const ev = async x => (await S("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true, timeout: 900000 })).result.value;
const sleep = ms => new Promise(r => setTimeout(r, ms));

await S("Page.navigate", { url: "http://127.0.0.1:" + port + "/index.html" });
await sleep(1400);
await ev(fs.readFileSync(path.join(HERE, "bot.js"), "utf8"));

await ev(`
window.__runOne = function (cls, depth, level, seed, botOpt) {
  var W = window.WORLD, I = window.ITEMS, S = window.SAVE, CL = window.CLASSES, D = window.DUNGEON;
  var hero = S.blank(cls);
  hero.level = level; hero.potions = 3; hero.equip = {};
  hero.bar = CL.skillsOf(cls).slice(0, 4);
  var grng = D.makeRng(seed ^ 0x51ed270b);
  for (var si = 0; si < I.SLOTS.length; si++) {
    var slot = I.SLOTS[si];
    var o = { ilvl: level, slot: slot };
    /* 그 직업이 잘 쓰는 무기를 든다 — 사람은 자기 무기를 찾는다 */
    if (slot === "weapon") { var L = CL.byId(cls).likes; o.base = L[Math.floor(grng() * L.length)]; }
    var it = I.roll(grng, o);
    if (I.canEquip(it, level)) hero.equip[slot] = I.pack(it);
  }
  var w = new W.World({ seed: seed, depth: depth, hero: hero });
  var opt = { seed: seed };
  for (var k in botOpt) opt[k] = botOpt[k];
  var bot = window.BOT.make(w, opt);
  bot.hero = hero;
  var potAt = -99;
  bot.drink = function () {
    var p = w.player;
    if (hero.potions <= 0 || w.time - potAt < 8 || p.hp >= p.maxHp) return false;
    hero.potions--; potAt = w.time;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.5));
    return true;
  };
  var cleared = false;
  for (var i = 0; i < 300 * 60; i++) {
    bot.step(1/60);
    if (w.player.dead) break;
    var alive = 0;
    for (var q = 0; q < w.ents.length; q++)
      if (!w.ents[q].dead && w.ents[q].team !== 0) alive++;
    if (alive === 0) { cleared = true; break; }
  }
  return { cleared: cleared, died: w.player.dead, time: +bot.stats.time.toFixed(0) };
};
window.__rate = function (cls, botOpt, n) {
  var ok = 0;
  /* 층 셋을 섞어 본다 — 한 층만 보면 그 층 생김새에 끌려간다 */
  var spots = [[10, 10], [20, 20], [28, 26]];
  for (var i = 0; i < n; i++) {
    var sp = spots[i % 3];
    if (window.__runOne(cls, sp[0], sp[1], 6100 + i * 7919, botOpt).cleared) ok++;
  }
  return ok / n;
};
`);

const SKILL = [
  { name: "아주 잘함", o: { react: 0.08, aimErr: 2 } },
  { name: "잘함",      o: { react: 0.14, aimErr: 4 } },
  { name: "보통",      o: { react: 0.22, aimErr: 8 } },
  { name: "서툼",      o: { react: 0.32, aimErr: 13 } },
  { name: "많이 서툼", o: { react: 0.45, aimErr: 20 } }
];
const CLS = ["warrior", "rogue", "mage"];

console.log("직업 격차 × 봇 실력 — 10·20·28층을 섞어 칸마다 " + N + "판\n");
const names = {};
for (const c of CLS) names[c] = await ev(`window.CLASSES.byId("${c}").name`);
console.log("봇 실력       " + CLS.map(c => names[c].padStart(7)).join("") + "     격차");

const rows = [];
for (const sk of SKILL) {
  const got = {};
  for (const c of CLS)
    got[c] = await ev(`window.__rate("${c}", ${JSON.stringify(sk.o)}, ${N})`);
  const vals = CLS.map(c => got[c]);
  const gap = (Math.max(...vals) - Math.min(...vals)) * 100;
  rows.push({ sk: sk.name, got, gap });
  console.log(sk.name.padEnd(12) +
    CLS.map(c => ((got[c] * 100).toFixed(0) + "%").padStart(7)).join("") +
    ("  " + gap.toFixed(0) + "%p").padStart(9));
}

/* 봇이 좋아질수록 격차가 주는가 */
const best = rows[0].gap, worst = rows[rows.length - 1].gap;
const trend = worst - best;
console.log("\n─── 읽는 법 ───\n");
if (trend > 12) {
  console.log("✔ 봇이 좋아질수록 격차가 " + worst.toFixed(0) + " → " + best.toFixed(0) +
    "%p 로 준다 — **봇 탓**이 크다.");
  console.log("  사람은 봇보다 잘하므로 실제 격차는 여기 적힌 것보다 작다.");
  console.log("  수치를 고치기 전에 봇을 더 고치는 편이 낫다.");
} else if (trend < -12) {
  console.log("⚠ 봇이 좋아질수록 격차가 오히려 " + best.toFixed(0) + "%p 로 **커진다** —");
  console.log("  잘하는 사람일수록 한 직업이 압도한다는 뜻이다(상향 평준화의 반대).");
} else {
  console.log("✔ 실력과 상관없이 격차가 " + best.toFixed(0) + "~" + worst.toFixed(0) +
    "%p 로 일정하다 — **게임 탓**이다.");
  console.log("  봇을 더 고쳐도 안 바뀐다. 수치를 손봐야 한다.");
}
const avgGap = rows.reduce((a, r) => a + r.gap, 0) / rows.length;
const leader = {};
for (const c of CLS) leader[c] = rows.filter(r =>
  r.got[c] === Math.max(...CLS.map(x => r.got[x]))).length;
console.log("\n평균 격차 " + avgGap.toFixed(0) + "%p · 실력 다섯 칸 중 1등 횟수 " +
  CLS.map(c => names[c] + " " + leader[c]).join(" · "));
console.log(errs.length ? "\n⚠ 콘솔 오류 " + errs.length + "건" : "");

try { ws.close(); } catch { /* 닫혔으면 됐다 */ }
ch.kill(); srv.close();
process.exit(0);
