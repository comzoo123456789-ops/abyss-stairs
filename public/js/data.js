/* 몬스터·아이템 표 — 밸런스는 전부 여기서만 고친다.
 *
 * 수치를 화면 코드에 흩어 놓으면 조정할 때마다 여러 파일을 뒤져야 하고
 * 한 곳을 빠뜨린다. 게임 규칙 숫자는 이 파일이 유일 소스다.
 */
(function (global) {
  "use strict";

  /* depth: 등장 시작 층 · last: 마지막 층(없으면 끝까지)
   * weight: 뽑기 가중치 — 깊어질수록 강한 놈이 흔해지게 둔다. */
  var MONSTERS = [
    { id: "rat",      name: "굶주린 쥐",   sprite: "rat",      hp: 6,   atk: 3,  def: 0, xp: 3,   depth: 1, last: 4,  weight: 10, speed: 1 },
    /* ⚠ 고블린은 2층부터다. 1층에 섞었더니 300판 중 32판(10.7%)이 1층에서 끝났다 —
     *   시작하자마자 죽는 게임은 다시 안 하게 된다. 1층은 쥐만 나오는 연습 층이다. */
    { id: "goblin",   name: "고블린",      sprite: "goblin",   hp: 12,  atk: 5,  def: 1, xp: 8,   depth: 2, last: 6,  weight: 10, speed: 1 },
    { id: "skeleton", name: "해골 병사",   sprite: "skeleton", hp: 18,  atk: 7,  def: 2, xp: 16,  depth: 3, last: 8,  weight: 8,  speed: 1 },
    { id: "orc",      name: "오크 전사",   sprite: "orc",      hp: 28,  atk: 10, def: 3, xp: 28,  depth: 4, last: 10, weight: 8,  speed: 1 },
    { id: "wraith",   name: "망령",        sprite: "wraith",   hp: 22,  atk: 13, def: 1, xp: 38,  depth: 6, last: 10, weight: 6,  speed: 1 },
    { id: "troll",    name: "동굴 트롤",   sprite: "troll",    hp: 48,  atk: 15, def: 5, xp: 60,  depth: 7, last: 10, weight: 5,  speed: 1 },
    { id: "lord",     name: "심연의 군주", sprite: "lord",     hp: 140, atk: 22, def: 7, xp: 500, depth: 99, last: 99, weight: 0, speed: 1, boss: true }
  ];

  /* ── 직업 ────────────────────────────────────────────────
   *
   * 셋이 같은 게임을 다르게 풀어야 의미가 있다. 능력치만 다르면 "센 쪽" 하나만 쓰게 된다.
   *   전사   버티고 때린다 — 체력·방어가 높고 능력은 인접 전체 광역
   *   도적   맞기 전에 끝낸다 — 회피가 있고 능력은 짧은 쿨의 원거리 투척
   *   마법사 물러서서 지운다 — 약하지만 능력이 범위 폭발이고 두루마리가 강해진다
   *
   * ability: kind 로 동작을 가른다 · cd = 쿨다운(턴) · power 는 공격력 배수 또는 고정값 */
  var CLASSES = [
    {
      id: "warrior", name: "전사", sprite: "warrior",
      hp: 58, atk: 6, def: 2, hpPerLevel: 14, atkPerLevel: 2, defPerLevel: 1,
      start: ["dagger", "leather"],
      evade: 0, scrollBoost: 1, goldBoost: 1,
      ability: { name: "강타", kind: "cleave", cd: 6, power: 1.9, range: 1,
                 desc: "인접한 모든 적에게 공격력의 1.9배 피해" },
      blurb: "실수를 한 번은 견딘다. 가장 멀리 가지만 마무리 화력은 약하다. 처음이라면 이쪽."
    },
    {
      id: "rogue", name: "도적", sprite: "rogue",
      hp: 40, atk: 6, def: 0, hpPerLevel: 8, atkPerLevel: 3, defPerLevel: 0,
      start: ["dagger"],
      evade: 0.14, scrollBoost: 1, goldBoost: 1.5,
      ability: { name: "투척 단검", kind: "throw", cd: 7, power: 1.35, range: 7,
                 desc: "보이는 가장 가까운 적에게 원거리로 공격력의 1.35배 피해" },
      blurb: "화력은 가장 세지만 방어가 자라지 않는다. 14% 회피와 함정 감지로 버틴다."
    },
    {
      id: "mage", name: "마법사", sprite: "mage",
      hp: 36, atk: 4, def: 0, hpPerLevel: 9, atkPerLevel: 2, defPerLevel: 1,
      start: ["dagger", "bolt"],
      evade: 0, scrollBoost: 1.6, goldBoost: 1,
      ability: { name: "화염 폭발", kind: "blast", cd: 7, power: 0, range: 2,
                 desc: "반경 2칸의 모든 적에게 (10 + 레벨×6) 피해" },
      blurb: "몸이 약한 대신 폭발과 두루마리가 세다. 위치를 읽을 줄 알아야 한다."
    }
  ];

  /* 미식별 물약에 붙는 겉모습. 판마다 섞여서 "붉은 물약" 이 매번 다른 물건이다.
   * ⚠ 개수가 물약 종류 수보다 많아야 한다 — 모자라면 두 물약이 같은 이름을 갖는다. */
  var POTION_LOOKS = [
    { label: "붉은 물약",   color: "#e05a5a" },
    { label: "푸른 물약",   color: "#5a8ae0" },
    { label: "초록 물약",   color: "#5ac077" },
    { label: "보랏빛 물약", color: "#a06ad0" },
    { label: "탁한 물약",   color: "#a89060" },
    { label: "은빛 물약",   color: "#c8ced8" },
    { label: "금빛 물약",   color: "#e0c04a" }
  ];

  /* 아이템. kind 가 동작을 가른다:
   *   potion/scroll = 소모품 · weapon/armor = 장비 · gold = 줍는 즉시 점수
   * ⚠ potion 은 전부 미식별로 나온다 — 마셔 봐야 무엇인지 안다. 그래서 독이 섞여 있다.
   *   나쁜 것이 하나도 없으면 "일단 다 마신다" 가 정답이 되어 선택이 사라진다. */
  var ITEMS = [
    { id: "heal_s",  name: "치유 물약",     sprite: "potion", kind: "potion", effect: "heal",  power: 26,  depth: 1, weight: 14, desc: "체력을 26 회복한다." },
    { id: "heal_l",  name: "고급 치유 물약", sprite: "potion", kind: "potion", effect: "heal",  power: 62,  depth: 4, weight: 7,  desc: "체력을 62 회복한다." },
    { id: "might",   name: "힘의 물약",     sprite: "potion", kind: "potion", effect: "might", power: 2,   depth: 3, weight: 5,  desc: "공격력이 영구히 2 오른다." },
    { id: "vigor",   name: "활력의 물약",   sprite: "potion", kind: "potion", effect: "vigor", power: 10,  depth: 3, weight: 5,  desc: "최대 체력이 영구히 10 오른다." },
    { id: "venom",   name: "독 물약",       sprite: "potion", kind: "potion", effect: "venom", power: 14,  depth: 2, weight: 6,  desc: "삼키는 순간 속이 타들어 간다. 큰 피해." },

    { id: "fire",    name: "화염 두루마리", sprite: "scroll", kind: "scroll", effect: "fire",  power: 22,  depth: 2, weight: 8,  desc: "주변 3칸의 모든 적에게 22 피해." },
    { id: "bolt",    name: "번개 두루마리", sprite: "scroll", kind: "scroll", effect: "bolt",  power: 32,  depth: 2, weight: 8,  desc: "보이는 가장 가까운 적에게 32 피해." },
    { id: "blink",   name: "도약 두루마리", sprite: "scroll", kind: "scroll", effect: "blink", power: 0,   depth: 2, weight: 6,  desc: "이 층의 무작위 위치로 순간이동한다." },
    { id: "mapping", name: "지도 두루마리", sprite: "scroll", kind: "scroll", effect: "map",   power: 0,   depth: 2, weight: 6,  desc: "이 층의 지형이 전부 드러난다." },

    { id: "dagger",  name: "단검",          sprite: "sword",  kind: "weapon", power: 2,  depth: 1, weight: 8, desc: "공격력 +2" },
    { id: "sword",   name: "장검",          sprite: "sword",  kind: "weapon", power: 5,  depth: 3, weight: 7, desc: "공격력 +5" },
    { id: "axe",     name: "전투 도끼",     sprite: "sword",  kind: "weapon", power: 8,  depth: 5, weight: 6, desc: "공격력 +8" },
    { id: "blade",   name: "룬 각인검",     sprite: "sword",  kind: "weapon", power: 12, depth: 7, weight: 4, desc: "공격력 +12" },

    { id: "leather", name: "가죽 갑옷",     sprite: "armor",  kind: "armor",  power: 1,  depth: 1, weight: 8, desc: "방어력 +1" },
    { id: "chain",   name: "사슬 갑옷",     sprite: "armor",  kind: "armor",  power: 3,  depth: 3, weight: 7, desc: "방어력 +3" },
    { id: "plate",   name: "판금 갑옷",     sprite: "armor",  kind: "armor",  power: 5,  depth: 5, weight: 6, desc: "방어력 +5" },
    { id: "rune",    name: "룬 판금",       sprite: "armor",  kind: "armor",  power: 8,  depth: 7, weight: 4, desc: "방어력 +8" },

    { id: "gold",    name: "금화",          sprite: "gold",   kind: "gold",   power: 0,  depth: 1, weight: 16, desc: "점수에 더해진다." }
  ];

  /* 레벨업에 필요한 누적 경험치. 마지막 값을 넘기면 더 안 오른다. */
  var XP_TABLE = [0, 20, 55, 110, 190, 300, 450, 650, 900, 1250, 1700];

  var MAX_DEPTH = 10;

  /* 층별 생성 개수 — 깊을수록 몬스터가 늘고 아이템은 완만하게 는다.
   *
   * ⚠ 기울기를 1.8 로 뒀더니 10층에 22마리가 깔렸다. 후반 몬스터(트롤 공격 15 ·
   *   망령 13)는 한 마리가 이미 위협이라, 그 수는 보스에 닿기 전에 체력을 다 태운다 —
   *   실측: 10층에 도달한 287판 중 234판(82%)이 거기서 끝났다.
   * ⚠ 보스 층은 별도로 반으로 줄인다. 그 층의 내용은 보스이지 잡몹이 아니다. */
  /* 값은 눈대중이 아니라 훑어서 골랐다(scratchpad/sweep.mjs · 기울기 × 보스층비율).
   * 실측: 1.2 → 승률 76.5% · 1.35 → 58.5% · 1.5 → 36% · 1.65 → 23%.
   * 1~9층 사망은 밀도와 거의 무관했고(18~28건) 보스층만 29 → 134 로 요동쳤다. */
  function monsterCount(depth) {
    var n = 4 + Math.floor(depth * 1.6);
    if (depth >= MAX_DEPTH) n = Math.floor(n * 0.45);
    return n;
  }

  /* ⚠ 아이템을 넉넉히 뿌리면 물약이 쌓여 중반이 통째로 무난해진다 —
   *   실측에서 1~9층 사망이 300판 중 5판까지 떨어졌다(긴장이 보스에만 몰림).
   *   깊어질수록 늘긴 하되 층당 회복 한 병 남짓으로 조인다. */
  function itemCount(depth) { return 2 + Math.floor(depth * 0.4); }

  /* 함정 — 밟기 전에는 안 보인다(도적만 인접하면 알아챈다).
   * 깊어질수록 늘지만 상한을 둔다 — 바닥이 함정밭이면 운 게임이 된다. */
  function trapCount(depth) { return Math.min(7, Math.floor(depth * 0.8)); }
  function trapDamage(depth) { return 6 + depth * 3; }

  /* 보물방 — 문을 닫아 둔 작은 방에 아이템을 몰아 두고 지키는 적을 붙인다.
   * 2층부터, 층마다 40% 확률. 항상 있으면 특별하지 않고 없으면 탐험할 이유가 준다. */
  var TREASURE_CHANCE = 0.4;
  var TREASURE_ITEMS = 3;
  var TREASURE_GUARDS = 2;

  /* 가중치 뽑기. depth 로 후보를 먼저 거르고, 깊이가 맞을수록 가중치를 올린다. */
  function pick(table, depth, rng) {
    var pool = [], total = 0, i, e, w;
    for (i = 0; i < table.length; i++) {
      e = table[i];
      if (e.weight <= 0) continue;
      if (depth < e.depth) continue;
      if (e.last && depth > e.last) continue;
      /* 등장 층에서 멀어질수록 살짝 흔해진다(= 익숙한 적이 쌓인다) */
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
    MONSTERS: MONSTERS,
    ITEMS: ITEMS,
    CLASSES: CLASSES,
    POTION_LOOKS: POTION_LOOKS,
    XP_TABLE: XP_TABLE,
    MAX_DEPTH: MAX_DEPTH,
    TREASURE_CHANCE: TREASURE_CHANCE,
    TREASURE_ITEMS: TREASURE_ITEMS,
    TREASURE_GUARDS: TREASURE_GUARDS,
    monsterCount: monsterCount,
    itemCount: itemCount,
    trapCount: trapCount,
    trapDamage: trapDamage,
    pick: pick,
    byId: byId
  };
})(window);
