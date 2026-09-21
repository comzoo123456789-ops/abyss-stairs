/* 저장 · 불러오기 — **캐릭터는 영구히 남는다.**
 *
 * 로그라이크는 한 판이 곧 게임이라 저장할 것이 없었다. RPG 는 반대다 —
 * 키우는 것이 목적이므로 저장이 **가장 먼저 믿을 수 있어야 하는 것**이다.
 * 여기가 깨지면 플레이한 시간이 통째로 사라지고, 그건 버그가 아니라 사고다.
 *
 * 규칙 셋:
 *
 * ① **던전은 저장하지 않는다.** 몬스터 위치·던진 화살·떠오르는 숫자까지 담으면
 *    저장이 몇 배로 커지고, 규칙을 고칠 때마다 옛 저장이 깨진다. 남기는 것은
 *    **캐릭터**(레벨·경험치·장비·금화·도달 층)뿐이고 던전은 들어갈 때 다시 만든다.
 *    ⚠ 그래서 "던전 한가운데서 껐다 켜면 마을에서 시작" 이다. 이건 흠이 아니라
 *      디아블로2·패스오브엑자일이 쓰는 방식이다(던전 안 저장은 그 자체로 어뷰징 통로다).
 * ② **판(version)을 적는다.** 안 적으면 저장 모양을 바꾼 날 옛 저장이 조용히
 *    이상한 캐릭터가 된다(레벨 0, 체력 NaN). 판이 다르면 **올리거나 버린다** —
 *    "어떻게든 읽어 본다" 가 가장 나쁘다.
 * ③ **읽은 값은 하나도 믿지 않는다.** localStorage 는 사람이 손으로 고칠 수 있다.
 *    숫자인지·범위 안인지 전부 다시 본다. 이건 치트 방지가 아니라 **깨진 저장으로
 *    게임이 안 켜지는 것**을 막는 것이다(고친 사람은 자기 게임을 고친 것뿐이다).
 *
 * ⚠ 저장은 **묶어서 드문드문** 한다. 맞을 때마다 쓰면 초당 수십 번 쓴다.
 * ⚠ localStorage 가 통째로 막힌 브라우저가 있다(사생활 보호 창·차단 설정).
 *   읽기·쓰기를 전부 try 로 감싸고, 안 되면 **저장 없이 그냥 돌아간다.**
 *   저장이 안 된다고 게임이 안 켜지면 그게 더 나쁘다.
 */
