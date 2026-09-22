/* 마을 — **손으로 만든 거점이다.** 던전 생성기를 쓰지 않는다.
 *
 * 마을은 매번 같아야 한다. 돌아올 때마다 포탈이 다른 자리에 있으면 집이 아니라
 * 또 하나의 던전이다. 같은 자리에 같은 것이 있는 것 자체가 **쉼**이다.
 *
 * ⚠ 처음에는 빈 사각형에 물건 넷을 놓았는데, 그건 **좁은 던전 복도**로 읽혔다 —
 *   바닥·벽이 던전과 같은 돌이고 상인이 허공에 서 있었다. 거점으로 읽히려면
 *   네 가지가 함께 있어야 한다:
 *     ① **건물** — 문이 난 벽으로 가게·대장간을 두른다. 물건만 놓으면 방이다.
 *     ② **자기 색** — 던전과 같은 돌을 쓰면 아무리 꾸며도 던전이다.
 *     ③ **길** — 석판길이 시설을 잇는다. 어디로 가야 하는지 바닥이 말해 준다.
 *     ④ **장식** — 등불·모닥불·간판·깃발·나무. 규칙엔 영향이 없지만 이게
 *        없으면 "누가 사는 곳" 이 아니라 "지나가는 곳" 이다.
 *
 * 배치(디아블로 로그 캠프 결):
 *     상단 심연의 문 — 좌 대장간 · 중앙 보관함 · 우 상인 — 하단 모닥불·샘
 *   길이 그 사이를 십자로 잇고, 시작 자리는 길 한가운데다.
 *
 * ⚠ 마을에는 몬스터가 없다. "안전한 곳" 이 실제로 안전해야 그 밖이 무서워진다.
 * ⚠ 지도를 글자로 적는다. 좌표로 적으면 벽 하나 옮기는 데 머릿속에 그림을
 *   그려야 한다 — 글자면 눈으로 보고 고친다.
 */
