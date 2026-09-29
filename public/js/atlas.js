/* 아틀라스 — 그림을 코드가 아니라 **시트 한 장**에서 꺼낸다.
 *
 * 원본: 0x72 "16x16 DungeonTileset II" v1.7 (CC0). public/art/LICENSE.txt 참고.
 *
 * ⚠ **덮어쓰기지 갈아엎기가 아니다.** 여기서 이름을 못 찾으면 bake() 가 지금까지의
 *   코드 도트로 그대로 떨어진다. 반쯤 바꾼 상태로도 게임이 돈다.
 *
 * ⚠ 시트는 네트워크로 **늦게 온다.** bake() 는 그 자리에서 답해야 하므로 오기 전에는
 *   null 을 주고, 온 뒤에 구워 둔 판을 전부 버린다. 안 버리면 첫 화면에 구워진
 *   옛 그림이 영영 남는다.
 *
 * ⚠ 프레임 번호에는 **뜻이 있다**(view.js `frameOf`, tools/walk-check.mjs):
 *       0 섬 · 1 걷1 · 2 걷2 · 3 치켜 · 4 내려
 *   그냥 0~3 을 돌려 쓰면 3·4 가 0 과 같아져 **공격 동작이 통째로 사라진다**
 *   (실제로 한 번 그렇게 만들었고 walk-check 의 「공격이 안 깨졌다」가 0% 로 잡았다).
 *   그래서 POSE 로 뜻을 짝지어 준다.
 *
 * ⚠ 이 시트에는 **공격 자세가 없다.** idle 4장 · run 4장뿐이다. 치켜·내려는 run 의
 *   다른 장을 빌려 쓴다 — 팔을 치켜드는 그림은 아니지만, 공격의 예고와 내려침은
 *   이미 **그리는 자리를 흔들어**(뒤로 2px 움츠렸다 앞으로 3px) 보여 주고 있다.
 *   여기서 멈춘 그림이 나가지만 않으면 된다.
 */
