/* 휘두르는 그림 — 무기마다 다른가, 그리고 **그려지기는 하는가.**
 *
 * 고치기 전 실측(2026-09-25): 지팡이와 활은 `arc: 0` 이다(원거리라 부채꼴
 * 판정이 없다). `swingArc` 가 그 값으로 부채꼴을 그려 **폭 0** 이 되니
 * 휘둘러도 화면에 아무 일도 안 일어났다. 마법사는 지팡이를 휘두르는데
 * 눈에 보이는 것이 없었고, 날아가는 것마저 활과 **같은 호박색 짧은 선**이었다.
 *
 *   ① 일곱이 다 그린다     칠한 칸이 0 인 무기가 없다
 *   ② 서로 다르다          모든 짝이 30% 넘게 다르다(모양 결이 갈린다)
 *   ③ 표에 빠진 것이 없다   무기 베이스가 전부 SWING_STYLE 에 있다
 *   ④ 화면을 안 덮는다      쏘는 무기의 효과가 2칸 안쪽이다
 *   ⑤ 날아가는 것도 다르다  지팡이 마력탄과 활 화살의 kind 가 갈린다
 *   ⑥ 예고도 보인다        선딜 동안에도 칠한 칸이 0 이 아니다
 *   ⑦ 쓸려 지나간다      한 번 휘두르는 동안 그림이 바뀜다
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
  /* 방향 번갈아 도는 것을 끔다 — 모든 침이 같은 쪽으로 간다 */
  ["/js/view.js", /var dir = a\.flip \? -1 : 1;/, "var dir = 1;"],
  /* 직업별 결을 끄면 전사와 기사가 같은 장검으로 똑같아진다 */
  ["/js/view.js", /var CLS_STYLE = \{ knight: \{[^}]*\} \};/, "var CLS_STYLE = {};"],
  /* 한 장이 통째로 떴다 사라지던 때로 — 머리와 꼬리를 끝에 박는다 */
  ["/js/view.js", /var headK = eOut\(sw \/ 0\.45\);/, "var headK = 1;"],
  ["/js/view.js", /var tailK = Math\.max\(eOut\(\(sw - 0\.30\) \/ 0\.70\), headK - 0\.45\);/, "var tailK = 0;"],
  ["/js/view.js", /var rel = eOut\(sw\);/, "var rel = 1;"],
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
    /* ⚠ 모양을 견주는 순간은 **휘두름 한가운데**다. 맨 처음을 재면
     * 일곱이 다 같은 자리의 얇은 조각이라 장검과 철퇴가 18.5% 로 닮았다. */
    p.atk.t = liveOn ? (p.atk.m.windup + p.atk.m.recover * 0.5)
                     : (p.atk.m.windup || 0.2) * 0.7;
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
  return { rows: rows, tile: TILE, worst: pairs.slice(0, 3), same: pairs.filter(function (p) { return p.d < 30; }) };
})()`);

/* ⑦ 한 번 휘두르는 동안 그림이 바뀔는가 — 이번 판의 핵심이다.
 * ⚠ 예전에는 후딜 내내 **같은 한 장**이 떠 있었다. 그래서 무기를
 *   바꿔도 "불이 켜졌다 꺼졌다" 로만 보였다. */
const mv = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  var bases = I.BASES.weapon.map(function (b) { return b.id; });
  var STEPS = [0.15, 0.5, 0.85];
  /* \u26a0 **\uc790\ub974\uc9c0 \uc54a\ub294\ub2e4.** \uce74\uba54\ub77c\uac00 \ub808\ubca8 \uacbd\uacc4\uc5d0\uc11c \ubb3c\ub9ac\uba74 \uc8fc\uc778\uacf5\uc774
   *   \ud654\uba74 \ud55c\uac00\uc6b4\ub370\uac00 \uc544\ub2c8\ub77c, \uc5b4\ub9bc\uc7241 \uc790\ub978 \uce78\uc5d0 \ud6a8\uacfc\uac00 \uc548 \ub4e4\uc5b4 **\uc77c\uacf1 \uc911 \uc5ec\uc12f\uc774
   *   0 \uc73c\ub85c \ub098\uc654\ub2e4.** \ud6a8\uacfc\uac00 \uc788\uace0 \uc5c6\uace0\uc758 \ucc28\uc774\ub97c \ud654\uba74 \uc804\uccb4\uc5d0\uc11c \uc7ac\uba74
   *   \uc8fc\uc778\uacf5\uc774 \uc5b4\ub514 \uc788\ub4e0 \uc0c1\uad00\uc5c6\ub2e4. */
  function maskOf(g, w2, h2, base) {
    var d = g.getImageData(0, 0, w2, h2).data;
    var m = new Uint8Array(w2 * h2);
    for (var i = 0, j = 0; i < d.length; i += 4, j++)
      m[j] = (Math.abs(d[i]-base[i]) + Math.abs(d[i+1]-base[i+1]) + Math.abs(d[i+2]-base[i+2]) > 24) ? 1 : 0;
    return m;
  }
  function count(m) { var n = 0; for (var i = 0; i < m.length; i++) n += m[i]; return n; }
  /* ⚠ **주인공 몸은 제외한다.** 공격할 때 스프라이트가 앞으로 내딛는데
   *   (motionOf 의 push), 그 움직임까지 세면 **효과가 멈춰 있어도
   *   바뀜 칸이 생긴다** — 대조군이 그것으로 통과했다(실측 182칸). */
  function moved(a, b, w2, cxp, cyp) {
    var n = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      var x = i % w2, y = (i / w2) | 0;
      var dx = x - cxp, dy = y - cyp;
      if (dx * dx + dy * dy < 26 * 26) continue;
      n++;
    }
    return n;
  }

  var out = [];
  bases.forEach(function (b) {
    window.__start({ depth: 1 });
    var w = window.__w(), view = window.__view();
    w.level.tiles.fill(D.FLOOR); w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.ents.length = 1; w.shots.length = 0;
    var h = window.__hero(); h.level = 20;
    var it = I.roll(D.makeRng(3), { slot: "weapon", base: b, tier: "rare", ilvl: 12 });
    h.equip.weapon = I.pack(it);
    w.applyHero();
    var p = w.player;
    window.__aimAt(p.x + 3, p.y);
    if (!p.atk) { out.push({ b: b, miss: true }); return; }
    p.atk.ang = 0;
    var m = p.atk.m, keep = p.atk;
    var c = document.getElementById("game") || document.querySelector("canvas");
    var g = c.getContext("2d");
    p.atk = null; view.draw(w, 1);
    var base = g.getImageData(0, 0, c.width, c.height).data;
    p.atk = keep;
    var ms = STEPS.map(function (k) {
      p.atk.t = m.windup + m.recover * k;
      view.draw(w, 1);
      return maskOf(g, c.width, c.height, base);
    });
    var TILE = window.VIEW.TILE;
    var cxp = p.x * TILE + view.ox, cyp = p.y * TILE + view.oy;
    var area = (count(ms[0]) + count(ms[1]) + count(ms[2])) / 3;
    out.push({ b: b, area: Math.round(area),
               d01: moved(ms[0], ms[1], c.width, cxp, cyp),
               d12: moved(ms[1], ms[2], c.width, cxp, cyp),
               d02: moved(ms[0], ms[2], c.width, cxp, cyp),
               r02: area ? Math.round(moved(ms[0], ms[2], c.width, cxp, cyp) / area * 1000) / 10 : 0 });
  });
  return out;
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
    /* 이 세계의 한 걸음은 step() 이다 (tick 은 없다) */
    for (var t = 0; t < 240 && !w.shots.length; t++) w.step();
    got[b] = w.shots.length ? (w.shots[0].kind || "(없음)") : "(안 쐈다)";
  });
  return got;
})()`);

