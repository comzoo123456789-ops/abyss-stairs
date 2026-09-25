/* 치명타 — 전투력이 **일어날 수 없는 일**을 값으로 치고 있지 않은가.
 *
 * `combat.js` 는 `random() * 100 < critPct` 로 굴린다. 100 을 넘는 몫은
 * 한 번도 쓰이지 않는다. 그런데 `derive()` 에 상한이 없어서 전투력이 그것을
 * 값으로 쳤다(실측 2026-09-25 · 도적 Lv.20 유물 28벌: 치명타 142% ·
 * 전투력 표시 8,308 인데 실제로 가능한 것은 6,267 — **25% 가 거품**).
 * 더 나쁜 것은 **자동장착이 그 죽은 능력치를 쫓았다**는 점이다.
 *
 *   ① 100 을 안 넘는다     어떤 장비를 껴도 몸의 치명타가 100% 이하
 *   ② 버리지 않는다        넘친 1%p 가 치명타 피해 +2%p 로 들어온다
 *   ③ 전투력이 참이다      derive 의 dps = 20만 대 굴린 평균 (0.5% 이내)
 *   ④ 자동장착이 안 쫓는다  넘친 치명타만 더 주는 장비를 고르지 않는다
 *   ⑤ 화면에 적힌다        견주기 표에 "넘친 치명타" 줄이 뜬다
 *
 * ⚠ **자기 식으로 다시 셈해서 맞대면 안 된다.** derive 의 식을 검사에 옮겨
 *   적으면 둘이 같이 틀려도 초록이 된다. 여기서는 `combat.js` 와 **같은
 *   굴림**(random 비교 + 배수 곱)을 실제로 20만 번 돌려 평균을 낸다.
 * ⚠ 전환율(2)을 검사에 박지 않는다. `WORLD.CRIT_OVER_TO_DMG` 를 읽는다.
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

/* 대조군: 상한도 전환도 없던 옛 셈으로 되돌린다. */
const REVERT = [
  ["/js/world.js",
   /var critRaw = \(cls \? cls\.critPct : 0\) \+ \(t\.critPct \|\| 0\);\n    o\.critOver = Math\.max\(0, critRaw - 100\);\n    o\.critPct = Math\.min\(100, critRaw\);\n    o\.critDmgPct = \(t\.critDmgPct \|\| 0\) \+ o\.critOver \* CRIT_OVER_TO_DMG;/,
   "o.critOver = 0;\n    o.critPct = (cls ? cls.critPct : 0) + (t.critPct || 0);\n    o.critDmgPct = t.critDmgPct || 0;"]
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-ct-"));
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

await S("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await S("Page.navigate", {
  url: URL_ARG ? URL_ARG.replace(/\/?$/, "/") + "?cb=" + Math.random().toString(36).slice(2)
               : "http://127.0.0.1:" + port + "/index.html"
});
for (let i = 0; i < 400; i++) { if (await ev("!!(window.AUTOEQ && window.__aeplan && window.WORLD)")) break; await sleep(60); }
await sleep(500);

let fails = 0;
const out = [];
const add = (n, ok, note) => { if (!ok) fails++; out.push([n, !!ok, note]); };

/* 치명타가 잔뜩 붙는 한 벌을 만든다 — 유물 스물여덟 벌에서 자동장착이 고른다 */
const r = await ev(`(function(){
  var I = window.ITEMS, D = window.DUNGEON;
  window.__pick("rogue");
  var h = window.__hero(); h.level = 20; h.equip = {}; h.bag = []; h.locks = {};
  var rng = D.makeRng(9);
  for (var s = 0; s < I.SLOTS.length; s++)
    for (var k = 0; k < 4; k++) {
      var it = I.roll(rng, { slot: I.SLOTS[s], ilvl: 14, tier: "relic" });
      if (it) h.bag.push(I.pack(it));
    }
  var w = window.__w(); w.hero = h;
  window.__aekey("mix");
  var p = window.__aeplan();
  for (var i = 0; i < p.changes.length; i++)
    if (p.changes[i].to) h.equip[p.changes[i].slot] = I.pack(p.changes[i].to);
  w.applyHero();
  var d = w.derive(window.SAVE.liveEquip(h));
  var pl = w.player;

  /* 장비가 정말로 준 치명타의 합 — 상한 없이 더하면 얼마인가 */
  var t = I.totals(window.SAVE.liveEquip(h));
  var cls = window.CLASSES.byId(h.cls);
  var rawCrit = (cls ? cls.critPct : 0) + (t.critPct || 0);

  /* combat.js 와 **같은 굴림**을 20만 번 */
  var n = 200000, sum = 0, crits = 0;
  for (var q = 0; q < n; q++) {
    var raw = pl.swing.dmg;
    if (Math.random() * 100 < pl.critPct) { raw = raw * (150 + pl.critDmgPct) / 100; crits++; }
    sum += raw;
  }
  return {
    rawCrit: rawCrit, critPct: d.critPct, over: d.critOver,
    bodyCrit: pl.critPct, critDmg: d.critDmgPct, rawDmg: t.critDmgPct || 0,
    rate: Math.round(crits / n * 1000) / 10,
    said: d.dps, real: Math.round((sum / n) * pl.swing.aps * 10) / 10,
    conv: window.WORLD.CRIT_OVER_TO_DMG
  };
})()`);