(function (global) {
  "use strict";

  var SCALE = 2;                 /* 16px 을 32px 자리에 — 정수배라 도트가 고르다 */
  var SRC = "art/dungeon.png";

  /* 두 번째 시트 — 재주 아이콘과 몇몇 물건. 원본은 Ninja Adventure (CC0).
   * ⚠ 이쪽은 **키우지 않는다.** 이펙트 장이 이미 30px 언저리라 2배로 늘리면
   *   재주 칸(32px)을 넘어 서로 겹친다. 던전 시트만 16→32 로 키운다.
   * ⚠ 시트가 둘이므로 **둘 다 온 뒤에** 구운 것을 버려야 한다. 하나만 보고
   *   버리면 나중에 온 쪽이 영영 안 나온다. */
  var FX_SRC = "art/fx.png";
  var FX_SCALE = 1;
  var FXT = {
    "s_cleave": [[0,0,24,27]],
    "s_whirl": [[25,0,26,28]],
    "s_backstab": [[52,0,26,27]],
    "s_dash": [[79,0,24,27]],
    "s_knives": [[104,0,59,41]],
    "s_throw": [[164,0,51,47]],
    "s_bash": [[0,48,48,46]],
    "s_stomp": [[49,48,27,26]],
    "s_nova": [[77,48,36,33]],
    "s_burn": [[114,48,30,28]],
    "s_frost": [[145,48,31,31]],
    "s_lightning": [[177,48,28,23]],
    "s_venom": [[206,48,28,24]],
    "s_smoke": [[0,95,41,40]],
    "s_guard": [[42,95,26,16]],
    "s_ward": [[69,95,26,16]],
    "s_provoke": [[96,95,26,26]],
    "s_shout": [[123,95,21,20]],
    "scroll": [[145,95,28,28]],
    "t_anvil": [[174,95,16,16]],
    "eq_magic": [[191,95,16,15]],
    "eq_rare": [[208,95,16,16]],
    "eq_relic": [[225,95,28,28]]
  };

  /* 시트 안의 칸 — [x, y, w, h] 를 프레임 순서대로. 원본 tile_list 에서 뽑았다. */
  var TILES = {
    "knight_m_idle": [[128,100,16,28],[144,100,16,28],[160,100,16,28],[176,100,16,28]],
    "knight_m_run": [[192,100,16,28],[208,100,16,28],[224,100,16,28],[240,100,16,28]],
    "elf_m_idle": [[128,36,16,28],[144,36,16,28],[160,36,16,28],[176,36,16,28]],
    "elf_m_run": [[192,36,16,28],[208,36,16,28],[224,36,16,28],[240,36,16,28]],
    "elf_f_idle": [[128,4,16,28],[144,4,16,28],[160,4,16,28],[176,4,16,28]],
    "elf_f_run": [[192,4,16,28],[208,4,16,28],[224,4,16,28],[240,4,16,28]],
    "wizzard_m_idle": [[128,164,16,28],[144,164,16,28],[160,164,16,28],[176,164,16,28]],
    "wizzard_m_run": [[192,164,16,28],[208,164,16,28],[224,164,16,28],[240,164,16,28]],
    "goblin_idle": [[368,40,16,16],[384,40,16,16],[400,40,16,16],[416,40,16,16]],
    "goblin_run": [[432,40,16,16],[448,40,16,16],[464,40,16,16],[480,40,16,16]],
    "skelet_idle": [[368,88,16,16],[384,88,16,16],[400,88,16,16],[416,88,16,16]],
    "skelet_run": [[432,88,16,16],[448,88,16,16],[464,88,16,16],[480,88,16,16]],
    "orc_warrior_idle": [[368,177,16,23],[384,177,16,23],[400,177,16,23],[416,177,16,23]],
    "orc_warrior_run": [[432,177,16,23],[448,177,16,23],[464,177,16,23],[480,177,16,23]],
    "masked_orc_idle": [[368,153,16,23],[384,153,16,23],[400,153,16,23],[416,153,16,23]],
    "masked_orc_run": [[432,153,16,23],[448,153,16,23],[464,153,16,23],[480,153,16,23]],
    "imp_idle": [[368,64,16,16],[384,64,16,16],[400,64,16,16],[416,64,16,16]],
    "imp_run": [[432,64,16,16],[448,64,16,16],[464,64,16,16],[480,64,16,16]],
    "chort_idle": [[368,273,16,23],[384,273,16,23],[400,273,16,23],[416,273,16,23]],
    "chort_run": [[432,273,16,23],[448,273,16,23],[464,273,16,23],[480,273,16,23]],
    "ogre_idle": [[16,380,32,36],[48,380,32,36],[80,380,32,36],[112,380,32,36]],
    "ogre_run": [[144,380,32,36],[176,380,32,36],[208,380,32,36],[240,380,32,36]],
    "big_demon_idle": [[16,428,32,36],[48,428,32,36],[80,428,32,36],[112,428,32,36]],
    "big_demon_run": [[144,428,32,36],[176,428,32,36],[208,428,32,36],[240,428,32,36]],
    "big_zombie_idle": [[16,332,32,36],[48,332,32,36],[80,332,32,36],[112,332,32,36]],
    "big_zombie_run": [[144,332,32,36],[176,332,32,36],[208,332,32,36],[240,332,32,36]],
    "slug": [[368,369,16,23],[384,369,16,23],[400,369,16,23],[416,369,16,23]],
    "muddy": [[368,112,16,16],[384,112,16,16],[400,112,16,16],[416,112,16,16]],
    "swampy": [[432,112,16,16],[448,112,16,16],[464,112,16,16],[480,112,16,16]],
    "skull": [[288,432,16,16]],
    "necromancer": [[368,225,16,23],[384,225,16,23],[400,225,16,23],[416,225,16,23]],
    "weapon_regular_sword": [[323,10,10,21]],
    "weapon_axe": [[341,74,9,21]],
    "weapon_knife": [[293,10,6,13]],
    "weapon_red_magic_staff": [[324,129,8,30]],
    "weapon_green_magic_staff": [[340,129,8,30]],
    "weapon_bow": [[289,195,14,26]],
    "weapon_spear": [[309,161,6,30]],
    "weapon_knight_sword": [[339,98,10,29]],
    "flask_red": [[288,352,16,16]],
    "coin": [[289,385,6,7],[297,385,6,7],[305,385,6,7],[313,385,6,7]],
    "crate": [[288,408,16,24]],
    "chest_full_open": [[304,416,16,16],[320,416,16,16],[336,416,16,16]],
    "wall_fountain_basin_blue": [[64,64,16,16],[80,64,16,16],[96,64,16,16]],
    "floor_1": [[16,64,16,16]],
    "floor_2": [[32,64,16,16]],
    "floor_3": [[48,64,16,16]],
    "floor_4": [[16,80,16,16]],
    "floor_5": [[32,80,16,16]],
    "floor_6": [[48,80,16,16]],
    "floor_7": [[16,96,16,16]],
    "floor_8": [[32,96,16,16]],
    "wall_top_mid": [[32,0,16,16]],
    "wall_top_left": [[16,0,16,16]],
    "wall_top_right": [[48,0,16,16]],
    "wall_mid": [[32,16,16,16]],
    "wall_left": [[16,16,16,16]],
    "wall_right": [[48,16,16,16]],
    "wall_hole_1": [[48,32,16,16]],
    "wall_hole_2": [[48,48,16,16]],
    "wall_goo": [[64,80,16,16]],
    "wall_banner_red": [[16,32,16,16]],
    "wall_banner_blue": [[32,32,16,16]],
    "doors_leaf_closed": [[32,240,32,32]],
    "doors_leaf_open": [[80,240,32,32]],
    "doors_frame_left": [[16,240,16,32]],
    "doors_frame_right": [[64,240,16,32]],
    "doors_frame_top": [[32,224,32,16]],
    "floor_stairs": [[80,192,16,16]],
    "floor_ladder": [[48,96,16,16]],
    "floor_spikes": [[16,192,16,16],[32,192,16,16],[48,192,16,16],[64,192,16,16]],
    "hole": [[96,144,16,16]],
    "column": [[80,80,16,48]],
    "column_wall": [[96,80,16,48]],
    "edge_down": [[96,128,16,16]]
  };

  /* 게임의 프레임 번호 → 시트의 [자세, 그 자세의 몇 번째 장] */
  var POSE = [["idle", 0], ["run", 1], ["run", 3], ["run", 3], ["run", 1]];

  /* 걷고 싸우는 것 — 시트에 <줄기>_idle 과 <줄기>_run 이 있다 */
  var CHAR = {
    warrior: "knight_m", knight: "knight_m", rogue: "elf_m", mage: "wizzard_m",

    goblin: "goblin", skeleton: "skelet", orc: "orc_warrior",
    slinger: "masked_orc", archer: "elf_f", wraith: "imp", eraser: "chort",
    troll: "ogre", lord: "big_demon",

    m_skel_warrior: "skelet", m_skel_archer: "skelet",

    /* 보스 — 시트에서 확실히 큰 것은 셋뿐(32×36)이라 나눠 쓴다 */
    b_warden: "ogre", b_gravekeeper: "ogre",
    b_drowned: "big_zombie", b_ossuary: "big_zombie",
    b_lord: "big_demon"
  };

  /* 움직이지 않는 것 — 시트의 칸을 그대로 쓴다(제 프레임이 있으면 그것을 돈다) */
  var OBJ = {
    rat: "slug", mist: "muddy", inkling: "swampy", corpse: "skull",
    m_necro: "necromancer", b_librarian: "necromancer",

    w_sword: "weapon_regular_sword", w_axe: "weapon_axe", w_dagger: "weapon_knife",
    w_staff: "weapon_red_magic_staff", w_bow: "weapon_bow", w_spear: "weapon_spear",

    sword: "weapon_knight_sword", axe: "weapon_axe", dagger: "weapon_knife",
    staff: "weapon_green_magic_staff", bow: "weapon_bow", spear: "weapon_spear",
    potion: "flask_red", gold: "coin",

    /* 지나갈 수 있는 곳 — 시트에 문짝이 여닫힌 두 장으로 들어 있다 */
    door: "doors_leaf_closed", door_open: "doors_leaf_open",
    stairs: "floor_stairs", deep: "hole", trap: "floor_spikes",
    t_barrel: "crate", t_banner: "wall_banner_red",

    p_crate: "crate", p_skull: "skull", p_bones: "skull",
    t_stash: "chest_full_open", t_well: "wall_fountain_basin_blue"
  };

  /* ── 지형 ────────────────────────────────────────
   *
   * ⚠ **구역 색을 잃으면 안 된다.** 다섯 구역(묘지·물든 계단·도서관·뼈 무덤·
   *   군주의 방)은 벽·바닥 색으로만 갈린다. 시트 타일은 색이 박혀 있으니
   *   그대로 깔면 서른 층이 전부 같은 방으로 보인다.
   *   그래서 캔버스의 color 혼합을 쓴다 — **밝기는 시트, 색조는 구역**이다.
   *   (multiply 로는 안 된다. 어두운 구역색을 곱하면 타일이 까맣게 죽는다.)
   *
   * ⚠ 지형 타일은 불투명하다. 그래서 color 혼합 뒤에 알파를 되살릴 필요가
   *   없다 — 생물 그림에 같은 짓을 하면 투명한 바깥까지 칠해진다. */
  var FLOORS = ["floor_1", "floor_2", "floor_3", "floor_4",
                "floor_5", "floor_6", "floor_7", "floor_8"];
  /* 벽은 윗면과 앞면이 따로다(시트도 그렇게 나뉘어 있다). 변종은 여섯이다. */
  var WALLTOP  = ["wall_top_mid", "wall_top_left", "wall_top_right",
                  "wall_top_mid", "wall_top_mid", "wall_top_right"];
  var WALLFACE = ["wall_mid", "wall_mid", "wall_hole_1",
                  "wall_mid", "wall_hole_2", "wall_mid"];

  /* 색조만 옮기면 **밝기가 안 따라온다.** 시트 바닥은 회색 돌(밝기 45% 언저리)인데
   * 이 게임의 바닥은 원래 12% 였다 — 그대로 깔면 던전이 대낮이 된다("심연" 이
   * 아니게 된다). 그래서 색조를 옮긴 뒤 구역색으로 한 번 더 곱해 어둡기를 당긴다.
   * ⚠ 곱하기만 쓰면 안 된다 — 어두운 구역색을 온전히 곱하면 질감이 까맣게 죽는다.
   *   색조(color) → 어둡기(multiply, 일부만) 두 단계다. 바닥이 벽보다 더 어둡다. */
  var DARK = { floor: 0.34, wall: 0.14 };
  /* ⚠ 색조만 옮겨도 **구역이 안 갈린다.** 다섯 구역의 바닥색은 전부 어두운
   *   중성 갈색이라(#211d15 #1a2328 #262016 #251e1d #1f171a) 색조 차이가
   *   화면 평균에서 거의 사라진다 — world-check 의 「구역마다 색이 다르다」가
   *   가장 비슷한 둘의 차이 4 로 잡았다. 그래서 구역색을 **직접 한 겹 덮는다**.
   *   질감을 죽이지 않을 만큼만(덮개가 0.5 를 넘으면 시트 무늬가 안 보인다). */
  var TINT = { floor: 0.46, wall: 0.44 };
  var SAT  = { floor: 0.55, wall: 0.45 };

  /* ⚠ **구역을 가르는 것은 벽색이지 바닥색이 아니다.** 다섯 구역의 바닥색은
   *   서로 거의 같다 — 묘지 #211d15 와 도서관 #262016 은 차이가 5 밖에 안 된다.
   *   반면 벽색은 초록·청록·갈색·자주·보라로 뚜렷이 갈린다(차이 20 이상).
   *   그래서 **바닥도 그 구역의 벽색으로 색조를 잡고**, 어둡기만 제 바닥색에서
   *   가져온다. 같은 암반을 깎아 만든 방처럼 보이고, 층을 옮기면 바로 읽힌다.
   *   (바닥색으로 색조까지 잡으면 world-check 의 「구역마다 색이 다르다」가
   *    가장 비슷한 둘의 차이 5 로 떨어진다 — 기준은 12 다.) */
  /* ⚠ **밝기를 올려 구역을 가르려 하면 안 된다.** 던전은 어두운 것이 설정이고,
   *   밝히면 색은 갈려도 "심연" 이 아니게 된다. 어두운 화면에서 남은 손잡이는
   *   **채도** 하나다 — 같은 밝기에서 채도를 올리면 RGB 세 값이 서로 벌어진다.
   *   그래서 구역색을 그대로 쓰지 않고 채도만 끌어올린 판(vivid)을 만들어
   *   canvas 의 saturation 혼합에 넣는다. 밝기는 손대지 않는다. */
  function vivid(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex;
    var n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0;
    if (mx !== mn) {
      var d = mx - mn;
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
      h /= 6;
    }
    /* 채도는 거의 끝까지, 밝기는 가운데로 — saturation 혼합은 이 판의 **채도만**
     * 읽으므로 밝기 값은 결과에 안 들어간다(0 이나 1 이면 채도가 0 이 되어버린다). */
    return "hsl(" + Math.round(h * 360) + ",90%,50%)";
  }

  function hueColor(zone) {
    return (zone && zone.wall && zone.wall.face) || null;
  }
  function darkColor(zone, kind) {
    if (!zone) return null;
    var p = (kind === "floor") ? zone.floor : zone.wall;
    return (p && p.face) || null;
  }

  function terrainTile(kind, variant) {
    var v = variant | 0;
    if (kind === "floor") return FLOORS[v % FLOORS.length];
    if (kind === "wall") return WALLTOP[v % WALLTOP.length];
    return WALLFACE[v % WALLFACE.length];      /* wallface · wallthin */
  }

  var img = null, loaded = false, cache = {}, tcache = {};
  var fximg = null, fxloaded = false;

  function fxCell(name) {
    var cs = FXT[name];
    return (fxloaded && cs && cs.length) ? cs[0] : null;
  }

  function tileFor(name, f) {
    var stem = CHAR[name];
    if (stem) {
      var p = POSE[(f || 0) % POSE.length];
      var cs = TILES[stem + "_" + p[0]] || TILES[stem + "_idle"];
      if (!cs) return null;
      return cs[p[1] % cs.length];
    }
    var t = OBJ[name]; if (!t) return null;
    var c2 = TILES[t]; if (!c2 || !c2.length) return null;
    return c2[(f || 0) % c2.length];
  }

  /* 시트가 왔을 때 — 구워 둔 것을 버리고 크기를 고쳐 준다.
   * ⚠ 크기를 안 고치면 32px 자리에 56px 그림이 들어가 **발이 땅에서 뜬다**. */
  function adopt() {
    var S = global.SPRITES; if (!S) return;
    var n = 0, k;
    for (k in CHAR) n += fix(S, k);
    for (k in OBJ) n += fix(S, k);
    for (k in FXT) n += fix(S, k);
    if (S.clearTerrain) S.clearTerrain();   /* 바닥·벽도 다시 굽는다 */
    if (global.console && global.console.log) console.log("[atlas] " + n + "개를 시트로 바꿨다");
  }
  function fix(S, k) {
    var s = S.data[k]; if (!s) return 0;          /* 게임에 없는 이름은 건너뛴다 */
    var fc = fxCell(k);
    var c = fc || tileFor(k, 0); if (!c) return 0;
    var sc = fc ? FX_SCALE : SCALE;
    s.opt = s.opt || {};
    s.opt.w = c[2] * sc;
    s.opt.h = c[3] * sc;
    s.baked = {};                                 /* 옛 그림을 버린다 */
    s._afr = null;
    return 1;
  }

  global.ATLAS = {
    has: function (name) {
      if (fxloaded && FXT[name]) return true;
      return loaded && !!(CHAR[name] || OBJ[name]);
    },

    /* 이 이름이 몇 장짜리인가 — 그리는 쪽이 번호를 고를 때 쓴다.
     * 걷고 싸우는 것은 언제나 다섯(섬·걷1·걷2·치켜·내려)이다. */
    frames: function (name) {
      if (fxloaded && FXT[name]) return 1;    /* 아이콘은 한 장이다 */
      if (!loaded) return 0;
      if (CHAR[name]) return POSE.length;
      var t = OBJ[name]; if (!t) return 0;
      var cs = TILES[t]; return cs ? cs.length : 0;
    },

    /* 지형은 bake() 가 아니라 terrain() 을 지난다 — 따로 받는다. */
    terrainOn: function () { return loaded; },
    terrain: function (kind, variant, zone) {
      if (!loaded) return null;
      var nm = terrainTile(kind, variant); if (!nm) return null;
      var cs = TILES[nm]; if (!cs || !cs.length) return null;
      var c = cs[0];
      var hue = hueColor(zone);
      var col = darkColor(zone, kind === "floor" ? "floor" : "wall");
      var key = kind + "|" + variant + "|" + (hue || "_") + (col || "_");
      if (tcache[key]) return tcache[key];
      var cv = document.createElement("canvas");
      cv.width = c[2] * SCALE; cv.height = c[3] * SCALE;
      var x = cv.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.drawImage(img, c[0], c[1], c[2], c[3], 0, 0, cv.width, cv.height);
      if (col) {
        x.globalCompositeOperation = "color";     /* ① 색조를 구역 것으로 */
        x.fillStyle = col;
        x.fillRect(0, 0, cv.width, cv.height);
        x.fillStyle = col;
        x.globalCompositeOperation = "multiply";  /* ② 어둡기는 제 바닥/벽색 */
        x.globalAlpha = (kind === "floor") ? DARK.floor : DARK.wall;
        x.fillRect(0, 0, cv.width, cv.height);
        x.globalAlpha = 1;
        x.globalCompositeOperation = "source-over";
      }
      tcache[key] = cv;
      return cv;
    },

    get: function (name, f) {
      var fc = fxCell(name);
      if (fc) {
        var fk = "fx|" + name;
        if (cache[fk]) return cache[fk];
        var fv = document.createElement("canvas");
        fv.width = fc[2] * FX_SCALE; fv.height = fc[3] * FX_SCALE;
        var fx2 = fv.getContext("2d");
        fx2.imageSmoothingEnabled = false;
        fx2.drawImage(fximg, fc[0], fc[1], fc[2], fc[3], 0, 0, fv.width, fv.height);
        cache[fk] = fv;
        return fv;
      }
      if (!loaded) return null;
      var c = tileFor(name, f); if (!c) return null;
      var key = name + "|" + (f || 0);
      if (cache[key]) return cache[key];
      var cv = document.createElement("canvas");
      cv.width = c[2] * SCALE; cv.height = c[3] * SCALE;
      var x = cv.getContext("2d");
      x.imageSmoothingEnabled = false;             /* 도트는 뭉개면 안 된다 */
      x.drawImage(img, c[0], c[1], c[2], c[3], 0, 0, cv.width, cv.height);
      cache[key] = cv;
      return cv;
    },

    /* 점검기용 — 무엇이 시트로 갔고 무엇이 코드 도트로 남았는가 */
    report: function () {
      var S = global.SPRITES, on = [], off = [];
      for (var k in S.data) (CHAR[k] || OBJ[k] || FXT[k] ? on : off).push(k);
      return { loaded: loaded, atlas: on.length, code: off.length, codeNames: off };
    },

    load: function () {
      if (img) return;
      fximg = new Image();
      fximg.onload = function () { fxloaded = true; cache = {}; if (loaded) adopt(); };
      fximg.onerror = function () {
        if (global.console && global.console.warn) console.warn("[atlas] " + FX_SRC + " 를 못 받았다");
      };
      fximg.src = FX_SRC;
      img = new Image();
      img.onload = function () { loaded = true; cache = {}; tcache = {}; adopt(); };
      img.onerror = function () {
        /* ⚠ 조용히 실패하게 두지 않는다 — 그림만 옛것으로 돌아가면
         *   "왜 안 바뀌지" 로 한참 헤맨다. */
        if (global.console && global.console.warn)
          console.warn("[atlas] " + SRC + " 를 못 받았다 — 코드 도트로 간다");
      };
      img.src = SRC;
    }
  };

  global.ATLAS.load();
})(window);
