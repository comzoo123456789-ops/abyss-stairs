/* 하루의 장부 — 일일 던전 + 공유판.
 *
 * 세계관이 장부다: 내려간 사람은 이름이 지워지고 「몇 층까지 갔는가」만 남는다.
 * 그러면 공유판이 곧 **장부 한 줄**이다. 그래서 이 기능은 억지로 붙인 유행이 아니라
 * 세계관이 원래 요구하던 것이다.
 *
 * Rogule(7일 게임잼 작품)이 Wordle 형식을 던전에 붙여 웹에서 터졌고, 만든 사람이
 * 직접 꼽은 성공 요인이 **공유판**이었다. 핵심은 "모두가 같은 던전" 이다 —
 * 씨앗이 사람마다 다르면 비교가 성립하지 않아서 공유할 이유가 없어진다.
 *
 * ⚠ 이 파일은 **DOM 을 건드리지 않는다.** 날짜·씨앗·장부 글자는 순수 함수로 두어
 *   브라우저 없이 검사할 수 있게 한다(tools/verify.mjs 가 여기를 직접 돌린다).
 *   localStorage 를 쓰는 함수만 따로 모아 두고, 막힌 브라우저에서도 죽지 않는다.
 */
(function (global) {
  "use strict";

  var DAY_MS = 86400000;
  var MAX_KEEP = 60;            /* 내 장부는 60일만 남긴다 — 더 쌓아도 아무도 안 본다 */

  /* ── 날짜 ─────────────────────────────────────────────
   *
   * ⚠ 기준 시간대를 **한국(UTC+9)으로 못박는다.** 브라우저 시간대에 맡기면 같은
   *   날짜에 사람마다 다른 던전이 나와 "모두가 같은 던전" 이 깨진다. 그리고
   *   시간대를 옮겨 다니며 하루를 여러 번 도는 것도 막힌다.
   * ⚠ Date 의 지역 함수(getFullYear 등)를 쓰면 안 된다 — 그게 곧 브라우저 시간대다.
   *   UTC 로 9시간을 더한 뒤 getUTC* 로 읽는다. */
  function dayKey(now) {
    var t = (now === undefined ? Date.now() : now);
    var d = new Date(t + 9 * 3600000);
    var mm = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (mm < 10 ? "0" : "") + mm + "-" + (dd < 10 ? "0" : "") + dd;
  }

  /* 사람에게 보여 줄 날짜 */
  function dayLabel(key) {
    var p = String(key).split("-");
    if (p.length !== 3) return String(key);
    return parseInt(p[1], 10) + "월 " + parseInt(p[2], 10) + "일";
  }

  /* 다음 날까지 남은 시간(밀리초). "내일 다시" 를 시각으로 보여 준다. */
  function msUntilNextDay(now) {
    var t = (now === undefined ? Date.now() : now);
    var kst = t + 9 * 3600000;
    return DAY_MS - (kst % DAY_MS);
  }

  function untilText(ms) {
    var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    if (h > 0) return h + "시간 " + m + "분";
    return Math.max(1, m) + "분";
  }

  /* ── 씨앗 ─────────────────────────────────────────────
   *
   * 날짜 글자 → 32비트 씨앗. FNV-1a 를 쓴다(짧고, 한 글자만 달라도 값이 확 바뀐다).
   * ⚠ 날짜를 그대로 숫자로 쓰면(20260918) 인접한 날의 던전이 닮는다 — 씨앗 RNG 가
   *   낮은 비트부터 쓰기 때문이다. 반드시 흩어 놓는다. */
  function seedOf(key) {
    var h = 0x811c9dc5;
    var s = "abyss:" + key;                  /* 접두어 — 다른 게임과 같은 씨앗이 되지 않게 */
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    /* 마지막으로 한 번 더 섞는다(xorshift 마무리) */
    h ^= h >>> 15; h = (h * 0x2545f491) >>> 0; h ^= h >>> 13;
    return h >>> 0;
  }

  function seedToday(now) { return seedOf(dayKey(now)); }

  /* ── 장부 한 줄 ───────────────────────────────────────
   *
   * 10층을 칸 10개로 그린다. 지나온 층은 채우고, 마지막 칸은 군주다.
   * ⚠ 이모지는 **플랫폼마다 있는 것만** 쓴다(🟨 ⬛ 🟥 👑). 없는 글자를 쓰면
   *   어떤 기기에서는 두부(□)로 붙여지고, 그건 공유판이 통째로 망가지는 것이다.
   */
  function blocks(depth, won, maxDepth) {
    var max = maxDepth || 10;
    var out = "";
    for (var i = 1; i <= max; i++) {
      if (i === max) out += won ? "👑" : (i <= depth ? "🟥" : "⬛");
      else out += (i <= depth ? "🟨" : "⬛");
    }
    return out;
  }

  /* 공유할 글자. r = { day, cls, depth, won, score, kills, crit, level, turn, url }
   *
   * ⚠ 다섯 줄을 넘기지 않는다. 카톡·디스코드에서 길면 접히고, 접힌 공유판은
   *   아무도 안 펴 본다(Wordle 이 세 줄인 이유다).
   * ⚠ 점수를 맨 위에 두지 않는다. 우리 장부에 남는 것은 **몇 층까지 갔는가** 다 —
   *   세계관과 공유판이 같은 말을 해야 한다. */
  function shareText(r) {
    /* 자유 탐사도 공유할 수 있다. 머리글만 다르다 — "모두 같은 던전" 이 아닌 판을
     * 「N월 N일의 장부」 라고 적으면 거짓이 된다. 씨앗을 함께 적어 같은 던전을
     * 다시 만들 수 있게 둔다. */
    var head = (r.mode === "free")
      ? "심연의 계단 · 자유 탐사 (씨앗 #" + (r.seed >>> 0).toString(16).toUpperCase() + ")"
      : "심연의 계단 · " + dayLabel(r.day) + "의 장부";
    /* ⚠ 중단한 판을 "지워졌다" 라고 적으면 거짓이다 — 죽은 것이 아니라 그만둔 것이다. */
    var line = r.cls + " · " + (r.won ? "10층 군주를 쓰러뜨렸다"
      : (r.open ? (r.depth || 0) + "층에서 멈췄다 (중단)" : r.depth + "층에서 지워졌다"));
    var bar = blocks(r.depth, r.won, r.maxDepth);
    var tail = "치명 " + Math.round((r.crit || 0) * 100) + "% · 처치 " + (r.kills || 0) +
               "체 · " + (r.score || 0).toLocaleString() + "점";
    var out = head + "\n" + line + "\n" + bar + "\n" + tail;
    if (r.url) out += "\n" + r.url;
    return out;
  }

  /* ── 저장 ─────────────────────────────────────────────
   *
   * ⚠ localStorage 는 **막힐 수 있다**(시크릿 모드·저장 차단). 읽기·쓰기를 전부
   *   try 로 감싸고, 실패하면 "오늘 안 했다" 로 본다 — 못 하게 막는 것보다 낫다.
   * ⚠ 이 잠금은 **브라우저 안에서만** 유효하다. 지우면 다시 할 수 있다. 서버로 막으려면
   *   계정이 필요하고, 그건 순위표를 만들 때 함께 할 일이다(지금은 이르다 —
   *   점수를 브라우저가 계산하므로 서버로 옮겨도 위조를 못 막는다).
   */
  var KEY_LEDGER = "rl_ledger";

  function readLedger() {
    try {
      var raw = localStorage.getItem(KEY_LEDGER);
      if (!raw) return [];
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (err) { return []; }
  }

  function writeLedger(list) {
    try { localStorage.setItem(KEY_LEDGER, JSON.stringify(list.slice(0, MAX_KEEP))); }
    catch (err) { /* 저장이 막힌 브라우저 — 이번 판만 기억하지 못할 뿐이다 */ }
  }

  function entryFor(key) {
    var list = readLedger();
    for (var i = 0; i < list.length; i++) if (list[i].day === key) return list[i];
    return null;
  }

  function doneToday(now) { return !!entryFor(dayKey(now)); }

  /* ⚠ **오늘 몫은 '시작할 때' 쓴다.** 끝날 때 적으면 구멍이 생긴다 —
   *   판이 나쁘게 흘러갈 때 새로고침하고 다시 시작하면 되므로 "하루 한 번" 이
   *   말뿐이 된다(실제로 그 상태였고 검사로 잡았다). 그래서 시작하면서 자리를
   *   먼저 잡아 두고(begin), 끝날 때 그 자리를 채운다(finish).
   * ⚠ 대신 **중단한 판도 장부에 남는다.** 그게 이 약속의 대가다 — 화면에서
   *   시작 전에 분명히 알린다("시작하면 오늘 몫을 쓴다"). */
  function begin(r) {
    var list = readLedger();
    for (var i = 0; i < list.length; i++) if (list[i].day === r.day) return list[i];
    var entry = {};
    for (var k in r) entry[k] = r[k];
    entry.open = true;                 /* 아직 안 끝난 판 */
    list.unshift(entry);
    list.sort(function (a, b) { return a.day < b.day ? 1 : (a.day > b.day ? -1 : 0); });
    writeLedger(list);
    return entry;
  }

  /* 끝난 결과로 오늘 자리를 채운다.
   * ⚠ **이미 닫힌 자리는 건드리지 않는다.** 안 막으면 끝낸 뒤 판을 또 만들어
   *   좋은 기록으로 갈아치울 수 있다. */
  function finish(r) {
    var list = readLedger();
    for (var i = 0; i < list.length; i++) {
      if (list[i].day !== r.day) continue;
      if (!list[i].open) return list[i];          /* 이미 닫혔다 */
      for (var k in r) list[i][k] = r[k];
      list[i].open = false;
      writeLedger(list);
      return list[i];
    }
    /* 자리가 없다(일일이 아닌 판) — 아무 것도 안 한다 */
    return null;
  }

  /* 옛 이름 — 한 번에 잡고 닫는다(자유 탐사 기록 등) */
  function record(r) {
    var e = begin(r);
    return finish(r) || e;
  }

  /* 연속 기록 — 어제까지 이어져 있으면 센다. 오늘 안 했어도 어제 했으면 살아 있다. */
  function streak(now) {
    var list = readLedger();
    if (!list.length) return 0;
    var have = {};
    for (var i = 0; i < list.length; i++) have[list[i].day] = 1;
    var t = (now === undefined ? Date.now() : now);
    var n = 0;
    if (!have[dayKey(t)]) t -= DAY_MS;              /* 오늘 아직 안 했으면 어제부터 */
    while (have[dayKey(t)]) { n++; t -= DAY_MS; }
    return n;
  }

  global.DAILY = {
    dayKey: dayKey, dayLabel: dayLabel, seedOf: seedOf, seedToday: seedToday,
    blocks: blocks, shareText: shareText,
    msUntilNextDay: msUntilNextDay, untilText: untilText,
    readLedger: readLedger, entryFor: entryFor, doneToday: doneToday,
    record: record, begin: begin, finish: finish, streak: streak, MAX_KEEP: MAX_KEEP
  };
})(typeof window !== "undefined" ? window : globalThis);
