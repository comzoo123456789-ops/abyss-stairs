/* 직업 셋 — **정말 다른 게임이어야 한다.**
 *
 * 전에는 `cls` 가 그림만 바꿨다(app.js 의 `opt.sprite = hero.cls` 한 줄이 전부였다).
 * 저장은 셋을 검증하고 도트도 셋 다 있는데 고를 방법조차 없었다 — 반쯤 약속만
 * 해 둔 구멍이었다.
 *
 * 무엇으로 가르는가. **수치만 다르면 같은 게임을 숫자만 바꿔 하는 것**이다.
 * 셋이 서로 다른 **행동**을 하게 만드는 것이 목적이라 네 가지를 함께 가른다:
 *
 *   ① 기본 수치   체력·속도·방어·치명타·기력
 *   ② 무기 적성   맞는 무기를 들면 피해 +25%  — 어떤 무기를 찾을지가 달라진다
 *   ③ 전용 스킬   직업당 둘 + 공용 둘 = 손잡이 네 칸이 꽉 찬다
 *   ④ 평타 사거리 지팡이·활은 **날아간다** — 마법사는 아예 다른 거리에서 논다
 *
 * ⚠ 적성은 **보너스만** 준다. 안 맞는 무기에 벌을 주면 "쓰면 안 되는 물건"이
 *   가방에 쌓여 전리품의 절반이 쓰레기가 된다. 보너스만 주면 "이게 더 낫다" 가 된다.
 * ⚠ 수치는 여기 **한 곳**에만 적는다. applyHero 가 이걸 읽는다 — 두 곳이 되면
 *   화면과 실제가 갈린다.
 */