add("100 을 안 넘는다", r.critPct <= 100 && r.bodyCrit <= 100,
  "장비가 준 치명타 " + r.rawCrit + "% → 몸에 붙은 것 " + r.bodyCrit + "% · " +
  "20만 대에서 실제로 터진 비율 " + r.rate + "%");

const wantDmg = r.rawDmg + r.over * r.conv;
add("버리지 않는다", r.over > 0 && Math.abs(r.critDmg - wantDmg) < 1e-6,
  r.over === 0 ? "넘친 몫이 0 이라 이 갈래를 못 밟았다(시험 장비를 세게 할 것)"
    : ("넘친 " + r.over + "%p × " + r.conv + " = 치명타 피해 +" + (r.over * r.conv) +
       "%p · 장비 " + r.rawDmg + "% → 몸 " + r.critDmg + "%"));

const gap = r.said > 0 ? Math.abs(r.said - r.real) / r.said * 100 : 99;
add("전투력이 참이다", gap < 0.5,
  "전투력 표시 " + r.said + " · 20만 대 평균에서 나온 값 " + r.real +
  " · 차이 " + gap.toFixed(2) + "% (고치기 전 25%)");

/* ── ④ 넘친 몫은 상한 아래보다 **덜** 값지다 ──
 * 막기만 하면 치명타 장비가 쓰레기가 되고, 그대로 두면 무한히 쌓는 것이 답이
 * 된다. 사이를 노린 값이므로 **정말 사이인지** 잰다. */
const marg = await ev(`(function(){
  var w = window.__w(), h = window.__hero();
  var eq = window.SAVE.liveEquip(h);
  function dpsWith(extraCrit) {
    /* 가짜 장비를 만들지 않고 **직업 기본 치명타**를 흔들어 잰다 —
     * 장비를 바꾸면 다른 수치까지 함께 움직여 한계값이 안 나온다. */
    var cls = window.CLASSES.byId(h.cls);
    var keep = cls.critPct;
    cls.critPct = keep + extraCrit;
    var d = w.derive(eq);
    cls.critPct = keep;
    return d;
  }
  var t = window.ITEMS.totals(eq);
  var cls = window.CLASSES.byId(h.cls);
  var raw = cls.critPct + (t.critPct || 0);
  /* 상한 아래로 내려놓고 +10%p · 상한 위에서 +10%p */
  var lowBase = dpsWith(-(raw - 90));        /* 치명타 90% */
  var lowUp = dpsWith(-(raw - 90) + 10);     /* 100% — 전부 상한 아래 */
  var hiBase = dpsWith(-(raw - 100));        /* 100% */
  var hiUp = dpsWith(-(raw - 100) + 10);     /* 110% — 전부 넘침 */
  return {
    low: Math.round((lowUp.dps - lowBase.dps) * 10) / 10,
    hi: Math.round((hiUp.dps - hiBase.dps) * 10) / 10,
    lowCrit: lowBase.critPct, hiCrit: hiBase.critPct
  };
})()`);
add("넘친 몫이 과하지 않다", marg.hi > 0 && marg.hi < marg.low,
  "치명타 " + marg.lowCrit + "% 에서 +10%p 을 주면 초당 피해 +" + marg.low +
  " · " + marg.hiCrit + "% 에서 주면 +" + marg.hi +
  " (0 보다 크고 앞엣것보다 작아야 한다)");

