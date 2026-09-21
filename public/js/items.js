/* 아이템 — 베이스 · 접사 · 등급 · 세트. **이 파일이 아이템 값의 단일 진실원이다.**
 *
 * 디아블로의 깊이는 베이스 개수가 아니라 **접사 × 등급 × 세트의 조합**에서 나온다.
 * 슬롯당 20종을 만들면 이름과 숫자만 다른 것이 120개 생긴다. 그래서 베이스는
 * **규칙이 진짜로 다른 것**만 두고(무기는 빠름/느림/길다가 갈린다) 접사 풀을 키운다.
 *
 * 수치의 단위:
 *   dmg        한 대에 더해지는 피해
 *   hp         최대 체력
 *   armor      맞을 때마다 빼는 양(**곱이 아니라 뺄셈**이다 — 곱은 후반에 무한이 된다)
 *   spdPct     걷는 속도 %
 *   apsPct     공격 속도 %  (**초당 횟수**에 곱한다)
 *   critPct    치명타 확률 %
 *   critDmgPct 치명타 배수 %  (기본 150 에 더한다)
 *   lifeOnHit  때릴 때마다 회복
 *
 * ⚠ **`%` 와 평값을 섞지 말 것.** 이름 끝의 Pct 가 그 표시다. 섞이면 "공격속도 +12"
 *   가 12% 인지 12회/초인지 아무도 모른다(후자면 게임이 끝난다).
 * ⚠ 굴리기는 **씨앗 난수**로 한다. Math.random 을 쓰면 같은 몬스터를 같은 판에서
 *   다시 잡아도 다른 것이 나와 버그 재현이 불가능해진다.
 * ⚠ reqLevel 은 **베이스와 접사에서 계산한다.** 손으로 적으면 접사를 고칠 때마다
 *   따로 고쳐야 하고 반드시 빠뜨린다.
 */
