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

  /* 셋이 함께 쓰는 재주. */
  var SHARED = ["dash", "ward"];

  var ADEPT_BONUS = 25;      /* 적성 무기 피해 % */

  function byId(id) {
    for (var i = 0; i < CLASSES.length; i++) if (CLASSES[i].id === id) return CLASSES[i];
    return CLASSES[0];
  }

  /* 이 직업이 쓸 수 있는 재주 — **전용 + 공용.**
   * ⚠ 순서가 곧 손잡이 기본 배치다. 전용을 앞에 둔다(그게 그 직업의 정체다). */
  /* ── 1차 전직 (Lv.15) ─────────────────────────────────── */
  var ADVANCEMENTS = {
    warrior: [
      {
        id: "berserker", name: "광전사", base: "warrior", reqLvl: 15,
        tag: "피의 폭주",
        text: "체력이 깎일수록 피의 광란을 일으키며 생명력을 흡수하는 죽음의 투사.",
        skills: ["bloodrage", "leap"],
        bonusText: "HP +15% · 공격속도 +15% · 흡혈 +10%"
      },
      {
        id: "dreadnought", name: "파괴자", base: "warrior", reqLvl: 15,
        tag: "대지 파괴",
        text: "묵직한 한 방으로 대지를 뒤흔들고 적의 방어구를 부수는 중장거리 파괴자.",
        skills: ["shatter", "decimate"],
        bonusText: "피해량 +20% · 방어력 +10 · 넉백거리 +50%"
      }
    ],
    knight: [
      {
        id: "paladin", name: "성기사", base: "knight", reqLvl: 15,
        tag: "신성한 수호",
        text: "천상의 빛으로 무적 결계를 치며 신성 심판을 내리는 요새.",
        skills: ["aegis", "judgment"],
        bonusText: "방어력 +15 · 피해 반사 +20% · 신성 피해 +25%"
      },
      {
        id: "darkknight", name: "암흑기사", base: "knight", reqLvl: 15,
        tag: "영혼 흡수",
        text: "적에게 암흑 저주를 걸고 영혼을 빨아들여 버티는 저주받은 기사.",
        skills: ["brand", "souldrain"],
        bonusText: "HP +20% · 흡혈 +12% · 저주 피해 +20%"
      }
    ],
    rogue: [
      {
        id: "assassin", name: "암살자", base: "rogue", reqLvl: 15,
        tag: "그림자 암습",
        text: "은신 상태로 순간이동하여 급소를 베어 강렬한 치명타를 가하는 섀도우.",
        skills: ["stealth", "fatalslash"],
        bonusText: "치명타율 +15% · 치명타 피해 +50% · 이동속도 +10%"
      },
      {
        id: "shadowblade", name: "섀도우댄서", base: "rogue", reqLvl: 15,
        tag: "환영 난무",
        text: "분신을 생성하고 화면 전체를 가르는 초고속 그림자 난무를 펼치는 댄서.",
        skills: ["mirrorimage", "shadowdance"],
        bonusText: "공격속도 +25% · 회피율 +15% · 이동속도 +15%"
      }
    ],
    mage: [
      {
        id: "archmage", name: "원소술사", base: "mage", reqLvl: 15,
        tag: "파멸의 원소",
        text: "하늘에서 거대한 운석을 떨어뜨리고 연쇄 전뇌를 쏘아 대지를 잿더미로 만드는 대마법사.",
        skills: ["meteor", "chainlightning"],
        bonusText: "기력 회복 +8 · 마법 피해 +30% · 사거리 +2.0"
      },
      {
        id: "necromancer", name: "사령술사", base: "mage", reqLvl: 15,
        tag: "언데드 군단",
        text: "언데드 해골 군단을 부리고 부패의 아우라로 적들을 서서히 좀먹는 흑마법사.",
        skills: ["summonundead", "decayaura"],
        bonusText: "소환수 체력 +40% · 저주 피해 +25% · 기력 +30"
      }
    ]
  };

  function advancementsOf(baseId) {
    return ADVANCEMENTS[baseId] || [];
  }

  function advancementById(advId) {
    if (!advId) return null;
    for (var k in ADVANCEMENTS) {
      var list = ADVANCEMENTS[k];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === advId) return list[i];
      }
    }
    return null;
  }

  function skillsOf(heroOrId, advId) {
    var baseId = (typeof heroOrId === "object" && heroOrId) ? heroOrId.cls : heroOrId;
    var aId = advId || (typeof heroOrId === "object" && heroOrId ? heroOrId.advClass : null);
    var list = byId(baseId).skills.concat(SHARED);
    if (aId) {
      var adv = advancementById(aId);
      if (adv && adv.skills) {
        for (var s = 0; s < adv.skills.length; s++) {
          if (list.indexOf(adv.skills[s]) < 0) list.push(adv.skills[s]);
        }
      }
    }
    return list;
  }

  function canUse(heroOrId, skillId, advId) {
    return skillsOf(heroOrId, advId).indexOf(skillId) >= 0;
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
      if (c.skills.length !== 4) bad.push(c.name + " 의 전용 재주가 4개가 아니다");
      if (SK) for (j = 0; j < c.skills.length; j++)
        if (!SK.byId(c.skills[j])) bad.push(c.name + " 의 재주 " + c.skills[j] + " 가 없다");
      if (I) for (j = 0; j < c.likes.length; j++)
        if (!I.BASES.weapon.some(function (b) { return b.id === c.likes[j]; }))
          bad.push(c.name + " 의 적성 무기 " + c.likes[j] + " 가 없다");
      if (I) for (var slot in c.start)
        if (!I.BASES[slot] || !I.BASES[slot].some(function (b) { return b.id === c.start[slot]; }))
          bad.push(c.name + " 의 시작 장비 " + slot + ":" + c.start[slot] + " 가 없다");
      if (!global.SPRITES || !global.SPRITES.data[c.sprite])
        bad.push(c.name + " 의 그림 " + c.sprite + " 가 없다");
    }
    if (SK) for (i = 0; i < SHARED.length; i++)
      if (!SK.byId(SHARED[i])) bad.push("공용 재주 " + SHARED[i] + " 가 없다");
    return bad;
  }

  global.CLASSES = {
    LIST: CLASSES, SHARED: SHARED, ADEPT_BONUS: ADEPT_BONUS, ADVANCEMENTS: ADVANCEMENTS,
    byId: byId, skillsOf: skillsOf, skills: skillsOf, canUse: canUse, adept: adept, audit: audit,
    advancementsOf: advancementsOf, advancementById: advancementById,
    ids: function () { return CLASSES.map(function (c) { return c.id; }); }
  };
})(window);
