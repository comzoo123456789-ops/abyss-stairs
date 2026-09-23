/* 전투력 — 두 숫자가 **진짜 그 숫자인가.**
 *
 * 전투력은 틀려도 아무 데서도 안 터진다. 그래서 틀린 채로 오래 간다.
 * 여기서 재는 것은 모양이 아니라 **숫자가 실제와 맞는가**다.
 *
 *   ① 공격이 치명타를 센다   dps = dpsRaw x critMul, 식이 combat.js 와 같다
 *   ② 생존이 실제와 맞는다   진짜로 한 대 맞혀 보고 깎인 체력과 대조한다
 *   ③ 층을 따라 바뀐다       방어가 뺄셈이라 층 없는 생존력은 성립하지 않는다
 *   ④ 허수아비 미터          진짜로 때려서, 센 값이 들어간 피해와 맞는다
 *   ⑤ 던전에서는 안 뜬다     싸움을 가리면 안 된다
 *   ⑥ 최고 기록이 남는다     판을 넘겨도
 *   ⑦ 화면                   가방 · 견주기 표에 두 숫자 · 390px 안 넘침
 *
 * ⚠ 대조군 `OLD=1` 은 둘을 되돌린다 — 치명타를 안 세는 옛 식과, 층을 안 보고
 *   10 으로 못 박은 기준 피해. ①과 ③이 빨개져야 이 검사가 일하는 것이다.
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
  ["/js/world.js",                       /* 치명타를 안 센다 */
   /o\.dps = Math\.round\(o\.dpsRaw \* o\.critMul \* 10\) \/ 10;/,
   "o.dps = Math.round(o.dpsRaw * 10) / 10;"],
  ["/js/world.js",                       /* 층을 안 보고 못 박는다 */
   /o\.refDmg = this\.refDmgAt\(o\.refDepth\);/,
   "o.refDmg = 10;"]
];
function oldify(urlPath, text) {
  for (const [f, re, to] of REVERT) {
    if (f !== urlPath) continue;
    if (!re.test(text)) throw new Error("대조군을 못 만들었다 — 되돌릴 자리가 없다: " + urlPath);
    text = text.replace(re, to);
  }
  return text;
}
const OLDIFY = ["/js/world.js"];

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-pw-"));
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
const mMove = (x, y) => S("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
const mDown = (x, y) => S("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
const mUp = (x, y) => S("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
const esc = async () => {
  await S("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await S("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
};

const W = 1280, H = 860;
await S("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const TARGET = URL_ARG
  ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
  : "http://127.0.0.1:" + port + "/index.html";
await S("Page.navigate", { url: TARGET });
await sleep(1600);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* 시험 장비로 치명타가 붙은 벌을 만든다 — 치명타 0 이면 ①이 아무 것도 안 잰다 */
await ev(`(function(){
  window.__start({ depth: 1 });
  window.__give();
  var I = window.ITEMS, S = window.SAVE, h = window.__hero();
  var bag = S.liveBag(h);
  /* 치명타가 붙은 것을 자리마다 하나씩 입는다 */
  for (var i = bag.length - 1; i >= 0; i--) {
    var it = bag[i];
    if (it && it.s && (it.s.critPct || it.s.critDmgPct) && I.canEquip(it, h.level)
        && !h.equip[it.slot]) window.__equipBag(i);
  }
  return true;
})()`);
await sleep(400);
await esc(); await sleep(250);

/* ── ① 공격이 치명타를 센다 ──────────────────────────── */
const crit = await ev(`(function(){
  var w = window.__w();
  var d = w.derive(window.SAVE.liveEquip(window.__hero()));
  /* combat.js 의 식을 여기서 다시 적어 맞대어 본다 — 두 곳이 갈리면 잡힌다 */
  var want = 1 + (d.critPct / 100) * ((150 + d.critDmgPct) / 100 - 1);
  return { critPct: d.critPct, critDmgPct: d.critDmgPct,
           mul: Math.round(d.critMul * 1e6) / 1e6, want: Math.round(want * 1e6) / 1e6,
           raw: Math.round(d.dpsRaw * 10) / 10, dps: d.dps,
           ok: Math.abs(d.dps - d.dpsRaw * want) < 0.06 };
})()`);
add("공격이 치명타를 센다", crit.ok && crit.critPct > 0,
  "치명타 " + crit.critPct + "% · 피해 +" + crit.critDmgPct + "% → 배수 " + crit.mul +
  " (식대로면 " + crit.want + ") · 치명타 없이 " + crit.raw + " → 공격 " + crit.dps);

/* ── ② 생존이 실제로 맞는 양과 맞는가 ─────────────────
 * ⚠ 식을 두 번 적어 견주면 둘 다 틀려도 통과한다. **진짜로 한 대 맞혀** 본다. */
const surv = await ev(`(function(){
  var w = window.__w(), p = w.player;
  var d = w.derive(window.SAVE.liveEquip(window.__hero()));
  var raw = d.refDmg;
  var was = p.hp;
  /* 치명타가 끼면 굴림이 섞인다 — 때리는 쪽 없이 순수한 피해만 넣는다 */
  var got = window.COMBAT.damage(w, null, p, raw, { canCrit: false });
  p.hp = was;
  var ratio = got / raw;
  return { refDepth: d.refDepth, refDmg: Math.round(raw * 10) / 10,
           def: d.def, maxHp: d.maxHp, ehp: d.ehp,
           got: got, ratio: Math.round(ratio * 1000) / 1000,
           real: Math.round(d.maxHp / ratio),
           ok: Math.abs(d.ehp - d.maxHp / ratio) <= Math.max(2, d.ehp * 0.02) };
})()`);
add("생존이 실제와 맞는다", surv.ok,
  surv.refDepth + "층 적 한 대 " + surv.refDmg + " → 방어 " + surv.def + " 로 " + surv.got +
  " 들어옴(" + Math.round(surv.ratio * 100) + "%) · 체력 " + surv.maxHp +
  " → 실효 " + surv.ehp + " (실제로 재면 " + surv.real + ")");

/* ── ③ 층을 따라 바뀌는가 ───────────────────────────── */
/* ⚠ 처음에 "낀 채로 층을 바꾸면 생존이 바뀐다" 로 잤다가 빨갰는데
 *   **제품이 맞고 검사가 틀렸다.** 시험 장비는 방어가 55 라 30% 바닥에
 *   붙어 있고, 이 게임에서 적 한 대가 55/0.7 = 79 를 넘는 층은 없다 —
 *   그 벌은 층이 달라도 생존이 같은 것이 맞다. 그래서 둘로 갈라 잰다:
 *     ㄱ. 기준 적 피해가 층을 따라 오른다 (늘 참이어야 한다)
 *     ㄴ. 바닥에 안 붙은 벌(맨몸)은 생존이 층을 따라 내린다 */
const byDepth = await ev(`(function(){
  var w = window.__w(), h = window.__hero();
  var was = h.maxDepth, gear = [], bare = [];
  [1, 10, 25].forEach(function (d) {
    h.maxDepth = d;
    gear.push({ d: d, dmg: Math.round(w.derive(window.SAVE.liveEquip(h)).refDmg * 10) / 10,
                ehp: w.derive(window.SAVE.liveEquip(h)).ehp });
    bare.push({ d: d, ehp: w.derive({}).ehp });
  });
  h.maxDepth = was;
  return { gear: gear, bare: bare };
})()`);
const dmgRises = byDepth.gear[0].dmg < byDepth.gear[1].dmg && byDepth.gear[1].dmg < byDepth.gear[2].dmg;
const bareFalls = byDepth.bare[0].ehp > byDepth.bare[2].ehp;
add("층을 따라 바뀐다", dmgRises && bareFalls,
  "기준 적 한 대 " + byDepth.gear.map(x => x.d + "층 " + x.dmg).join(" → ") +
  " · 맨몸 생존 " + byDepth.bare.map(x => x.ehp).join(" → ") +
  " · 시험 장비(방어 높음) 생존 " + byDepth.gear.map(x => x.ehp).join(" → ") +
  " (30% 바닥에 붙어 있어 되레 오른다 · 반올림이 얕은 층에서 더 크다)");

/* ── ④ 허수아비를 진짜로 때린다 ────────────────────────
 * ⚠ 이것이 이 기능의 핵심이다. 수식은 스킬을 못 세지만 이건 센다. */
const town = await ev(`(function(){
  window.__start({ depth: 0 });
  var w = window.__w();
  var d = w.ents.filter(function (e) { return e.kind === "dummy"; })[0];
  if (!d) return { none: true };
  w.player.x = d.x - 0.8; w.player.y = d.y;
  w.player.px = w.player.x; w.player.py = w.player.y;
  w.player.hp = w.player.maxHp;
  window.__dmgSeen = 0;
  /* 들어간 피해를 **미터와 따로** 센다. 둘이 같아야 미터를 믿을 수 있다.
   *
   * ⚠ window.COMBAT.damage 를 감싸는 것은 헛다리였다. combat.js 안쪽은
   *   지역 damage() 를 부르므로(97줄) 겉면을 바꿔도 근접 타격은 안 걸린다.
   *   (여기는 지문 안이다 - 홑따옴표 기울임표를 쓰면 지문이 거기서 끊긴다.)
   *   원거리 무기일 때만 world.js 가 겉면을 거쳐 우연히 맞았고, 그래서
   *   어떤 판은 맞고 어떤 판은 0 이었다. 뜨는 피해 숫자를 센다 —
   *   같은 함수 안의 **다른 줄**이라 미터와 따로 움직인다. */
  var arr = w.floaters;
  arr.push = function (f) {
    if (f && f.foe) {
      var v = parseInt(f.text, 10);
      if (v > 0) window.__dmgSeen += v;
    }
    return Array.prototype.push.apply(this, arguments);
  };
  return { x: d.x, y: d.y };
})()`);
await sleep(500);
let meterNote = "허수아비를 못 찾았다", meterOk = false, hidNote = "-", hidOk = false,
    bestOk = false, bestNote = "-", overOk = false, overNote = "-";
if (!town.none) {
  /* ⚠ 화면 좌표로 겨누려 했는데 `view` 에 toScreen 이 없다. 세계 좌표로
   *   바로 휘두른다 — 프레임 루프가 마우스를 누르고 있을 때 하는 일과 같다
   *   (조준 경로는 aim-check 가 따로 잰다). 화면 안에서 돌려야 프레임 속도로
   *   들어간다 — CDP 로 한 번씩 부르면 왕복 때문에 훨씬 덜 때린다. */
  await ev(`window.__hammer = setInterval(function () {
    window.__swing(${town.x}, ${town.y});
  }, 25);`);
  await sleep(3200);
  const live = await ev(`(function(){
    var m = window.__w().meterNow();
    var box = document.getElementById("dpsMeter");
    return { m: m, shown: !!(box && !box.hidden),
             txt: box ? box.textContent.replace(/\\s+/g, " ").trim().slice(0, 60) : "" };
  })()`);
  await ev("clearInterval(window.__hammer)");
  await sleep(3400);                                  /* 멈춤 2.5초 + 여유 */
  const fin = await ev(`(function(){
    var w = window.__w();
    return { done: w.meter.done, seen: Math.round(window.__dmgSeen), best: w.meter.best };
  })()`);
  if (!fin.done) meterNote = "측정이 안 끝났다 (재는 중 " + JSON.stringify(live.m) + ")";
  else {
    /* 미터가 센 합과 따로 센 합이 같아야 한다 */
    const gap = Math.abs(fin.done.dmg - fin.seen);
    /* ⚠ `sec` 은 소수 한 자리로 적힌 값이다. 그것으로 나눈 몫과 맞대면
     *   반올림만큼 늘 어긋난다(4446/2.6 = 1710 vs 1688.4).
     * ⚠ 허용오차를 손으로 적지 말 것 — 짧게 잰 판일수록 오차가 커진다
     *   (0.05초가 2.6초에서는 1.9%, 1.3초에서는 3.8%다). 반올림 폭에서 뽑는다. */
    const slack = fin.done.dps * (0.05 / fin.done.sec) + 0.05;
    meterOk = live.shown && gap <= 1 && fin.done.dps > 0 &&
      Math.abs(fin.done.dps - fin.done.dmg / fin.done.sec) <= slack;
    meterNote = "재는 중 화면에 " + (live.shown ? "뜸" : "안 뜸") +
      " · " + fin.done.sec + "초 " + fin.done.hits + "대 " +
      "합 " + fin.done.dmg + "(따로 센 값 " + fin.seen + ") → 초당 " + fin.done.dps +
      " · 치명타 " + fin.done.critPct + "%";
    bestOk = fin.best === fin.done.dps;
    /* ⑥ 판을 넘겨도 최고 기록이 남는가 */
    const kept = await ev(`(function(){
      window.__start({ depth: 1 });
      var a = window.__w().meter.best;
      window.__start({ depth: 0 });
      return { a: a, b: window.__w().meter.best };
    })()`);
    bestOk = bestOk && kept.a === fin.best && kept.b === fin.best;
    bestNote = "최고 " + fin.best + " · 던전 갔다 오니 " + kept.a + " / " + kept.b;
  }
  /* ⑤ 던전에서는 안 뜬다 */
  await sleep(300);
  const hid = await ev(`(function(){
    window.__start({ depth: 1 });
    var w = window.__w();
    w.meter.on = true; w.meter.t0 = w.time; w.meter.last = w.time;
    w.meter.dmg = 500; w.meter.hits = 9;
    return true;
  })()`);
  await sleep(400);
  const hv = await ev(`(function(){
    var box = document.getElementById("dpsMeter");
    return { hidden: !!(box && box.hidden), town: window.__w().inTown };
  })()`);
  hidOk = hv.hidden && !hv.town;
  hidNote = "던전에서 재는 중으로 만들어도 " + (hv.hidden ? "안 뜬다" : "⚠ 뜬다");
  /* 미터가 상단바나 미니맵을 덮지 않는가. ⚠ 사각형을 교차시켜야 잡힌다 —
   * 문서 넘침으로는 겹침이 안 나온다(이 저장소에서 여러 번 겪었다). */
  await ev(`(function(){
    window.__start({ depth: 0 });
    var w = window.__w();
    var d = w.ents.filter(function (e) { return e.kind === "dummy"; })[0];
    w.player.x = d.x - 0.8; w.player.y = d.y;
    window.__hammer2 = setInterval(function () { window.__swing(d.x, d.y); }, 25);
  })()`);
  await sleep(1400);
  const lay = await ev(`(function(){
    function R(e) { if (!e) return null; var r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom,
               vis: e.checkVisibility ? e.checkVisibility() : true }; }
    function hit(a, b) { if (!a || !b || !a.vis || !b.vis) return 0;
      var w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      var h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      return (w > 0 && h > 0) ? Math.round(w * h) : 0; }
    var M = R(document.getElementById("dpsMeter"));
    var stage = getComputedStyle(document.documentElement).getPropertyValue("--stage-l");
    return { shown: !!(M && M.vis),
             vsTop: hit(M, R(document.querySelector(".top-bar"))),
             vsMini: hit(M, R(document.getElementById("minimapBox"))),
             vsBottom: hit(M, R(document.querySelector(".bottom"))),
             left: M ? Math.round(M.l) : -1, stageL: stage.trim(),
             outside: M ? Math.max(0, Math.round(M.r - window.innerWidth)) : -1 };
  })()`);
  await ev("clearInterval(window.__hammer2)");
  overOk = lay.shown && lay.vsTop === 0 && lay.vsMini === 0 && lay.vsBottom === 0 && lay.outside === 0;
  overNote = "미터 왼쪽 " + lay.left + "px (판 " + lay.stageL + ") · 상단바와 " + lay.vsTop +
    " · 미니맵과 " + lay.vsMini + " · 아래 줄과 " + lay.vsBottom + " · 화면 밖 " + lay.outside;
}
add("미터가 안 덮는다", overOk, overNote);
add("허수아비 미터", meterOk, meterNote);
add("최고 기록이 남는다", bestOk, bestNote);
add("던전에서는 안 뜬다", hidOk, hidNote);

/* ── ⑦ 화면 ────────────────────────────────────────── */
await ev("window.__bag()");
await sleep(400);
const shownUi = await ev(`(function(){
  var box = document.getElementById("panel");
  var pw = box.querySelector(".pw");
  if (!pw) return { none: true };
  var vs = [].slice.call(pw.querySelectorAll(".pw-v")).map(function (x) { return x.textContent.trim(); });
  var ls = [].slice.call(pw.querySelectorAll(".pw-l")).map(function (x) { return x.textContent.trim(); });
  return { vs: vs, ls: ls, note: (pw.querySelector(".pw-note") || {}).textContent || "" };
})()`);
add("가방에 두 숫자", !shownUi.none && shownUi.ls[0] === "공격" && shownUi.ls[1] === "생존" &&
  /층 기준/.test(shownUi.note),
  shownUi.none ? "전투력 칸이 없다"
    : shownUi.ls.map((l, i) => l + " " + shownUi.vs[i]).join(" · ") + " · " + shownUi.note.trim());

await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await sleep(350);
await ev("window.__bag()"); await sleep(400);
const narrow = await ev(`(function(){
  var pw = document.querySelector("#panel .pw");
  var over = document.documentElement.scrollWidth - window.innerWidth;
  if (!pw) return { none: true, over: over };
  var r = pw.getBoundingClientRect();
  return { over: over, outside: Math.max(0, Math.round(r.right - window.innerWidth)),
           w: Math.round(r.width), h: Math.round(r.height) };
})()`);
add("좁은 화면", !narrow.none && narrow.over <= 0 && narrow.outside === 0,
  narrow.none ? "전투력 칸이 없다"
    : "390px · 칸 " + narrow.w + "x" + narrow.h + " · 문서 넘침 " + narrow.over +
      "px · 밖으로 " + narrow.outside + "px");

console.log(OLD ? "── 전투력 [대조군: 치명타 안 셈 · 층 안 봄] ──"
                : ("── 전투력" + (URL_ARG ? " [배포본]" : "") + " ──"));
if (URL_ARG) console.log("   " + TARGET);
for (const [n, ok, note] of out) console.log((ok ? "✔ " : "✘ ") + n.padEnd(16) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); fails++; }
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
