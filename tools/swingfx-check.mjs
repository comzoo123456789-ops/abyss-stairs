/* 휘두르는 그림 — 무기마다 다른가, 그리고 **그려지기는 하는가.**
 *
 * 고치기 전 실측(2026-09-25): 지팡이와 활은 `arc: 0` 이다(원거리라 부채꼴
 * 판정이 없다). `swingArc` 가 그 값으로 부채꼴을 그려 **폭 0** 이 되니
 * 휘둘러도 화면에 아무 일도 안 일어났다. 마법사는 지팡이를 휘두르는데
 * 눈에 보이는 것이 없었고, 날아가는 것마저 활과 **같은 호박색 짧은 선**이었다.
 *
 *   ① 일곱이 다 그린다     칠한 칸이 0 인 무기가 없다
 *   ② 서로 다르다          모든 짝이 20% 넘게 다르다
 *   ③ 표에 빠진 것이 없다   무기 베이스가 전부 SWING_STYLE 에 있다
 *   ④ 화면을 안 덮는다      쏘는 무기의 효과가 2칸 안쪽이다
 *   ⑤ 날아가는 것도 다르다  지팡이 마력탄과 활 화살의 kind 가 갈린다
 *   ⑥ 예고도 보인다        선딜 동안에도 칠한 칸이 0 이 아니다
 *
 * ⚠ ④ 가 있는 까닭: 쏘는 무기의 `reach` 는 7.5~9칸이다. 그 값을 반지름으로
 *   쓰면 효과가 **화면을 통째로 덮는다** — 안 보이는 것을 고치려다 반대쪽
 *   끝으로 가기 쉬운 자리다.
 * ⚠ `OLD=1` 이 표에서 지팡이·활을 빼 옛 모양(아무것도 안 그려짐)으로 되돌린다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(path.resolve(HERE, ".."), "public");
const OLD = process.env.OLD === "1";
const ui = process.argv.indexOf("--url");
const URL_ARG = ui >= 0 ? process.argv[ui + 1] : null;
if (URL_ARG && OLD) { console.error("--url 과 OLD=1 은 같이 못 쓴다"); process.exit(2); }

const REVERT = [
  /* 진짜 결함이었던 자리 — 몸이 아니라 빈 객체에서 무기를 찾던 때로
   * 되돌린다. 이것 하나로 일곱 무기가 전부 장검으로 떨어진다. */
  ["/js/view.js", /var wId = \(e\.swing && e\.swing\.base\) \|\| "";/,
   'var eq0 = e.equipped || null; var wId = (eq0 && eq0.weapon) ? (eq0.weapon.base || "") : "";'],
  ["/js/view.js", /    staff: "cast",\n    bow: "draw"\n/, "\n"],
  ["/js/world.js", /          kind: sm\.base \|\| "shot",\n/, ""]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/view.js", "/js/world.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-sf-"));
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
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
    errs.push(m.params.args.map(a => a.value === undefined ? a.description : a.value).join(" "));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", {
  url: URL_ARG ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
               : "http://127.0.0.1:" + port + "/index.html"
});
for (let i = 0; i < 400; i++) { if (await ev("!!(window.VIEW && window.ITEMS && window.__w)")) break; await sleep(60); }
await sleep(500);

/* ⚠ **가짜 개체를 넣어 재다가 진짜 결함을 놓쳐다.**
 *   예전 검사는 { team:0, equipped:{weapon:it} } 를 지어 넣어 swingArc 을
 *   불렀다. 그런데 제품은 Entity 의 equipped 가 **빈 객체**라(applyHero 는
 *   World 에 담는다) 모든 무기가 장검으로 떨어졌고, 화면에서 단검·도끼·
 *   장창의 그림은 **한 번도 나온 적이 없었다.** 검사는 초록이었다.
 *   지금은 **진짜 세계에 무기를 끼워** 한 프레임을 그려 오려 낸다.
 * ⚠ 그리고 바로 오려 낸다 — 스크린샷을 따로 찍으면 그 사이에 시간이
 *   흘러 휘두름이 끝나 버린다(한 번 그렇게 재다가 값이 흔들렸다). */
