/* 콘텐츠 표 — 구역 · 몬스터 · 보스. **수치의 단일 진실원이다.**
 *
 * ⚠ 구역 팔레트는 턴제판에서 그대로 가져왔다(색을 다시 고르는 품이 크고, 이미
 *   실측으로 다듬은 값이다). 층 범위만 30층에 맞춰 다시 나눴다. 제안은 "테마 셋"
 *   이었지만 **다섯 벌이 이미 있어서 다섯으로 간다** — 여섯 층마다 풍경이 바뀌는
 *   편이 열 층마다 바뀌는 것보다 덜 지루하다.
 *
 * ⚠ 몬스터는 **행동이 다른 것**만 둔다. 이름과 숫자만 다른 것을 늘리면
 *   "쥐가 더 센 쥐" 가 될 뿐 전투가 달라지지 않는다. 다섯 가지 행동:
 *     melee    붙어서 때린다        — 몰려온다
 *     archer   거리를 두고 쏜다     — 쫓아가야 한다
 *     mage     장판을 깐다          — 자리를 옮겨야 한다
 *     healer   동료를 고친다        — **먼저 잡아야 한다**
 *     breaker  내 버프를 걷어낸다   — 버프를 아껴 써야 한다
 *
 * ⚠ 층 배수는 statsAt() **한 곳에서만** 곱한다. 소환하는 쪽에서 또 곱하면
 *   두 배가 되고, 그건 눈으로 절대 못 잡는다.
 */
