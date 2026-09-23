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
  function skillsOf(id) {
    return byId(id).skills.concat(SHARED);
  }

  function canUse(id, skillId) {
    return skillsOf(id).indexOf(skillId) >= 0;
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
        CLASSES.some(function (c) { return c.skills.indexOf(id) >= 0; });
      if (!owned) bad.push("재주 " + id + " 를 아무도 못 쓴다");
    }
    return bad;
  }

  global.CLASSES = {
    LIST: CLASSES, SHARED: SHARED, ADEPT_BONUS: ADEPT_BONUS,
    byId: byId, skillsOf: skillsOf, canUse: canUse, adept: adept, audit: audit,
    ids: function () { return CLASSES.map(function (c) { return c.id; }); }
  };
})(window);
