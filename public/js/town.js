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
   *   a 모루와 화로 · v 가판대 · o 장작더미 · e 벤치 · u 꽃수풀 · r 짐수레
   * ⚠ 줄 길이가 모두 같아야 한다 — buildTown 이 검사한다. */
  var MAP = [
    "##############################",
    "#..t..u................u..t..#",
    "#..u.####################.u..#",
    "#....#g.c..b......b..c.g#....#",
    "#....#.l.....,P,.....l..#....#",
    "#....#####...,,,...######....#",
    "#......s.....,,,.....s.......#",
    "#..########..,,,..########...#",
    "#..#a.o..B#,,,,,,,#M.C..v#...#",
    "#..#b.c...#,,,,,,,#..c..b#...#",
    "#..###s####..,,,..####s###...#",
    "#....l.......eKe.......l.....#",
    "#..u.t.e.....,,,.....e.t.u...#",
    "#..c.X.o.....,@,.....o.X.c...#",
    "#....l..e....,f,....e..l.....#",
    "#..u.t.......eoe.......t.u...#",
    "#...####.....,,,.....####....#",
    "#...#W.#..u..,,,..u..#.c#....#",
    "#...#b.u.............#rb#....#",
    "#...##.#..e.......e..#.##....#",
    "#..t..u................u..t..#",
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
    C: { id: "craft",  sprite: "t_stall",   label: "연금술사",    verb: "제작한다",   reach: 1.5 },
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
    v: { sprite: "t_stall" },
    o: { sprite: "t_logs" },
    e: { sprite: "t_bench" },
    u: { sprite: "t_bush" },
    r: { sprite: "t_cart" }
  };

  /* 마을의 색 — **던전과 달라야 한다.**
   * ⚠ 같은 돌을 쓰면 아무리 꾸며도 던전 방으로 읽힌다. 바닥은 마른 흙,
   *   벽은 따뜻한 나무·흙벽이다. */
  var ZONE = {
    id: "town", name: "마을",
    floor: { mortar: "#201810", face: "#3d2f21", lit: "#4e3c2a", dim: "#2a2016",
             grain1: "#483723", grain2: "#362a1b", crack: "#221a12",
             peb1: "#5c462e", peb2: "#6b5237", peb3: "#453523" },
    wall:  { mortar: "#4a3420", face: "#755436", lit: "#946c45", dim: "#5a3f27",
             grain1: "#84603d", grain2: "#674a2e", moss: "#5c6a40" }
  };

  /* 석판길 — **흙바닥보다 밝고 차갑다.** 그래야 길로 읽힌다. */
  var PATH_ZONE = {
    id: "townpath", name: "마을 길",
    floor: { mortar: "#45444a", face: "#74737d", lit: "#91909a", dim: "#5e5d66",
             grain1: "#807f89", grain2: "#686770", crack: "#504f57",
             peb1: "#9c9ba5", peb2: "#aaa9b3", peb3: "#7a7983" },
    wall:  ZONE.wall
  };

  /* 목조 바닥 — **건물 안.** 바깥 흙길보다 밝고 석판길보다 따뜻한 오크 판자. */
  var WOOD_ZONE = {
    id: "townwood", name: "마을 실내",
    floor: { mortar: "#422e18", face: "#785430", lit: "#9e6f40", dim: "#5e4225",
             grain1: "#8c633a", grain2: "#694a2b", crack: "#3e2a16",
             peb1: "#a87747", peb2: "#b88450", peb3: "#734f2d" },
    wall:  ZONE.wall
  };

  /* 건물 **안쪽** 네모 */
  var INDOOR = [
    { x: 3,  y: 8,  w: 7, h: 3 },     /* 대장간 */
    { x: 18, y: 8,  w: 7, h: 3 },     /* 잡화·연금 상점 */
    { x: 4,  y: 17, w: 3, h: 3 },     /* 우물집 */
    { x: 21, y: 17, w: 3, h: 3 }      /* 창고집 */
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
    var props = [], decor = [], dummies = [], start = null;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var c = MAP[y][x];
        var id = y * w + x;
        lv.tiles[id] = (c === "#") ? D.WALL : D.FLOOR;
        if (c === "," || c === "@" || c === "K") fzone[id] = Z_PATH;
        if (c === "@") start = { x: x + 0.5, y: y + 0.5 };
        if (c === "X") dummies.push({ x: x + 0.5, y: y + 0.5 });
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
    return { level: lv, props: props, decor: decor, dummies: dummies, fzone: fzone, zones: ZONES,
             start: start || { x: 2.5, y: 2.5 }, zone: ZONE };
  }

  global.TOWN = { MAP: MAP, PROPS: PROPS, DECOR: DECOR, INDOOR: INDOOR,
                  ZONE: ZONE, PATH_ZONE: PATH_ZONE, WOOD_ZONE: WOOD_ZONE,
                  ZONES: ZONES, build: buildTown };
})(window);