/* ⑧ 직업 넷이 **자기 무기로** 서로 다른가 — 훈님이 짚은 자리다.
 * ⚠ 무기만 키로 쓰면 **전사와 기사가 한 글자도 안 다르다**(둘 다 장검으로
 *   시작한다). 같은 칼이라도 몸이 다르게 쓴다는 것이 직업이다. */
const cls = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON, CL = window.CLASSES;
  var out = [], masks = [];
  CL.LIST.forEach(function (c) {
    window.__pick(c.id);
    window.__start({ depth: 1 });
    var w = window.__w(), view = window.__view();
    w.level.tiles.fill(D.FLOOR); w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.ents.length = 1; w.shots.length = 0;
    var h = window.__hero(); h.level = 20;
    var wb = (c.start && c.start.weapon) || "sword";
    var it = I.roll(D.makeRng(3), { slot: "weapon", base: wb, tier: "rare", ilvl: 12 });
    h.equip.weapon = I.pack(it);
    w.applyHero();
    var p = w.player;
    window.__aimAt(p.x + 3, p.y);
    if (!p.atk) { out.push({ id: c.id, miss: true }); return; }
    p.atk.ang = 0;
    var m = p.atk.m, keep = p.atk;
    var cv = document.getElementById("game") || document.querySelector("canvas");
    var g = cv.getContext("2d");
    p.atk = null; view.draw(w, 1);
    var off = g.getImageData(0, 0, cv.width, cv.height).data;
    p.atk = keep; p.atk.t = m.windup + m.recover * 0.5;
    view.draw(w, 1);
    var on = g.getImageData(0, 0, cv.width, cv.height).data;
    /* \uc790\ub9ac\uc5d0 \uc548 \ud754\ub4e4\ub9ac\ub3c4\ub85d **\ud6a8\uacfc\uc758 \ud55c\uac00\uc6b4\ub370\ub85c \ub9de\ucd94\uc5b4** \ubcf8\ub2e4 \u2014
     * \uce74\uba54\ub77c\uac00 \ub808\ubca8 \uacbd\uacc4\uc5d0\uc11c \ubb3c\ub9ac\uba74 \uc8fc\uc778\uacf5\uc774 \ud654\uba74 \ud55c\uac00\uc6b4\ub370\uac00 \uc544\ub2c8\ub2e4. */
    /* ⚠ **몸은 뻐다.** 공격할 때 스프라이트가 앞으로 내딛는데, 직업마다
     * 그림이 다르니 그 움직임만으로도 마스크가 갈라 — 효과가 똑같아도
     * 52.4% 로 나왔다(대조군 실측). 재려는 것은 휘두름이지 스프라이트가 아니다. */
    var TILEc = window.VIEW.TILE;
    var bx = p.x * TILEc + view.ox, by = p.y * TILEc + view.oy;
    var R = 130, pts = [], sxA = 0, syA = 0, n = 0;
    for (var y = 0; y < cv.height; y++) for (var x = 0; x < cv.width; x++) {
      var i2 = (y * cv.width + x) * 4;
      if (Math.abs(on[i2]-off[i2]) + Math.abs(on[i2+1]-off[i2+1]) + Math.abs(on[i2+2]-off[i2+2]) > 24) {
        var ddx = x - bx, ddy = y - by;
        if (ddx * ddx + ddy * ddy < 26 * 26) continue;
        pts.push(x, y); sxA += x; syA += y; n++;
      }
    }
    if (!n) { out.push({ id: c.id, ink: 0 }); masks.push({ id: c.id, m: new Uint8Array(R * R) }); return; }
    var ccx = Math.round(sxA / n), ccy = Math.round(syA / n);
    var mk = new Uint8Array(R * R);
    for (var q = 0; q < pts.length; q += 2) {
      var rx = pts[q] - ccx + R / 2, ry = pts[q+1] - ccy + R / 2;
      if (rx >= 0 && ry >= 0 && rx < R && ry < R) mk[(ry | 0) * R + (rx | 0)] = 1;
    }
    out.push({ id: c.id, name: c.name || c.id, w: wb, ink: n });
    masks.push({ id: c.id, m: mk });
  });
  function diff(a, b) {
    var n2 = 0, u = 0;
    for (var i = 0; i < a.length; i++) { if (a[i] || b[i]) u++; if (a[i] !== b[i]) n2++; }
    return u ? Math.round(n2 / u * 1000) / 10 : 0;
  }
  var pairs = [];
  for (var i = 0; i < masks.length; i++)
    for (var j = i + 1; j < masks.length; j++)
      pairs.push({ a: masks[i].id, b: masks[j].id, d: diff(masks[i].m, masks[j].m) });
  pairs.sort(function (x, y) { return x.d - y.d; });
  return { rows: out, pairs: pairs };
})()`);

/* ⑨ 칠 때마다 **방향이 번갈아 도는가** — 훈님이 짚은 "위아래로만 왔다갔다".
 * ⚠ 한쪽으로만 쓸면 연타가 같은 그림의 반복이 된다. */
const flip = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  function shot(fl) {
    window.__pick("warrior");
    window.__start({ depth: 1 });
    var w = window.__w(), view = window.__view();
    w.level.tiles.fill(D.FLOOR); w.level.visible.fill(1); w.level.seen.fill(1);
    w.refreshFov = function () { this.level.visible.fill(1); return false; };
    w.ents.length = 1; w.shots.length = 0;
    var h = window.__hero(); h.level = 20;
    var it = I.roll(D.makeRng(3), { slot: "weapon", base: "sword", tier: "rare", ilvl: 12 });
    h.equip.weapon = I.pack(it);
    w.applyHero();
    var p = w.player;
    window.__aimAt(p.x + 3, p.y);
    if (!p.atk) return null;
    p.atk.ang = 0; p.atk.flip = fl;
    var m = p.atk.m, keep = p.atk;
    var cv = document.getElementById("game") || document.querySelector("canvas");
    var g = cv.getContext("2d");
    p.atk = null; view.draw(w, 1);
    var off = g.getImageData(0, 0, cv.width, cv.height).data;
    p.atk = keep; p.atk.t = m.windup + m.recover * 0.3;
    view.draw(w, 1);
    var on = g.getImageData(0, 0, cv.width, cv.height).data;
    var TILEc = window.VIEW.TILE;
    var bx = p.x * TILEc + view.ox, by = p.y * TILEc + view.oy;
    /* \ud6a8\uacfc\uac00 \ubab8\uc758 **\uc704\ucabd\uc778\uac00 \uc544\ub798\ucabd\uc778\uac00** \u2014 \uadf8\uac83\uc774 \ud718\ub450\ub974\ub294 \ubc29\ud5a5\uc774\ub2e4 */
    var up = 0, dn = 0;
    for (var y = 0; y < cv.height; y++) for (var x = 0; x < cv.width; x++) {
      var i2 = (y * cv.width + x) * 4;
      if (Math.abs(on[i2]-off[i2]) + Math.abs(on[i2+1]-off[i2+1]) + Math.abs(on[i2+2]-off[i2+2]) <= 24) continue;
      var dx = x - bx, dy = y - by;
      if (dx * dx + dy * dy < 26 * 26) continue;
      if (dy < 0) up++; else dn++;
    }
    return { up: up, dn: dn, n: up + dn };
  }
  return { a: shot(false), b: shot(true) };
})()`);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

