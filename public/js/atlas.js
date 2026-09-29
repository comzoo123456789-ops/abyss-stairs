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
    "wall_fountain_basin_blue": [[64,64,16,16],[80,64,16,16],[96,64,16,16]]
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

    p_crate: "crate", p_skull: "skull", p_bones: "skull",
    t_stash: "chest_full_open", t_well: "wall_fountain_basin_blue"
  };

  var img = null, loaded = false, cache = {};

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
    if (global.console && global.console.log) console.log("[atlas] " + n + "개를 시트로 바꿨다");
  }
  function fix(S, k) {
    var s = S.data[k]; if (!s) return 0;          /* 게임에 없는 이름은 건너뛴다 */
    var c = tileFor(k, 0); if (!c) return 0;
    s.opt = s.opt || {};
    s.opt.w = c[2] * SCALE;
    s.opt.h = c[3] * SCALE;
    s.baked = {};                                 /* 옛 그림을 버린다 */
    s._afr = null;
    return 1;
  }

  global.ATLAS = {
    has: function (name) { return loaded && !!(CHAR[name] || OBJ[name]); },

    /* 이 이름이 몇 장짜리인가 — 그리는 쪽이 번호를 고를 때 쓴다.
     * 걷고 싸우는 것은 언제나 다섯(섬·걷1·걷2·치켜·내려)이다. */
    frames: function (name) {
      if (!loaded) return 0;
      if (CHAR[name]) return POSE.length;
      var t = OBJ[name]; if (!t) return 0;
      var cs = TILES[t]; return cs ? cs.length : 0;
    },

    get: function (name, f) {
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
      for (var k in S.data) (CHAR[k] || OBJ[k] ? on : off).push(k);
      return { loaded: loaded, atlas: on.length, code: off.length, codeNames: off };
    },

    load: function () {
      if (img) return;
      img = new Image();
      img.onload = function () { loaded = true; cache = {}; adopt(); };
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
