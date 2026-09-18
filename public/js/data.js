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
  var AILMENTS = {
    poison: { name: "중독", turns: 4, perTurn: 4, color: "#6ec06e", tone: "bad" },
    bleed:  { name: "출혈", turns: 3, perTurn: 7, color: "#e05a5a", tone: "bad" },
    stun:   { name: "기절", turns: 1, perTurn: 0, color: "#e8d44a", tone: "warn" }
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
    { id: "blast",  name: "화염 폭발", kind: "blast",  cd: 7,  power: 0,  range: 2, flat: [10, 6],
      desc: "반경 2칸에 (10 + 레벨×6) 피해" },
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
    { id: "quake",  name: "지진",      kind: "quake",  cd: 11, power: 1.4, range: 3,
      desc: "반경 3칸에 140% 피해 + 기절" },
    { id: "hunt",   name: "저격",      kind: "snipe",  cd: 5,  power: 2.2, range: 8,
      desc: "8칸 안 가장 먼 적에게 220% 피해 (치명타 확률 2배)" }
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
  var MONSTERS = [
    { id: "rat",      name: "굶주린 쥐", sprite: "rat",      hp: 7,   atk: 3,  def: 0, xp: 3,   depth: 1, last: 4,  weight: 10 },
    /* ⚠ 고블린은 2층부터다. 1층에 섞었더니 300판 중 32판이 1층에서 끝났다 —
     *   시작하자마자 죽는 게임은 다시 안 하게 된다. 1층은 쥐만 나오는 연습 층이다. */
    { id: "goblin",   name: "고블린",    sprite: "goblin",   hp: 13,  atk: 5,  def: 1, xp: 8,   depth: 2, last: 6,  weight: 10 },
    { id: "skeleton", name: "해골 병사", sprite: "skeleton", hp: 20,  atk: 7,  def: 2, xp: 16,  depth: 3, last: 8,  weight: 8, ail: "bleed" },
    { id: "orc",      name: "오크 전사", sprite: "orc",      hp: 30,  atk: 10, def: 3, xp: 28,  depth: 4, last: 10, weight: 8 },
    { id: "wraith",   name: "망령",      sprite: "wraith",   hp: 24,  atk: 13, def: 1, xp: 38,  depth: 6, last: 10, weight: 6, ail: "poison" },
    { id: "troll",    name: "동굴 트롤", sprite: "troll",    hp: 52,  atk: 15, def: 5, xp: 60,  depth: 7, last: 10, weight: 5 },
    /* ⚠ 보스 수치는 여기서 직접 잡는다(층 배수를 안 받는다).
     *   10층 플레이어는 방어 30~40 이라 공격 24 로는 한 대에 9 밖에 안 들어간다 —
     *   마지막 벽이 되려면 이 정도가 필요하다.
     *   실측(40판/직업): 1150/44 → 승률 43·53·43% · 보스층 사망 17 ·
     *                     1400/52 → 28·38·33% · 보스층 사망 33. */
    { id: "lord",     name: "심연의 군주", sprite: "lord",   hp: 1150, atk: 44, def: 16, xp: 900, depth: 99, last: 99, weight: 0, boss: true, ail: "bleed" }
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
      hp: 38, atk: 4, def: 0, hpPerLevel: 8, atkPerLevel: 2, defPerLevel: 1,
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
    monsterCount: monsterCount, itemCount: itemCount, trapCount: trapCount, trapDamage: trapDamage,
    pick: pick, byId: byId
  };
})(window);