const M = await ev(`(function(){
  var V = window.VIEW, I = window.ITEMS, D = window.DUNGEON, TILE = V.TILE;
  var R = 120;
  var bases = I.BASES.weapon.map(function (b) { return b.id; });

  function frame(base, liveOn) {
    window.__start({ depth: 1 });
    var w = window.__w(), view = window.__view();
    w.level.tiles.fill(D.FLOOR); w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.ents.length = 1;
    w.shots.length = 0;
    var h = window.__hero(); h.level = 20;
    var it = I.roll(D.makeRng(3), { slot: "weapon", base: base, tier: "rare", ilvl: 12 });
    if (!it) return null;
    h.equip.weapon = I.pack(it);
    w.applyHero();
    var p = w.player;
    window.__aimAt(p.x + 3, p.y);
    if (!p.atk) return null;
    p.atk.ang = 0;
    p.atk.t = (p.atk.m.windup || 0.2) * (liveOn ? 1 : 0.7) + (liveOn ? 0.01 : 0);
    var before = document.createElement("canvas");
    /* 효과 없이 한 장 — 그 차이가 곧 휘두름이다 */
    var keep = p.atk; p.atk = null; view.draw(w, 1);
    var c = document.getElementById("game") || document.querySelector("canvas");
    var sx = Math.round(p.x * TILE + (view.ox || 0)), sy = Math.round(p.y * TILE + (view.oy || 0));
    before.width = R; before.height = R;
    before.getContext("2d").drawImage(c, sx - R / 2, sy - R / 2, R, R, 0, 0, R, R);
    p.atk = keep; view.draw(w, 1);
    var after = document.createElement("canvas"); after.width = R; after.height = R;
    after.getContext("2d").drawImage(c, sx - R / 2, sy - R / 2, R, R, 0, 0, R, R);
    return {
      a: before.getContext("2d").getImageData(0, 0, R, R).data,
      b: after.getContext("2d").getImageData(0, 0, R, R).data,
      sw: p.swing, ranged: !!p.swing.ranged
    };
  }
  /* 효과가 있고 없고의 차이 난 칸 = 휘두름이 그린 것 */
  function drew(f) {
    var n = 0;
    for (var i = 0; i < f.a.length; i += 4)
      if (Math.abs(f.a[i]-f.b[i]) + Math.abs(f.a[i+1]-f.b[i+1]) + Math.abs(f.a[i+2]-f.b[i+2]) > 24) n++;
    return n;
  }
  function mask(f) {
    var m = new Uint8Array(f.a.length / 4);
    for (var i = 0, j = 0; i < f.a.length; i += 4, j++)
      m[j] = (Math.abs(f.a[i]-f.b[i]) + Math.abs(f.a[i+1]-f.b[i+1]) + Math.abs(f.a[i+2]-f.b[i+2]) > 24) ? 1 : 0;
    return m;
  }
  function far(m) {
    var f = 0;
    for (var y = 0; y < R; y++) for (var x = 0; x < R; x++) if (m[y * R + x]) {
      var dx = x - R / 2, dy = y - R / 2, d = Math.sqrt(dx * dx + dy * dy);
      if (d > f) f = d;
    }
    return Math.round(f);
  }
  function diff(m1, m2) {
    var n = 0, u = 0;
    for (var i = 0; i < m1.length; i++) {
      if (m1[i] || m2[i]) u++;
      if (m1[i] !== m2[i]) n++;
    }
    return u ? Math.round(n / u * 1000) / 10 : 0;
  }

  var rows = [], masks = [];
  bases.forEach(function (b) {
    var L = frame(b, true), P = frame(b, false);
    if (!L) { rows.push({ b: b, miss: true }); return; }
    var mk = mask(L);
    rows.push({
      b: b, style: V.SWING_STYLE[b] || "(표에 없음)", inTable: !!V.SWING_STYLE[b],
      ink: drew(L), warn: P ? drew(P) : 0, far: far(mk),
      reach: L.sw.reach, arc: L.sw.arc, ranged: L.ranged
    });
    masks.push({ b: b, m: mk });
  });
  var pairs = [];
  for (var i = 0; i < masks.length; i++)
    for (var j = i + 1; j < masks.length; j++)
      pairs.push({ a: masks[i].b, b: masks[j].b, d: diff(masks[i].m, masks[j].m) });
  pairs.sort(function (x, y) { return x.d - y.d; });
  return { rows: rows, tile: TILE, worst: pairs.slice(0, 3), same: pairs.filter(function (p) { return p.d < 20; }) };
})()`);