(function (global) {
  "use strict";

  var CLASSES = [
    {
      id: "warrior", name: "전사", sprite: "warrior",
      tag: "붙어서 버틴다",
      text: "체력과 방어가 가장 높다. 무거운 무기를 들고 한가운데로 들어간다.",
      hp: 60, hpPer: 14, spd: 4.0, armor: 3, critPct: 0,
      stam: 100, stamRegen: 12,
      likes: ["axe", "mace", "sword"],
      likesText: "전투도끼 · 철퇴 · 장검",
      skills: ["cleave", "whirl", "stomp", "shout"],
      start: { weapon: "sword", body: "tunic" }
    },
    {
      /* 기사 — **막고 되받아친다.**
       * ⚠ 전사와 갈리는 축이 수치가 아니라 **행동**이어야 한다. 전사는 체력이
       *   가장 높고 먼저 때린다(베어넘기기·회전베기). 기사는 방어가 가장 높고
       *   재주 넷이 전부 받아 넘기거나 끌어당기거나 밀어낸다 — 먼저 때리는
       *   재주가 하나도 없다. 같은 장르가 기사와 전사를 가르는 축이 그것이다.
       * ⚠ 가장 느리다(3.7). 방어를 가장 높게 주면서 발까지 빠르면 도망도
       *   버티기도 다 되는 직업이 된다. */
      id: "knight", name: "기사", sprite: "knight",
      tag: "막고 되받아친다",
      text: "방어가 가장 높고 가장 느리다. 맞아 주고 그만큼을 되돌려준다.",
      hp: 56, hpPer: 13, spd: 3.7, armor: 6, critPct: 0,
      stam: 110, stamRegen: 13,
      likes: ["sword", "spear"],
      likesText: "장검 · 장창",
      skills: ["shieldup", "bash", "provoke", "shieldthrow"],
      start: { weapon: "sword", body: "mail" }
    },
    {
      id: "rogue", name: "도적", sprite: "rogue",
      tag: "붙었다 빠진다",
      text: "빠르고 치명타가 높지만 잘 죽는다. 한 방을 노리고 들어갔다 물러난다.",
      hp: 44, hpPer: 10, spd: 4.9, armor: 0, critPct: 10,
      stam: 120, stamRegen: 16,
      likes: ["dagger", "spear", "bow"],
      likesText: "단검 · 장창 · 활",
      skills: ["backstab", "venom", "knives", "smoke"],
      start: { weapon: "dagger", feet: "boots" }
    },
    {
      id: "mage", name: "마법사", sprite: "mage",
      tag: "거리를 둔다",
      /* ⚠ 여기 글은 **그대로 화면에 찍힌다**(esc 를 거친다). 별표 같은 표시를
       *   넣으면 마크다운이 아니라 별표로 보인다 — 실제로 그렇게 나왔다. */
      text: "가장 약하지만 평타가 날아간다. 붙기 전에 끝내는 것이 전부다.",
      hp: 40, hpPer: 9, spd: 4.3, armor: 0, critPct: 4,
      stam: 140, stamRegen: 18,
      likes: ["staff", "bow"],
      likesText: "지팡이 · 활",
      skills: ["burn", "nova", "frost", "lightning"],
      start: { weapon: "staff", body: "robe" }
    }
  ];

  /* ── 1차 전직 목록 (Lv 15 달성 시 선택) ─────────────────────── */
  var ADVANCED_CLASSES = {
    berserker: {
      id: "berserker", base: "warrior", name: "광전사", icon: "warrior",
      tag: "피투성이 폭주", text: "체력과 공격력이 모두 증폭된 분노의 전사. 체력 +10%, 공격력 +15%, 이동속도 +10%.",
      skills: ["bloodrage", "leap"],
      bonuses: { hpMult: 1.10, dmgMult: 1.15, spdMult: 1.10 }
    },
    dreadnought: {
      id: "dreadnought", base: "warrior", name: "드레드노트", icon: "warrior",
      tag: "절대 방벽 파쇄자", text: "상대를 가루로 만드는 파쇄 전사. 체력 +20%, 방어력 +5, 공격력 +5%.",
      skills: ["shatter", "decimate"],
      bonuses: { hpMult: 1.20, armorAdd: 5, dmgMult: 1.05 }
    },
    paladin: {
      id: "paladin", base: "knight", name: "성기사", icon: "knight",
      tag: "신성 가호와 징벌", text: "빛으로 자신을 수호하고 적을 신벌하는 성기사. 체력 +15%, 방어력 +8, 기력회복 +3.",
      skills: ["aegis", "judgment"],
      bonuses: { hpMult: 1.15, armorAdd: 8, stamRegenAdd: 3 }
    },
    darkknight: {
      id: "darkknight", base: "knight", name: "암흑기사", icon: "knight",
      tag: "영혼 수확자", text: "적의 영혼을 갈취하여 본인을 치유하는 마기사. 체력 +10%, 공격력 +15%, 타격회복 +10.",
      skills: ["brand", "souldrain"],
      bonuses: { hpMult: 1.10, dmgMult: 1.15, leechPct: 10 }
    },
    assassin: {
      id: "assassin", base: "rogue", name: "암살자", icon: "rogue",
      tag: "은형의 일격", text: "치명적인 급소를 사냥하는 은신의 사냥꾼. 치명타율 +15%, 치명타피해 +30%, 이동속도 +10%.",
      skills: ["stealth", "fatalslash"],
      bonuses: { critPctAdd: 15, critDmgAdd: 30, spdMult: 1.10 }
    },
    shadowblade: {
      id: "shadowblade", base: "rogue", name: "그림자검", icon: "rogue",
      tag: "환영 춤꾼", text: "분신과 함께 환형으로 이동하며 춤추듯 사냥하는 쾌검사. 이동속도 +20%, 기력회복 +5, 치명타율 +10%.",
      skills: ["mirrorimage", "shadowdance"],
      bonuses: { spdMult: 1.20, stamRegenAdd: 5, critPctAdd: 10 }
    },
    archmage: {
      id: "archmage", base: "mage", name: "대마법사", icon: "mage",
      tag: "원소 폭격", text: "하늘에서 메테오와 연쇄 벼락을 내리치는 대원소 마법사. 스킬 피해 +25%, 기력 +30, 기력회복 +5.",
      skills: ["meteor", "chainlightning"],
      bonuses: { dmgMult: 1.25, stamAdd: 30, stamRegenAdd: 5 }
    },
    necromancer: {
      id: "necromancer", base: "mage", name: "네크로맨서", icon: "mage",
      tag: "사령의 부패", text: "해골 군단을 소환하고 부패의 오라로 사멸시키는 흑마법사. 지속 피해 +30%, 체력 흡수 +8%, 체력 +15%.",
      skills: ["summonundead", "decayaura"],
      bonuses: { hpMult: 1.15, dmgMult: 1.15, leechPct: 8 }
    }
  };

  /* 셋이 함께 쓰는 재주. */
  var SHARED = ["dash", "ward"];

  var ADEPT_BONUS = 25;      /* 적성 무기 피해 % */

  function byId(id) {
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i].id === id) return CLASSES[i];
    return CLASSES[0];
  }

  function getAdvancements(baseId) {
    var res = [];
    for (var k in ADVANCED_CLASSES) {
      if (ADVANCED_CLASSES[k].base === baseId) res.push(ADVANCED_CLASSES[k]);
    }
    return res;
  }

  /* 이 직업이 쓸 수 있는 재주 — **전용 + 공용 + (전직 시) 전직 스킬.** */
  function skillsOf(id, advClass) {
    var baseList = byId(id).skills.concat(SHARED);
    if (advClass && ADVANCED_CLASSES[advClass]) {
      return baseList.concat(ADVANCED_CLASSES[advClass].skills);
    }
    return baseList;
  }

  function canUse(id, skillId, advClass) {
    return skillsOf(id, advClass).indexOf(skillId) >= 0;
  }

  /* 든 무기가 적성인가 */
  function adept(id, item) {
    if (!item || item.slot !== "weapon") return false;
    return byId(id).likes.indexOf(item.base) >= 0;
  }

  /* 표가 스스로 어긋나지 않았는가 — 켤 때 한 번 본다 */
  function audit() {
    var bad = [], seen = {}, i, j;
    var SK = global.SKILLS, I = global.ITEMS;
    for (i = 0; i < CLASSES.length; i++) {
      var c = CLASSES[i];
      if (seen[c.id]) bad.push("직업 id 가 겹친다: " + c.id);
      seen[c.id] = 1;
      /* ⚠ 전용 4개 + 공용 2개 구조 */
      if (c.skills.length !== 4) bad.push(c.name + " 의 전용 재주가 4개가 아니다");
      if (SK) for (j = 0; j < c.skills.length; j++)
        if (!SK.byId(c.skills[j])) bad.push(c.name + " 의 재주 " + c.skills[j] + " 가 없다");
      if (I) for (j = 0; j < c.likes.length; j++)
        if (!I.BASES.weapon.some(function (b) { return b.id === c.likes[j]; }))
          bad.push(c.name + " 의 적성 무기 " + c.likes[j] + " 가 없다");
      /* 시작 장비도 실제로 있는 것이어야 한다 */
      if (I) for (var slot in c.start)
        if (!I.BASES[slot] || !I.BASES[slot].some(function (b) { return b.id === c.start[slot]; }))
          bad.push(c.name + " 의 시작 장비 " + slot + ":" + c.start[slot] + " 가 없다");
      if (!global.SPRITES || !global.SPRITES.data[c.sprite])
        bad.push(c.name + " 의 그림 " + c.sprite + " 가 없다");
    }
    if (SK) for (i = 0; i < SHARED.length; i++)
      if (!SK.byId(SHARED[i])) bad.push("공용 재주 " + SHARED[i] + " 가 없다");
    /* ⚠ **모든 재주가 누군가의 것이어야** 한다. 아무도 못 쓰는 재주는 죽은 표다. */
    if (SK) for (i = 0; i < SK.LIST.length; i++) {
      var id = SK.LIST[i].id;
      var owned = SHARED.indexOf(id) >= 0 ||
        CLASSES.some(function (c) { return c.skills.indexOf(id) >= 0; }) ||
        Object.keys(ADVANCED_CLASSES).some(function (k) { return ADVANCED_CLASSES[k].skills.indexOf(id) >= 0; });
      if (!owned) bad.push("재주 " + id + " 를 아무도 못 쓴다");
    }
    return bad;
  }

  global.CLASSES = {
    LIST: CLASSES, SHARED: SHARED, ADEPT_BONUS: ADEPT_BONUS, ADVANCED_CLASSES: ADVANCED_CLASSES,
    byId: byId, getAdvancements: getAdvancements, skillsOf: skillsOf, skills: skillsOf, canUse: canUse, adept: adept, audit: audit,
    ids: function () { return CLASSES.map(function (c) { return c.id; }); }
  };
})(window);