const mvOk = mv.filter(function (x) { return !x.miss; });
/* ⚠ **칸 수로 문턱을 두지 않는다.** 120칸으로 두었더니 효과 자체가
 *   작은 단검(769칸)이 불리해졌다 — 큰 무기만 통과하는 잣대다.
 *   **제 넓이 대비**로 재면 무기 크기와 상관없다. 대조군은 0.5% 이다. */
/* ⚠ 문턱은 **대조군과 제품 사이**에 둔다. 대조군 0.5% · 가장 낮은
 * 제품 값이 활 24.7% 이다. 25 로 두면 활이 **눈썭 차로** 빨개져
 * 언젠가 흔들리는 판정이 된다(이 저장소에서 이미 두 번 겪었다). */
const still = mvOk.filter(function (x) { return x.r02 < 15; });
add("쓸려 지나간다", mvOk.length >= 7 && still.length === 0,
  "휘두름 처음(15%)과 끝(85%)이 얼마나 달라졌나 — " +
  mvOk.map(function (x) { return x.b + " " + x.r02 + "%"; }).join(" · ") +
  (still.length ? " ← " + still.map(function (x) { return x.b; }).join(",") + " 가 멈춰 있다"
                : " (제 넓이의 15% 넘게 움직여야 한다 · 대조군 0.5%)"));

