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
  /* 쓸 수 있는 직업 — classes.js 가 진실원이다.
   * ⚠ 못 읽을 때만 옛 셋으로 떨어진다. 그 자리에 기사를 적어 넣지 말 것 —
   *   목록을 두 곳에 두면 다음 직업에서 같은 사고가 난다. */
  function clsList() {
    var CL = global.CLASSES;
    if (CL && CL.LIST && CL.LIST.length)
      return CL.LIST.map(function (c) { return c.id; });
    return ["warrior", "rogue", "mage"];
  }

  var FIELDS = {
    name:     { def: "모험가", str: 24 },
    /* ⚠ 직업 목록을 **여기 박지 않는다.** 기사를 더했을 때 이 배열에 없어서
     *   고르는 순간 정리기가 전사로 되돌렸고, 그 빈 전사가 진짜 전사 칸을
     *   덮어썼다 — **키워 둔 저장이 통째로 날아갔다.** 오류는 한 줄도 안 났다.
     * ⚠ 함수로 둔다. save.js 는 classes.js 보다 **먼저** 실리므로(index.html)
     *   선언할 때 읽으면 늘 undefined 다. 부를 때 읽어야 한다. */
    cls:      { def: "warrior", oneOf: clsList },
    level:    { def: 1, min: 1, max: 99, int: true },
    xp:       { def: 0, min: 0, max: 1e12, int: true },
    gold:     { def: 0, min: 0, max: 1e12, int: true },
    maxDepth: { def: 1, min: 1, max: 30, int: true },   /* 여기까지 내려가 봤다 */
    playSec:  { def: 0, min: 0, max: 1e9 },
    deaths:   { def: 0, min: 0, max: 1e9, int: true },
    born:     { def: 0, min: 0, max: 1e15, int: true }, /* 만든 시각 */
    potions:  { def: 3, min: 0, max: 99, int: true },
    points:   { def: 0, min: 0, max: 200, int: true }  /* 안 쓴 재주 점수 */
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
      if (f.oneOf) {
        var allow = (typeof f.oneOf === "function") ? f.oneOf() : f.oneOf;
        out[k] = allow.indexOf(v) >= 0 ? v : f.def;
      }
      else if (f.str) out[k] = (typeof v === "string" && v.length) ? v.slice(0, f.str) : f.def;
      else out[k] = clampNum(v, f);
    }
    /* ── 재료 ── */
    var rawM = (raw.mats && typeof raw.mats === "object") ? raw.mats : {};
    out.mats = {
      m_dust: Math.max(0, Math.min(9999, Math.floor(Number(rawM.m_dust) || 0))),
      m_crystal: Math.max(0, Math.min(9999, Math.floor(Number(rawM.m_crystal) || 0))),
      m_essence: Math.max(0, Math.min(9999, Math.floor(Number(rawM.m_essence) || 0))),
      m_scale: Math.max(0, Math.min(9999, Math.floor(Number(rawM.m_scale) || 0)))
    };

    /* ── 물건. **다섯 칸으로 다시 만든다**(items.js 의 rebuild).
     * ⚠ 수치를 그대로 믿지 않는다. 표에 없는 베이스·접사는 애초에 만들어지지
     *   않으므로 구조 자체가 검증이다. */
    var I = global.ITEMS;
    out.equip = {};
    out.bag = [];
    out.stash = [];

    /* ── 재주. **표에 있는 것만** 남긴다.
     * ⚠ 손으로 고쳐 시너지를 셋 다 켜면 게임이 무너진다 — 스킬마다 **하나**만
     *   받는다(고르는 것이 곧 빌드다. 다 켤 수 있으면 고를 이유가 없다). */
    out.skills = {};
    out.bar = [null, null, null, null, null, null];
    var SK = global.SKILLS;
    if (SK) {
      var rawSk = (raw.skills && typeof raw.skills === "object") ? raw.skills : {};
      for (var ki = 0; ki < SK.LIST.length; ki++) {
        var def = SK.LIST[ki];
        /* ⚠ 남의 직업 재주에 찍힌 점수는 버린다 — 안 버리면 직업을 바꿔도
         *   옛 시너지가 따라다니며 재주책에 ✔ 로 남는다. */
        if (global.CLASSES && !global.CLASSES.canUse(out.cls, def.id)) continue;
        var want = rawSk[def.id];
        if (!Array.isArray(want) || !want.length) continue;
        var ok = null;
        for (var wi = 0; wi < want.length && !ok; wi++)
          for (var yi = 0; yi < def.syn.length; yi++)
            if (def.syn[yi].id === want[wi]) { ok = want[wi]; break; }
        out.skills[def.id] = ok ? [ok] : [];
      }
      var rawBar = Array.isArray(raw.bar) ? raw.bar : [];
      var CL = global.CLASSES;
      for (var bi2 = 0; bi2 < 6; bi2++) {
        var want2 = rawBar[bi2];
        var okSkill = SK.byId(want2) && (!CL || CL.canUse(out.cls, want2, out.advClass));
        out.bar[bi2] = okSkill ? want2 : null;
      }
      /* ⚠ 같은 스킬이 두 칸에 있으면 하나가 죽은 칸이 된다 — 뒤엣것을 비운다 */
      for (var a = 0; a < 6; a++)
        for (var b2 = a + 1; b2 < 6; b2++)
          if (out.bar[a] && out.bar[a] === out.bar[b2]) out.bar[b2] = null;

      var mine = CL ? CL.skillsOf(out.cls, out.advClass) : [SK.LIST[0].id, SK.LIST[1].id];
      var free = mine.filter(function (x) { return out.bar.indexOf(x) < 0; });
      for (var mi = 0; mi < 6; mi++)
        if (!out.bar[mi] && free.length) out.bar[mi] = free.shift();
    }
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

    /* ── 잠근 칸. 자동장착이 손대지 않을 자리다.
     * ⚠ **표에 있는 슬롯만** 남긴다. 낯선 키가 들어오면 자동장착이
     *   영영 못 고르는 유령 칸이 생기는데 오류는 한 줄도 안 난다. */
    out.locks = {};
    if (I) {
      var rawL = (raw.locks && typeof raw.locks === "object") ? raw.locks : {};
      for (var lk = 0; lk < I.SLOTS.length; lk++)
        if (rawL[I.SLOTS[lk]]) out.locks[I.SLOTS[lk]] = true;
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
    /* ⚠ 직업을 **sanitize 에 함께 넘긴다.** 전에는 먼저 정리하고 나서 cls 를
     *   바꿨는데, 그러면 손잡이가 **기본 직업(전사) 것으로 채워진 뒤** 직업만
     *   마법사가 되어, 다음 정리에서 전사 재주가 걸러지고 **빈 칸 둘**이 남았다
     *   (실측: 마법사로 시작했는데 손잡이가 [—,—,돌진,결의]).
     *   순서 하나로 새 캐릭터가 반쯤 빈 채 시작하는 종류의 버그다. */
    var want = clsList().indexOf(cls) >= 0 ? cls : FIELDS.cls.def;
    var s = sanitize({ cls: want });
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

  /* ── 직업마다 따로 저장한다 ─────────────────────────────
   *
   * 저장 칸이 **하나**였다. 직업을 바꾸면 그 위에 덮어써서 전사로 키운
   * 레벨·가방·장비가 통째로 날아갔다. 바꿔 보려고 눌렀다가 잃는다.
   *
   * 이제 직업마다 제 칸이 있다. 바꿀 때 쓰던 것을 제 칸에 넣고, 가려는
   * 직업의 칸을 꺼낸다. 없으면 그때 새로 만든다.
   *
   * ⚠ 본래 칸(KEY)도 **그대로 쓴다.** 그게 "지금 하던 직업" 이다. 옛 저장이
   *   거기 있으니 지우면 지금까지 키운 것이 사라진다.
   * ⚠ 창고(stash)는 **공용**이다. 직업마다 따로 두면 전사가 넣어 둔 것을
   *   도적이 못 꺼낸다 — 보관함의 뜻이 사라진다. 바꿀 때 옮겨 준다. */
  function slotKey(cls) { return KEY + ":cls:" + cls; }

  /* 저장을 덮어쓰기 전에 **한 벌 옆에 둔다.**
   * ⚠ 2026-09-23 에 기사를 더하며 전사 저장을 날렸다. 원인(박아 둔 목록)은
   *   고쳤지만, 저장을 덮어쓰는 길은 앞으로도 늘 있다 — 되돌릴 자리가
   *   하나도 없던 것이 진짜 문제였다.
   * ⚠ 레벨이 **내려가는** 덮어쓰기만 남긴다. 평소 저장마다 남기면 백업이
   *   백업을 덮어 뜻이 없다. 레벨이 내려가는 것은 거의 사고다. */
  function keepBackup(ls, cls, nextLevel) {
    if (!cls) return;
    var k = slotKey(cls), prev = null;
    try { prev = ls.getItem(k); } catch (e) { return; }
    if (!prev) return;
    var pd;
    try { pd = JSON.parse(prev); } catch (e) { return; }
    var lv = pd && pd.d && pd.d.level;
    if (!(lv > 1) || !(lv > (nextLevel || 0))) return;
    try { ls.setItem(k + ":bak", prev); } catch (e) {}
  }

  function save(s) {
    var ls = store();
    if (!ls) return false;
    var clean = sanitize(s);
    var text = JSON.stringify({ v: VERSION, t: Date.now(), d: clean });
    /* ⚠ 직업 칸은 **본래 칸과 따로** 센다. 본래 칸이 안 바뀌었다고 건너뛰면
     *   직업 칸이 영영 안 써진다. */
    if (clean.cls) {
      keepBackup(ls, clean.cls, clean.level);
      try { ls.setItem(slotKey(clean.cls), text); } catch (e) {}
    }
    if (text === lastText) return true;        /* 안 바뀌었으면 안 쓴다 */
    try { ls.setItem(KEY, text); lastText = text; return true; }
    catch (e) { return false; }                /* 꽉 찼거나 막혔다 — 게임은 계속 돈다 */
  }

  /* 그 직업의 저장을 꺼낸다. 없으면 null.
   * ⚠ 직업 칸이 아직 없고 **본래 칸이 그 직업**이면 그걸 쓴다. 칸을 나누기
   *   전에 키운 것이 거기 있다 — 안 보면 첫 전환에서 한 번 더 날린다. */
  function loadSlot(cls) {
    var ls = store();
    if (!ls) return null;
    var txt = null;
    try { txt = ls.getItem(slotKey(cls)); } catch (e) { txt = null; }
    if (!txt) {
      try { txt = ls.getItem(KEY); } catch (e) { txt = null; }
      if (!txt) return null;
      var probe;
      try { probe = JSON.parse(txt); } catch (e) { return null; }
      var pd = probe && (probe.d || probe);
      if (!pd || pd.cls !== cls) return null;
    }
    var raw;
    try { raw = JSON.parse(txt); } catch (e) { return null; }
    var ver = Number(raw && raw.v);
    if (!isFinite(ver) || ver < 1 || ver > VERSION) return null;
    var got = sanitize(upgrade(raw, ver));
    return (got && got.cls === cls) ? got : null;
  }

  /* 어느 직업에 무엇이 있나 — 직업 고르는 창이 "Lv.12" 를 보여 주는 데 쓴다 */
  function slots() {
    var ls = store();
    var out = {};
    if (!ls) return out;
    var ids = (global.CLASSES && global.CLASSES.LIST)
      ? global.CLASSES.LIST.map(function (c) { return c.id; })
      : clsList();
    for (var i = 0; i < ids.length; i++) {
      var g = loadSlot(ids[i]);
      if (g) out[ids[i]] = { level: g.level || 1, maxDepth: g.maxDepth || 1, gold: g.gold || 0 };
    }
    return out;
  }

  function wipe() {
    var ls = store();
    if (!ls) return false;
    try { ls.removeItem(KEY); lastText = ""; return true; } catch (e) { return false; }
  }

  function wipeAll() {
    var ls = store();
    if (!ls) return false;
    try {
      ls.removeItem(KEY);
      var ids = (global.CLASSES && global.CLASSES.LIST)
        ? global.CLASSES.LIST.map(function (c) { return c.id; })
        : clsList();
      for (var i = 0; i < ids.length; i++) {
        ls.removeItem(slotKey(ids[i]));
        ls.removeItem(slotKey(ids[i]) + ":bak");
      }
      lastText = "";
      return true;
    } catch (e) { return false; }
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
    load: load, save: save, wipe: wipe, wipeAll: wipeAll, blank: blank, sanitize: sanitize,
    needFor: needFor, gainXp: gainXp,
    BAG: BAG, STASH: STASH,
    liveSkills: function (s) { return (s && s.skills) || {}; },
    liveEquip: liveEquip, liveBag: liveBag, liveStash: liveStash,
    slotKey: slotKey, loadSlot: loadSlot, slots: slots,
    blocked: function () { return !store(); }
  };
})(window);