(function (global) {
  "use strict";

  var D = global.DUNGEON;

  /* # 벽 · . 흙바닥 · , 석판길 · @ 시작 자리
   * 말 거는 것   P 심연의 문 · K 보관함 · M 상인 · B 대장장이 · W 회복의 샘
   * 장식(그림일 뿐 — 지나갈 수 있다)
   *   f 모닥불 · l 등불 · t 나무 · c 상자 · b 통 · s 간판 · g 깃발
   *   a 모루와 화로 · v 가판대
   * ⚠ 줄 길이가 모두 같아야 한다 — buildTown 이 검사한다. */
  var MAP = [
    "##############################",
    "#..t......................t..#",
    "#....####################....#",
    "#....#g....b......b....g#....#",
    "#....#.l.....,P,.....l..#....#",
    "#....#####...,,,...######....#",
    "#......s.....,,,.....s.......#",
    "#..########..,,,..########...#",
    "#..#a....B#,,,,,,,#M....v#...#",
    "#..#b.....#,,,,,,,#.....b#...#",
    "#..###s####..,,,..####s###...#",
    "#....l.......,K,.......l.....#",
    "#....t.......,,,.......t.....#",
    "#..c.........,@,.........c...#",
    "#....l.......,f,.......l.....#",
    "#....t.......,,,.......t.....#",
    "#...####.....,,,.....####....#",
    "#...#W.#.....,,,.....#.c#....#",
    "#...#b.#.............#.b#....#",
    "#...##.#.............#.##....#",
    "#..t......................t..#",
    "##############################"
  ];

  /* 말을 거는 것들. **한 곳에 모은다** — 화면·조작·규칙이 전부 이 목록을 본다.
   * 세 곳에 나눠 적으면 반드시 하나가 어긋난다(포탈은 눌리는데 글자가 안 뜨는 식).
   * ⚠ reach 는 **그림 크기에 맞춘다.** 게이트는 64px 라 1.4칸이면 그림 안에
   *   들어가야 말이 걸린다 — 큰 것은 넉넉히 준다. */
  var PROPS = {
    P: { id: "portal", sprite: "t_gate",    label: "심연의 문",   verb: "층을 고른다", reach: 2.2 },
    K: { id: "stash",  sprite: "t_stash",   label: "보관함",      verb: "연다",       reach: 1.6 },
    M: { id: "shop",   sprite: "merchant",  label: "잡화 상인",   verb: "거래한다",   reach: 1.5 },
    B: { id: "smith",  sprite: "blacksmith",label: "대장장이",    verb: "강화한다",   reach: 1.5 },
    W: { id: "well",   sprite: "t_well",    label: "회복의 샘",   verb: "마신다",     reach: 1.4 }
  };

  /* 장식 — **규칙에 아무 영향이 없다.** 그림만 얹는다.
   * ⚠ 지나갈 수 있게 둔다. 장식으로 길을 막으면 "왜 여기 못 가지" 가 된다.
   * ⚠ sway 는 흔들리는 것(불·깃발·등) — 프레임을 **시간**으로 고른다. */
  var DECOR = {
    f: { sprite: "t_fire",   sway: true, light: 3.4 },
    l: { sprite: "t_lamp",   sway: true, light: 2.6 },
    t: { sprite: "t_tree" },
    c: { sprite: "p_crate" },
    b: { sprite: "t_barrel" },
    s: { sprite: "t_sign" },
    g: { sprite: "t_banner", sway: true },
    a: { sprite: "t_anvil",  sway: true, light: 1.8 },
    v: { sprite: "t_stall" }
  };

  /* 마을의 색 — **던전과 달라야 한다.**
   * ⚠ 같은 돌을 쓰면 아무리 꾸며도 던전 방으로 읽힌다. 바닥은 마른 흙,
   *   벽은 따뜻한 나무·흙벽이다. 구역 팔레트와 **같은 모양**이어야
   *   S.terrain 이 그대로 받는다(칸 이름이 하나라도 다르면 조용히 검게 나온다). */
  var ZONE = {
    id: "town", name: "마을",
    floor: { mortar: "#241c14", face: "#3a2d20", lit: "#4a3a29", dim: "#2c2218",
             grain1: "#43341f", grain2: "#332819", crack: "#261d14",
             peb1: "#52402c", peb2: "#5c4832", peb3: "#3e3021" },
    /* ⚠ 벽을 **낮췄다.** 전에는 밝기 88 로 석판길(93)과 붙어 있어 건물 벽과
     *   길이 서로 다퉜다 — 눈이 어디를 따라가야 할지 몰랐다. */
    wall:  { mortar: "#4a3420", face: "#755436", lit: "#946c45", dim: "#5a3f27",
             grain1: "#84603d", grain2: "#674a2e", moss: "#5c6a40" }
  };

  /* 석판길 — **흙바닥보다 밝고 차갑다.** 그래야 길로 읽힌다.
   * ⚠ 색이 비슷하면 길이 아니라 얼룩으로 보인다. 밝기를 확실히 벌린다. */
  var PATH_ZONE = {
    id: "townpath", name: "마을 길",
    floor: { mortar: "#45444a", face: "#6f6e78", lit: "#8a8993", dim: "#5b5a63",
             grain1: "#7b7a84", grain2: "#63626b", crack: "#4e4d55",
             peb1: "#94939d", peb2: "#a1a0aa", peb3: "#74737d" },
    wall:  ZONE.wall
  };

  /* 목조 바닥 — **건물 안.** 바깥 흙길보다 밝고 석판길보다 따뜻하다.
   * ⚠ 실측으로 고른 값이다: 흙 50 · 목조 71 · 석판 93 · 벽 88(화면 밝기).
   *   셋이 서로 20 이상 벌어져야 흘긋 봐서도 갈라진다. */
  var WOOD_ZONE = {
    id: "townwood", name: "마을 실내",
    floor: { mortar: "#46321d", face: "#735130", lit: "#956b3f", dim: "#5a3e23",
             grain1: "#855e38", grain2: "#634528", crack: "#442f20",
             peb1: "#9e7546", peb2: "#ac814f", peb3: "#6e4d2d" },
    wall:  ZONE.wall
  };

  /* 건물 **안쪽** 네모. 지도 글자로는 못 가른다 — 건물 안의 '.' 과 바깥의 '.' 이
   * 같은 글자이기 때문이다. 벽인 칸은 아래에서 걸러 내므로 넉넉히 적어도 된다.
   * ⚠ 지도를 고치면 **여기도 함께** 고칠 것. 어긋나면 바닥만 조용히 틀린다. */
  var INDOOR = [
    { x: 4,  y: 8,  w: 6, h: 2 },     /* 대장간 */
    { x: 19, y: 8,  w: 6, h: 2 },     /* 잡화·연금 상점 */
    { x: 5,  y: 17, w: 2, h: 3 },     /* 우물집 */
    { x: 22, y: 17, w: 2, h: 3 }      /* 창고집 */
  ];

  /* 바닥 구역 번호 — ZONES 의 자리와 같아야 한다 */
  var Z_DIRT = 0, Z_PATH = 1, Z_WOOD = 2;
  var ZONES = [ZONE, PATH_ZONE, WOOD_ZONE];

  function buildTown() {
    var h = MAP.length, w = MAP[0].length;
    for (var i = 0; i < h; i++) {
      if (MAP[i].length !== w)
        throw new Error("마을 지도 " + (i + 1) + "줄의 길이가 다르다: " +
                        MAP[i].length + " ≠ " + w);
    }
    var lv = new D.Level(w, h);
    /* 어느 칸이 석판길인가. ⚠ 지형(tiles)에 섞지 않는다 — 섞으면 길이 벽처럼
     *   막히거나, 길 위에 문을 놓을 수 없게 된다(함정을 따로 둔 것과 같은 이유). */
    var fzone = new Uint8Array(w * h);        /* 칸마다 ZONES 의 자리 번호 */
    var props = [], decor = [], start = null;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = MAP[y][x];
        var id = y * w + x;
        lv.tiles[id] = (c === "#") ? D.WALL : D.FLOOR;
        if (c === "," || c === "@" || c === "K") fzone[id] = Z_PATH;
        if (c === "@") start = { x: x + 0.5, y: y + 0.5 };
        var p = PROPS[c];
        if (p) props.push({ id: p.id, x: x + 0.5, y: y + 0.5, def: p });
        var dc = DECOR[c];
        if (dc) decor.push({ x: x + 0.5, y: y + 0.5, def: dc,
                             /* 흔들림을 개체마다 어긋나게 — 다 같이 흔들리면 기계 같다 */
                             phase: ((x * 7 + y * 13) % 17) / 17 });
      }
    }
    /* 건물 안은 목조 바닥. **벽은 건너뛴다** — 벽에 칠해도 안 보이지만
     * 네모를 넉넉히 적을 수 있어야 지도를 고치기 쉽다. */
    for (var r = 0; r < INDOOR.length; r++) {
      var b = INDOOR[r];
      for (var by = b.y; by < b.y + b.h; by++) {
        for (var bx = b.x; bx < b.x + b.w; bx++) {
          if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
          var bid = by * w + bx;
          if (lv.tiles[bid] === D.WALL) continue;
          fzone[bid] = Z_WOOD;
        }
      }
    }

    /* 마을은 **전부 보인다.** 안개를 씌우면 집 안에서 길을 잃는다. */
    lv.visible.fill(1);
    lv.seen.fill(1);
    lv.rooms = [{ x: 1, y: 1, w: w - 2, h: h - 2 }];
    lv.upAt = start ? { x: Math.floor(start.x), y: Math.floor(start.y) } : { x: 2, y: 2 };
    return { level: lv, props: props, decor: decor, fzone: fzone, zones: ZONES,
             start: start || { x: 2.5, y: 2.5 }, zone: ZONE };
  }

  global.TOWN = { MAP: MAP, PROPS: PROPS, DECOR: DECOR, INDOOR: INDOOR,
                  ZONE: ZONE, PATH_ZONE: PATH_ZONE, WOOD_ZONE: WOOD_ZONE,
                  ZONES: ZONES, build: buildTown };
})(window);