(function (global) {
  "use strict";

  var KEY = "ABYSS_ARPG_V1";
  var VERSION = 1;
  var AUTO_EVERY = 5;        /* 자동 저장 간격(초) — 값이 달라졌을 때만 쓴다 */

  /* 저장할 칸과 그 칸을 **어떻게 검사할지**를 한 곳에 적는다.
   * ⚠ 칸을 늘릴 때 여기만 고치면 저장·불러오기·검사가 함께 따라온다.
   *   세 곳에 나눠 적으면 반드시 한 곳을 빠뜨린다. */
  var FIELDS = {
    name:     { def: "모험가", str: 24 },
    cls:      { def: "warrior", oneOf: ["warrior", "rogue", "mage"] },
    level:    { def: 1, min: 1, max: 99, int: true },
    xp:       { def: 0, min: 0, max: 1e12, int: true },
    gold:     { def: 0, min: 0, max: 1e12, int: true },
    maxDepth: { def: 1, min: 1, max: 30, int: true },   /* 여기까지 내려가 봤다 */
    playSec:  { def: 0, min: 0, max: 1e9 },
    deaths:   { def: 0, min: 0, max: 1e9, int: true },
    born:     { def: 0, min: 0, max: 1e15, int: true }, /* 만든 시각 */
    potions:  { def: 3, min: 0, max: 99, int: true }
  };

  /* 가방 크기. ⚠ 무제한으로 두면 회원이 정리를 안 하고, 저장이 끝없이 커진다.
   *   차면 마을에 다녀오게 만드는 것이 이 숫자의 목적이다. */
  var BAG = 24;
  /* 창고는 가방보다 **한참 커야** 한다. 비슷하면 창고에 넣는 것이 정리가 아니라
   * 또 한 번의 가방 정리가 된다(그러면 아무도 안 쓴다). */
  var STASH = 60;

  function clampNum(v, f) {
    var n = Number(v);
    if (!isFinite(n)) return f.def;
    if (f.int) n = Math.floor(n);
    if (f.min !== undefined && n < f.min) n = f.min;
    if (f.max !== undefined && n > f.max) n = f.max;
    return n;
  }

  /* 낯선 값을 **쓸 수 있는 값**으로 만든다. 절대 예외를 던지지 않는다 —
   * 저장 한 칸이 깨졌다고 게임이 안 켜지면 안 된다. */
  function sanitize(raw) {
    var out = {}, k, f, v;
    raw = (raw && typeof raw === "object") ? raw : {};
    for (k in FIELDS) {
      f = FIELDS[k];
      v = raw[k];
      if (f.oneOf) out[k] = f.oneOf.indexOf(v) >= 0 ? v : f.def;
      else if (f.str) out[k] = (typeof v === "string" && v.length) ? v.slice(0, f.str) : f.def;
      else out[k] = clampNum(v, f);
    }
    /* ── 물건. **다섯 칸으로 다시 만든다**(items.js 의 rebuild).
     * ⚠ 수치를 그대로 믿지 않는다. 표에 없는 베이스·접사는 애초에 만들어지지
     *   않으므로 구조 자체가 검증이다. */
    var I = global.ITEMS;
    out.equip = {};
    out.bag = [];
    out.stash = [];
    if (I) {
      var raw_e = (raw.equip && typeof raw.equip === "object") ? raw.equip : {};
      for (var si = 0; si < I.SLOTS.length; si++) {
        var sl = I.SLOTS[si];
        var it = I.rebuild(raw_e[sl]);
        /* ⚠ **슬롯이 맞는지 다시 본다.** 손으로 고쳐 무기를 반지 칸에 넣으면
         *   화면과 계산이 어긋난다(반지 칸에 장검이 끼워진다). */
        if (it && it.slot === sl) out.equip[sl] = I.pack(it);
      }
      var raw_b = Array.isArray(raw.bag) ? raw.bag : [];
      for (var bi = 0; bi < raw_b.length && out.bag.length < BAG; bi++) {
        var bit = I.rebuild(raw_b[bi]);
        if (bit) out.bag.push(I.pack(bit));
      }
      var raw_s = Array.isArray(raw.stash) ? raw.stash : [];
      for (var xi = 0; xi < raw_s.length && out.stash.length < STASH; xi++) {
        var xit = I.rebuild(raw_s[xi]);
        if (xit) out.stash.push(I.pack(xit));
      }
    }

    /* 서로 어긋난 값 바로잡기 — 칸별로만 보면 못 잡는 종류다 */
    if (out.born <= 0) out.born = Date.now();
    return out;
  }

  /* 저장본(팩된 것) → 쓸 수 있는 물건. 화면·계산은 늘 이쪽을 본다.
   * ⚠ 캐릭터 객체 위에 **캐시해 두지 말 것.** 두 벌이 되면 장착을 바꿨는데
   *   수치가 안 따라오는 일이 생긴다. 장착은 일곱 개뿐이라 매번 만들어도 싸다. */
  function liveEquip(s) {
    var I = global.ITEMS, out = {};
    if (!I || !s || !s.equip) return out;
    for (var i = 0; i < I.SLOTS.length; i++) {
      var it = I.rebuild(s.equip[I.SLOTS[i]]);
      if (it) out[I.SLOTS[i]] = it;
    }
    return out;
  }
  function liveList(arr) {
    var I = global.ITEMS, out = [];
    if (!I || !Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
      var it = I.rebuild(arr[i]);
      if (it) out.push(it);
    }
    return out;
  }
  function liveBag(s) { return liveList(s && s.bag); }
  function liveStash(s) { return liveList(s && s.stash); }

  function blank(cls, name) {
    var s = sanitize({});
    if (cls) s.cls = FIELDS.cls.oneOf.indexOf(cls) >= 0 ? cls : s.cls;
    if (name) s.name = String(name).slice(0, FIELDS.name.str);
    s.born = Date.now();
    return s;
  }

  /* ── 저장소 ─────────────────────────────────────────────
   * ⚠ localStorage 는 **접근만 해도** 던지는 환경이 있다(차단 설정).
   *   있는지 보는 것까지 try 안에 둔다. */
  function store() {
    try {
      var ls = global.localStorage;
      ls.setItem(KEY + ":probe", "1");
      ls.removeItem(KEY + ":probe");
      return ls;
    } catch (e) { return null; }
  }

  function load() {
    var ls = store();
    if (!ls) return { save: blank(), fresh: true, blocked: true };
    var txt;
    try { txt = ls.getItem(KEY); } catch (e) { txt = null; }
    if (!txt) return { save: blank(), fresh: true };
    var raw;
    try { raw = JSON.parse(txt); } catch (e) {
      /* 깨진 글자 — 지우지 말고 **옆에 치워 둔다.** 지워 버리면 되살릴 길이 없다. */
      try { ls.setItem(KEY + ":broken", txt); } catch (e2) {}
      return { save: blank(), fresh: true, broken: true };
    }
    var ver = Number(raw && raw.v);
    if (!isFinite(ver) || ver < 1) return { save: blank(), fresh: true, broken: true };
    if (ver > VERSION) {
      /* 앞선 판의 저장 — **건드리지 않는다.** 내려 읽으려다 망가뜨리면
       * 나중에 새 판으로 돌아가도 못 쓴다. */
      return { save: blank(), fresh: true, future: true };
    }
    var data = upgrade(raw, ver);
    return { save: sanitize(data), fresh: false, from: ver };
  }

  /* 옛 판 → 지금 판. 판이 늘 때마다 한 단씩 쌓는다.
   * ⚠ 한 번에 건너뛰게 쓰지 말 것 — 1→3 을 따로 쓰면 1→2 와 어긋난다. */
  function upgrade(raw, ver) {
    var d = raw.d || raw;
    /* if (ver < 2) { ... ver = 2; } */
    return d;
  }

  var lastText = "";

  function save(s) {
    var ls = store();
    if (!ls) return false;
    var clean = sanitize(s);
    var text = JSON.stringify({ v: VERSION, t: Date.now(), d: clean });
    if (text === lastText) return true;        /* 안 바뀌었으면 안 쓴다 */
    try { ls.setItem(KEY, text); lastText = text; return true; }
    catch (e) { return false; }                /* 꽉 찼거나 막혔다 — 게임은 계속 돈다 */
  }

  function wipe() {
    var ls = store();
    if (!ls) return false;
    try { ls.removeItem(KEY); lastText = ""; return true; } catch (e) { return false; }
  }

  /* ── 성장 ───────────────────────────────────────────────
   * 필요 경험치는 **한 곳에서만** 정한다. 화면에 쓰는 값과 올리는 값이 갈리면
   * "바가 꽉 찼는데 레벨이 안 오른다" 가 된다. */
  function needFor(level) {
    return Math.round(40 * Math.pow(level, 1.55));
  }

  /* 경험치를 준다. 여러 단계가 한 번에 오를 수 있다(보스를 잡으면 실제로 그렇다). */
  function gainXp(s, amount) {
    var got = Math.max(0, Math.floor(amount || 0));
    s.xp += got;
    var ups = 0;
    while (s.level < FIELDS.level.max && s.xp >= needFor(s.level)) {
      s.xp -= needFor(s.level);
      s.level++;
      ups++;
    }
    /* ⚠ 최고 레벨에서 경험치가 끝없이 쌓이면 표시가 바보 같아진다. 거기서 멈춘다. */
    if (s.level >= FIELDS.level.max) s.xp = Math.min(s.xp, needFor(s.level));
    return ups;
  }

  global.SAVE = {
    KEY: KEY, VERSION: VERSION, FIELDS: FIELDS, AUTO_EVERY: AUTO_EVERY,
    load: load, save: save, wipe: wipe, blank: blank, sanitize: sanitize,
    needFor: needFor, gainXp: gainXp,
    BAG: BAG, STASH: STASH,
    liveEquip: liveEquip, liveBag: liveBag, liveStash: liveStash,
    blocked: function () { return !store(); }
  };
})(window);