/* ── ⑤ 화면에 적히는가 ──
 * ⚠ 다 입은 몸에서 열면 바꿀 것이 없어 **표가 아예 안 그려진다**(한 번
 *   그렇게 재서 0줄이 나왔다). 한 칸을 비워 바꿀 거리를 만들어 둔다. */
const prep = await ev(`(function(){
  var h = window.__hero();
  /* ⚠ 한 칸만 벗겨 놓고 재면 치명타가 앞뒤 둘 다 100% 라 **그 줄이
   * 숨는다**(값이 같으면 안 그리는 것이 이 표의 규칙이다). 통째로
   * 벗어 **맨몸 → 한 벌**이 되게 해야 치명타와 넘친 몫이 함께 움직인다.
   * ⚠ 씨앗이 가방을 상한(24) 널게 채워 둔 터라 먼저 줄인다. */
  var keep = [];
  for (var k in h.equip) if (h.equip[k]) keep.push(h.equip[k]);
  h.equip = {};
  h.bag = h.bag.slice(0, 5).concat(keep);
  window.__w().applyHero();
  window.SAVE.save(h);
  window.__bag();
  var p = window.__aeplan();
  return { worn: Object.keys(h.equip).length, bag: h.bag.length,
           changes: p.changes.length,
           overBefore: p.before.critOver, overAfter: p.after.critOver,
           critBefore: p.before.critPct, critAfter: p.after.critPct };
})()`);
await sleep(450);
await ev("window.__autoeq()");
await sleep(550);
const tip = await ev(`(function(){
  var m = document.getElementById("aeModal");
  if (!m) return { none: true };
  var rows = [].slice.call(m.querySelectorAll(".ae-t tbody tr"));
  /* ⚠ 이름을 **앞머리로** 맞대면 "치명타" 가 "치명타 없이"(dpsRaw)를
   * 먼저 잡는다 — 그래서 1408.4 같은 엉뚱한 값을 읽었다. 딱 맞춘다. */
  function row(name) {
    return rows.filter(function (x) {
      var h = x.querySelector("th");
      if (!h) return false;
      var sub = h.querySelector(".cmp-rowsub");
      var t = h.textContent;
      if (sub) t = t.replace(sub.textContent, "");
      return t.trim() === name;
    })[0];
  }
  function val(r) { return r ? r.querySelectorAll("td")[1].textContent.trim() : null; }
  return {
    rows: rows.length,
    crit: val(row("치명타")),
    critDmg: val(row("치명타 피해")),
    /* 값이 안 달라지면 숨는 것이 이 표의 규칙이다. **줄이 있을 수 있는가**는
     * 표 정의(CMP_ROWS)에 있는지로 본다. */
    hasDef: (window.__cmprows || []).indexOf("critOver") >= 0
  };
})()`);
const critNum = parseFloat(tip.crit || "999");
const dmgNum = parseFloat(tip.critDmg || "0");
add("화면에 적힌다", !tip.none && tip.rows > 0 && critNum <= 100 && dmgNum >= 100 && tip.hasDef,
  tip.none ? "자동장착 창이 안 열렸다"
    : ("자동장착 표 " + tip.rows + "줄 · 치명타 [" + tip.crit + "] (100% 이하여야 한다) · " +
       "치명타 피해 [" + tip.critDmg + "] · [넘친 치명타] 줄이 표에 " +
       (tip.hasDef ? "있다(값이 달라질 때만 뜬다)" : "없다") +
       " · 밑준비 " + JSON.stringify(prep)));

console.log(OLD ? "── 치명타 [대조군: 상한도 전환도 없던 옛 셈] ──"
                : ("── 치명타" + (URL_ARG ? " [배포본]" : "") + " ──"));
for (const [n, k, note] of out) console.log((k ? "✔ " : "✘ ") + n.padEnd(18) + " " + note);
if (errs.length) { console.log("\n화면 오류 " + errs.length + "건:"); errs.slice(0, 5).forEach(e => console.log("  " + e)); }
if (errs.length) fails++;
console.log();
console.log(fails ? "✘ 문제 " + fails + "건" : "✔ 전부 통과");

ws.close(); ch.kill(); srv.close();
process.exit(fails ? 1 : 0);