(function (global) {
  "use strict";

  var ZONES = [
    /* ⚠ 1구역은 전에 "관리소 아래"(보스 관리인) 였다. 사용자 결정으로
     *   **묘지**로 바꿨다. 색은 던전 기본(자주빛 돌)이 아니라 **흙과 이끼**다 —
     *   같은 돌을 쓰면 아무리 꾸며도 아래 구역과 같은 곳으로 보인다. */
    { id: "grave", from: 1, to: 6, boss: "b_gravekeeper",
      /* 구역 중간보스 — 얼굴과 성격만 준다. 능력치는 그 층에서 뽑는다 */
      mid: "b_gravekeeper",
      name: "묘지", tag: "여기서부터 아래로 내려간다",
      enter: "묘지. 비뚤어진 묘비 사이로 계단이 아래로 뚫려 있다.",
      props: ["grave", "deadtree", "torch"],
      floor: { mortar: "#14120d", face: "#211d15", lit: "#2a2419", dim: "#1a1711",
               grain1: "#262117", grain2: "#1d1912", crack: "#17140e",
               peb1: "#332d20", peb2: "#3a3325", peb3: "#292418" },
      wall:  { mortar: "#3f4436", face: "#5f6650", lit: "#7c8468", dim: "#484e3d",
               grain1: "#6d745b", grain2: "#545b47", moss: "#6d8a4a" } },

    { id: "flood", from: 7, to: 12, boss: "b_drowned",
      /* 구역 중간보스 — 얼굴과 성격만 준다. 능력치는 그 층에서 뽑는다 */
      mid: "b_warden",
      name: "물이 든 계단실", tag: "어딘가에서 물이 새어 든다",
      enter: "물이 든 계단실. 발밑이 미끄럽고, 어디선가 물 떨어지는 소리가 난다.",
      props: ["puddle", "moss", "torch"],
      floor: { mortar: "#10151a", face: "#1a2328", lit: "#202a32", dim: "#141b20",
               grain1: "#1e282e", grain2: "#161e23", crack: "#13181d",
               peb1: "#253037", peb2: "#2b3840", peb3: "#1c252a" },
      wall:  { mortar: "#395a5b", face: "#598989", lit: "#76a4a4", dim: "#476d6e",
               grain1: "#649898", grain2: "#507a78", moss: "#567b52" } },

    { id: "library", from: 13, to: 18, boss: "b_librarian",
      /* 구역 중간보스 — 얼굴과 성격만 준다. 능력치는 그 층에서 뽑는다 */
      mid: "b_librarian",
      name: "이름의 도서관", tag: "지워진 이름들이 쌓여 있다",
      enter: "이름의 도서관. 장부가 천장까지 쌓여 있고, 펼쳐진 쪽은 전부 비어 있다.",
      props: ["books", "papers", "torch"],
      floor: { mortar: "#18140e", face: "#262016", lit: "#302816", dim: "#1e1811",
               grain1: "#2c251a", grain2: "#211b13", crack: "#1b160f",
               peb1: "#352d1f", peb2: "#3e3523", peb3: "#2a2318" },
      wall:  { mortar: "#5a382a", face: "#845640", lit: "#a66c50", dim: "#674332",
               grain1: "#946147", grain2: "#744b38", moss: "#7d5b3c" } },

    { id: "bones", from: 19, to: 24, boss: "b_ossuary",
      name: "뼈 무덤", tag: "먼저 내려간 사람들",
      enter: "뼈 무덤. 밟을 때마다 무언가가 바스러진다 — 전부 사람 것이다.",
      props: ["bones", "skull", "torch"],
      floor: { mortar: "#171313", face: "#251e1d", lit: "#2d2623", dim: "#1e1616",
               grain1: "#2a2320", grain2: "#201a18", crack: "#1a1413",
               peb1: "#352e2a", peb2: "#3f3631", peb3: "#28211f" },
      wall:  { mortar: "#533f41", face: "#7d6060", lit: "#9c807f", dim: "#64494a",
               grain1: "#8c6b67", grain2: "#6c4d4a", moss: "#7d645c" } },

    { id: "lord", from: 25, to: 30,
      name: "군주의 방", tag: "벽이 숨을 쉰다",
      enter: "군주의 방. 벽이 따뜻하고, 어딘가 아주 느리게 뛰고 있다.",
      props: ["blood", "vein", "torch"],
      /* ⚠ 처음 값은 분홍으로 읽혔다(6배로 늘려 보고 알았다). 마른 피 쪽으로
       *   채도를 내렸다 — 밝기는 그대로 두어 그 위의 도트가 묻히지 않게. */
      floor: { mortar: "#130e11", face: "#1f171a", lit: "#271d20", dim: "#191316",
               grain1: "#241b1e", grain2: "#1b1517", crack: "#161113",
               peb1: "#2d2326", peb2: "#35292d", peb3: "#241b1e" },
      wall:  { mortar: "#463041", face: "#69495d", lit: "#855d73", dim: "#55394a",
               grain1: "#785268", grain2: "#5d4053", moss: "#754759" } }
  ];

  function zoneAt(depth) {
    for (var i = 0; i < ZONES.length; i++)
      if (depth >= ZONES[i].from && depth <= ZONES[i].to) return ZONES[i];
    return ZONES[ZONES.length - 1];
  }

  /* ── 몬스터 ─────────────────────────────────────────────
   * hp·dmg 는 **1층 기준**이다. w 는 그 층에서 뽑힐 가중치. */
  var MOBS = [
    { id: "rat", name: "쥐", sprite: "rat", brain: "melee",
      from: 1, hp: 14, dmg: 4, spd: 3.0, xp: 8, gold: 2, w: 30,
      swing: { aps: 0.85, windup: 0.32, recover: 0.30, reach: 0.95, arc: 120, push: 0.15 } },

    { id: "goblin", name: "고블린", sprite: "goblin", brain: "melee",
      from: 3, hp: 24, dmg: 7, spd: 3.6, xp: 14, gold: 4, w: 26,
      swing: { aps: 1.00, windup: 0.28, recover: 0.26, reach: 1.05, arc: 100, push: 0.25 } },

    { id: "slinger", name: "투석꾼", sprite: "slinger", brain: "archer",
      from: 4, hp: 18, dmg: 6, spd: 3.2, xp: 16, gold: 5, w: 18,
      shot: { cd: 2.2, cast: 0.55, speed: 9, range: 8.0, keep: 4.5 } },

    { id: "archer", name: "사수", sprite: "archer", brain: "archer",
      from: 9, hp: 26, dmg: 11, spd: 3.4, xp: 26, gold: 8, w: 16,
      shot: { cd: 1.8, cast: 0.45, speed: 13, range: 9.5, keep: 5.5 } },

    { id: "mist", name: "안개", sprite: "mist", brain: "mage",
      from: 7, hp: 22, dmg: 5, spd: 2.6, xp: 24, gold: 7, w: 14,
      field: { cd: 5.0, cast: 0.8, r: 2.1, dur: 4.0, tick: 0.7, range: 6.0 } },

    { id: "wraith", name: "망령", sprite: "wraith", brain: "mage",
      from: 15, hp: 34, dmg: 9, spd: 3.0, xp: 40, gold: 12, w: 13,
      field: { cd: 4.2, cast: 0.7, r: 2.6, dur: 5.0, tick: 0.55, range: 7.0 } },

    { id: "inkling", name: "잉크물", sprite: "inkling", brain: "healer",
      from: 11, hp: 26, dmg: 3, spd: 3.4, xp: 34, gold: 10, w: 11,
      heal: { cd: 3.2, cast: 0.6, amount: 14, range: 5.5, flee: 3.2 } },

    { id: "eraser", name: "지우개", sprite: "eraser", brain: "breaker",
      from: 13, hp: 30, dmg: 8, spd: 3.5, xp: 38, gold: 11, w: 10,
      strip: { cd: 6.0, cast: 0.75, range: 5.0 },
      swing: { aps: 0.9, windup: 0.30, recover: 0.28, reach: 1.05, arc: 100, push: 0.2 } },

    { id: "skeleton", name: "해골", sprite: "skeleton", brain: "melee",
      from: 13, hp: 40, dmg: 12, spd: 3.3, xp: 44, gold: 13, w: 20,
      swing: { aps: 0.95, windup: 0.30, recover: 0.28, reach: 1.15, arc: 110, push: 0.35 } },

    { id: "orc", name: "오크", sprite: "orc", brain: "melee",
      from: 19, hp: 60, dmg: 18, spd: 3.1, xp: 60, gold: 18, w: 18, r: 0.40,
      swing: { aps: 0.70, windup: 0.40, recover: 0.34, reach: 1.30, arc: 130, push: 0.70 } },

    /* ── 언데드 셋 — **묘지(1구역) 주민.**
     * ⚠ hp·dmg 는 **1층 기준**이다. from 을 앞으로 당기면 수치도 함께 내려야
     *   한다 — 19층 기준(55/16)을 그대로 두면 2층에서 만나 죽는다.
     *   깊은 층에서는 scaleAt 이 알아서 올려 준다(22층에서 체력 ×4.4).
     * ⚠ 사령술사는 **해골 전사를 부른다.** 그래서 전사보다 뒤(5층)에 나온다 —
     *   부를 것이 아직 안 나온 층에 술사를 두면 이상하다. */
    /* ⚠ **1층부터** 나온다. 묘지인데 첫 층에 해골이 없으면 구역 이름이
     *   거짓말이 된다(전에 1층은 쥐 한 종뿐이었다). 쥐보다 질기고 느리므로
     *   첫 전투에서 "피하고 때린다" 를 배우기에 맞다. */
    { id: "skel_warrior", name: "해골 전사", sprite: "m_skel_warrior", brain: "melee",
      from: 1, hp: 22, dmg: 6, spd: 2.9, xp: 12, gold: 3, w: 24,
      /* 방패를 들었으니 느리게·무겁게 — 고블린보다 질기고 느리다 */
      swing: { aps: 0.78, windup: 0.34, recover: 0.30, reach: 1.20, arc: 115, push: 0.55 } },

    { id: "skel_archer", name: "해골 궁수", sprite: "m_skel_archer", brain: "archer",
      from: 3, hp: 16, dmg: 5, spd: 3.1, xp: 14, gold: 4, w: 18,
      shot: { cd: 1.9, cast: 0.48, speed: 12, range: 8.5, keep: 5.0 } },

    /* 사령술사 — **부하를 부른다.** 먼저 잡지 않으면 끝이 안 난다. */
    { id: "necro", name: "사령술사", sprite: "m_necro", brain: "summoner",
      from: 5, hp: 20, dmg: 4, spd: 2.5, xp: 22, gold: 6, w: 10,
      summon: { id: "skel_warrior", cd: 7.0, cast: 0.9, count: 1, max: 2, range: 8.0, keep: 3.4 } },
    { id: "troll", name: "트롤", sprite: "troll", brain: "melee",
      from: 24, hp: 110, dmg: 26, spd: 2.8, xp: 95, gold: 28, w: 12, r: 0.46,
      swing: { aps: 0.55, windup: 0.55, recover: 0.42, reach: 1.55, arc: 150, push: 1.10 } }
  ];

  /* 보스 — 구역의 마지막 층에 하나.
   * ⚠ 잡몹과 **행동이 달라야** 한다. 체력만 큰 잡몹은 보스가 아니라 긴 잡몹이다. */
  var BOSSES = {
    /* 무덤지기 — **묘지(1구역) 보스.** 해골을 불러낸다.
     * ⚠ 체력을 크게 두지 않았다. 위협은 **부른 것**에서 나와야 한다 —
     *   체력만 큰 것은 보스가 아니라 긴 잡몹이다.
     * ⚠ 부르는 것은 **해골 전사 하나짜리**다. 궁수를 부르게 두면 1구역에서
     *   원거리 둘에 갇혀 피할 자리가 없다(첫 보스다).
     * ⚠ 때릴 수단(swing)도 준다. 안 주면 못 부르는 동안 아무것도 안 해
     *   허수아비가 된다 — summoner 행동이 swing 이 있으면 근접한다. */
    b_gravekeeper: { name: "무덤지기", brain: "summoner", hp: 230, dmg: 14, spd: 3.0, r: 0.44,
      xp: 380, gold: 130,
      summon: { id: "skel_warrior", cd: 6.0, cast: 1.0, count: 1, max: 3, range: 9.0, keep: 3.0 },
      swing: { aps: 0.75, windup: 0.40, recover: 0.32, reach: 1.7, arc: 140, push: 0.9 } },

    /* ⚠ 관리인은 **지금 아무 구역도 쓰지 않는다**(1구역이 묘지가 됐다).
     *   스프라이트(b_warden)와 함께 남겨 두었다 — 지울지는 물어볼 것. */
    b_warden: { name: "관리인", brain: "melee", hp: 260, dmg: 16, spd: 3.4, r: 0.44,
      xp: 420, gold: 140,
      swing: { aps: 0.8, windup: 0.42, recover: 0.30, reach: 1.9, arc: 150, push: 1.0 } },
    b_drowned: { name: "물에 잠긴 것", brain: "mage", hp: 380, dmg: 22, spd: 3.0, r: 0.44,
      xp: 760, gold: 240,
      field: { cd: 2.6, cast: 0.6, r: 2.8, dur: 5.0, tick: 0.5, range: 8.0 },
      swing: { aps: 0.7, windup: 0.40, recover: 0.30, reach: 1.5, arc: 140, push: 0.8 } },
    b_librarian: { name: "사서", brain: "breaker", hp: 520, dmg: 28, spd: 3.3, r: 0.44,
      xp: 1200, gold: 380,
      strip: { cd: 4.0, cast: 0.6, range: 7.0 },
      swing: { aps: 0.9, windup: 0.35, recover: 0.28, reach: 1.6, arc: 130, push: 0.7 } },
    b_ossuary: { name: "뼈무덤", brain: "archer", hp: 760, dmg: 34, spd: 3.2, r: 0.46,
      xp: 1900, gold: 560,
      shot: { cd: 1.2, cast: 0.40, speed: 12, range: 10, keep: 5.0 } },
    b_lord: { name: "심연의 군주", brain: "melee", hp: 1400, dmg: 46, spd: 3.6, r: 0.5,
      xp: 4000, gold: 1200,
      swing: { aps: 0.9, windup: 0.38, recover: 0.26, reach: 2.2, arc: 180, push: 1.4 } }
  };

  function scaleAt(depth) {
    var d = Math.max(0, depth - 1);
    return { hp: 1 + d * 0.16, dmg: 1 + d * 0.11, xp: 1 + d * 0.13, gold: 1 + d * 0.10 };
  }

  function poolAt(depth) {
    var out = MOBS.filter(function (m) { return m.from <= depth; });
    /* ⚠ 비면 안 된다 — 빈 층은 "버그로 몬스터가 없다" 와 구별이 안 된다 */
    return out.length ? out : [MOBS[0]];
  }

  /* 진짜 보스는 **10층마다**다(사용자 결정 2026-09-23).
   * ⚠ 예전에는 구역 끝(6·12·18·24·30)이었다. 10·20·30 으로 옮기면서
   *   무덤지기와 사서가 자리를 잃었는데, 버리지 않고 그 구역의 **중간보스**로
   *   내려 세웠다(guardAt 의 z.mid). 예비로 놀던 관리인도 함께 쓴다. */
  function bossAt(depth) {
    if (depth < 10 || depth % 10 !== 0) return null;
    var z = zoneAt(depth);
    var id = (z && z.boss) || (depth >= 30 ? "b_lord" : null);
    return (id && BOSSES[id]) ? { id: id, def: BOSSES[id] } : null;
  }

  function statsAt(mob, depth) {
    var s = scaleAt(depth);
    return {
      hp: Math.round(mob.hp * s.hp),
      dmg: Math.round(mob.dmg * s.dmg),
      xp: Math.round(mob.xp * s.xp),
      gold: Math.round(mob.gold * s.gold)
    };
  }

  /* 층마다 몇 마리 — 깊이에 따라 늘되 **상한**을 둔다.
   * ⚠ 상한이 없으면 후반에 수십 마리가 몰려 프레임이 죽고, 피할 자리가 없어져
   *   실력이 아니라 운이 된다. */
  /* 기준 판의 걷는 칸 수 — 예전 56x40 을 실측한 값이다(685칸).
   * ⚠ 판을 줄이면서 마릿수를 그대로 두면 **밀도가 1.8배**가 된다
   *   (한 마리당 31.2칸 → 17.5칸). 판 크기는 "얼마나 걷나" 의 문제이고
   *   밀도는 "얼마나 싸우나" 의 문제다 — 한 번에 둘을 바꾸면 무엇 때문에
   *   달라졌는지 알 수가 없다. 걷는 칸에 비례해 마릿수를 맞춘다. */
  var REF_WALK = 685;

  /* ── 수문장 ───────────────────────────────────────────
   *
   * 층마다 계단을 지키는 하나가 있다. 10·20·30 층은 **진짜 보스**이고
   * 나머지 층은 **중간보스**다. 쓰러뜨려야 계단이 열린다(사용자 결정).
   *
   * ⚠ 중간보스의 능력치를 손수 만든 보스 표에서 그대로 가져오면 안 된다.
   *   무덤지기는 체력이 230 인데 1층 주인공의 초당 피해가 7 남짓이라
   *   **한 마리에 33초**가 걸린다(실측). 표에서 가져오는 것은 이름 · 그림 ·
   *   성격뿐이고, 체력과 피해는 **그 층 보통 몬스터에서 키운다.**
   * ⚠ 그래서 구역에 이름난 얼굴이 없어도 된다(뼈 무덤 · 군주의 방).
   *   그때는 그 층 몬스터 하나에 칭호를 붙인다 — 디아블로의 유니크와 같다. */
  /* ⚠ 배수를 7 로 뒀다가 되돌렸다. 진짜 보스가 마침 그 층 보통 몬스터의
   *   **7.5배**라(380/50 · 760/109 · 1400/186 실측), 중간보스가 보스와
   *   같은 세기가 되어 상한에 계속 걸렸다 — 3~9층이 전부 체력 171 로
   *   평평했다. 보스 배수의 **절반**을 쓴다. 그러면 다음 보스가 늘 두 배쯤
   *   되어 상한이 물릴 일이 없고, 층을 따라 매끄럽게 자란다. */
  var ELITE = { hp: 3.5, dmg: 1.45, r: 1.3, xp: 6, gold: 6 };
  var ELITE_TITLE = ["거대한", "굶주린", "피에 젖은", "오래된", "무리를 이끄는"];

  /* 그 층 보통 몬스터의 평균 — 정예의 바탕이다 */
  function midBaseAt(depth) {
    var pool = poolAt(depth), hp = 0, dmg = 0, xp = 0, gold = 0;
    for (var i = 0; i < pool.length; i++) {
      var st = statsAt(pool[i], depth);
      hp += st.hp; dmg += st.dmg; xp += st.xp; gold += st.gold;
    }
    var n = Math.max(1, pool.length);
    return { hp: hp / n, dmg: dmg / n, xp: xp / n, gold: gold / n };
  }

  /* 이 층의 수문장. { kind: "boss"|"mid", id, def } 또는 null(마을).
   * ⚠ 마릿수 셈과 달리 **여기 한 곳**에서만 정한다 — 화면과 규칙이
   *   서로 다른 수문장을 말하면 계단이 영영 안 열린다. */
  function guardAt(depth) {
    if (depth < 1) return null;
    var b = bossAt(depth);
    if (b) return { kind: "boss", id: b.id, def: b.def };

    var z = zoneAt(depth);
    var base = midBaseAt(depth);
    var face = (z && z.mid && BOSSES[z.mid]) ? BOSSES[z.mid] : null;
    var pool = poolAt(depth);
    /* 얼굴이 없는 구역은 그 층 몬스터 가운데 **가장 단단한 것**에 칭호를 붙인다.
     * ⚠ 무작위로 뽑으면 같은 층을 다시 와도 딴 것이 나와 "그 층의 수문장" 이
     *   되지 않는다. 층이 같으면 늘 같은 얼굴이라야 기억에 남는다. */
    var pick = pool[0];
    for (var i = 1; i < pool.length; i++) if (pool[i].hp > pick.hp) pick = pool[i];
    var title = ELITE_TITLE[depth % ELITE_TITLE.length];

    /* ⚠ 필드를 **하나씩 베끼지 않는다.** 처음에 이름·그림·성격·몸짓만 옮겼다가
     *   무덤지기의 `summon` 설정이 빠져 소환사 행동이 매 걸음 터졌다
     *   (ai.js 가 `sm.cd` 를 읽는데 sm 이 undefined). 성격마다 필요한 값이
     *   다르므로 **통째로 복사하고 숫자만 덮어쓴다.** */
    var src = face || pick, def = {}, kk;
    for (kk in src) def[kk] = src[kk];
    if (!face) {
      def.name = title + " " + pick.name;
      def.r = (pick.r || 0.34) * ELITE.r;
    } else if (!def.sprite) {
      def.sprite = z.mid;
    }
    /* ⚠ **다음 진짜 보스를 넘지 못하게 막는다.** 안 막으면 29층 중간보스가
     *   체력 1,267 이 되어 30층 군주(1,400)와 거의 같아진다 — 보스가
     *   봉우리가 아니게 된다(실측으로 잡혔다). 진짜 보스는 손으로 맞춘
     *   고정값이고 중간보스는 층을 따라 자라므로, 깊이 갈수록 반드시 만난다.
     * ⚠ 상한은 다음 보스의 45% 다. 그래야 보스가 적어도 두 배는 된다. */
    var nb = bossAt(Math.ceil(depth / 10) * 10);
    var capHp = nb ? nb.def.hp * 0.45 : Infinity;
    var capDmg = nb ? nb.def.dmg * 0.60 : Infinity;
    def.hp = Math.round(Math.min(base.hp * ELITE.hp, capHp));
    def.dmg = Math.round(Math.min(base.dmg * ELITE.dmg, capDmg));
    def.xp = Math.round(base.xp * ELITE.xp);
    def.gold = Math.round(base.gold * ELITE.gold);
    return { kind: "mid", id: (z && z.mid) || ("elite_" + (pick.id || "mob")), def: def };
  }

  function countAt(depth, walkable) {
    var n = Math.min(22, 8 + Math.floor(depth * 0.7));
    /* ⚠ 안 넘겨주면 옛 값 그대로다. 부르는 곳이 하나라 지금은 늘 넘어오지만,
     *   빠뜨렸을 때 조용히 0 이 되면 몬스터 없는 층이 된다. */
    if (!walkable) return n;
    return Math.max(3, Math.round(n * walkable / REF_WALK));
  }

  function audit() {
    var bad = [], i, seen = {};
    for (i = 0; i < ZONES.length; i++) {
      var z = ZONES[i];
      if (z.from > z.to) bad.push("구역 " + z.id + " 의 범위가 거꾸로다");
      if (i > 0 && ZONES[i - 1].to + 1 !== z.from)
        bad.push("구역 " + ZONES[i - 1].id + " 와 " + z.id + " 사이에 빈 층이 있다");
      if (z.boss && !BOSSES[z.boss]) bad.push("구역 " + z.id + " 의 보스 " + z.boss + " 가 없다");
    }
    if (ZONES[0].from !== 1) bad.push("1층에 구역이 없다");
    if (ZONES[ZONES.length - 1].to !== 30) bad.push("30층에 구역이 없다");
    for (i = 0; i < MOBS.length; i++) {
      var m = MOBS[i];
      if (seen[m.id]) bad.push("몬스터 id 가 겹친다: " + m.id);
      seen[m.id] = 1;
      if (!m.swing && !m.shot && !m.field && !m.heal && !m.strip && !m.summon)
        bad.push(m.id + " 이 아무것도 못 한다");
      if (m.brain === "archer" && !m.shot) bad.push(m.id + " 은 사수인데 쏠 것이 없다");
      if (m.brain === "mage" && !m.field) bad.push(m.id + " 은 술사인데 깔 것이 없다");
      if (m.brain === "healer" && !m.heal) bad.push(m.id + " 은 치유사인데 고칠 것이 없다");
      if (m.brain === "breaker" && !m.strip) bad.push(m.id + " 은 파괴자인데 걷을 것이 없다");
      /* ⚠ 소환할 것이 **표에 실제로 있는 id** 여야 한다. 없는 이름을 적으면
       *   world.summon 이 조용히 null 을 돌려주고 술사가 영원히 빈손이 된다
       *   (오류도 안 난다 — 그냥 아무 일도 안 일어난다). */
      if (m.brain === "summoner" && !m.summon) bad.push(m.id + " 은 술사인데 부를 것이 없다");
      if (m.summon && !MOBS.some(function (x) { return x.id === m.summon.id; }))
        bad.push(m.id + " 이 부르려는 " + m.summon.id + " 가 표에 없다");
    }
    /* 보스도 같은 규칙으로 본다.
     * ⚠ 전에는 **보스를 아예 안 봤다.** 그래서 b_lord(30층 최종 보스)에
     *   스프라이트가 없는 것을 아무도 못 잡았고, 회원은 **보이지 않는 보스**와
     *   싸웠다(placeAt 은 그림이 없으면 조용히 return 한다). */
    for (var bid in BOSSES) {
      var b = BOSSES[bid];
      if (!b.swing && !b.shot && !b.field && !b.strip && !b.summon)
        bad.push("보스 " + bid + " 이 아무것도 못 한다");
      if (b.brain === "archer" && !b.shot) bad.push("보스 " + bid + " 은 사수인데 쏠 것이 없다");
      if (b.brain === "mage" && !b.field) bad.push("보스 " + bid + " 은 술사인데 깔 것이 없다");
      if (b.brain === "breaker" && !b.strip) bad.push("보스 " + bid + " 은 파괴자인데 걷을 것이 없다");
      if (b.brain === "summoner" && !b.summon) bad.push("보스 " + bid + " 은 술사인데 부를 것이 없다");
      if (b.summon && !MOBS.some(function (x) { return x.id === b.summon.id; }))
        bad.push("보스 " + bid + " 이 부르려는 " + b.summon.id + " 가 표에 없다");
      /* ⚠ 스프라이트는 **보스 id 가 그대로 이름**이다(makeMob 이 그렇게 쓴다).
       *   SPRITES 가 있을 때만 본다 — data.js 는 혼자서도 돌아야 한다. */
      if (global.SPRITES && global.SPRITES.has && !global.SPRITES.has(bid))
        bad.push("보스 " + bid + " 의 그림이 없다 — 보이지 않는 보스가 된다");
    }
    for (var d = 1; d <= 30; d++)
      if (!poolAt(d).length) bad.push(d + "층에 나올 몬스터가 없다");
    return bad;
  }

  global.DATA = {
    ZONES: ZONES, MOBS: MOBS, BOSSES: BOSSES, MAX_DEPTH: 30,
    zoneAt: zoneAt, poolAt: poolAt, bossAt: bossAt,
    statsAt: statsAt, scaleAt: scaleAt, countAt: countAt, REF_WALK: REF_WALK,
    guardAt: guardAt, midBaseAt: midBaseAt, ELITE: ELITE, audit: audit
  };
})(window);
