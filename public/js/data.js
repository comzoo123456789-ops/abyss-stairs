/* 규칙 수치의 유일 소스 — 몬스터 · 무기 · 옵션 · 스킬 · 직업 · 상점.
 *
 * 수치를 화면 코드에 흩어 놓으면 조정할 때마다 여러 파일을 뒤져야 하고 한 곳을 빠뜨린다.
 *
 * 빌드 철학: **정해진 틀이 없다.** 직업은 출발점만 정하고, 그 뒤로는 레벨업 선택 ·
 * 아이템 옵션 · 상점에서 배운 스킬이 쌓여 각자 다른 캐릭터가 된다.
 * 그래서 옵션에 상한을 두지 않는다(같은 옵션이 여러 개 붙으면 그만큼 세진다).
 */
(function (global) {
  "use strict";

  /* ── 상태 이상 ────────────────────────────────────────────
   * 즉발 피해만 있으면 "때린다/맞는다" 뿐이다. 지속 피해가 있으면
   * "지금 싸울까 빠질까" 라는 결정이 생긴다 — D&D 전투의 긴장 대부분이 여기서 온다. */
/* 상태이상.
   *
   * ⚠ **수치를 깎는 것보다 행동을 바꾸는 쪽이 세다.** 같은 네 턴이라도 "공격력이
   *   조금 준다" 는 안 읽히고 "등을 돌린다" 는 바로 읽힌다. 그래서 새로 넣는
   *   넷 중 셋(둔화·실명·공포)은 **행동**을 바꾼다.
   * ⚠ 몬스터와 플레이어에 **같은 이름이 다른 뜻**이 되지 않게 적어 둔다.
   *   한쪽에만 뜻이 있는 것은 여기 주석에 명시한다.
   *
   *   perTurn  턴마다 깎는 체력
   *   spd      속도를 이만큼 더한다(음수면 느려진다). 플레이어가 걸리면 상대적으로
   *            몬스터가 빨라진다 — monsterTurn 의 pace 참조
   *   sight    플레이어 시야 반경을 이만큼 더한다. 몬스터는 플레이어를 못 찾는다
   *   flee     몬스터가 등을 돌린다. 플레이어는 공격력이 깎인다(atkMul)
   *   takeMore 받는 피해가 이 비율만큼 는다(양쪽 다) */
  var AILMENTS = {
    poison: { name: "중독", turns: 4, perTurn: 4, color: "#6ec06e", tone: "bad" },
    bleed:  { name: "출혈", turns: 3, perTurn: 7, color: "#e05a5a", tone: "bad" },
    burn:   { name: "화상", turns: 2, perTurn: 7, color: "#ff8c3a", tone: "bad" },
    stun:   { name: "기절", turns: 1, perTurn: 0, color: "#e8d44a", tone: "warn" },
    slow:   { name: "둔화", turns: 4, perTurn: 0, spd: -25, color: "#7fa8c9", tone: "warn" },
    blind:  { name: "실명", turns: 3, perTurn: 0, sight: -4, color: "#9b8fb0", tone: "warn" },
    fear:   { name: "공포", turns: 3, perTurn: 0, flee: true, atkMul: 0.7, color: "#c77fd8", tone: "warn" },
    weak:   { name: "취약", turns: 4, perTurn: 0, takeMore: 0.18, color: "#d8a24a", tone: "warn" }
  };

  /* ── 무기 종류 ────────────────────────────────────────────
   * 같은 "공격력 +5" 가 아니라 **종류마다 성격이 다르다**. 그래야 무엇을 줍는지가
   * 결정이 된다. atkMul 은 기본 공격력 배수, 나머지는 그 무기를 들면 붙는 태생 옵션. */
  var WEAPON_KINDS = [
    { id: "sword",  name: "검",     atkMul: 1.00, base: { crit: 0.02 },
      hint: "균형. 치명타가 조금 붙는다" },
    { id: "axe",    name: "도끼",   atkMul: 1.28, base: { critMult: 0.35 },
      hint: "무겁다. 피해와 치명타 배수가 높다" },
    { id: "dagger", name: "단검",   atkMul: 0.72, base: { crit: 0.12, ailChance: 0.10 },
      hint: "가볍다. 치명타와 상태이상이 잘 터진다" },
    { id: "staff",  name: "지팡이", atkMul: 0.80, base: { skillPower: 0.30, cdReduce: 1 },
      hint: "스킬이 세지고 쿨다운이 줄어든다" },
    { id: "bow",    name: "활",     atkMul: 0.92, base: { crit: 0.05 }, ranged: 6,
      hint: "F 키로 멀리서 쏜다(6칸)" },
    { id: "spear",  name: "창",     atkMul: 1.10, base: {}, reach: 2,
      hint: "두 칸 앞까지 찌른다" }
  ];

  /* 무기 기본 이름 — 종류 × 티어. RPG 는 이름이 많아야 줍는 재미가 있다. */
  var WEAPON_NAMES = {
    sword:  [["녹슨 검", "짧은 검"], ["장검", "기사검"], ["강철 대검", "십자검"], ["룬 각인검", "심연강 검"]],
    axe:    [["손도끼", "나무꾼 도끼"], ["전투 도끼", "쌍날 도끼"], ["대부월", "처형 도끼"], ["룬 대부월", "심연강 도끼"]],
    dagger: [["단검", "부엌칼"], ["가르는 칼", "송곳검"], ["암살자 단검", "독니"], ["그림자 송곳", "심연강 단검"]],
    staff:  [["나무 지팡이", "옹이 지팡이"], ["은장 지팡이", "부적 지팡이"], ["수정 홀", "별빛 지팡이"], ["심연의 홀", "측량자의 지팡이"]],
    bow:    [["사냥 활", "짧은 활"], ["장궁", "뿔활"], ["합판궁", "저격 활"], ["심연현 장궁", "별 가르는 활"]],
    spear:  [["나무 창", "낚시 작살"], ["보병창", "갈고리창"], ["기병창", "삼지창"], ["심연강 창", "관통자"]]
  };

  var ARMOR_NAMES = [
    ["천 옷", "가죽 조각"], ["가죽 갑옷", "징 박힌 가죽"],
    ["사슬 갑옷", "비늘 갑옷"], ["판금 갑옷", "심연강 판금"]
  ];
  var OFFHAND_NAMES = [
    ["나무 방패", "냄비 뚜껑"], ["둥근 방패", "징 방패"],
    ["연꼴 방패", "강철 방패"], ["탑 방패", "심연강 방패"]
  ];

  /* ── 등급 ─────────────────────────────────────────────────
   * 색으로 한눈에 갈린다(Diablo·Dead Cells 방식). 등급이 높으면 옵션이 더 붙는다. */
  var RARITY = [
    { id: "common", name: "일반", color: "#b5afa1", affixes: 0, mul: 1.00, weight: 46 },
    { id: "magic",  name: "고급", color: "#5b8ec4", affixes: 1, mul: 1.12, weight: 30 },
    { id: "rare",   name: "희귀", color: "#d8c24a", affixes: 2, mul: 1.26, weight: 17 },
    { id: "relic",  name: "유물", color: "#e0742a", affixes: 3, mul: 1.44, weight: 7 }
  ];

  /* ── 아이템 옵션(접두·접미) ───────────────────────────────
   * ⚠ 상한을 두지 않는다. 같은 옵션이 셋 붙으면 셋만큼 세진다 —
   *   그게 "정해진 틀 없이 스스로 쌓는 빌드" 의 전부다(Risk of Rain 2 방식). */
  /* ⚠ pre 는 **형용사형**, suf 는 **관형격(~의)** 으로 통일한다.
   *   이름은 `관형격 + 형용사 + 기본명` 으로 조립한다 — 한국어는 수식어가 다 앞에 온다.
   *   처음엔 접미를 뒤에 붙여 "약초사의 은장 지팡이 처형의" 처럼 나왔다(비문이다).
   *   pre 에 관형격을 섞어 두면 "처형의 약초사의 …" 로 '의' 가 겹치므로 섞지 말 것. */
  var AFFIXES = [
    { id: "crit",      stat: "crit",       label: "치명타 확률",     per: 0.04, unit: "%",  pre: "날카로운",   suf: "예리함의" },
    { id: "critMult",  stat: "critMult",   label: "치명타 피해",     per: 0.20, unit: "%",  pre: "잔혹한",     suf: "처형의" },
    { id: "ailChance", stat: "ailChance",  label: "상태이상 확률",   per: 0.09, unit: "%",  pre: "독 서린",    suf: "역병의" },
    { id: "ailPower",  stat: "ailPower",   label: "상태이상 피해",   per: 0.25, unit: "%",  pre: "곪은",       suf: "부패의" },
    { id: "atk",       stat: "atkFlat",    label: "공격력",          per: 2,    unit: "",   pre: "사나운",     suf: "힘의" },
    { id: "def",       stat: "defFlat",    label: "방어력",          per: 1,    unit: "",   pre: "단단한",     suf: "수호의" },
    { id: "hp",        stat: "hpFlat",     label: "최대 체력",       per: 9,    unit: "",   pre: "강인한",     suf: "생명의" },
    { id: "skill",     stat: "skillPower", label: "스킬 피해",       per: 0.16, unit: "%",  pre: "주문 새긴",  suf: "비술의" },
    { id: "cd",        stat: "cdReduce",   label: "스킬 쿨다운",     per: 1,    unit: "턴", pre: "신속한",     suf: "질풍의" },
    { id: "steal",     stat: "lifesteal",  label: "생명 흡수",       per: 0.05, unit: "%",  pre: "피 마른",    suf: "갈증의" },
    { id: "potion",    stat: "potionBoost",label: "물약 효과",       per: 0.18, unit: "%",  pre: "약초 섞인",  suf: "치유의" },
    { id: "gold",      stat: "goldBoost",  label: "금화 획득",       per: 0.20, unit: "%",  pre: "반짝이는",   suf: "부귀의" }
  ];

  /* ── 스킬 ─────────────────────────────────────────────────
   * 직업이 스킬을 하나 갖고 시작하고, 레벨업·상점에서 최대 4개까지 모은다.
   * 단계(rank)를 올리면 세지고 쿨다운이 줄어든다 — 넓게 갈지 깊게 갈지가 선택이다. */
  var SKILLS = [
    { id: "cleave", name: "강타",      kind: "cleave", cd: 5,  power: 1.9, range: 1,
      desc: "주위 8칸의 모든 적을 공격력의 190%로 때린다" },
    { id: "throw",  name: "투척 단검", kind: "throw",  cd: 7,  power: 1.35, range: 5,
      desc: "5칸 안 가장 가까운 적에게 135% 피해" },
    { id: "blast", ail: "burn",  name: "화염 폭발", kind: "blast",  cd: 7,  power: 0,  range: 2, flat: [10, 6],
      desc: "반경 2칸에 (10 + 레벨×6) 피해 + 화상" },
    { id: "charge", name: "돌진",      kind: "charge", cd: 6,  power: 1.6, range: 4,
      desc: "보이는 적에게 달려들어 160% 피해 + 기절" },
    { id: "venom",  name: "독 뿌리기", kind: "ail",    cd: 6,  power: 0.5, range: 2, ail: "poison",
      desc: "반경 2칸에 중독을 건다 (확률 판정 없음)" },
    { id: "mend",   name: "응급 처치", kind: "heal",   cd: 12, power: 0.38,
      desc: "최대 체력의 38%를 회복하고 상태이상을 씻는다" },
    { id: "drain",  name: "생명 흡수", kind: "drain",  cd: 8,  power: 1.2, range: 4,
      desc: "4칸 안 적에게 120% 피해, 그만큼 회복" },
    { id: "ward",   name: "방벽",      kind: "ward",   cd: 10, power: 0.30,
      desc: "최대 체력의 30%를 흡수하는 막 (다음 피해부터)" },
    { id: "quake", ail: "slow",  name: "지진",      kind: "quake",  cd: 11, power: 1.4, range: 3,
      desc: "반경 3칸에 140% 피해 + 기절 + 둔화" },
    { id: "hunt", ail: "weak",   name: "저격",      kind: "snipe",  cd: 5,  power: 2.2, range: 8,
      desc: "8칸 안 가장 먼 적에게 220% 피해 + 취약 (치명타 확률 2배)" }
  ];

  /* 스킬 단계 — 단계당 배수와 쿨다운 변화 */
  var SKILL_MAX_RANK = 4;
  function skillPowerAt(sk, rank) { return sk.power * (1 + (rank - 1) * 0.28); }
  function skillCdAt(sk, rank) { return Math.max(2, sk.cd - (rank - 1)); }
  function skillFlatAt(sk, rank, level) {
    if (!sk.flat) return 0;
    return Math.round((sk.flat[0] + level * sk.flat[1]) * (1 + (rank - 1) * 0.28));
  }

  /* ── 레벨업 선택지 ────────────────────────────────────────
   * 매번 3개를 제시하고 하나를 고른다(Hades·Caves of Qud 방식).
   * 능력치와 스킬이 같은 풀에서 나오므로 "세로로 깊게" 와 "가로로 넓게" 가 경쟁한다. */
  /* ── 구역 ─────────────────────────────────────────────
   *
   * 1층부터 10층까지 돌벽 하나로 똑같이 생겼었다. 열 층을 내려가는데 **내려가는
   * 느낌이 없다** — 숫자만 올라갈 뿐이다. 두 층씩 묶어 다섯 구역으로 가른다.
   *
   * 세계관(관리소 장부)을 따라간다. 위쪽은 아직 사람 손이 닿은 곳이고,
   * 내려갈수록 먼저 간 사람들의 흔적이 나오다가, 마지막에 군주의 것이 된다.
   *
   * ⚠ 규칙은 **하나도 안 바꾼다.** 구역은 색·장식·문구만 바꾼다. 여기서 몬스터나
   *   난이도를 함께 건드리면 손잡이 하나에 두 가지가 달려 균형 조정이 불가능해진다
   *   (보스 배수에서 이미 겪었다 — 0.16 → 0.30 하나로 승률이 95% → 10% 가 됐다).
   * ⚠ 밝기를 구역마다 크게 바꾸지 말 것. 바닥이 어두워지면 그 위의 도트가 안 보인다 —
   *   **색상만 돌리고 명도는 붙잡는다**(UI 팔레트를 갈색으로 돌릴 때와 같은 규칙).
   */
  var ZONES = [
    { id: "office", from: 1, to: 2,
      name: "관리소 아래", tag: "아직 사람 손이 닿은 곳",
      enter: "관리소 아래. 벽에 아직 등불 자국이 남아 있다.",
      props: ["crate", "lantern", "torch"],
      floor: { mortar: "#1e1b26", face: "#302b3a", lit: "#3a3446", dim: "#272233",
               grain1: "#363040", grain2: "#2a2534", crack: "#241f2e",
               peb1: "#423b4e", peb2: "#4a4257", peb3: "#332d3e" },
      wall:  { mortar: "#3c3846", face: "#585264", lit: "#6d6679", dim: "#433e4e",
               grain1: "#615b6e", grain2: "#4e4859", moss: "#3f5040" } },

    { id: "flood", from: 3, to: 4,
      name: "물이 든 계단실", tag: "어딘가에서 물이 새어 든다",
      enter: "물이 든 계단실. 발밑이 미끄럽고, 어디선가 물 떨어지는 소리가 난다.",
      props: ["puddle", "moss", "torch"],
      floor: { mortar: "#161d24", face: "#243038", lit: "#2d3b45", dim: "#1c262d",
               grain1: "#2a3740", grain2: "#1f2a31", crack: "#1a2228",
               peb1: "#33434d", peb2: "#3c4e59", peb3: "#27333b" },
      wall:  { mortar: "#2c3a42", face: "#455a64", lit: "#57707c", dim: "#374750",
               grain1: "#4d646f", grain2: "#3e5159", moss: "#3f5a45" } },

    { id: "library", from: 5, to: 6,
      name: "이름의 도서관", tag: "지워진 이름들이 쌓여 있다",
      enter: "이름의 도서관. 장부가 천장까지 쌓여 있고, 펼쳐진 쪽은 전부 비어 있다.",
      props: ["books", "papers", "torch"],
      floor: { mortar: "#221c14", face: "#352c1f", lit: "#42381f", dim: "#2a2218",
               grain1: "#3d3324", grain2: "#2e261a", crack: "#261f15",
               peb1: "#4a3f2b", peb2: "#564931", peb3: "#3a3022" },
      wall:  { mortar: "#413522", face: "#5f5033", lit: "#786540", dim: "#4a3e28",
               grain1: "#6b5a39", grain2: "#54462d", moss: "#5a5230" } },

    { id: "bones", from: 7, to: 8,
      name: "뼈 무덤", tag: "먼저 내려간 사람들",
      enter: "뼈 무덤. 밟을 때마다 무언가가 바스러진다 — 전부 사람 것이다.",
      props: ["bones", "skull", "torch"],
      floor: { mortar: "#201a1a", face: "#332a28", lit: "#3f3531", dim: "#291f1e",
               grain1: "#3b312d", grain2: "#2c2422", crack: "#241c1b",
               peb1: "#4a403a", peb2: "#574b44", peb3: "#372e2b" },
      wall:  { mortar: "#3d3330", face: "#5c4f49", lit: "#75665e", dim: "#493d38",
               grain1: "#67594f", grain2: "#4f4239", moss: "#5c5346" } },

    { id: "lord", from: 9, to: 10,
      name: "군주의 방", tag: "벽이 숨을 쉰다",
      enter: "군주의 방. 벽이 따뜻하고, 어딘가 아주 느리게 뛰고 있다.",
      props: ["blood", "vein", "torch"],
      /* ⚠ 처음 값은 분홍으로 읽혔다(6배로 늘려 보고 알았다). 마른 피 쪽으로
       *   채도를 내렸다 — 밝기는 그대로 두어 그 위의 도트가 묻히지 않게. */
      floor: { mortar: "#1b1317", face: "#2b2024", lit: "#36282d", dim: "#231b1e",
               grain1: "#32262a", grain2: "#261d20", crack: "#1f171b",
               peb1: "#3f3135", peb2: "#4a393e", peb3: "#322629" },
      wall:  { mortar: "#33252b", face: "#4d383e", lit: "#61474d", dim: "#3e2c31",
               grain1: "#583f45", grain2: "#443137", moss: "#553739" } }
  ];

  /* 층 → 구역. ⚠ 못 찾으면 마지막 구역을 준다 — null 을 돌려주면 그리는 쪽이
   *   통째로 빈 화면이 된다(있을 수 없는 일이라고 두지 말 것). */
  function zoneAt(depth) {
    for (var i = 0; i < ZONES.length; i++) {
      if (depth >= ZONES[i].from && depth <= ZONES[i].to) return ZONES[i];
    }
    return ZONES[ZONES.length - 1];
  }

  /* ── 유물 ─────────────────────────────────────────────
   *
   * 특성(PERKS)은 **숫자**를 올린다(공격 +3, 치명 +6%). 그것만으로는 판이 매번
   * 비슷하다 — 쌓이는 값이 다를 뿐 하는 짓이 같기 때문이다. 유물은 **규칙 자체**를
   * 바꾼다. Hades·Slay the Spire·Balatro 가 중독성을 얻은 자리가 정확히 여기다
   * ("조커가 규칙을 점점 말도 안 되게 깨뜨린다").
   *
   * ⚠ 유물은 **하나마다 대가가 있거나, 없으면 조건이 좁아야 한다.** 그냥 좋기만 하면
   *   매번 같은 것을 고르게 되어 특성과 다를 바가 없어진다(DCSS 의 "압도적인 하나를
   *   없앤다" 와 같은 이유).
   * ⚠ 같은 유물을 두 번 주지 않는다 — 배수가 겹치면 균형이 통째로 무너진다.
   * ⚠ 효과는 **game.js 의 정해진 자리에서만** 읽는다(hasRelic). 여기저기서 읽으면
   *   어디가 그 유물 때문인지 추적이 안 된다.
   */
  var RELICS = [
    { id: "r_brush", name: "두 번 새기는 붓", cost: 240,
      note: "중독·출혈이 두 배로 오래 간다",
      why: "상태이상 확률을 올렸다면 여기서 값이 난다" },

    { id: "r_blank", name: "빈 이름", cost: 300,
      note: "치명타가 터지면 체력 25% 이하인 적은 그 자리에서 지워진다",
      why: "치명타 확률 빌드의 끝" },

    { id: "r_reverse", name: "거꾸로 읽는 장부", cost: 260,
      note: "체력이 낮을수록 공격이 오른다 (빈사에서 최대 +70%)",
      why: "도망치지 않고 버티는 빌드" },

    { id: "r_hourglass", name: "깨진 모래시계", cost: 280,
      note: "스킬 쿨다운이 턴마다 2씩 줄어든다",
      why: "스킬을 두 배로 쓴다" },

    { id: "r_scales", name: "탐욕의 저울", cost: 150,
      note: "금화가 두 배로 들어온다 · 대신 최대 체력이 20% 준다",
      why: "상점에서 되사는 빌드" },

    /* ⚠ 처음엔 "처치당 최대 체력 +2, 상한 없음" 이었다. 한 판에 100마리 넘게 잡으니
     *   최대 체력이 세 배가 되어 **승률 +36%p**. +1·상한 50 으로 묶어도 +16~22%p 였다 —
     *   체력 기반이 직업마다 달라(62 vs 38) 같은 상한이 배수로는 전혀 다른 값이다.
     *   그래서 **능력치를 불리는 것을 그만두고 회복으로 바꿨다.** 최대 체력이 천장이라
     *   저절로 묶이고, 특성(숫자 올리기)과 성격도 갈린다. */
    { id: "r_bloodblade", name: "피를 먹는 검", cost: 240,
      note: "적을 쓰러뜨릴 때마다 체력이 4 회복된다",
      why: "물약 없이 밀고 나간다 — 많이 잡을수록 버틴다" },

    { id: "r_thorns", name: "가시 갑옷", cost: 230,
      note: "맞으면 받은 피해의 30%를 되돌려 준다",
      why: "방어를 올릴수록 되돌리는 값이 커진다" },

    { id: "r_stairs", name: "계단의 기억", cost: 250,
      note: "층을 내려갈 때마다 체력을 30% 회복한다",
      why: "물약을 아껴 다른 데 쓴다" },

    /* ⚠ 대가가 "전부 깨어 있다" 였을 때 셰라 −12.5%p · 오르넬 −8.8%p 였다 —
     *   물러서서 싸우는 직업에게는 그냥 나쁜 유물이라 아무도 안 고른다.
     *   대가를 **감지 범위**로 바꿔 등급을 낮췄다(8칸 → 14칸). */
    { id: "r_lordseye", name: "군주의 눈", cost: 200,
      note: "층 전체가 보인다 · 대신 몬스터가 두 배 멀리서 나를 알아챈다",
      why: "계단을 바로 찾는다 — 도망치는 빌드" },

    /* ⚠ 대가를 두 번 낮췄다. "상인이 오지 않는다" → 전 직업 −14~−20%p,
     *   "상인 값 +60%" → 여전히 −14~−20%p. 상점은 이 게임에서 빌드를 만드는
     *   자리라 조금만 건드려도 판이 무너진다. **대가를 없앴다** — 대신 값을 낮춰
     *   약한 유물로 둔다. 모든 유물이 크게 흔들릴 필요는 없다. */
    { id: "r_memory", name: "남의 기억", cost: 140,
      note: "물약이 전부 정체를 드러낸 채 나온다 (마시기 전에 안다)",
      why: "물약을 아끼지 않고 쓴다 — 독을 밟을 일이 없다" }
  ];

  /* 레벨업 선택지에 유물이 섞일 확률. ⚠ 너무 높이면 특성·스킬이 밀려 빌드가
   *   유물 수집으로 바뀐다. 3분의 1쯤이 적당하다(실측으로 조정). */
  var RELIC_CHANCE = 0.34;

  var PERKS = [
    { id: "p_atk",   label: "공격력 +3",        note: "평타와 스킬이 함께 세진다", stat: "atkFlat",   amt: 3 },
    { id: "p_def",   label: "방어력 +2",        note: "받는 피해가 비율로 줄어든다", stat: "defFlat",  amt: 2 },
    { id: "p_hp",    label: "최대 체력 +22",    note: "실수를 한 번 더 견딘다", stat: "hpFlat",      amt: 22 },
    { id: "p_crit",  label: "치명타 확률 +6%",  note: "치명타 빌드의 주축", stat: "crit",           amt: 0.06 },
    { id: "p_cdmg",  label: "치명타 피해 +30%", note: "확률이 있어야 값이 난다", stat: "critMult",   amt: 0.30 },
    { id: "p_ailc",  label: "상태이상 확률 +12%", note: "때릴 때 독·출혈이 걸린다", stat: "ailChance", amt: 0.12 },
    { id: "p_ailp",  label: "상태이상 피해 +35%", note: "걸어 둔 독이 더 아프다", stat: "ailPower",  amt: 0.35 },
    { id: "p_skill", label: "스킬 피해 +22%",   note: "스킬 위주 빌드", stat: "skillPower",         amt: 0.22 },
    { id: "p_cd",    label: "스킬 쿨다운 −1턴", note: "스킬을 더 자주", stat: "cdReduce",           amt: 1 },
    { id: "p_steal", label: "생명 흡수 +6%",    note: "때리면서 회복한다", stat: "lifesteal",        amt: 0.06 },
    { id: "p_pot",   label: "물약 효과 +25%",   note: "회복이 커진다", stat: "potionBoost",         amt: 0.25 },
    { id: "p_gold",  label: "금화 획득 +30%",   note: "상점을 더 쓴다", stat: "goldBoost",          amt: 0.30 }
  ];

  /* ── 몬스터 ───────────────────────────────────────────────
   * ⚠ 아이템·빌드가 세지므로 몬스터도 깊이에 따라 함께 오른다(scaleAt).
   *   고정 수치로 두면 5층부터 아무 저항이 없어진다. */
  /* 행동 값(js/game.js 의 spawn 과 stepMonster 가 읽는다):
   *   spd     100 이 사람과 같은 속도. 150 이면 두 턴에 세 걸음이다.
   *   ranged  이 칸 수 안에서 보이면 던진다. 붙으면 그냥 때린다.
   *   timid   체력이 이 비율 밑으로 내려가면 등을 돌린다.
   *   summon  {id, every, max}
   *   swing   화면이 그릴 공격 모양(기본 claw)
   * ⚠ **행동은 수치보다 세게 느껴진다.** 같은 공격력이라도 멀리서 던지는 놈과
   *   붙어야 때리는 놈은 전혀 다른 상대다. 수치를 올리기 전에 여기를 먼저 본다. */
  var MONSTERS = [
    { id: "rat",      name: "굶주린 쥐", sprite: "rat",      hp: 7,   atk: 3,  def: 0, xp: 3,   depth: 1, last: 3,  weight: 10, timid: 0.30 },
    /* ⚠ 고블린은 2층부터다. 1층에 섞었더니 300판 중 32판이 1층에서 끝났다 —
     *   시작하자마자 죽는 게임은 다시 안 하게 된다. 1층은 쥐만 나오는 연습 층이다. */
    { id: "goblin",   name: "고블린",    sprite: "goblin",   hp: 13,  atk: 5,  def: 1, xp: 8,   depth: 2, last: 5,  weight: 10, timid: 0.25 },
    /* 투석꾼 — **이 게임 첫 원거리 몬스터다.** 이것이 생겨야 모서리와 엄폐가
     * 처음으로 의미를 가진다. 맷집을 낮게 두어 "먼저 저놈부터" 가 정답이 되게 한다.
     * ⚠ 3층부터다. 1~2층은 연습 층으로 두되 너무 늦게 가르치면 뒤에서 처음 만나
     *   억울하게 죽는다.
     * ⚠ **원거리는 수치보다 훨씬 세다.** 실측(120판/직업): 속도·도망·소환 셋을
     *   합쳐도 승률이 3.0%p 밖에 안 떨어졌는데, 투석꾼 하나를 weight 6 · 사거리 5 ·
     *   공격 4 로 넣자 **9.5%p** 가 더 떨어졌다(46.7% → 37.2%). 붙기까지 공짜로
     *   맞는 횟수가 곧 난이도다 — 사거리를 한 칸 줄이는 것이 공격력을 깎는 것보다
     *   크게 먹는다. 여기 값을 만질 때는 반드시 다시 잴 것. */
    { id: "slinger",  name: "고블린 투석꾼", sprite: "slinger", hp: 10, atk: 3, def: 0, xp: 12, depth: 3, last: 7, weight: 4,
      ranged: 4, swing: "stone", timid: 0.35 },
    /* ── 구역 전속 ──────────────────────────────────
     * 구역은 다섯인데 나오는 놈이 겹쳐서 1층과 9층의 싸움이 같았다.
     * 구역마다 하나씩, **지금 몬스터 출처가 없던 상태이상**을 들려 보낸다
     * (둔화·실명·공포는 스킬에만 있었다). */
    { id: "mist",     name: "물안개",     sprite: "mist",     hp: 18, atk: 6,  def: 0, xp: 18, depth: 3, last: 5,  weight: 7,
      ail: "slow", spd: 80 },
    { id: "inkling",  name: "먹물 그림자", sprite: "inkling",  hp: 22, atk: 8,  def: 1, xp: 26, depth: 5, last: 8,  weight: 4,
      ail: "blind", ranged: 3, swing: "stone" },
    { id: "archer",   name: "해골 궁수",   sprite: "archer",   hp: 20, atk: 9,  def: 1, xp: 34, depth: 7, last: 10, weight: 4,
      ranged: 5, swing: "stone", timid: 0.30 },
    { id: "eraser",   name: "지운 자",     sprite: "eraser",   hp: 40, atk: 16, def: 4, xp: 70, depth: 9, last: 10, weight: 6,
      ail: "fear", spd: 130 },
    { id: "skeleton", name: "해골 병사", sprite: "skeleton", hp: 20,  atk: 7,  def: 2, xp: 16,  depth: 3, last: 8,  weight: 8, ail: "bleed" },
    { id: "orc",      name: "오크 전사", sprite: "orc",      hp: 30,  atk: 10, def: 3, xp: 28,  depth: 4, last: 10, weight: 8 },
    /* 망령은 **빠르다**(두 턴에 세 걸음). 걸어서는 절대 못 떼어놓는 상대가
     * 하나는 있어야 "도망" 이 상대를 보고 정하는 판단이 된다. */
    { id: "wraith",   name: "망령",      sprite: "wraith",   hp: 24,  atk: 13, def: 1, xp: 38,  depth: 6, last: 10, weight: 6, ail: "poison", spd: 150 },
    { id: "troll",    name: "동굴 트롤", sprite: "troll",    hp: 52,  atk: 15, def: 5, xp: 60,  depth: 7, last: 10, weight: 5 },
    /* ⚠ 보스 수치는 여기서 직접 잡는다(층 배수를 안 받는다).
     *   10층 플레이어는 방어 30~40 이라 공격 24 로는 한 대에 9 밖에 안 들어간다 —
     *   마지막 벽이 되려면 이 정도가 필요하다.
     *   실측(40판/직업): 1150/44 → 승률 43·53·43% · 보스층 사망 17 ·
     *                     1400/52 → 28·38·33% · 보스층 사망 33. */
    { id: "lord",     name: "심연의 군주", sprite: "lord",   hp: 1150, atk: 44, def: 16, xp: 900, depth: 99, last: 99, weight: 0, boss: true, ail: "bleed",
      summon: { id: "skeleton", every: 7, max: 2 } }
  ];

  /* 깊이 배수 — 층이 깊어질수록 같은 종류도 강해진다 */
  /* 값은 눈대중이 아니라 훑어서 골랐다(scratchpad/sweep2.mjs).
   * 실측 승률: 0.16 → 95% · 0.35 → 88% · 0.45 → 75% · 0.55 → 50~60%.
   * ⚠ 빌드에 상한이 없으니(그게 요구사항이다) 균형은 **여기 기울기**로 잡는다.
   *   플레이어가 세지는 것을 깎는 대신 몬스터를 같이 올린다.
   * ⚠ 보스는 이 배수를 받지 않는다 — js/game.js 의 spawn 주석 참조. */
  function scaleAt(depth) {
    return { hp: 1 + (depth - 1) * 0.55, atk: 1 + (depth - 1) * 0.32, def: 1 + (depth - 1) * 0.21 };
  }

  /* 엘리트 — 이름에 접두가 붙고 두 배로 위험하다(DCSS 방식).
   * 깊을수록 자주 나오고, 보상(경험치·금화)도 그만큼 크다. */
  var ELITES = [
    { id: "plague", pre: "역병에 걸린", hp: 1.7, atk: 1.15, xp: 2.4, ail: "poison" },
    { id: "brute",  pre: "거대한",     hp: 2.1, atk: 1.30, xp: 2.6 },
    { id: "razor",  pre: "칼날 박힌",  hp: 1.5, atk: 1.25, xp: 2.4, ail: "bleed" },
    { id: "elder",  pre: "늙은",       hp: 1.9, atk: 1.10, xp: 2.2, def: 1.6 }
  ];
  function eliteChance(depth) { return Math.min(0.26, Math.max(0, (depth - 2) * 0.035)); }

  /* ── 소모품 ───────────────────────────────────────────────
   * ⚠ potion 은 전부 미식별로 나온다 — 마셔 봐야 안다. 그래서 독이 섞여 있다.
   *   나쁜 것이 하나도 없으면 "일단 다 마신다" 가 정답이 되어 선택이 사라진다. */
  var CONSUMABLES = [
    { id: "heal_s",  name: "치유 물약",     sprite: "potion", kind: "potion", effect: "heal",  power: 30,  depth: 1, weight: 14, cost: 28,  desc: "체력을 30 회복한다." },
    { id: "heal_l",  name: "고급 치유 물약", sprite: "potion", kind: "potion", effect: "heal",  power: 70,  depth: 4, weight: 7,  cost: 62,  desc: "체력을 70 회복한다." },
    { id: "might",   name: "힘의 물약",     sprite: "potion", kind: "potion", effect: "might", power: 3,   depth: 3, weight: 5,  cost: 80,  desc: "공격력이 영구히 3 오른다." },
    { id: "vigor",   name: "활력의 물약",   sprite: "potion", kind: "potion", effect: "vigor", power: 14,  depth: 3, weight: 5,  cost: 80,  desc: "최대 체력이 영구히 14 오른다." },
    { id: "venomp",  name: "독 물약",       sprite: "potion", kind: "potion", effect: "venom", power: 16,  depth: 2, weight: 6,  cost: 0,   desc: "삼키는 순간 속이 타들어 간다. 큰 피해." },
    { id: "cure",    name: "해독 물약",     sprite: "potion", kind: "potion", effect: "cure",  power: 0,   depth: 3, weight: 5,  cost: 34,  desc: "상태이상을 모두 씻는다." },

    { id: "fire",    name: "화염 두루마리", sprite: "scroll", kind: "scroll", effect: "fire",  power: 26,  depth: 2, weight: 8, cost: 46, desc: "주변 3칸의 모든 적에게 26 피해." },
    { id: "bolt",    name: "번개 두루마리", sprite: "scroll", kind: "scroll", effect: "bolt",  power: 38,  depth: 2, weight: 8, cost: 46, desc: "보이는 가장 가까운 적에게 38 피해." },
    { id: "blink",   name: "도약 두루마리", sprite: "scroll", kind: "scroll", effect: "blink", power: 0,   depth: 2, weight: 6, cost: 38, desc: "이 층의 무작위 위치로 순간이동한다." },
    { id: "mapping", name: "지도 두루마리", sprite: "scroll", kind: "scroll", effect: "map",   power: 0,   depth: 2, weight: 6, cost: 38, desc: "이 층의 지형과 함정이 드러난다." },
    { id: "forge",   name: "벼림 두루마리", sprite: "scroll", kind: "scroll", effect: "forge", power: 0,   depth: 3, weight: 5, cost: 120, desc: "착용 중인 장비 하나에 옵션을 하나 더 붙인다." },

    { id: "gold",    name: "금화",          sprite: "gold",   kind: "gold",   power: 0,  depth: 1, weight: 16, cost: 0, desc: "장비와 스킬을 산다." }
  ];

  /* 미식별 물약 겉모습. 판마다 섞여서 "붉은 물약" 이 매번 다른 물건이다.
   * ⚠ 개수가 물약 종류 수보다 많아야 한다 — 모자라면 두 물약이 같은 이름을 갖는다. */
  var POTION_LOOKS = [
    { label: "붉은 물약",   color: "#e05a5a" },
    { label: "푸른 물약",   color: "#5a8ae0" },
    { label: "초록 물약",   color: "#5ac077" },
    { label: "보랏빛 물약", color: "#a06ad0" },
    { label: "탁한 물약",   color: "#a89060" },
    { label: "은빛 물약",   color: "#c8ced8" },
    { label: "금빛 물약",   color: "#e0c04a" },
    { label: "검은 물약",   color: "#6a6478" }
  ];

  /* ── 직업 — 출발점만 정한다 ───────────────────────────────
   * 세 인물은 모두 「지워진 이름」 때문에 내려간다. 그 사연이 생김새에 있다.
   * ⚠ 여기서 정하는 것은 시작 수치·시작 장비·시작 스킬뿐이다.
   *   그 뒤로는 레벨업 선택과 아이템 옵션이 캐릭터를 만든다. */
  var CLASSES = [
    {
      id: "warrior", name: "다인", title: "성문 수비대장", sprite: "warrior", age: "38세",
      why: "부하 40명의 이름을 되찾으려고",
      story: "6년 전 심연에서 무언가가 올라온 「검은 밤」에 부하 40명을 잃고 혼자 살아남았다. " +
             "그들의 이름은 이미 지워졌고, 기억하는 사람은 다인 하나뿐이다.",
      hp: 62, atk: 6, def: 2, hpPerLevel: 13, atkPerLevel: 2, defPerLevel: 1,
      base: { crit: 0.05, critMult: 1.8 },
      startWeapon: { kind: "sword", tier: 0 }, startArmor: 1, startOffhand: true,
      skill: "cleave",
      blurb: "맷집이 좋고 방패를 든다. 무엇을 쌓아도 버티는 쪽."
    },
    {
      id: "rogue", name: "셰라", title: "쫓겨난 필경생", sprite: "rogue", age: "19세",
      why: "베껴 적은 이름들을 지키려고",
      story: "관리소 장부에서 지워지는 이름을 몰래 베껴 적다가 들켜 쫓겨났다. " +
             "심연에서 나온 물건을 팔아 그 장부를 한 장씩 사들이는 중이다.",
      hp: 44, atk: 6, def: 0, hpPerLevel: 9, atkPerLevel: 3, defPerLevel: 0,
      base: { crit: 0.14, critMult: 1.9, ailChance: 0.10, goldBoost: 0.4 },
      startWeapon: { kind: "dagger", tier: 0 }, startArmor: 0,
      skill: "throw", evade: 0.14, trapSense: true,
      blurb: "치명타와 상태이상이 잘 터지고 금화를 더 줍는다. 방어는 자라지 않는다."
    },
    {
      id: "mage", name: "오르넬", title: "심연을 측량한 학자", sprite: "mage", age: "나이 불명",
      why: "자기 이름을 되찾으려고",
      story: "심연을 처음 측량해 지도를 그린 사람이다. 그 대가로 이름이 절반 지워져 " +
             "스스로도 제 이름을 확신하지 못한다.",
      hp: 38, atk: 4, def: 0, hpPerLevel: 8, atkPerLevel: 2, defPerLevel: 0.5,
      base: { crit: 0.04, critMult: 1.8, skillPower: 0.35, cdReduce: 1 },
      startWeapon: { kind: "staff", tier: 0 }, startArmor: 0,
      skill: "blast", scrollBoost: 1.5,
      blurb: "몸이 약한 대신 스킬과 두루마리가 세다. 스킬 빌드의 출발점."
    }
  ];

  /* 레벨업에 필요한 누적 경험치 */
  var XP_TABLE = [0, 20, 55, 105, 175, 270, 395, 555, 755, 1000, 1300, 1660, 2090, 2600, 3200];
  var MAX_DEPTH = 10;
  var BAG_MAX = 18;
  var SKILL_SLOTS = 4;

  /* ── 층 구성 ──────────────────────────────────────────── */
  function monsterCount(depth) {
    var n = 4 + Math.floor(depth * 1.35);
    if (depth >= MAX_DEPTH) n = Math.floor(n * 0.45);
    return n;
  }
  function itemCount(depth) { return 2 + Math.floor(depth * 0.45); }
  function trapCount(depth) { return Math.min(7, Math.floor(depth * 0.8)); }
  function trapDamage(depth) { return 6 + depth * 3; }

  var TREASURE_CHANCE = 0.4;
  var TREASURE_ITEMS = 3;
  var TREASURE_GUARDS = 2;

  /* 상점 — 2층마다. 금화가 점수판 숫자로만 남으면 탐험할 이유가 준다. */
  function hasShop(depth) { return depth % 2 === 0 && depth < MAX_DEPTH; }
  var SHOP_ITEMS = 5;
  var SHOP_SKILLS = 2;
  function skillCost(depth, rank) { return Math.round((90 + depth * 24) * (1 + (rank - 1) * 0.7)); }

  /* ── 뽑기 ───────────────────────────────────────────────── */
  function pick(table, depth, rng) {
    var pool = [], total = 0, i, e, w;
    for (i = 0; i < table.length; i++) {
      e = table[i];
      if (e.weight <= 0) continue;
      if (depth < e.depth) continue;
      if (e.last && depth > e.last) continue;
      w = e.weight + Math.min(6, depth - e.depth);
      total += w;
      pool.push({ e: e, w: w });
    }
    if (!pool.length) return null;
    var r = rng() * total;
    for (i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) return pool[i].e;
    }
    return pool[pool.length - 1].e;
  }

  function byId(table, id) {
    for (var i = 0; i < table.length; i++) if (table[i].id === id) return table[i];
    return null;
  }

  global.DATA = {
    AILMENTS: AILMENTS,
    WEAPON_KINDS: WEAPON_KINDS, WEAPON_NAMES: WEAPON_NAMES,
    ARMOR_NAMES: ARMOR_NAMES, OFFHAND_NAMES: OFFHAND_NAMES,
    RARITY: RARITY, AFFIXES: AFFIXES,
    SKILLS: SKILLS, SKILL_MAX_RANK: SKILL_MAX_RANK, SKILL_SLOTS: SKILL_SLOTS,
    skillPowerAt: skillPowerAt, skillCdAt: skillCdAt, skillFlatAt: skillFlatAt,
    PERKS: PERKS,
    MONSTERS: MONSTERS, scaleAt: scaleAt, ELITES: ELITES, eliteChance: eliteChance,
    CONSUMABLES: CONSUMABLES, ITEMS: CONSUMABLES,   /* 옛 이름 호환 */
    POTION_LOOKS: POTION_LOOKS,
    CLASSES: CLASSES, XP_TABLE: XP_TABLE, MAX_DEPTH: MAX_DEPTH, BAG_MAX: BAG_MAX,
    TREASURE_CHANCE: TREASURE_CHANCE, TREASURE_ITEMS: TREASURE_ITEMS, TREASURE_GUARDS: TREASURE_GUARDS,
    hasShop: hasShop, SHOP_ITEMS: SHOP_ITEMS, SHOP_SKILLS: SHOP_SKILLS, skillCost: skillCost,
    RELICS: RELICS, RELIC_CHANCE: RELIC_CHANCE,
    ZONES: ZONES, zoneAt: zoneAt,
    monsterCount: monsterCount, itemCount: itemCount, trapCount: trapCount, trapDamage: trapDamage,
    pick: pick, byId: byId
  };
})(window);