(function (global) {
  "use strict";

  /* 슬롯 일곱. ⚠ 순서가 곧 화면 순서다 — 화면 쪽에 다시 적지 말 것. */
  var SLOTS = ["weapon", "head", "body", "hands", "feet", "ring", "amulet"];
  var SLOT_NAME = {
    weapon: "무기", head: "투구", body: "갑옷", hands: "장갑",
    feet: "신발", ring: "반지", amulet: "목걸이"
  };

  /* 등급. 접사 개수와 값의 배수가 여기서 갈린다. */
  var TIERS = [
    { id: "common", name: "일반", color: "#b8b2a4", affixes: [0, 0], mult: 1.00, w: 52 },
    { id: "magic",  name: "마법", color: "#6a9bd8", affixes: [1, 2], mult: 1.15, w: 30 },
    { id: "rare",   name: "희귀", color: "#d9a441", affixes: [3, 4], mult: 1.35, w: 14 },
    { id: "relic",  name: "유물", color: "#b06be0", affixes: [4, 5], mult: 1.60, w: 4 }
  ];

  /* ── 베이스 ─────────────────────────────────────────────
   * 무기 여섯은 **규칙이 다르다**(빠름·느림·길다·넓다). 이름만 다른 것은 두지 않는다.
   * swing 은 COMBAT 이 그대로 쓰는 모양이다 — 두 벌로 적지 않는다. */
  var BASES = {
    weapon: [
      { id: "dagger", name: "단검", sprite: "w_dagger", lvl: 1, dmg: 4, val: 12,
        swing: { aps: 1.95, windup: 0.09, recover: 0.13, reach: 1.00, arc: 70, push: 0.18 },
        note: "아주 빠르고 짧다" },
      { id: "sword", name: "장검", sprite: "w_sword", lvl: 1, dmg: 7, val: 20,
        swing: { aps: 1.15, windup: 0.16, recover: 0.22, reach: 1.30, arc: 100, push: 0.32 },
        note: "고르다" },
      { id: "axe", name: "전투도끼", sprite: "w_axe", lvl: 4, dmg: 13, val: 34,
        swing: { aps: 0.70, windup: 0.30, recover: 0.34, reach: 1.25, arc: 130, push: 0.60 },
        note: "느리고 무겁다 · 넓게 쓸어친다" },
      { id: "spear", name: "장창", sprite: "w_spear", lvl: 3, dmg: 8, val: 28,
        swing: { aps: 1.00, windup: 0.20, recover: 0.24, reach: 2.05, arc: 46, push: 0.40 },
        note: "멀리 닿지만 좁다" },
      { id: "mace", name: "철퇴", sprite: "w_fist", lvl: 2, dmg: 10, val: 26,
        swing: { aps: 0.88, windup: 0.24, recover: 0.28, reach: 1.15, arc: 90, push: 0.75 },
        note: "세게 밀어낸다" },
      { id: "staff", name: "지팡이", sprite: "w_staff", lvl: 2, dmg: 6, val: 24,
        swing: { aps: 1.05, windup: 0.22, recover: 0.20, reach: 1.70, arc: 150, push: 0.25 },
        note: "사방으로 휘두른다" }
    ],
    head:   [{ id: "cap",   name: "가죽모자", sprite: "armor", lvl: 1, armor: 1, val: 10 },
             { id: "helm",  name: "쇠투구",   sprite: "armor", lvl: 3, armor: 3, hp: 6, val: 22, spdPct: -3 },
             { id: "hood",  name: "두건",     sprite: "armor", lvl: 2, armor: 1, apsPct: 4, val: 18 }],
    body:   [{ id: "tunic", name: "누비옷",   sprite: "armor", lvl: 1, armor: 2, val: 14 },
             { id: "mail",  name: "사슬갑옷", sprite: "armor", lvl: 4, armor: 6, hp: 12, val: 34, spdPct: -6 },
             { id: "robe",  name: "긴 옷",    sprite: "armor", lvl: 2, armor: 1, hp: 8, apsPct: 5, val: 24 }],
    hands:  [{ id: "wraps", name: "손싸개",   sprite: "armor", lvl: 1, apsPct: 5, val: 10 },
             { id: "gaunt", name: "쇠장갑",   sprite: "armor", lvl: 4, armor: 2, dmg: 2, val: 26 }],
    feet:   [{ id: "boots", name: "가죽장화", sprite: "armor", lvl: 1, spdPct: 5, val: 12 },
             { id: "greave", name: "쇠각반",  sprite: "armor", lvl: 4, armor: 3, val: 24, spdPct: -2 }],
    ring:   [{ id: "band",  name: "고리반지", sprite: "shield", lvl: 2, critPct: 3, val: 20 },
             { id: "signet", name: "인장반지", sprite: "shield", lvl: 5, dmg: 3, hp: 6, val: 32 }],
    amulet: [{ id: "pendant", name: "펜던트", sprite: "shield", lvl: 3, hp: 10, val: 26 },
             { id: "talisman", name: "부적",  sprite: "shield", lvl: 6, critDmgPct: 25, val: 38 }]
  };

  /* ── 접사 ───────────────────────────────────────────────
   * 단계(t)가 높을수록 세고, 물건 수준(ilvl)이 낮으면 안 나온다.
   * ⚠ 접두는 공격, 접미는 방어·편의로 갈라 둔다. 섞으면 "공격 접사 넷" 같은
   *   물건이 나와 한쪽만 극단적으로 세진다. */
  var PREFIX = [
    { id: "sharp",  name: "날카로운", t: 1, il: 1,  s: { dmg: 2 } },
    { id: "cruel",  name: "잔혹한",   t: 2, il: 6,  s: { dmg: 5 } },
    { id: "savage", name: "야만의",   t: 3, il: 14, s: { dmg: 9 } },
    { id: "swift",  name: "날렵한",   t: 1, il: 2,  s: { apsPct: 6 } },
    { id: "hasted", name: "질주의",   t: 2, il: 9,  s: { apsPct: 12 } },
    { id: "keen",   name: "예리한",   t: 1, il: 3,  s: { critPct: 4 } },
    { id: "deadly", name: "치명의",   t: 2, il: 11, s: { critPct: 7, critDmgPct: 20 } },
    { id: "vamp",   name: "흡혈의",   t: 2, il: 8,  s: { lifeOnHit: 2 } }
  ];
  var SUFFIX = [
    { id: "bear",   name: "곰의",     t: 1, il: 1,  s: { hp: 10 } },
    { id: "titan",  name: "거인의",   t: 2, il: 7,  s: { hp: 26 } },
    { id: "stone",  name: "바위의",   t: 1, il: 2,  s: { armor: 2 } },
    { id: "iron",   name: "무쇠의",   t: 2, il: 10, s: { armor: 5 } },
    { id: "wind",   name: "바람의",   t: 1, il: 2,  s: { spdPct: 6 } },
    { id: "wolf",   name: "늑대의",   t: 2, il: 12, s: { spdPct: 11 } },
    { id: "greed",  name: "탐욕의",   t: 1, il: 4,  s: { goldPct: 20 } },
    { id: "sage",   name: "현자의",   t: 1, il: 5,  s: { xpPct: 12 } }
  ];

  /* ── 세트 ───────────────────────────────────────────────
   * ⚠ 세트 조각은 **슬롯이 안 겹쳐야** 모을 수 있다. 같은 슬롯에 둘을 두면
   *   영원히 3피스가 안 된다(실제로 흔한 실수다 — 아래 checkSets 가 잡는다). */
  var SETS = [
    { id: "depth", name: "심연의 순례자",
      pieces: [
        { slot: "head",   base: "hood",   name: "순례자의 두건" },
        { slot: "body",   base: "robe",   name: "순례자의 긴 옷" },
        { slot: "feet",   base: "boots",  name: "순례자의 장화" },
        { slot: "hands",  base: "wraps",  name: "순례자의 손싸개" },
        { slot: "amulet", base: "pendant", name: "순례자의 펜던트" }
      ],
      bonus: [
        { at: 3, s: { spdPct: 10, apsPct: 8 },  text: "이동 +10% · 공격속도 +8%" },
        { at: 5, s: { critPct: 10, hp: 40 },     text: "치명타 +10% · 체력 +40" }
      ] }
  ];

  /* ── 굴리기 ─────────────────────────────────────────────
   * ⚠ 씨앗 난수만 쓴다. Math.random 이면 같은 판을 다시 돌려도 다른 것이 나와
   *   "이 물건이 왜 이렇게 세지?" 를 두 번 다시 못 본다. */
  function pickWeighted(rng, list, key) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += list[i][key];
    var r = rng() * total;
    for (i = 0; i < list.length; i++) { r -= list[i][key]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  /* 접사 값이 **물건 수준(ilvl)을 따라 커진다.**
   *
   * ⚠ 전에는 ilvl 을 무시했다. `il` 은 "언제부터 나올 수 있나" 만 막고 값은
   *   고정이라, **30층에서 주운 「날카로운 검」이 1층 것과 똑같이 +2** 였다.
   *   그래서 Lv.15 에 최고 접사가 다 열리면 그 뒤로 강해질 방법이 없었고,
   *   실측에서 한 대 피해가 Lv.15~30 동안 **28 에서 멈췄다**(몬스터 체력 합은
   *   같은 구간에 1,445 → 4,172 로 늘었다). 던전이 뒤로 갈수록 벽이 된 원인이다.
   * ⚠ 계수를 여기 **한 곳**에 둔다. 값마다 따로 적으면 균형을 다시 잡을 때
   *   열여섯 군데를 고쳐야 하고 반드시 하나를 빠뜨린다. */
  var ILVL_GROW = 0.14;

  function scaleStat(v, t, mult, ilvl) {
    var grow = 1 + Math.max(0, (ilvl || 1) - 1) * ILVL_GROW;
    /* 반올림은 **마지막에 한 번만** — 중간에 하면 작은 값이 계속 0 으로 깎인다. */
    return Math.max(1, Math.round(v * mult * grow));
  }

  /* 물건 하나를 굴린다. ilvl 은 대개 층 깊이다. */
  function roll(rng, opt) {
    opt = opt || {};
    var ilvl = Math.max(1, Math.floor(opt.ilvl || 1));
    var slot = opt.slot || SLOTS[Math.floor(rng() * SLOTS.length)];
    var pool = BASES[slot].filter(function (b) { return b.lvl <= ilvl + 1; });
    if (!pool.length) pool = [BASES[slot][0]];
    var base = opt.base
      ? BASES[slot].filter(function (b) { return b.id === opt.base; })[0] || pool[0]
      : pool[Math.floor(rng() * pool.length)];

    var tier = opt.tier
      ? TIERS.filter(function (t) { return t.id === opt.tier; })[0] || TIERS[0]
      : pickWeighted(rng, TIERS, "w");

    var it = {
      uid: opt.uid || ("i" + Math.floor(rng() * 1e9).toString(36) + ilvl),
      slot: slot, base: base.id, name: base.name, sprite: base.sprite,
      tier: tier.id, ilvl: ilvl, affixes: [], set: null, s: {}
    };

    /* 베이스 수치 */
    var k;
    for (k in base) {
      if (k === "id" || k === "name" || k === "sprite" || k === "lvl" ||
          k === "val" || k === "swing" || k === "note") continue;
      it.s[k] = base[k];
    }
    if (base.swing) it.swing = base.swing;
    if (base.note) it.note = base.note;

    /* 세트 조각인가 — 유물 등급에서만, 그리고 **딱 그 슬롯·베이스**일 때만 */
    if (tier.id === "relic") {
      for (var si = 0; si < SETS.length; si++) {
        var piece = SETS[si].pieces.filter(function (p) {
          return p.slot === slot && p.base === base.id;
        })[0];
        if (piece) { it.set = SETS[si].id; it.name = piece.name; break; }
      }
    }

    /* 접사 */
    var want = tier.affixes[0] +
      Math.floor(rng() * (tier.affixes[1] - tier.affixes[0] + 1));
    var pre = PREFIX.filter(function (a) { return a.il <= ilvl; });
    var suf = SUFFIX.filter(function (a) { return a.il <= ilvl; });
    var usedPre = {}, usedSuf = {};
    for (var n = 0; n < want; n++) {
      /* 접두·접미를 번갈아 — 한쪽으로 쏠리면 극단적인 물건이 나온다 */
      var fromPre = (n % 2 === 0);
      var src = fromPre ? pre : suf, used = fromPre ? usedPre : usedSuf;
      var avail = src.filter(function (a) { return !used[a.id]; });
      if (!avail.length) { avail = (fromPre ? suf : pre).filter(function (a) {
        return !(fromPre ? usedSuf : usedPre)[a.id]; }); used = fromPre ? usedSuf : usedPre; }
      if (!avail.length) break;
      var a = avail[Math.floor(rng() * avail.length)];
      used[a.id] = 1;
      it.affixes.push(a.id);
      for (k in a.s) it.s[k] = (it.s[k] || 0) + scaleStat(a.s[k], a.t, tier.mult, ilvl);
    }

    it.name = affixName(it, base, tier);
    it.req = reqLevel(it);
    it.val = value(it, base, tier);
    return it;
  }

  /* 이름 — 접두 + 베이스 + 접미. 세트 조각은 자기 이름을 지킨다. */
  function affixName(it, base, tier) {
    if (it.set) return it.name;
    var p = null, s = null;
    for (var i = 0; i < it.affixes.length; i++) {
      var a = byId(it.affixes[i]);
      if (!a) continue;
      if (isPrefix(a.id)) { if (!p || a.t > p.t) p = a; }
      else { if (!s || a.t > s.t) s = a; }
    }
    return (p ? p.name + " " : "") + base.name + (s ? " " + s.name : "");
  }

  function isPrefix(id) {
    return PREFIX.some(function (a) { return a.id === id; });
  }
  function byId(id) {
    for (var i = 0; i < PREFIX.length; i++) if (PREFIX[i].id === id) return PREFIX[i];
    for (var j = 0; j < SUFFIX.length; j++) if (SUFFIX[j].id === id) return SUFFIX[j];
    return null;
  }

  /* 쓸 수 있는 레벨. **계산한다** — 손으로 적으면 접사를 고칠 때 반드시 빠뜨린다. */
  function reqLevel(it) {
    var base = BASES[it.slot].filter(function (b) { return b.id === it.base; })[0];
    var req = base ? base.lvl : 1;
    for (var i = 0; i < it.affixes.length; i++) {
      var a = byId(it.affixes[i]);
      if (a) req = Math.max(req, Math.round(a.il * 0.8));
    }
    return Math.max(1, Math.min(99, req));
  }

  function value(it, base, tier) {
    var v = (base ? base.val : 10) * tier.mult;
    v += it.affixes.length * 8 * tier.mult;
    v += it.ilvl * 2;
    return Math.max(1, Math.round(v));
  }

  /* ── 저장용 ─────────────────────────────────────────────
   * 물건은 **{슬롯·베이스·등급·수준·접사} 다섯 칸만으로 완전히 결정된다.**
   * 수치는 전부 그 다섯에서 계산된 것이라 따로 저장할 이유가 없다.
   * 그래서 저장에는 다섯만 담고 불러올 때 **다시 만든다**. 얻는 것이 셋이다:
   *   ① 저장이 작다  ② 수치가 어긋날 수가 없다
   *   ③ 손으로 고쳐도 표에 없는 값은 만들어지지 않는다(구조가 곧 검증이다)
   * ⚠ 수치를 함께 저장하면 표를 고친 날 **옛 물건만 옛 수치로 남는다.** */
  function pack(it) {
    if (!it) return null;
    return { u: it.uid, sl: it.slot, b: it.base, t: it.tier,
             il: it.ilvl, a: (it.affixes || []).slice() };
  }

  function rebuild(p) {
    if (!p || typeof p !== "object") return null;
    var slot = p.sl;
    if (SLOTS.indexOf(slot) < 0) return null;
    var base = BASES[slot].filter(function (b) { return b.id === p.b; })[0];
    if (!base) return null;
    var tier = TIERS.filter(function (t) { return t.id === p.t; })[0] || TIERS[0];
    var ilvl = Math.max(1, Math.min(99, Math.floor(Number(p.il) || 1)));
    /* 아는 접사만 · 중복 없이 · 등급이 허락하는 개수까지 */
    var seen = {}, affixes = [];
    var list = Array.isArray(p.a) ? p.a : [];
    for (var i = 0; i < list.length && affixes.length < tier.affixes[1]; i++) {
      var a = byId(list[i]);
      if (!a || seen[a.id]) continue;
      seen[a.id] = 1; affixes.push(a.id);
    }

    var it = {
      uid: (typeof p.u === "string" && p.u.length <= 24) ? p.u : ("i" + (++UID)),
      slot: slot, base: base.id, name: base.name, sprite: base.sprite,
      tier: tier.id, ilvl: ilvl, affixes: affixes, set: null, s: {}
    };
    for (var k in base) {
      if (k === "id" || k === "name" || k === "sprite" || k === "lvl" ||
          k === "val" || k === "swing" || k === "note") continue;
      it.s[k] = base[k];
    }
    if (base.swing) it.swing = base.swing;
    if (base.note) it.note = base.note;
    if (tier.id === "relic") {
      for (var si = 0; si < SETS.length; si++) {
        var piece = SETS[si].pieces.filter(function (q) {
          return q.slot === slot && q.base === base.id;
        })[0];
        if (piece) { it.set = SETS[si].id; it.name = piece.name; break; }
      }
    }
    for (var n = 0; n < affixes.length; n++) {
      var af = byId(affixes[n]);
      for (var kk in af.s) it.s[kk] = (it.s[kk] || 0) + scaleStat(af.s[kk], af.t, tier.mult, ilvl);
    }
    if (!it.set) it.name = affixName(it, base, tier);
    it.req = reqLevel(it);
    it.val = value(it, base, tier);
    return it;
  }

  var UID = 0;

  /* ── 합치기 ─────────────────────────────────────────────
   * 입은 것 전부 + 세트 보너스 → 한 덩어리. **여기가 유일한 합산 자리다.**
   * 화면이 따로 더하면 "표시는 +30 인데 실제로는 +24" 가 된다. */
  function totals(equipped) {
    var t = { dmg: 0, hp: 0, armor: 0, spdPct: 0, apsPct: 0,
              critPct: 0, critDmgPct: 0, lifeOnHit: 0, goldPct: 0, xpPct: 0 };
    var counts = {}, k, i;
    for (i = 0; i < SLOTS.length; i++) {
      var it = equipped[SLOTS[i]];
      if (!it) continue;
      for (k in it.s) if (k in t) t[k] += it.s[k];
      if (it.set) counts[it.set] = (counts[it.set] || 0) + 1;
    }
    var sets = [];
    for (i = 0; i < SETS.length; i++) {
      var st = SETS[i], have = counts[st.id] || 0;
      if (!have) continue;
      var on = [];
      for (var b = 0; b < st.bonus.length; b++) {
        var bn = st.bonus[b];
        if (have < bn.at) continue;
        on.push(bn);
        for (k in bn.s) if (k in t) t[k] += bn.s[k];
      }
      sets.push({ id: st.id, name: st.name, have: have, of: st.pieces.length, on: on });
    }
    t._sets = sets;
    return t;
  }

  /* 무기의 몸짓 — 없으면 맨손. ⚠ 공격속도 %% 는 여기서 한 번만 곱한다. */
  function swingOf(equipped, tot) {
    var w = equipped.weapon;
    var base = (w && w.swing) ? w.swing : global.COMBAT.SWING;
    var m = {
      aps: base.aps * (1 + (tot.apsPct || 0) / 100),
      windup: base.windup, recover: base.recover,
      reach: base.reach, arc: base.arc, push: base.push
    };
    /* ⚠ 공격속도를 올려도 **선딜은 안 줄인다.** 줄이면 빠른 무기를 낀 순간
     *   몬스터가 피할 틈이 사라져(서로에게) 전투가 무너진다. 줄이는 것은 주기뿐이다. */
    return m;
  }

  /* 쓸 수 있는가 */
  function canEquip(it, level) { return !it || it.req <= level; }

  /* ── 자기 점검 ───────────────────────────────────────────
   * 표를 고치다 보면 조용히 어긋나는 것들이 있다. 켤 때 한 번 본다. */
  function audit() {
    var bad = [];
    var i, j;
    for (i = 0; i < SETS.length; i++) {
      var seen = {};
      for (j = 0; j < SETS[i].pieces.length; j++) {
        var p = SETS[i].pieces[j];
        if (seen[p.slot]) bad.push("세트 " + SETS[i].id + " 에 " + p.slot + " 가 둘이다");
        seen[p.slot] = 1;
        if (!BASES[p.slot] || !BASES[p.slot].some(function (b) { return b.id === p.base; }))
          bad.push("세트 조각 " + p.name + " 의 베이스 " + p.base + " 가 없다");
      }
      for (j = 0; j < SETS[i].bonus.length; j++)
        if (SETS[i].bonus[j].at > SETS[i].pieces.length)
          bad.push("세트 " + SETS[i].id + " 의 " + SETS[i].bonus[j].at + "피스 보너스가 조각 수보다 많다");
    }
    for (i = 0; i < SLOTS.length; i++)
      if (!BASES[SLOTS[i]] || !BASES[SLOTS[i]].length) bad.push("슬롯 " + SLOTS[i] + " 에 베이스가 없다");
    var known = { dmg:1, hp:1, armor:1, spdPct:1, apsPct:1, critPct:1,
                  critDmgPct:1, lifeOnHit:1, goldPct:1, xpPct:1 };
    [PREFIX, SUFFIX].forEach(function (pool) {
      pool.forEach(function (a) {
        for (var k in a.s) if (!known[k]) bad.push("접사 " + a.id + " 의 수치 " + k + " 를 아무도 안 읽는다");
      });
    });
    return bad;
  }

  global.ITEMS = {
    SLOTS: SLOTS, SLOT_NAME: SLOT_NAME, TIERS: TIERS, BASES: BASES,
    PREFIX: PREFIX, SUFFIX: SUFFIX, SETS: SETS,
    ILVL_GROW: ILVL_GROW,
    roll: roll, totals: totals, swingOf: swingOf, canEquip: canEquip,
    pack: pack, rebuild: rebuild,
    reqLevel: reqLevel, audit: audit,
    tierOf: function (id) {
      for (var i = 0; i < TIERS.length; i++) if (TIERS[i].id === id) return TIERS[i];
      return TIERS[0];
    },
    affix: byId
  };
})(window);
