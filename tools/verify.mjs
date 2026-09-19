//  전체 회귀 검사 — 로직(Node) + 화면(Chrome) 을 한 번에 돌린다.
//
//    사용:  node tools/verify.mjs [판수]        기본 120판/직업
//
//  로직 검사는 DOM 없이 규칙만 돌린다(던전 · 아이템 굴림 · 치명타 · 상태이상 · 빌드).
//  화면 검사는 tools/check.mjs 를 폭별로 돌린다.
//  ⚠ 둘 다 필요하다 — 로직이 맞아도 캔버스가 0px 일 수 있고,
//    화면이 멀쩡해도 경험치가 NaN 일 수 있다(실제로 둘 다 났다).

import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JS = path.join(ROOT, "public", "js");
const N = parseInt(process.argv[2] || "120", 10);

function loadRules() {
  const win = {};
  const ctx = vm.createContext({ window: win, Math, console, Uint8Array, Uint16Array, Int32Array });
  /* sound.js · sprites* 는 DOM 을 쓰므로 안 올린다 —
   * game.js 가 `if (global.SFX)` 로 감싸 두어 없어도 돈다(그러라고 감쌌다). */
  for (const f of ["data.js", "items.js", "dungeon.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(JS, f), "utf8"), ctx, { filename: f });
  }
  return win;
}

//  ⚠ 이동이 4방향이 된 뒤로는 검사도 4방향이어야 한다. 8방향으로 두면 AI 가
//    사람이 갈 수 없는 길로 가서 승률이 실제보다 높게 나온다.
const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]];
let fails = 0;
const ok = (b) => { if (!b) fails++; return b ? "✔" : "✘"; };

/* 하위 검사가 **조용히 죽었을 때** 그 이유를 끌어낸다.
 * ⚠ 종료 코드만 보고 stdout 의 ✘ 만 세면, 크롬이 안 떠서 통째로 죽은 것이
 *   "✘ 통과" 나 "✘ 0개 항목 통과" 로 나온다 — 화면에 아무 단서가 없다.
 *   실제로 장비 창과 마법사 화면에서 한 번씩 그렇게 나왔다. stderr 를 버리지 말 것. */
function why(r) {
  if (!r || r.status === 0) return "";
  if ((r.stdout || "").includes("✘")) return "";
  const err = (r.stderr || "").trim().split(String.fromCharCode(10)).filter(Boolean);
  const last = err.length ? err[err.length - 1] : "";
  return " ⚠ 종료코드 " + r.status +
         (r.error ? " · " + r.error.message : "") +
         (last ? " · " + last.slice(0, 120) : " · stderr 없음") +
         (r.stdout ? "" : " · 출력 없음");
}

const W = loadRules();
const { Game, DUNGEON: D, DATA, ITEMS, josa } = W;
/* 맹세 값을 밖에서 갈아끼운다 — **대조군을 돌리려고** 둔 문이다.
 * ⚠ 제품 코드(data.js)에는 이 손잡이를 두지 않는다. 측정용 갈래가 제품에
 *   섞이면 배포된 값이 무엇인지가 흐려진다. */
if (process.env.MB_OATH_HP) DATA.ALTAR.oathHp = parseFloat(process.env.MB_OATH_HP);
if (process.env.MB_OATH_CRIT) DATA.ALTAR.oathCrit = parseFloat(process.env.MB_OATH_CRIT);

console.log("── 로직 ──");

// 1) 문법
let synBad = 0;
for (const f of fs.readdirSync(JS)) {
  const r = spawnSync(process.execPath, ["--check", path.join(JS, f)], { encoding: "utf8" });
  if (r.status !== 0) { console.log("   ✘ " + f + ": " + r.stderr.split("\n")[0]); synBad++; }
}
console.log("문법        :", ok(synBad === 0), fs.readdirSync(JS).length + "개 파일");