/* ⑤ 날아가는 것 — 무기마다 kind 가 갈리는가 */
const fly = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  var got = {};
  ["staff", "bow"].forEach(function (b) {
    window.__start({ depth: 1 });
    var w = window.__w();
    w.level.tiles.fill(D.FLOOR); w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.ents.length = 1;
    var h = window.__hero(); h.level = 20;
    var it = I.roll(D.makeRng(3), { slot: "weapon", base: b, tier: "rare", ilvl: 12 });
    h.equip.weapon = I.pack(it);
    w.applyHero();
    w.shots.length = 0;
    var p = w.player;
    window.__aimAt(p.x + 3, p.y);
    /* ⚠ 이 세계의 한 걸음은 step() 이다 (tick 은 없다) */
    for (var t = 0; t < 240 && !w.shots.length; t++) w.step();
    got[b] = w.shots.length ? (w.shots[0].kind || "(없음)") : "(안 쐈다)";
  });
  return got;
})()`);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

const ok = M.rows.filter(r => !r.miss);
const blank = ok.filter(r => r.ink === 0);
add("일곱이 다 그린다", ok.length >= 7 && blank.length === 0,
  ok.length + "무기 · 칠한 칸 " + ok.map(r => r.b + " " + r.ink).join(" · ") +
  (blank.length ? " ← " + blank.map(r => r.b).join(",") + " 가 아무것도 안 그린다" : ""));

add("서로 다르다", M.same.length === 0,
  "가장 닮은 짝 — " + M.worst.map(p => p.a + "/" + p.b + " " + p.d + "%").join(" · ") +
  " (20% 넘게 달라야 한다)" + (M.same.length ? " ← 닮은 짝 " + M.same.length + "쌍" : ""));

const notIn = ok.filter(r => !r.inTable);
add("표에 빠진 것이 없다", notIn.length === 0,
  "무기 " + ok.length + "종 — " + ok.map(r => r.b + ":" + r.style).join(" · ") +
  (notIn.length ? " ← " + notIn.map(r => r.b).join(",") + " 가 표에 없다" : ""));

const shooters = ok.filter(r => r.ranged);
const tooBig = shooters.filter(r => r.far > M.tile * 2);
add("화면을 안 덮는다", shooters.length > 0 && tooBig.length === 0,
  "쏘는 무기 " + shooters.map(r => r.b + " 뻗음 " + r.far + "px(reach " + r.reach + "칸 = " +
    Math.round(r.reach * M.tile) + "px)").join(" · ") + " · 한 칸 " + M.tile + "px");

add("날아가는 것도 다르다", fly.staff && fly.bow && fly.staff !== fly.bow,
  "지팡이 [" + fly.staff + "] · 활 [" + fly.bow + "]");

const noWarn = ok.filter(r => r.warn === 0);
add("예고도 보인다", noWarn.length === 0,
  "선딜 칠한 칸 " + ok.map(r => r.b + " " + r.warn).join(" · ") +
  (noWarn.length ? " ← " + noWarn.map(r => r.b).join(",") + " 는 예고가 안 보인다" : ""));

console.log(OLD ? "── 휘두르는 그림 [대조군: 표에서 지팡이·활을 뺌] ──"
                : ("── 휘두르는 그림" + (URL_ARG ? " [배포본]" : "") + " ──"));
for (const [n, k, note] of out) console.log((k ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