/* 첫 칠은 한쪽, 둘째 칠은 반대쪽에 무게가 실려야 한다 */
const fa = flip.a, fb = flip.b;
const fOk = fa && fb && fa.n > 50 && fb.n > 50 &&
  ((fa.up / fa.n > 0.55 && fb.dn / fb.n > 0.55) || (fa.dn / fa.n > 0.55 && fb.up / fb.n > 0.55));
add("번갈아 휘두른다", !!fOk,
  fa && fb
    ? ("첫 칠 위 " + Math.round(fa.up / fa.n * 100) + "% / 아래 " + Math.round(fa.dn / fa.n * 100) +
       "% · 둘째 칠 위 " + Math.round(fb.up / fb.n * 100) + "% / 아래 " + Math.round(fb.dn / fb.n * 100) +
       "% (한쪽이 55% 넘고 다음 칠은 반대여야 한다)")
    : "휘두름이 안 걸렸다");

const clsBad = cls.pairs.filter(function (p) { return p.d < 30; });
add("직업 넷이 다르다", cls.rows.every(function (r) { return r.ink > 0; }) && clsBad.length === 0,
  "각자 제 무기로 — " + cls.rows.map(function (r) { return (r.name || r.id) + "(" + r.w + ") " + r.ink; }).join(" · ") +
  " · 가장 닮은 짝 " + cls.pairs.slice(0, 2).map(function (p) { return p.a + "/" + p.b + " " + p.d + "%"; }).join(" · ") +
  (clsBad.length ? " ← " + clsBad.map(function (p) { return p.a + "/" + p.b; }).join(",") + " 가 닮았다"
                 : " (30% 넘게 달라야 한다)"));

const ok = M.rows.filter(r => !r.miss);
const blank = ok.filter(r => r.ink === 0);
add("일곱이 다 그린다", ok.length >= 7 && blank.length === 0,
  ok.length + "무기 · 칠한 칸 " + ok.map(r => r.b + " " + r.ink).join(" · ") +
  (blank.length ? " ← " + blank.map(r => r.b).join(",") + " 가 아무것도 안 그린다" : ""));

add("서로 다르다", M.same.length === 0,
  "가장 닮은 짝 — " + M.worst.map(p => p.a + "/" + p.b + " " + p.d + "%").join(" · ") +
  " (30% 넘게 달라야 한다 · 옛 부채꼴 한 벌일 때 21.1% 였다)" + (M.same.length ? " ← 닮은 짝 " + M.same.length + "쌍" : ""));

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