// 1-b) 캐시 무효화 — public 의 js/css 를 고치고 index.html 의 ?v= 를 안 올리면
//    **이미 접속한 사람에게는 옛 파일이 그대로 나간다.** 배포는 성공하고 화면 검사도
//    통과하는데(점검기는 늘 새 브라우저다) 정작 쓰던 사람만 안 바뀐다 — 화면에
//    아무 단서가 없는 종류다. 실제로 구역 배포에서 한 번 빠뜨렸다.
{
  const rc = spawnSync(process.execPath, [path.join(ROOT, "tools", "cache-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const line = rc.stdout.split(String.fromCharCode(10)).find(l => l.startsWith("버전 값")) || "";
  if (rc.status !== 0) fails++;
  console.log("캐시 무효화 :", ok(rc.status === 0),
    line.replace(/^버전 값[^:]*:/, "버전").replace(/\s+/g, " ").trim());
  if (rc.status !== 0) rc.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 2) 던전 연결성 + 보물방 진입 가능성
let unreachable = 0, treasureSealed = 0, treasureCount = 0, deepCount = 0, deepSealed = 0;
for (let s = 1; s <= 200; s++) {
  for (let depth = 1; depth <= DATA.MAX_DEPTH; depth++) {
    const lv = D.generate(62, 38, depth, (s * 2654435761 + depth) >>> 0);
    const seen = new Uint8Array(lv.w * lv.h);
    const q = [lv.upAt.y * lv.w + lv.upAt.x];
    seen[q[0]] = 1;
    let head = 0;
    while (head < q.length) {
      const cur = q[head++], cx = cur % lv.w, cy = (cur / lv.w) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
        const id = ny * lv.w + nx;
        if (seen[id]) continue;
        seen[id] = 1; q.push(id);
      }
    }
    if (!seen[lv.downAt.y * lv.w + lv.downAt.x]) unreachable++;
    /* ⚠ 깊은 계단도 **걸어서 닿아야 한다.** 못 닿으면 선택지가 아니라 장식이다. */
    if (lv.deepAt) {
      deepCount++;
      if (!seen[lv.deepAt.y * lv.w + lv.deepAt.x]) deepSealed++;
    }
    if (lv.treasure) {
      treasureCount++;
      const t = lv.treasure;
      let reach = false;
      for (let y = t.y; y < t.y + t.h && !reach; y++)
        for (let x = t.x; x < t.x + t.w; x++)
          if (seen[y * lv.w + x]) { reach = true; break; }
      if (!reach) treasureSealed++;
    }
  }
}
console.log("던전 연결성 :", ok(unreachable === 0), 200 * DATA.MAX_DEPTH + "개 층 · 계단 못 가는 층 " + unreachable + "개");
console.log("보물방      :", ok(treasureSealed === 0),
  treasureCount + "개 생성 · 들어갈 수 없는 방 " + treasureSealed + "개");
console.log("깊은 계단   :", ok(deepSealed === 0),
  deepCount + "개 생성(층마다 하나가 목표) · 걸어서 못 닿음 " + deepSealed + "개");

// 2-b) 탭 이동의 길찾기 — 이어진 길만 내놓는가
//    ⚠ 화면 검사는 "걸었다" 까지만 본다. 길 자체가 옳은지(칸마다 인접 · 벽 없음 ·
//      본 칸만 · 드러난 함정 피함)는 규칙으로 재야 잡힌다. 한 칸이라도 끊기면
//      캐릭터가 벽을 통과하거나 제자리에서 멈춘다.
{
  let paths = 0, broken = 0, missed = 0, unseenLeak = 0, trapStep = 0, nullOnUnseen = 0, tries = 0;
  for (let s = 1; s <= 120; s++) {
    const g = new Game("warrior");
    g.reset((s * 2654435761) >>> 0, "warrior");
    const lv = g.level;
    /* 절반은 "다 본" 상태, 절반은 실제 시야 그대로 둔다 — 두 조건을 다 밟는다 */
    if (s % 2 === 0) lv.seen.fill(1);
    const floors = [];
    for (let y = 0; y < lv.h; y++) for (let x = 0; x < lv.w; x++)
      if (!lv.blocked(x, y) && lv.seen[lv.idx(x, y)]) floors.push([x, y]);
    for (let k = 0; k < 6 && floors.length; k++) {
      const [tx, ty] = floors[(s * 7 + k * 13) % floors.length];
      tries++;
      const p = g.pathTo(tx, ty);
      if (!p) continue;                       /* 몬스터가 막고 있으면 길이 없는 게 맞다 */
      paths++;
      let cx = g.player.x, cy = g.player.y;
      for (let i = 0; i < p.length; i++) {
        const st = p[i];
        if (Math.abs(st.x - cx) + Math.abs(st.y - cy) !== 1) broken++;
        if (lv.blocked(st.x, st.y)) broken++;
        if (!lv.seen[lv.idx(st.x, st.y)]) unseenLeak++;
        const isGoal = (i === p.length - 1);
        if (!isGoal && lv.traps[lv.idx(st.x, st.y)] === 2) trapStep++;
        cx = st.x; cy = st.y;
      }
      if (cx !== tx || cy !== ty) missed++;
    }
    /* 아직 못 본 칸은 **길을 몰라야 한다**(그래야 탐험이 산다) */
    for (let y = 0; y < lv.h && nullOnUnseen === 0; y++)
      for (let x = 0; x < lv.w; x++) {
        const i = lv.idx(x, y);
        if (lv.blocked(x, y) || lv.seen[i]) continue;
        if (g.pathTo(x, y) !== null) { nullOnUnseen = 1; }
        break;
      }
  }
  console.log("탭 길찾기   :", ok(broken === 0 && missed === 0 && unseenLeak === 0 &&
                                trapStep === 0 && nullOnUnseen === 0 && paths > 100),
    paths + "개 길(" + tries + "회 시도) · 끊긴 걸음 " + broken + " · 목적지 못 닿음 " + missed +
    " · 못 본 칸 지나감 " + unseenLeak + " · 드러난 함정 밟음 " + trapStep +
    " · 안 본 칸에 길 내줌 " + nullOnUnseen);
}

// 2-c) 하루의 장부 — 날짜·씨앗·공유판
//    ⚠ 이 기능의 약속은 둘이다: **모두가 같은 던전** · **하루 한 번**.
//      앞엣것이 깨지면 공유판이 비교가 안 되어 공유할 이유가 사라지고,
//      뒤엣것이 깨지면 좋은 기록만 남기게 되어 장부가 거짓이 된다.
{
  const src = fs.readFileSync(path.join(JS, "daily.js"), "utf8");
  const box = {};
  const dctx = vm.createContext({ Date, Math, JSON, Array, String, console, globalThis: box });
  vm.runInContext(src, dctx, { filename: "daily.js" });
  const DAILY = box.DAILY;

  /* 한국 시간 기준으로 날짜가 갈리는가 — 자정 경계를 직접 밟는다.
   * ⚠ 브라우저 시간대에 맡기면 같은 날짜에 사람마다 다른 던전이 나온다. */
  const kstEdge = DAILY.dayKey(Date.UTC(2026, 8, 18, 14, 59)) === "2026-09-18" &&
                  DAILY.dayKey(Date.UTC(2026, 8, 18, 15,  1)) === "2026-09-19";
  /* 같은 날은 하루 안에서 언제 불러도 같은 씨앗이어야 한다 */
  let sameDay = true;
  for (let hh = 0; hh < 24; hh++) {
    const t = Date.UTC(2026, 8, 17, 15, 0) + hh * 3600000;   /* 9/18 00:00 KST 부터 24시간 */
    if (DAILY.dayKey(t) !== "2026-09-18") { sameDay = false; break; }
    if (DAILY.seedToday(t) !== DAILY.seedOf("2026-09-18")) { sameDay = false; break; }
  }
  /* 이웃한 날의 씨앗이 닮지 않는가 — 날짜를 그대로 숫자로 쓰면 닮는다.
   * 1년치를 뽑아 ① 중복 ② 상위 비트가 안 흔들리는 경우를 본다. */
  const seeds = [], seen = new Set();
  let dup = 0, lowDelta = 0;
  for (let i = 0; i < 365; i++) {
    const k = DAILY.dayKey(Date.UTC(2026, 0, 1, 3, 0) + i * 86400000);
    const s = DAILY.seedOf(k);
    if (seen.has(s)) dup++;
    seen.add(s); seeds.push(s);
    if (i > 0) {
      /* 이웃 씨앗의 xor 에서 켜진 비트가 8개 미만이면 "닮았다" 로 본다 */
      let x = (seeds[i] ^ seeds[i - 1]) >>> 0, bits = 0;
      while (x) { bits += x & 1; x >>>= 1; }
      if (bits < 8) lowDelta++;
    }
  }
  /* 실제로 그 씨앗으로 층을 만들면 날마다 다른 층이 나오는가 */
  const shapes = new Set();
  for (let i = 0; i < 20; i++) {
    const k = DAILY.dayKey(Date.UTC(2026, 8, 1, 3, 0) + i * 86400000);
    const lv = D.generate(62, 38, 1, DAILY.seedOf(k));
    shapes.add(lv.rooms.length + ":" + lv.downAt.x + "," + lv.downAt.y);
  }
  /* 같은 날 같은 씨앗으로 두 번 만들면 **같은 층**이어야 한다(그게 "모두 같은 던전") */
  const a1 = D.generate(62, 38, 3, DAILY.seedOf("2026-09-18"));
  const a2 = D.generate(62, 38, 3, DAILY.seedOf("2026-09-18"));
  let identical = a1.tiles.length === a2.tiles.length;
  for (let i = 0; identical && i < a1.tiles.length; i++) if (a1.tiles[i] !== a2.tiles[i]) identical = false;

  /* ── 오늘의 변이 ────────────────────────────────────
   * ⚠ 이 기능의 약속은 셋이다: **하루 둘(나쁨+좋음)** · **이틀 연속 안 겹침** ·
   *   **같은 날은 늘 같다**. 둘째가 깨지면 "내일 또" 가 없어지고, 셋째가 깨지면
   *   새로고침할 때마다 규칙이 바뀌어 "모두 같은 던전" 이 통째로 거짓이 된다. */
  {
    const rows = [];
    const chk = (n, good, note) => rows.push([n, good, note]);
    const start = Date.UTC(2026, 0, 1);
    let same = 0, badShape = 0, prev = null;
    const combos = {}, ids = new Set();
    for (let i = 0; i < 365; i++) {
      const k = DAILY.dayKey(start + i * 86400000);
      const m = DAILY.mutatorsFor(k);
      if (!m || m.length !== 2 || m[0].tone !== "bad" || m[1].tone !== "good") { badShape++; continue; }
      m.forEach(x => ids.add(x.id));
      combos[m[0].id + "+" + m[1].id] = 1;
      if (prev && (m[0].id === prev[0].id || m[1].id === prev[1].id)) same++;
      prev = m;
    }
    chk("하루 둘", badShape === 0, "365일 전부 나쁨 하나 + 좋음 하나");
    chk("연속 겹침 0", same === 0, "365일 중 어제와 겹친 날 " + same);
    chk("조합", Object.keys(combos).length >= 20, Object.keys(combos).length + "가지 / 25");
    chk("모두 나온다", ids.size === DAILY.MUTATORS.length,
      DAILY.MUTATORS.length + "종 중 " + ids.size + "종");
    const a1 = DAILY.mutatorsFor("2026-05-05").map(m => m.id).join();
    const a2 = DAILY.mutatorsFor("2026-05-05").map(m => m.id).join();
    chk("같은 날은 같다", a1 === a2, a1);
    /* ⚠ mods 의 열쇠가 game.js 가 읽는 이름과 다르면 그 변이는 **조용히** 아무
     *   일도 안 한다. 화면에는 뜨는데 게임은 그대로다 — 제일 잡기 어려운 종류다. */
    {
      const keys = new Set();
      DAILY.MUTATORS.forEach(m => Object.keys(m.mods).forEach(k => keys.add(k)));
      const src2 = fs.readFileSync(path.join(JS, "game.js"), "utf8");
      const miss = [...keys].filter(k => src2.indexOf("this.mut(\"" + k + "\"") < 0);
      chk("game.js 가 읽는다", miss.length === 0,
        miss.length ? "✘ 아무 데서도 안 읽는 열쇠: " + miss.join(", ") : keys.size + "개 전부 읽힌다");
    }
    /* 장부 한 줄에 변이 이름이 들어가는가(자유 탐사에는 안 들어가야 한다) */
    {
      const d = DAILY.shareText({ mode: "daily", day: "2026-05-05", cls: "다인", won: false,
        depth: 5, maxDepth: 10, crit: 0.1, kills: 10, score: 100 });
      const f = DAILY.shareText({ mode: "free", seed: 1, cls: "다인", won: false,
        depth: 5, maxDepth: 10, crit: 0.1, kills: 10, score: 100 });
      const nm = DAILY.mutatorsFor("2026-05-05")[0].name;
      chk("장부에 적힌다", d.indexOf(nm) >= 0 && f.indexOf(nm) < 0,
        "일일에는 있고 자유 탐사에는 없다");
    }
    const nbad = rows.filter(r => !r[1]).length;
    console.log("오늘의 변이 :", ok(nbad === 0),
      DAILY.MUTATORS.length + "종 · 검사 " + rows.length + "항목" +
      (nbad ? " · ⚠ 실패 " + nbad : " 전부 통과"));
    rows.filter(r => !r[1]).forEach(r => console.log("              ✘ " + r[0] + " — " + r[2]));
  }

  console.log("일일 씨앗   :", ok(kstEdge && sameDay && dup === 0 && lowDelta === 0 &&
                                shapes.size >= 18 && identical),
    "한국시간 경계 " + (kstEdge ? "맞음" : "⚠틀림") + " · 하루 안 고정 " + (sameDay ? "맞음" : "⚠틀림") +
    " · 1년 365일 중 중복 " + dup + " · 이웃과 닮은 씨앗 " + lowDelta +
    " · 20일치 층 모양 " + shapes.size + "가지 · 같은 날 재생성 " + (identical ? "동일" : "⚠다름"));

  /* 공유판 — 줄 수·칸 수·이모지 */
  const mk = (depth, won) => DAILY.shareText({ day: "2026-09-18", mode: "daily", cls: "셰라",
    depth, won, score: 5430, kills: 46, crit: 0.31, maxDepth: DATA.MAX_DEPTH, url: "x.dev" });
  const lines = mk(7, false).split(String.fromCharCode(10));
  /* ⚠ 칸 줄을 **줄 번호로 찾지 않는다.** 오늘의 변이가 들어오면서 줄이 하나
   *   늘었는데, lines[2] 로 찍어 두었더니 엉뚱한 줄을 세어 "이모지 빠짐" 으로
   *   빨개졌다(제품이 아니라 검사의 전제가 낡은 것이었다). 내용으로 찾는다. */
  const barLine = lines.find(l => l.indexOf("🟨") >= 0 || l.indexOf("⬛") >= 0) || "";
  /* 이모지는 서로게이트 쌍이라 length 로 세면 안 된다 — 코드포인트로 센다 */
  const cells = [...barLine].length;
  const won10 = [...mk(10, true)].join("");
  const shapeOk = lines.length >= 5 && cells === DATA.MAX_DEPTH &&
                  barLine.indexOf("🟨") >= 0 && barLine.indexOf("⬛") >= 0 &&
                  won10.indexOf("👑") >= 0 && mk(10, false).indexOf("🟥") >= 0;
  /* 자유 탐사는 날짜를 쓰지 않는다 — "9월 18일의 장부" 라고 적으면 거짓이다 */
  const freeHead = DAILY.shareText({ day: "2026-09-18", mode: "free", seed: 0x096ff20d, cls: "다인",
    depth: 4, won: false, score: 900, kills: 9, crit: 0.1, maxDepth: DATA.MAX_DEPTH });
  const freeOk = freeHead.indexOf("자유 탐사") >= 0 && freeHead.indexOf("장부") < 0 &&
                 freeHead.indexOf("96FF20D") >= 0;
  console.log("장부 공유판 :", ok(shapeOk && freeOk),
    lines.length + "줄 · 칸 " + cells + "개(층 " + DATA.MAX_DEPTH + ") · 이모지 " +
    (shapeOk ? "정상" : "⚠빠짐") + " · 자유 탐사 머리글 " + (freeOk ? "분리됨" : "⚠날짜를 쓴다"));

  /* 연속 기록 — localStorage 없이도 죽지 않아야 한다(시크릿 모드) */
  let noStorageOk = true;
  try {
    if (DAILY.readLedger().length !== 0) noStorageOk = false;
    if (DAILY.doneToday() !== false) noStorageOk = false;
    if (DAILY.streak() !== 0) noStorageOk = false;
    DAILY.record({ day: "2026-09-18", depth: 3 });      /* 저장이 막혀도 예외가 없어야 한다 */
  } catch (err) { noStorageOk = false; }
  console.log("저장 막힘   :", ok(noStorageOk),
    noStorageOk ? "localStorage 없이도 예외 없음(시크릿 모드)" : "⚠ 예외가 난다");
}

// 2-c2) 구역 — 층마다 어디에 있는지가 갈리는가
//    ⚠ 구역은 **색·장식·문구만** 바꾼다. 여기서 몬스터나 난이도를 함께 건드리면
//      손잡이 하나에 두 가지가 달려 균형 조정이 불가능해진다(보스 배수에서 겪었다).
//    ⚠ 장식이 계단·함정을 덮으면 화면이 거짓말을 한다 — 규칙은 그대로인데
//      계단을 못 알아보거나 드러난 함정을 밟는다.
{
  /* 1~10층이 빠짐없이 어떤 구역에 들어가는가 */
  let gaps = 0;
  const zonesUsed = new Set();
  for (let d = 1; d <= DATA.MAX_DEPTH; d++) {
    const z = DATA.zoneAt(d);
    if (!z || d < z.from || d > z.to) gaps++;
    zonesUsed.add(z.id);
  }
  /* 팔레트 열쇠가 다 있는가 — 하나만 빠져도 그 색이 undefined 로 그려진다 */
  const needF = ["mortar","face","lit","dim","grain1","grain2","crack","peb1","peb2","peb3"];
  const needW = ["mortar","face","lit","dim","grain1","grain2","moss"];
  let badPal = 0, badHex = 0;
  for (const z of DATA.ZONES) {
    for (const k of needF) if (!z.floor[k]) badPal++;
    for (const k of needW) if (!z.wall[k]) badPal++;
    for (const k in z.floor) if (!/^#[0-9a-fA-F]{6}$/.test(z.floor[k])) badHex++;
    for (const k in z.wall) if (!/^#[0-9a-fA-F]{6}$/.test(z.wall[k])) badHex++;
  }
  /* 구역끼리 색이 실제로 다른가(같으면 나눈 뜻이 없다) */
  const faces = new Set(DATA.ZONES.map(z => z.floor.face + z.wall.face));
  /* 장식 이름이 전부 그림으로 있는가 */
  const art = fs.readFileSync(path.join(JS, "sprites-art.js"), "utf8");
  let noArt = 0;
  for (const z of DATA.ZONES) for (const p of (z.props || []))
    if (!art.includes('art("p_' + p + '"')) noArt++;

  /* 실제로 뿌려 보고 규칙을 안 건드리는지 본다 */
  let onWall = 0, onTrap = 0, onStairs = 0, placed = 0, floorTiles = 0;
  for (let s = 0; s < 20; s++) {
    const g = new Game("warrior");
    g.reset((s * 7919 + 11) >>> 0, "warrior");
    for (let depth = 1; depth <= DATA.MAX_DEPTH; depth++) {
      if (depth > 1) g.descend();
      const lv = g.level;
      for (let i = 0; i < lv.props.length; i++) {
        if (lv.tiles[i] === D.FLOOR) floorTiles++;
        if (!lv.props[i]) continue;
        placed++;
        if (lv.tiles[i] === D.WALL) onWall++;
        if (lv.traps[i]) onTrap++;
        const x = i % lv.w, y = (i / lv.w) | 0;
        if ((x === lv.downAt.x && y === lv.downAt.y) || (x === lv.upAt.x && y === lv.upAt.y)) onStairs++;
      }
    }
  }
  const density = placed / Math.max(1, floorTiles) * 100;
  console.log("구역        :", ok(gaps === 0 && badPal === 0 && badHex === 0 &&
                                faces.size === DATA.ZONES.length && noArt === 0 &&
                                onWall === 0 && onTrap === 0 && onStairs === 0 &&
                                density > 1 && density < 8),
    DATA.ZONES.length + "구역 · 1~" + DATA.MAX_DEPTH + "층 빈 곳 " + gaps +
    " · 팔레트 빠짐 " + badPal + " · 잘못된 색 " + badHex +
    " · 색이 겹치는 구역 " + (DATA.ZONES.length - faces.size) +
    " · 그림 없는 장식 " + noArt);
  console.log("구역 장식   :", ok(onWall === 0 && onTrap === 0 && onStairs === 0),
    placed + "개 뿌림(바닥의 " + density.toFixed(1) + "%) · 벽 위 " + onWall +
    " · 함정 위 " + onTrap + " · 계단 위 " + onStairs);
}

// 2-d) 유물 — **규칙을 바꾸는** 것들이라 조용히 깨져도 화면에서는 안 보인다.
//    ⚠ "유물을 얻었다" 는 로그만으로는 아무 것도 증명되지 않는다. 하나하나가
//      실제로 규칙을 바꾸는지 직접 재고, **대가와 안전장치도 함께** 잰다
//      (안전장치가 빠지면 보스를 치명타 한 방에 지우거나 내 유물이 나를 때린다).
{
  const mk = (relics) => {
    const g = new Game("warrior");
    g.reset(12345, "warrior");
    (relics || []).forEach(r => g.takeRelic(r));
    return g;
  };
  const rat = () => DATA.byId(DATA.MONSTERS, "rat");
  const rows = [];
  const chk = (name, good, note) => rows.push([name, !!good, note]);

  /* 같은 유물을 두 번 주지 않는다 */
  { const g = mk(["r_brush"]);
    chk("중복 방지", g.takeRelic("r_brush") === false && g.player.relics.length === 1,
        "두 번째 주기 거절"); }

  /* 두 번 새기는 붓 — 내가 거는 것만 길어진다 */
  { const a = mk(), b = mk(["r_brush"]);
    const m1 = a.spawn(rat(), 5, 5, true), m2 = b.spawn(rat(), 5, 5, true);
    a.applyAil(m1, "poison", 0); b.applyAil(m2, "poison", 0);
    b.applyAil(b.player, "poison", 0);
    chk("붓: 상대 ×2 · 나는 그대로",
      m2.ail.poison.turns === m1.ail.poison.turns * 2 &&
      b.player.ail.poison.turns === m1.ail.poison.turns,
      m1.ail.poison.turns + " → " + m2.ail.poison.turns + "턴 · 내게는 " + b.player.ail.poison.turns + "턴"); }

  /* 빈 이름 — 치명타로 약한 적을 지운다 · 보스에는 안 통한다 */
  { const g = mk(["r_blank"]); g.critRoll = () => 2;
    const m = g.spawn(DATA.byId(DATA.MONSTERS, "troll"), g.player.x + 1, g.player.y, true);
    m.maxhp = 400; m.hp = 80; g.monsters.push(m);
    g.attack(g.player, m);
    const gone = g.monsters.indexOf(m) < 0;
    const g2 = mk(["r_blank"]); g2.critRoll = () => 2;
    const boss = g2.spawn(DATA.byId(DATA.MONSTERS, "lord"), g2.player.x + 1, g2.player.y, true);
    boss.hp = Math.round(boss.maxhp * 0.1); g2.monsters.push(boss);
    g2.attack(g2.player, boss);
    chk("빈 이름: 지움 · 보스 면역", gone && g2.monsters.indexOf(boss) >= 0,
      (gone ? "약한 적 지움" : "⚠ 안 지워짐") + " · " +
      (g2.monsters.indexOf(boss) >= 0 ? "보스 안 통함" : "⚠ 보스도 즉사")); }

  /* 거꾸로 읽는 장부 — 체력이 낮을수록 세다 */
  { const dmgAt = (frac) => {
      const g = mk(["r_reverse"]);
      g.player.hp = Math.max(1, Math.round(g.maxhp() * frac));
      g.rng = () => 0.5;
      const m = g.spawn(rat(), g.player.x + 1, g.player.y, true);
      m.hp = 9999; m.maxhp = 9999; g.monsters.push(m);
      const h = m.hp; g.attack(g.player, m); return h - m.hp;
    };
    const full = dmgAt(1), low = dmgAt(0.02);
    chk("거꾸로: 빈사에서 강해짐", low > full, "만피 " + full + " → 빈사 " + low); }

  /* 깨진 모래시계 — 쿨다운이 두 배로 줄어든다 */
  { const step = (relics) => {
      const g = mk(relics); g.learn("cleave", true);
      g.player.skills[0].cd = 5; g.act(true); return g.player.skills[0].cd; };
    const a = step([]), b = step(["r_hourglass"]);
    chk("모래시계: 쿨 2씩", b === a - 1, a + " → " + b); }

  /* 탐욕의 저울 — 금화 ×2 · 최대 체력 −20% */
  { const gold = (relics) => {
      const g = mk(relics); const m = g.spawn(rat(), 5, 5, true); g.monsters.push(m);
      const before = g.gold; g.kill(m); return g.gold - before; };
    const a = gold([]), b = gold(["r_scales"]);
    const hp0 = mk().maxhp(), hp1 = mk(["r_scales"]).maxhp();
    chk("저울: 금화 ×2 · 체력 −20%", b === a * 2 && Math.abs(hp1 - Math.round(hp0 * 0.8)) <= 1,
      "금화 " + a + " → " + b + " · 체력 " + hp0 + " → " + hp1); }

  /* 피를 먹는 검 — 처치하면 회복한다(최대 체력은 안 늘어난다) */
  { const g = mk(["r_bloodblade"]);
    const mx = g.maxhp();
    g.player.hp = 10;
    for (let i = 0; i < 3; i++) { const m = g.spawn(rat(), 5, 5, true); g.monsters.push(m); g.kill(m); }
    chk("피검: 처치마다 회복", g.player.hp > 10 && g.maxhp() === mx,
      "체력 10 → " + g.player.hp + " · 최대 " + mx + " (안 변함)"); }

  /* 가시 갑옷 — 되돌려 준다 */
  { const g = mk(["r_thorns"]);
    const m = g.spawn(rat(), g.player.x + 1, g.player.y, true);
    m.hp = 500; m.maxhp = 500; m.atk = 40; g.monsters.push(m);
    g.cls = Object.assign({}, g.cls, { evade: 0 });      /* 회피로 흘리면 못 잰다 */
    const h = m.hp; g.attack(m, g.player);
    chk("가시: 반사", m.hp < h, "몬스터 " + h + " → " + m.hp); }

  /* 계단의 기억 — 내려가면 회복 */
  { const g = mk(["r_stairs"]); g.player.hp = 10; g.descend();
    chk("계단: 내려가면 회복", g.player.hp > 10, "10 → " + g.player.hp); }

  /* 군주의 눈 — 전체 공개 · 몬스터를 깨우지는 않는다 */
  { const g = mk(["r_lordseye"]);
    let all = true; for (let i = 0; i < g.level.seen.length; i++) if (!g.level.seen[i]) { all = false; break; }
    const awake = g.monsters.filter(m => m.awake).length;
    chk("군주의 눈: 전체 공개", all && awake === 0,
      (all ? "전부 보임" : "⚠ 안 보임") + " · 깨어 있는 몬스터 " + awake + "/" + g.monsters.length); }

  /* 남의 기억 — 물약 전부 식별 · 상인은 그대로 온다 */
  { const g = mk(["r_memory"]);
    const pots = DATA.CONSUMABLES.filter(c => c.kind === "potion");
    let sawShop = false;
    for (let d = 2; d <= 8; d += 2) { g.descend(); if (g.merchant) sawShop = true; }
    chk("남의 기억: 식별 · 상인 유지", pots.every(p => g.identified[p.id]) && sawShop,
      pots.length + "종 식별 · 상인 " + (sawShop ? "옴" : "⚠ 안 옴")); }

  /* 레벨업·상점에 실제로 나오는가 */
  { let inPerk = 0, inShop = 0;
    for (let s = 0; s < 60; s++) {
      const g = new Game("warrior"); g.reset((s * 7919 + 3) >>> 0, "warrior");
      g.offerPerks();
      if (g.pendingPerks && g.pendingPerks.some(c => c.what === "relic")) inPerk++;
      if (g.rollShop(4).some(r => r.what === "relic")) inShop++;
    }
    chk("나오는 자리", inPerk > 5 && inShop > 5,
      "레벨업 60회 중 " + inPerk + "회 · 상점 60회 중 " + inShop + "회"); }

  const bad = rows.filter(r => !r[1]).length;
  console.log("유물        :", ok(bad === 0),
    DATA.RELICS.length + "종 · 검사 " + rows.length + "항목" + (bad ? " · ⚠ 실패 " + bad : " 전부 통과"));
  rows.filter(r => !r[1]).forEach(r => console.log("              ✘ " + r[0] + " — " + r[2]));
}

// 3) 조사
const JOSA = [["굶주린 쥐", "를"], ["고블린", "을"], ["해골 병사", "를"], ["오크 전사", "를"],
              ["망령", "을"], ["동굴 트롤", "을"], ["심연의 군주", "를"], ["치유 물약", "을"],
              ["붉은 물약", "을"], ["금화 10", "을"], ["금화 22", "를"], ["금화 9", "를"]];
const badJosa = JOSA.filter(([w, want]) => josa(w, "을", "를").slice(w.length) !== want);
console.log("한국어 조사 :", ok(badJosa.length === 0),
  JOSA.length + "건 중 틀림 " + badJosa.length + (badJosa.length ? " — " + badJosa.map(b => b[0]).join(", ") : ""));

// 4) 화면에 나갈 문구에 마크다운 기호가 섞이지 않았는가
//    ⚠ data.js 의 설명은 HTML 로 그대로 들어간다. `**강조**` 를 적으면 별표가 그대로 보인다.
const dataSrc = fs.readFileSync(path.join(JS, "data.js"), "utf8");
const strayMd = (dataSrc.match(/["'][^"'\n]*\*\*[^"'\n]*["']/g) || []).length;
console.log("문구        :", ok(strayMd === 0), strayMd ? "마크다운 기호 " + strayMd + "건" : "마크다운 기호 없음");

// 5) 아이템 굴림 — 등급·옵션·이름이 제대로 나오는가
{
  const g = new Game("warrior");
  g.reset(777, "warrior");
  const seenRar = {}, seenAffix = {}, seenKind = {};
  let badName = 0, noAffixOnRare = 0, total = 0;
  for (let depth = 1; depth <= 10; depth++) {
    for (let i = 0; i < 120; i++) {
      const it = ITEMS.makeGear(["weapon", "armor", "offhand"][i % 3], depth, g.rng);
      total++;
      seenRar[it.rarity] = (seenRar[it.rarity] || 0) + 1;
      if (it.weaponKind) seenKind[it.weaponKind] = 1;
      for (const a of it.affixes) seenAffix[a.id] = 1;
      /* 이름 — 빈 문자열이나 "undefined" 가 섞이면 안 된다 */
      if (!it.name || /undefined|NaN/.test(it.name)) badName++;
      /* 등급이 높은데 옵션이 안 붙으면 굴림이 죽은 것이다 */
      const want = DATA.byId(DATA.RARITY, it.rarity).affixes;
      if (it.affixes.length < want) noAffixOnRare++;
    }
  }
  const rarKinds = Object.keys(seenRar).length;
  console.log("아이템 굴림 :", ok(rarKinds === 4 && badName === 0 && noAffixOnRare === 0),
    total + "점 · 등급 " + rarKinds + "종 · 옵션 " + Object.keys(seenAffix).length + "/" + DATA.AFFIXES.length +
    "종 · 무기 " + Object.keys(seenKind).length + "/" + DATA.WEAPON_KINDS.length + "종" +
    (badName ? " · ⚠이름 오류 " + badName : "") + (noAffixOnRare ? " · ⚠옵션 누락 " + noAffixOnRare : ""));
}

// 6) 능력치 합산 — 옵션이 실제로 반영되는가(표시와 실제가 어긋나면 안 된다)
{
  const g = new Game("warrior");
  g.reset(2024, "warrior");
  const before = { atk: g.power(), def: g.guard(), crit: g.stats().crit, hp: g.maxhp() };
  /* 옵션을 강제로 붙인 장비를 만들어 착용 */
  /* ⚠ 무기 종류를 고정한다. 안 하면 굴려 나온 종류의 태생 옵션(검 +2% 치명 등)이
   *   섞여 "옵션 +25% 인데 +28% 올랐다" 로 나와 검사가 빨개진다(제품이 아니라 검사 결함). */
  const gear = ITEMS.makeGear("weapon", 5, g.rng,
    { affixes: 0, rarity: DATA.RARITY[0], weaponKind: g.cls.startWeapon.kind, tier: g.cls.startWeapon.tier });
  gear.affixes = [
    { id: "crit", stat: "crit", label: "치명타 확률", unit: "%", value: 0.25, pre: "날카로운", suf: "예리함의" },
    { id: "hp", stat: "hpFlat", label: "최대 체력", unit: "", value: 40, pre: "강인한", suf: "생명의" }
  ];
  g.player.inventory.push(gear);
  g.equip(gear, true);
  const after = { atk: g.power(), def: g.guard(), crit: g.stats().crit, hp: g.maxhp() };
  const critOk = Math.abs((after.crit - before.crit) - 0.25) < 0.001;
  const hpOk = (after.hp - before.hp) >= 40;
  console.log("옵션 반영   :", ok(critOk && hpOk),
    "치명 " + Math.round(before.crit * 100) + "% → " + Math.round(after.crit * 100) + "% · " +
    "최대체력 " + before.hp + " → " + after.hp);
}

// 7) 치명타 — 정말 터지고, 확률을 올리면 더 자주 터지는가
{
  const g = new Game("warrior");
  g.reset(31337, "warrior");
  function measure(chance) {
    g.player.perks = ITEMS.blank();
    g.player.perks.crit = chance - g.cls.base.crit;
    let crit = 0;
    for (let i = 0; i < 4000; i++) if (g.critRoll(1)) crit++;
    return crit / 4000;
  }
  const low = measure(0.05), high = measure(0.60);
  console.log("치명타      :", ok(low > 0.02 && low < 0.09 && high > 0.5),
    "확률 5% 설정 → 실측 " + (low * 100).toFixed(1) + "% · 60% 설정 → " + (high * 100).toFixed(1) + "%");
}

// 8) 상태이상 — 걸리고, 턴마다 깎이고, 끝나면 사라지는가
{
  const g = new Game("warrior");
  g.reset(555, "warrior");
  const m = g.spawn(DATA.byId(DATA.MONSTERS, "orc"), g.player.x + 5, g.player.y);
  m.hp = 9999; m.maxhp = 9999;
  g.monsters = [m];
  g.applyAil(m, "poison", 0);
  const hp0 = m.hp;
  let ticks = 0;
  for (let i = 0; i < 8; i++) { g.tickAil(m, false); if (m.hp < hp0) ticks++; }
  const gone = !m.ail.poison;
  console.log("상태이상    :", ok(hp0 - m.hp > 0 && gone),
    "중독 " + DATA.AILMENTS.poison.turns + "턴 · 총 " + (hp0 - m.hp) + " 피해 · 만료 " + (gone ? "됨" : "안 됨"));
}

// 9) 스킬 — 전부 동작하고 쿨이 걸리고 다시 풀리는가.
//    ⚠ 화면에서는 "버튼이 보인다" 까지만 확인된다 — 1층엔 붙을 적이 없다.
{
  const rows = [];
  for (const sk of DATA.SKILLS) {
    const g = new Game("warrior");
    g.reset(4242, "warrior");
    g.player.skills = [{ id: sk.id, rank: 1, cd: 0 }];
    /* 사거리 안에 적을 둔다. 근접 스킬은 옆 칸, 원거리는 세 칸 */
    const near = g.spawn(DATA.byId(DATA.MONSTERS, "goblin"), g.player.x + 1, g.player.y);
    const far = g.spawn(DATA.byId(DATA.MONSTERS, "goblin"), g.player.x + 3, g.player.y);
    near.hp = near.maxhp = 9999; far.hp = far.maxhp = 9999;
    g.monsters = [near, far];
    const hpBefore = g.player.hp, mhpBefore = near.hp + far.hp;
    const used = g.useSkill(0) !== false;
    const cdSet = g.player.skills[0].cd;
    const blocked = g.useSkill(0) === false;
    g.monsters = [];
    for (let i = 0; i < cdSet + 1 && !g.over; i++) g.wait();
    const recovered = g.player.skills[0].cd === 0 && !g.over;
    const didSomething = (near.hp + far.hp) < mhpBefore || g.player.hp !== hpBefore ||
                         g.player.ward > 0 || Object.keys(near.ail).length > 0;
    rows.push({ id: sk.id, name: sk.name, used, cdSet, blocked, recovered, didSomething });
  }
  const bad = rows.filter(r => !(r.used && r.cdSet > 0 && r.blocked && r.recovered && r.didSomething));
  console.log("스킬        :", ok(bad.length === 0),
    rows.length + "종 · " + rows.map(r => r.name).join(" · "));
  bad.forEach(r => console.log("   ✘ " + r.name + " " + JSON.stringify(r)));
}

// 10) 레벨업 선택 — 3개가 나오고, 고르면 실제로 반영되는가
{
  const g = new Game("warrior");
  g.reset(9001, "warrior");
  g.offerPerks();
  const count = g.pendingPerks ? g.pendingPerks.length : 0;
  /* ⚠ 일부 수치만 더해 비교하면 "금화 획득 +30%" 같은 선택에서 변화가 0 으로 나온다 —
   *   그것도 유효한 선택이므로 능력치 전체와 스킬 목록을 함께 본다.
   * ⚠ **유물을 빠뜨리면 안 된다.** 유물은 규칙을 바꾸므로 대부분 stats() 가 그대로다 —
   *   유물이 선택지에 섞이기 시작하자 이 검사가 "고른 뒤 변화 없음" 으로 빨개졌다.
   *   제품이 아니라 검사의 전제가 낡은 것이었다(데모 계정으로 관문을 재던 것과 같은 종류). */
  const snap = () => JSON.stringify(g.stats()) + "|" + JSON.stringify(g.player.skills) +
                     "|" + JSON.stringify(g.player.relics || []);
  const kind = g.pendingPerks && g.pendingPerks[0] ? g.pendingPerks[0].what : "?";
  const before = snap();
  g.choosePerk(0);
  const after = snap();
  const closed = !g.pendingPerks;
  console.log("레벨업 선택 :", ok(count === 3 && after !== before && closed),
    count + "개 제시 · 첫 칸은 " + kind + " · 고른 뒤 변화 " + (after !== before ? "있음" : "없음") +
    " · 창 " + (closed ? "닫힘" : "⚠열림"));

  /* 세 갈래(능력치·스킬·유물)가 **전부** 반영되는지 따로 본다 —
   * 한 갈래만 골라 확인하면 나머지가 조용히 죽어도 모른다. */
  {
    const kinds = { perk: 0, skillnew: 0, skillup: 0, relic: 0 };
    let applied = 0, tried = 0;
    for (let s = 0; s < 120; s++) {
      const gg = new Game("warrior");
      gg.reset((s * 31337 + 7) >>> 0, "warrior");
      gg.offerPerks();
      if (!gg.pendingPerks) continue;
      const c0 = gg.pendingPerks[0];
      kinds[c0.what] = (kinds[c0.what] || 0) + 1;
      const s0 = JSON.stringify(gg.stats()) + JSON.stringify(gg.player.skills) +
                 JSON.stringify(gg.player.relics || []);
      gg.choosePerk(0);
      const s1 = JSON.stringify(gg.stats()) + JSON.stringify(gg.player.skills) +
                 JSON.stringify(gg.player.relics || []);
      tried++;
      if (s1 !== s0) applied++;
    }
    console.log("  선택 반영 :", ok(applied === tried && kinds.relic > 0 && kinds.perk > 0),
      tried + "회 중 반영 " + applied + " · 갈래별 " +
      Object.keys(kinds).map(k => k + " " + kinds[k]).join(" · "));
  }
}

// 11) 상점 — 물건이 차고, 사면 금화가 줄고 물건이 들어오는가
{
  const g = new Game("rogue");
  g.reset(4711, "rogue");
  g.depth = 4;
  const stock = g.rollShop(4);
  g.shop = stock;
  g.gold = 99999;
  const bagBefore = g.player.inventory.length, skillsBefore = g.player.skills.length;
  let boughtItem = false, boughtSkill = false;
  for (let i = 0; i < stock.length; i++) {
    const before = g.gold;
    if (g.buy(i) && g.gold < before) {
      if (stock[i].what === "skill") boughtSkill = true; else boughtItem = true;
    }
  }
  const sellBefore = g.gold;
  const sold = g.player.inventory.length ? g.sell(0) : false;
  console.log("상점        :", ok(stock.length >= 5 && boughtItem && g.gold > 0),
    stock.length + "개 진열 · 물건 구매 " + (boughtItem ? "됨" : "✘") +
    " · 스킬 구매 " + (boughtSkill ? "됨" : "없음(자리 부족일 수 있다)") +
    " · 팔기 " + (sold ? "됨(+" + (g.gold - sellBefore) + ")" : "✘") +
    " · 가방 " + bagBefore + "→" + g.player.inventory.length +
    " · 스킬 " + skillsBefore + "→" + g.player.skills.length);
}

// 12) 엘리트 — 나오고, 실제로 더 강한가
{
  const g = new Game("warrior");
  g.reset(1234, "warrior");
  let elites = 0, plain = 0, eliteHp = 0, plainHp = 0;
  for (let depth = 5; depth <= 9; depth++) {
    g.depth = depth;
    for (let i = 0; i < 400; i++) {
      const m = g.spawn(DATA.byId(DATA.MONSTERS, "orc"), 1, 1);
      if (m.elite) { elites++; eliteHp += m.hp; } else { plain++; plainHp += m.hp; }
    }
  }
  const ratio = (eliteHp / Math.max(1, elites)) / (plainHp / Math.max(1, plain));
  console.log("엘리트      :", ok(elites > 0 && ratio > 1.3),
    "2000마리 중 " + elites + "마리(" + (elites / 20).toFixed(1) + "%) · 체력 배수 " + ratio.toFixed(2) + "배");
}

// 13) 무작위 조작 내구 — 예외 0 (직업·스킬·상점을 돌려 가며)
{
  let crashes = 0;
  const CLS = DATA.CLASSES.map(c => c.id);
  for (let run = 0; run < 120; run++) {
    try {
      const g = new Game(CLS[run % CLS.length]);
      g.reset((run * 7919 + 13) >>> 0, CLS[run % CLS.length]);
      for (let t = 0; t < 1400 && !g.over; t++) {
        if (g.pendingPerks) { g.choosePerk((Math.random() * 3) | 0); continue; }
        if (g.shop) {
          if (Math.random() < 0.5) g.buy((Math.random() * g.shop.length) | 0);
          else g.closeShop();
          continue;
        }
        const r = Math.random();
        if (r < 0.05) g.pickUp();
        else if (r < 0.08) g.descendIfStairs();
        else if (r < 0.14) g.useSkill((Math.random() * 4) | 0);
        else if (r < 0.17) g.shoot();
        else if (r < 0.21 && g.player.inventory.length) g.useItem((Math.random() * g.player.inventory.length) | 0);
        else if (r < 0.23 && g.player.inventory.length) g.dropItem((Math.random() * g.player.inventory.length) | 0);
        else { const d = DIRS[(Math.random() * DIRS.length) | 0]; g.move(d[0], d[1]); }
      }
    } catch (e) { crashes++; if (crashes < 4) console.log("   예외:", e.message, "\n     " + (e.stack || "").split("\n")[1]); }
  }
  console.log("무작위 내구 :", ok(crashes === 0), "120판 · 예외 " + crashes + "건");
}

// 13-a) 몬스터 행동 — 속도 · 원거리 · 도망 · 소환이 실제로 도는가.
/* ⚠ 표에 spd: 150 이라고 적혀 있는 것은 통과가 아니다. 세워 놓고 몇 대 맞는지
 *   세야 에너지가 도는지 알 수 있다. 그리고 **도망에 끝이 있는지**를 꼭 본다 —
 *   끝없이 달아나면 같은 속도라 영영 못 잡아 판이 안 끝난다(실측 120판 중 55판). */
{
  const rm = spawnSync(process.execPath, [path.join(ROOT, "tools", "mob-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (rm.stdout.match(/✘/g) || []).length;
  if (rm.status !== 0) fails++;
  console.log("몬스터 행동 :", ok(rm.status === 0),
    (bad ? "문제 " + bad + "건" : (rm.stdout.match(/✔/g) || []).length + "개 항목 통과") + why(rm));
  if (bad) rm.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 13-b) 붙었다 떨어지는 춤 — 0 피해로 쿨다운을 돌릴 수 있는가.
/* ⚠ **밸런스 검사가 이것을 못 잡는다.** 아래 AI 는 붙으면 반드시 때리고 물러나는
 *   일이 없어서, 기회 공격을 넣기 전후로 360판 결과가 소수점까지 같았다. 사람은
 *   물러난다 — 그래서 따로 돌린다. 값은 tools/kite-check.mjs 안에 적혀 있다. */
{
  const rk = spawnSync(process.execPath, [path.join(ROOT, "tools", "kite-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const lines = rk.stdout.split(String.fromCharCode(10));
  const pick = (head) => (lines.find(l => l.startsWith(head)) || "").split(":").slice(1).join(":").trim();
  if (rk.status !== 0) fails++;
  console.log("붙었다 떨어지기:", ok(rk.status === 0),
    [pick("춤이 공짜인가"), pick("도망 값"), pick("때릴 때")].filter(Boolean).join(" · "));
  if (rk.status !== 0) lines.filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 14) 밸런스 — 빌드를 쌓으며 내려가는 AI 의 직업별 승률
/* 상인은 길을 막지 않는다(밟으면 들어가면서 상점이 열린다) — 그래서 여기서도
 * 특별 취급하지 않는다. 예전에 상인을 막았을 때는 상인이 유일한 통로를 가로막는
 * 배치에서 길을 못 찾아 갇혔다. */
function bfsStep(g, sx, sy, targets) {
  const lv = g.level, Wd = lv.w;
  const goal = new Set(targets.map(t => t.y * Wd + t.x));
  if (!goal.size) return null;
  const prev = new Int32Array(lv.w * lv.h).fill(-1);
  const start = sy * Wd + sx;
  prev[start] = start;
  const q = [start]; let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (goal.has(cur) && cur !== start) {
      let n = cur; while (prev[n] !== start) n = prev[n];
      return [(n % Wd) - sx, ((n / Wd) | 0) - sy];
    }
    const cx = cur % Wd, cy = (cur / Wd) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!lv.inside(nx, ny) || lv.blocked(nx, ny)) continue;
      const id = ny * Wd + nx;
      if (prev[id] !== -1) continue;
      prev[id] = cur; q.push(id);
    }
  }
  return null;
}

/* 사람처럼 두는 AI. 빌드 시스템이 붙었으니 그것도 쓴다:
 *   · 레벨업은 **공격 계열**로 민다(사람도 대개 그렇게 한다)
 *   · 상인을 만나면 살 수 있는 것을 산다
 *   · 스킬은 쿨이 돌면 쓴다
 *   · 모르는 물약은 안전할 때만 시험한다(독이 섞여 있다) */
const PERK_PREF = ["p_atk", "p_crit", "p_cdmg", "p_skill", "p_hp", "p_def"];
function play(seed, clsId) {
  const g = new Game(clsId);
  g.reset(seed, clsId);
  const inv = pred => g.player.inventory.findIndex(pred);
  const skip = new Set();
  /* ⚠ 상점을 닫고 또 걸어가면 무한 순환이 된다(상인에게 걸어 들어가는 것은 턴을
   *   쓰지 않으므로 턴이 안 늘고 영원히 돈다 — 실측: 40판 전부 미결).
   *   한 층에 한 번만 본다. */
  const shopped = new Set();
  /* ⚠ "안 쓰기로 했다" 도 기억해야 한다. used 만 보면 지나치기로 한 제단을
   *   다시 목표로 삼아 밟고 닫기를 끝없이 반복한다 — 실측 360판 중 57판이
   *   그렇게 안 끝났다. 상인에서 겪은 것과 같은 왕복이다. */
  const altared = new Set();
  let t = 0, stuck = 0;

  while (!g.over && t < 60000) {
    t++;

    /* 레벨업 — 선호 순서대로, 없으면 새 스킬, 없으면 첫 번째 */
    if (g.pendingPerks) {
      let idx = -1;
      /* ⚠ 특화는 **판마다 갈아 가며** 고른다. 늘 첫 칸을 고르면 둘째 갈래가
       *   한 번도 안 돌아 밸런스에 안 잡힌다(새 선택지를 넣을 때마다 겪는 일이다). */
      if (g.pendingPerks.every(c => c.what === "spec")) {
        g.choosePerk(seed % g.pendingPerks.length);
        continue;
      }
      for (const want of PERK_PREF) {
        idx = g.pendingPerks.findIndex(c => c.what === "perk" && c.perk.id === want);
        if (idx >= 0) break;
      }
      if (idx < 0) idx = g.pendingPerks.findIndex(c => c.what === "skillnew");
      if (idx < 0) idx = 0;
      g.choosePerk(idx);
      continue;
    }

    /* 상점 — 살 수 있는 것을 다 사고 닫는다 */
    if (g.shop) {
      let bought = false;
      for (let i = 0; i < g.shop.length; i++) {
        const row = g.shop[i];
        if (row.sold || g.gold < row.cost) continue;
        if (g.buy(i)) { bought = true; break; }
      }
      if (!bought) { shopped.add(g.depth); g.closeShop(); }
      continue;
    }

    /* 제단 — **새 선택지는 AI 에게도 가르쳐야 한다.** 안 가르치면 사람은 쓰는데
     * 밸런스에는 한 번도 안 잡힌다(깊은 계단·특화·저주받은 장비에서 세 번 겪었다).
     * 사람이 할 법한 순서로 고른다: 저주가 제일 급하고, 등급을 무기로 옮기는
     * 것이 다음이고, 금화가 남으면 담금질, 그것도 아니면 맹세. */
    if (g.altarPanel) {
      const row = id => g.altarPanel.find(r => r.id === id && !r.poor);
      const ab = row("absolve"), sw = row("swap"), tp = row("temper"), oa = row("oath");
      /* 치환은 **더 좋은 등급이 무기가 아닌 자리에 붙어 있을 때만** 뜻이 있다.
       * 무기에 이미 붙어 있으면 바꾸는 순간 손해다. */
      const swapWorth = sw && sw.a !== "weapon";
      /* MB_ALTAR 로 정책을 갈아끼운다 — **대조군을 돌리려고** 둔 문이다.
       *   none: 늘 지나친다 / oath: 맹세만 / 기본: 사람이 할 법한 순서 */
      const POL = process.env.MB_ALTAR || "";
      if (POL === "none") { altared.add(g.depth); g.closeAltar(); continue; }
      if (POL === "oath") { if (oa) g.useAltar("oath"); else { altared.add(g.depth); g.closeAltar(); } continue; }
      const noOath = POL === "noath";
      if (ab) g.useAltar("absolve");
      else if (swapWorth) g.useAltar("swap");
      else if (tp && g.gold >= tp.cost + 150) g.useAltar("temper");
      else if (oa && !noOath && g.player.hp / g.maxhp() > 0.75 && g.depth <= 6) g.useAltar("oath");
      else { altared.add(g.depth); g.closeAltar(); }
      continue;
    }

    const p = g.player, lv = g.level, hurt = p.hp / g.maxhp();

    /* 상태이상이 심하면 씻는다 */
    if ((p.ail.poison || p.ail.bleed) && hurt < 0.5) {
      const ci = inv(it => g.identified[it.id] && it.effect === "cure");
      if (ci >= 0) { g.useItem(ci); continue; }
    }
    if (hurt < 0.45) {
      let i = inv(it => g.identified[it.id] && it.effect === "heal" && it.power >= 60);
      if (i < 0 || hurt > 0.25) { const j = inv(it => g.identified[it.id] && it.effect === "heal"); if (j >= 0) i = j; }
      if (i >= 0) { g.useItem(i); continue; }
      /* 회복 스킬 */
      const hs = p.skills.findIndex(s => s.cd <= 0 && DATA.byId(DATA.SKILLS, s.id).kind === "heal");
      if (hs >= 0 && g.useSkill(hs) !== false) continue;
    }

    let adj = null;
    for (const d of DIRS) { const m = g.monsterAt(p.x + d[0], p.y + d[1]); if (m) { adj = { d, m }; break; } }
    const near = g.nearestVisible();

    /* 스킬 — 쿨이 돌고 쓸 자리가 있으면 쓴다 */
    let usedSkill = false;
    for (let si = 0; si < p.skills.length; si++) {
      const s = p.skills[si];
      if (s.cd > 0) continue;
      const def = DATA.byId(DATA.SKILLS, s.id);
      let worth = false;
      if (def.kind === "cleave") worth = g.monsters.some(m => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1);
      else if (def.kind === "blast" || def.kind === "quake" || def.kind === "ail")
        worth = g.monsters.some(m => Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= def.range);
      else if (def.kind === "throw" || def.kind === "drain" || def.kind === "charge")
        worth = near && (Math.abs(near.x - p.x) + Math.abs(near.y - p.y)) <= def.range;
      else if (def.kind === "snipe") worth = !!g.farthestVisible(def.range);
      else if (def.kind === "ward") worth = !!adj && hurt < 0.7;
      else if (def.kind === "heal") worth = hurt < 0.5;
      if (worth && g.useSkill(si) !== false) { usedSkill = true; break; }
    }
    if (usedSkill) continue;

    /* 저주받은 장비 — **사람은 값이 크면 낀다.** 시뮬도 그래야 그 선택지가
     *   밸런스에 잡힌다. 안 끼면 저주받은 것이 그냥 없어진 전리품이 되어
     *   승률이 통째로 내려앉는다(실측 −7.4%p — 제품이 아니라 AI 탓이었다).
     * ⚠ 한 번 끼면 그 칸이 잠기므로 **확실히 나을 때만**(25% 넘게) 낀다.
     *   사람도 그 정도는 재고 낀다. */
    {
      const ci = p.inventory.findIndex(it => it.cursed && it.slot && !g.slotLocked(it.slot) &&
        (!p[it.slot] || g.gearScore(it) > g.gearScore(p[it.slot]) * 1.25));
      if (ci >= 0) { g.useItem(ci); continue; }
    }

    /* 활 — 붙기 전에 쏜다 */
    if (p.weapon && p.weapon.ranged && !adj && near) {
      if (g.shoot() !== false) continue;
    }

    if (hurt < 0.35 && adj) {
      let i = inv(it => it.effect === "fire");
      if (i < 0) i = inv(it => it.effect === "bolt");
      if (i < 0 && hurt < 0.2) i = inv(it => it.effect === "blink");
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (adj) { g.move(adj.d[0], adj.d[1]); continue; }

    /* 안전할 때 모르는 물약을 하나 시험한다 — 독일 수 있으니 체력이 넉넉할 때만 */
    if (hurt > 0.8 && !g.monsters.some(m => g.isVisible(m.x, m.y))) {
      const i = inv(it => it.kind === "potion" && !g.identified[it.id]);
      if (i >= 0) { g.useItem(i); continue; }
    }

    if (g.itemAt(p.x, p.y)) {
      if (p.inventory.length >= DATA.BAG_MAX) skip.add(g.depth + ":" + p.x + "," + p.y);
      else { g.pickUp(); continue; }
    }

    const key = it => g.depth + ":" + it.x + "," + it.y;
    const desperate = hurt < 0.3 && inv(it => g.identified[it.id] && it.effect === "heal") < 0;
    let goals, toStairs = false;
    /* 어느 계단으로 갈까 — **체력이 넉넉하면 깊은 쪽**을 고른다. 사람이 하는
     *   판단을 그대로 흉내 낸다. 한쪽만 쓰면 그 선택지가 밸런스에 안 잡힌다. */
    const wantDeep = lv.deepAt && hurt > 0.7 && g.depth < DATA.MAX_DEPTH - 1;
    const exit = wantDeep ? lv.deepAt : lv.downAt;
    if (desperate && g.depth < DATA.MAX_DEPTH) { goals = [lv.downAt]; toStairs = true; }
    else if (g.merchant && g.gold >= 60 && !shopped.has(g.depth)) goals = [g.merchant];
    /* ⚠ 다 쓴 제단으로는 안 간다. 안 걸러 두면 같은 칸을 계속 목표로 삼아
     *   층을 못 벗어난다(상인에서 이미 겪은 무한 왕복이다). */
    else if (g.altar && !g.altar.used && !altared.has(g.depth)) goals = [g.altar];
    else if (g.items.some(it => !skip.has(key(it)))) goals = g.items.filter(it => !skip.has(key(it)));
    else if (g.monsters.length) goals = g.monsters;
    else { goals = [exit]; toStairs = true; }
    if (toStairs && g.isStairs(p.x, p.y)) { if (g.descendIfStairs()) { stuck = 0; continue; } }

    const step = bfsStep(g, p.x, p.y, goals);
    if (!step) {
      const s2 = bfsStep(g, p.x, p.y, [lv.downAt]);
      if (s2) { g.move(s2[0], s2[1]); continue; }
      if (++stuck > 30) break;
      g.wait(); continue;
    }
    if (!g.move(step[0], step[1])) { if (++stuck > 30) break; g.wait(); } else stuck = 0;
  }
  return g;
}

//  기준: 직업마다 승률 30~70%. 이보다 높으면 긴장이 없고, 낮으면 사람은 못 깬다.
//  그리고 직업 사이 격차가 28%p 를 넘으면 안 된다 — 넘으면 "센 직업" 하나만 고르게 된다.
//  ⚠ 빌드 자유도가 생긴 뒤로는 직업보다 **선택**이 승률을 가른다. 폭을 조금 넓게 잡는다.
console.log("\n── 밸런스 (빌드를 쌓으며 내려가는 AI · " + N + "판/직업) ──");
const rates = [];
/* ⚠ 직업 평균만 보면 **한 갈래가 죽어 있어도 안 보인다.** 둘을 반반 고르므로
 *   한쪽이 0% 여도 다른 쪽이 두 배면 평균이 그대로다. 갈래별로 나눠 센다.
 * ⚠ 따로 한 번 더 돌리지 않는다 — 같은 판을 두 번 돌리면 밸런스 검사 시간이
 *   그대로 두 배가 된다. 본 루프에서 같이 센다. */
const specRows = [];
for (const c of DATA.CLASSES) {
  let wins = 0, unresolved = 0;
  const specs = DATA.SPECS[c.id] || [];
  const tally = specs.map(sp => ({ name: sp.name, win: 0, n: 0 }));
  const dd = {}, depths = [], scores = [], lv = [], crit = [];
  for (let i = 0; i < N; i++) {
    const g = play((i * 104729 + 7) >>> 0, c.id);
    depths.push(g.depth); scores.push(g.score()); lv.push(g.player.level);
    crit.push(g.stats().crit);
    if (g.won) wins++;
    else if (g.over) dd[g.depth] = (dd[g.depth] || 0) + 1;
    else unresolved++;
    const sk = specs.findIndex(sp => sp.id === g.player.spec);
    if (sk >= 0) { tally[sk].n++; if (g.won) tally[sk].win++; }
  }
  specRows.push({ cls: c.name, tally: tally });
  const rate = wins / N * 100;
  rates.push(rate);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const pre = Object.keys(dd).filter(k => +k < DATA.MAX_DEPTH).reduce((a, k) => a + dd[k], 0);
  console.log(c.name.padEnd(9), ok(rate >= 30 && rate <= 70 && unresolved === 0),
    ("승률 " + rate.toFixed(1) + "%").padEnd(12) +
    "평균 " + avg(depths).toFixed(2) + "층 · Lv." + avg(lv).toFixed(1) +
    " · 치명 " + Math.round(avg(crit) * 100) + "%" +
    " · 점수 " + Math.round(avg(scores)).toLocaleString() +
    " · 보스 전 사망 " + pre + " · 보스층 " + (dd[DATA.MAX_DEPTH] || 0) +
    (unresolved ? " · ⚠미결 " + unresolved : ""));
}
{
  let worst = 0;
  for (const r of specRows) {
    if (!r.tally.length) continue;
    const line = r.tally.map(t => t.name + " " + (t.n ? (t.win / t.n * 100).toFixed(0) : "?") +
      "%(" + t.n + "판)").join(" · ");
    console.log("  " + r.cls.padEnd(8), line);
    const pcts = r.tally.filter(t => t.n >= 10).map(t => t.win / t.n * 100);
    if (pcts.length > 1) worst = Math.max(worst, Math.max(...pcts) - Math.min(...pcts));
  }
  console.log("특화 격차   :", ok(worst <= 25), worst.toFixed(1) + "%p (25%p 이하여야 한다)");
}

const gap = Math.max(...rates) - Math.min(...rates);
console.log("직업 격차   :", ok(gap <= 28), gap.toFixed(1) + "%p (28%p 이하여야 한다)");

// ── 화면 ──
console.log("\n── 화면 (실제 Chrome) ──");
const SCREENS = [
  ["데스크톱 1440×900", ["--w", "1440", "--h", "900"]],
  ["노트북 1280×720", ["--w", "1280", "--h", "720"]],
  ["아이폰 390×844", ["--touch", "--w", "390", "--h", "844"]],
  ["태블릿 820×1180", ["--touch", "--w", "820", "--h", "1180"]],
  ["도적 1440×900", ["--cls", "rogue", "--w", "1440", "--h", "900"]],
  ["마법사 1440×900", ["--cls", "mage", "--w", "1440", "--h", "900"]]
];
for (const [label, args] of SCREENS) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "check.mjs"), ...args],
    { encoding: "utf8", cwd: ROOT });
  const bad = (r.stdout.match(/✘/g) || []).length;
  console.log(label.padEnd(20), ok(r.status === 0), (bad ? "문제 " + bad + "건" : "통과") + why(r));
  if (bad) r.stdout.split("\n").filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 부드러운 이동
{
  const ra = spawnSync(process.execPath, [path.join(ROOT, "tools", "anim-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (ra.stdout.match(/✘/g) || []).length;
  console.log("부드러운 이동".padEnd(20), ok(ra.status === 0), (bad ? "문제 " + bad + "건" : "통과") + why(ra));
  if (bad) ra.stdout.split("\n").filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 하루의 장부 — 하루 한 번 잠금은 화면·저장·모드가 함께 맞아야 성립한다.
// ⚠ 논리 검사(위의 "일일 씨앗")는 씨앗이 같다는 것까지만 본다. 새로고침으로 다시
//   시작할 수 있는 구멍이 실제로 있었고, 그건 브라우저에서만 잡힌다.
{
  const rd = spawnSync(process.execPath, [path.join(ROOT, "tools", "daily-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (rd.stdout.match(/✘/g) || []).length;
  if (rd.status !== 0) fails++;
  console.log("하루의 장부".padEnd(20), ok(rd.status === 0),
    (bad ? "문제 " + bad + "건" : (rd.stdout.match(/✔/g) || []).length + "개 항목 통과") + why(rd));
  if (bad) rd.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 구역 장식이 바닥에 묻히지 않는가 — 팔레트를 만질 때마다 다시 잰다
{
  const rz = spawnSync(process.execPath, [path.join(ROOT, "tools", "deco-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (rz.stdout.match(/✘/g) || []).length;
  if (rz.status !== 0) fails++;
  const line = rz.stdout.split(String.fromCharCode(10)).find(l => l.startsWith("묻히는 장식")) || "";
  console.log("장식 대비".padEnd(20), ok(rz.status === 0),
    (line.replace(/^묻히는 장식s*[✔✘]?s*/, "묻히는 것 ") || ("문제 " + bad + "건")) + why(rz));
  if (bad) rz.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 타격감 — 연출이 실제로 캔버스에 그려지는가(무기별 궤적 · 숫자 · 섬광 · 색 · 히트스톱)
{
  const rf = spawnSync(process.execPath, [path.join(ROOT, "tools", "fx-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (rf.stdout.match(/✘/g) || []).length;
  if (rf.status !== 0) fails++;
  console.log("타격감".padEnd(20), ok(rf.status === 0),
    (bad ? "문제 " + bad + "건" : (rf.stdout.match(/✔/g) || []).length + "개 항목 통과") + why(rf));
  if (bad) rf.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 장비 창 · 유물 표시 — 휴대폰에서 장비를 볼 수 있는가, 그리고 턴을 안 쓰는가
{
  const rg = spawnSync(process.execPath, [path.join(ROOT, "tools", "gear-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (rg.stdout.match(/✘/g) || []).length;
  if (rg.status !== 0) fails++;
  console.log("장비 창".padEnd(20), ok(rg.status === 0),
    (bad ? "문제 " + bad + "건" : (rg.stdout.match(/✔/g) || []).length + "개 항목 통과") + why(rg));
  if (bad) rg.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 제단 — 거래 넷이 실제로 돌고, 창이 좁은 화면에서도 눌리는가
{
  const ra = spawnSync(process.execPath, [path.join(ROOT, "tools", "altar-check.mjs")],
    { encoding: "utf8", cwd: ROOT });
  const bad = (ra.stdout.match(/✘/g) || []).length;
  if (ra.status !== 0) fails++;
  console.log("제단".padEnd(20), ok(ra.status === 0),
    (bad ? "문제 " + bad + "건" : (ra.stdout.match(/✔/g) || []).length + "개 항목 통과") + why(ra));
  if (bad) ra.stdout.split(String.fromCharCode(10))
    .filter(l => l.includes("✘")).forEach(l => console.log("   " + l.trim()));
}

// 한 판을 끝까지 밟는다(종료 화면)
const rp = spawnSync(process.execPath, [path.join(ROOT, "tools", "check.mjs"), "--play"],
  { encoding: "utf8", cwd: ROOT });
const endLine = rp.stdout.split("\n").find(l => l.includes("끝까지 진행")) || "";
console.log("끝까지 한 판".padEnd(20), ok(rp.status === 0), endLine.replace(/.*끝까지 진행\s*:\s*/, "").trim() + why(rp));

console.log(fails === 0 ? "\n전부 통과" : "\n✘ 실패 " + fails + "건");
process.exit(fails === 0 ? 0 : 1);
