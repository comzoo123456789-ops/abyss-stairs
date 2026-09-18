/* 장비 생성과 능력치 합산.
 *
 * 규칙: **아이템은 굴려서 만든다.** 같은 "장검" 이 매번 다른 물건이어야 줍는 재미가 있다.
 *   등급(색) → 붙는 옵션 개수 → 옵션 종류와 값 → 이름(접두 + 기본명 + 접미)
 *
 * ⚠ 옵션 값에 상한을 두지 않는다. 같은 옵션이 셋 붙으면 셋만큼 세진다 —
 *   그게 "정해진 틀 없이 스스로 쌓는 빌드" 의 전부다. 상한을 두면 결국 한 가지
 *   최적해로 수렴하고, 그러면 빌드를 고민할 이유가 사라진다.
 */
(function (global) {
  "use strict";

  var DATA = global.DATA;

  /* 티어 — 층이 깊을수록 좋은 기본템이 나온다. 0~3 */
  function tierFor(depth, rng) {
    var t = Math.min(3, Math.floor((depth - 1) / 2.6));
    if (rng() < 0.22 && t < 3) t += 1;          /* 가끔 한 티어 위가 나온다 */
    if (rng() < 0.12 && t > 0) t -= 1;
    return t;
  }

  function pickRarity(depth, rng) {
    /* 깊을수록 좋은 등급이 흔해진다 */
    var list = DATA.RARITY, total = 0, i, w = [];
    for (i = 0; i < list.length; i++) {
      var bonus = i === 0 ? -depth * 2.2 : i * depth * 0.9;
      var ww = Math.max(1, list[i].weight + bonus);
      w.push(ww); total += ww;
    }
    var r = rng() * total;
    for (i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[0];
  }

  function nameFrom(list, tier, rng) {
    var row = list[Math.min(list.length - 1, tier)];
    return row[Math.floor(rng() * row.length)];
  }

  /* 옵션 굴리기 — 같은 종류가 두 번 붙지 않게 하되, 값은 층에 따라 커진다 */
  function rollAffixes(count, depth, rng) {
    var out = [], used = {};
    for (var n = 0; n < count; n++) {
      var a = null;
      for (var t = 0; t < 12; t++) {
        var c = DATA.AFFIXES[Math.floor(rng() * DATA.AFFIXES.length)];
        if (!used[c.id]) { a = c; break; }
      }
      if (!a) break;
      used[a.id] = 1;
      /* 값 = 기본 × (1 + 깊이) × 굴림. 정수 옵션은 1 이하로 안 내려간다 */
      var scale = (1 + (depth - 1) * 0.13) * (0.8 + rng() * 0.6);
      var v = a.per * scale;
      if (a.unit === "" || a.unit === "턴") v = Math.max(1, Math.round(v));
      else v = Math.round(v * 1000) / 1000;
      out.push({ id: a.id, stat: a.stat, label: a.label, unit: a.unit, value: v,
                 pre: a.pre, suf: a.suf });
    }
    return out;
  }

  /* 장비 한 점 만들기. slot = weapon | armor | offhand */
  function makeGear(slot, depth, rng, opt) {
    opt = opt || {};
    var tier = (opt.tier !== undefined) ? opt.tier : tierFor(depth, rng);
    var rar = opt.rarity || pickRarity(depth, rng);
    var it = {
      slot: slot, kind: slot, tier: tier,
      rarity: rar.id, rarityName: rar.name, color: rar.color,
      affixes: rollAffixes(opt.affixes !== undefined ? opt.affixes : rar.affixes, depth, rng),
      base: {}
    };

    if (slot === "weapon") {
      var wk = opt.weaponKind
        ? DATA.byId(DATA.WEAPON_KINDS, opt.weaponKind)
        : DATA.WEAPON_KINDS[Math.floor(rng() * DATA.WEAPON_KINDS.length)];
      it.weaponKind = wk.id;
      it.weaponName = wk.name;
      it.ranged = wk.ranged || 0;
      it.reach = wk.reach || 1;
      it.hint = wk.hint;
      it.base = wk.base || {};
      /* ⚠ 무기 종류 id 가 곧 스프라이트 이름이다(sword·axe·dagger·staff·bow·spear).
       *   전에는 전부 "sword" 를 썼는데, 그러면 바닥에 떨어진 것이 도끼인지 활인지
       *   알 수 없어 종류를 나눈 의미가 사라진다. */
      it.sprite = wk.id;
      /* 공격력 = 티어 기본 × 종류 배수 × 등급 배수 */
      it.power = Math.max(1, Math.round((2 + tier * 4.2 + depth * 0.5) * wk.atkMul * rar.mul));
      it.baseName = nameFrom(DATA.WEAPON_NAMES[wk.id], tier, rng);
    } else if (slot === "armor") {
      it.sprite = "armor";
      it.power = Math.max(1, Math.round((1 + tier * 2.1 + depth * 0.22) * rar.mul));
      it.baseName = nameFrom(DATA.ARMOR_NAMES, tier, rng);
    } else {
      it.sprite = "shield";      /* 보조 장비는 방패 — 갑옷과 실루엣이 달라야 한다 */
      it.power = Math.max(1, Math.round((1 + tier * 1.5 + depth * 0.16) * rar.mul));
      it.baseName = nameFrom(DATA.OFFHAND_NAMES, tier, rng);
    }

    it.name = composeName(it);
    it.cost = priceOf(it);
    it.id = slot + ":" + it.name + ":" + (rng() * 1e9 | 0);   /* 목록 구분용 */
    return it;
  }

  /* 이름 = 관형격 + 형용사 + 기본명. 옵션이 이름에 드러나야 주울 때 기대가 생긴다.
   * ⚠ 한국어는 수식어가 **모두 앞**에 온다. 접미를 뒤에 붙였더니
   *   "약초사의 은장 지팡이 처형의" 처럼 비문이 됐다. */
  function composeName(it) {
    var head = "", adj = "";
    if (it.affixes.length >= 2) head = it.affixes[1].suf + " ";
    if (it.affixes.length >= 1) adj = it.affixes[0].pre + " ";
    return head + adj + it.baseName;
  }

  function priceOf(it) {
    var v = it.power * 6;
    for (var i = 0; i < it.affixes.length; i++) v += 34;
    if (it.slot === "weapon") v = Math.round(v * 1.15);
    return Math.max(12, Math.round(v));
  }

  /* 한 줄 설명 — 툴팁에 쓴다 */
  function affixText(a) {
    if (a.unit === "%") return a.label + " +" + Math.round(a.value * 100) + "%";
    if (a.unit === "턴") return a.label + " −" + a.value + "턴";
    return a.label + " +" + a.value;
  }

  function gearLines(it) {
    var out = [];
    if (it.slot === "weapon") out.push("공격력 +" + it.power + " · " + it.weaponName);
    else if (it.slot === "armor") out.push("방어력 +" + it.power);
    else out.push("방어력 +" + it.power + " · 보조 장비");
    /* 무기 종류의 태생 옵션 */
    for (var k in it.base) {
      var def = null;
      for (var i = 0; i < DATA.AFFIXES.length; i++) if (DATA.AFFIXES[i].stat === k) def = DATA.AFFIXES[i];
      if (def) out.push(affixText({ label: def.label, unit: def.unit, value: it.base[k] }) + " (종류)");
    }
    for (var a = 0; a < it.affixes.length; a++) out.push(affixText(it.affixes[a]));
    return out;
  }

  /* ── 능력치 합산 ───────────────────────────────────────────
   * 기본값 + 직업 + 레벨업 특성 + 장비(기본 옵션 + 굴린 옵션).
   * ⚠ 한 곳에서만 계산한다. 화면과 규칙이 각자 더하면 반드시 어긋난다. */
  var STAT_KEYS = ["atkFlat", "defFlat", "hpFlat", "crit", "critMult", "ailChance",
                   "ailPower", "skillPower", "cdReduce", "lifesteal", "potionBoost", "goldBoost"];

  function blank() {
    return { atkFlat: 0, defFlat: 0, hpFlat: 0, crit: 0, critMult: 0, ailChance: 0,
             ailPower: 0, skillPower: 0, cdReduce: 0, lifesteal: 0, potionBoost: 0, goldBoost: 0 };
  }

  function addInto(dst, src) {
    if (!src) return dst;
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var k = STAT_KEYS[i];
      if (src[k]) dst[k] += src[k];
    }
    return dst;
  }

  function gearStats(it) {
    var s = blank();
    if (!it) return s;
    addInto(s, it.base);
    for (var i = 0; i < it.affixes.length; i++) {
      var a = it.affixes[i];
      if (s[a.stat] !== undefined) s[a.stat] += a.value;
    }
    return s;
  }

  global.ITEMS = {
    makeGear: makeGear,
    gearLines: gearLines,
    affixText: affixText,
    gearStats: gearStats,
    blank: blank,
    addInto: addInto,
    priceOf: priceOf,
    tierFor: tierFor,
    STAT_KEYS: STAT_KEYS
  };
})(window);
