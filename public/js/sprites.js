/* 도트 스프라이트 — 16x16 픽셀 행렬.
 *
 * 한 글자가 한 픽셀이다. '.' 은 투명.
 * SVG <rect> 로 찍으면 타일 한 장에 256개라 화면이 기어간다 —
 * 그래서 스프라이트마다 오프스크린 캔버스에 한 번만 굽고(bake) 그 뒤로는 복사만 한다.
 * 그림을 고치고 싶으면 아래 문자 그림만 고치면 된다. 길이가 안 맞아도
 * def() 가 16칸으로 맞춰 주므로 세다가 틀려도 깨지지 않는다.
 */
(function (global) {
  "use strict";

  var SIZE = 16;
  var SPR = {};

  function def(name, colors, rows) {
    var g = [];
    for (var y = 0; y < SIZE; y++) {
      var r = rows[y] || "";
      while (r.length < SIZE) r += ".";
      g.push(r.slice(0, SIZE));
    }
    SPR[name] = { colors: colors, rows: g, baked: null, bakedScale: 0 };
  }

  /* 스프라이트를 캔버스에 한 번 굽는다. 확대까지 미리 해 둬 매 프레임 scale 을 안 건다. */
  function bake(name, scale) {
    var s = SPR[name];
    if (!s) return null;
    if (s.baked && s.bakedScale === scale) return s.baked;
    var c = document.createElement("canvas");
    c.width = SIZE * scale;
    c.height = SIZE * scale;
    var x = c.getContext("2d");
    for (var y = 0; y < SIZE; y++) {
      var row = s.rows[y];
      for (var i = 0; i < SIZE; i++) {
        var col = s.colors[row[i]];
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(i * scale, y * scale, scale, scale);
      }
    }
    s.baked = c;
    s.bakedScale = scale;
    return c;
  }

  /* ── 지형 ────────────────────────────────────────────── */

  def("wall", { a: "#4a4550", b: "#39353f", c: "#5d5866", d: "#2b2831" }, [
    "cccccccccccccccc",
    "caaaaadaaaaaaaad",
    "caaaaadaaaaaaaad",
    "caaaaadaaaaaaaad",
    "dddddddddddddddd",
    "caaaaaaaaadaaaaa",
    "caaaaaaaaadaaaaa",
    "caaaaaaaaadaaaaa",
    "dddddddddddddddd",
    "caaaadaaaaaaaaad",
    "caaaadaaaaaaaaad",
    "caaaadaaaaaaaaad",
    "dddddddddddddddd",
    "caaaaaaaadaaaaaa",
    "caaaaaaaadaaaaaa",
    "bbbbbbbbbbbbbbbb"
  ]);

  def("floor", { a: "#221f28", b: "#2a2733", c: "#1c1a22" }, [
    "aaaaaaaaaaaaaaaa",
    "aaaabaaaaaaaaaaa",
    "aaaaaaaaaaaacaaa",
    "aaaaaaaaaaaaaaaa",
    "aacaaaaaabaaaaaa",
    "aaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaba",
    "aaaaaaacaaaaaaaa",
    "aaaaaaaaaaaaaaaa",
    "abaaaaaaaaaaacaa",
    "aaaaaaaaaaaaaaaa",
    "aaaaaacaaaaaaaaa",
    "aaaaaaaaabaaaaaa",
    "aaaaaaaaaaaaaaaa",
    "aacaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaa"
  ]);

  def("stairs", { a: "#221f28", s: "#8b8496", h: "#5d5866" }, [
    "aaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaa",
    "assssssssssssssa",
    "ahhhhhhhhhhhhhha",
    "aaassssssssssssa",
    "aaahhhhhhhhhhhha",
    "aaaaaasssssssssa",
    "aaaaaahhhhhhhhha",
    "aaaaaaaasssssssa",
    "aaaaaaaahhhhhhha",
    "aaaaaaaaaassssssa",
    "aaaaaaaaaahhhhhha",
    "aaaaaaaaaaaassssa",
    "aaaaaaaaaaaahhhha",
    "aaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaa"
  ]);

  def("door", { a: "#221f28", w: "#7a5230", d: "#5a3a20", k: "#c9a227" }, [
    "aaaaaaaaaaaaaaaa",
    "aadddddddddddda.",
    "adwwwwwwwwwwwwda",
    "adwwddwwwwddwwda",
    "adwwddwwwwddwwda",
    "adwwwwwwwwwwwwda",
    "adwwwwwwwwwwwwda",
    "adwwwwwwkwwwwwda",
    "adwwwwwwkwwwwwda",
    "adwwwwwwwwwwwwda",
    "adwwddwwwwddwwda",
    "adwwddwwwwddwwda",
    "adwwwwwwwwwwwwda",
    "adwwwwwwwwwwwwda",
    "aadddddddddddda.",
    "aaaaaaaaaaaaaaaa"
  ]);

  /* ── 플레이어 (직업별) ───────────────────────────────────
   *
   * 셋 다 실루엣이 다르게 읽혀야 한다 — 투구+망토(전사) · 후드(도적) · 뾰족모자(마법사).
   * 같은 몸에 색만 바꾸면 화면에서 구분이 안 된다. */

  /* 전사 — 깃털 투구 · 붉은 망토 · 방패와 검 */
  def("warrior", {
    P: "#d24a3a", H: "#b8bec9", D: "#1a1a20", S: "#e0ac69",
    C: "#9c2f2a", M: "#8a919e", B: "#6b5230", W: "#eef2f8",
    G: "#c9a227", L: "#4a4a54", F: "#3a2a18"
  }, [
    ".......P........",
    "......PPP.......",
    "....HHHHHHH.....",
    "...HHHHHHHHH....",
    "...HHSSSSSHH....",
    "...HSDSSSDSH....",
    "....SSSSSSS.....",
    "..CCMMMMMMMCC...",
    ".CCMMMMMMMMMCC..",
    ".CBMMMMMMMMMWC..",
    ".CBBMMMMMMMWWC..",
    ".CBBMMMMMMMWWC..",
    "..CGGGGGGGGGC...",
    "...LLL...LLL....",
    "...LLL...LLL....",
    "..FFF.....FFF..."
  ]);

  /* 도적 — 깊은 후드 · 양손 단검 · 어두운 옷 */
  def("rogue", {
    H: "#2f4436", S: "#d6a26a", D: "#e8d44a", T: "#3d5244",
    K: "#c8cedb", B: "#2a2118", L: "#2c3a30", F: "#241c14"
  }, [
    "................",
    "....HHHHHHH.....",
    "...HHHHHHHHH....",
    "...HHHHHHHHH....",
    "...HHSSSSSHH....",
    "...HHSDSDSHH....",
    "....HSSSSSH.....",
    ".....HHHHH......",
    "...KTTTTTTTK....",
    "..KKTTTTTTTKK...",
    "..KKTTTTTTTKK...",
    "...KTTTTTTTK....",
    "...BBBBBBBBB....",
    "...LLL...LLL....",
    "...LLL...LLL....",
    "..FFF.....FFF..."
  ]);

  /* 마법사 — 뾰족 모자 · 흰 수염 · 빛나는 지팡이 */
  def("mage", {
    O: "#8ae8f0", H: "#4a3a7a", S: "#e0ac69", D: "#241a10",
    B: "#e8e4dc", R: "#5a4894", T: "#7a5230", V: "#3a2c60"
  }, [
    ".......O........",
    "......HHH.......",
    ".....HHHHH......",
    "....HHHHHHH.....",
    "...HHHHHHHHH....",
    "..HHHHHHHHHHH...",
    "....SSSSSSS.....",
    "....SDSSSDS.....",
    ".....BBBBB....O.",
    "...RRRRRRRRR.TT.",
    "..RRRRRRRRRRRT..",
    "..RRVVRRRVVRRT..",
    "..RRRRRRRRRRRT..",
    "..RRRRRRRRRRRT..",
    "...RRRRRRRRR.T..",
    "....RRRRRRR....."
  ]);

  /* 옛 이름은 전사로 이어 둔다(어디선가 "player" 를 부르면 빈 화면이 된다) */
  SPR.player = SPR.warrior;

  /* 함정 — 드러난 뒤에만 그린다 */
  def("trap", { a: "#221f28", S: "#9aa0ab", D: "#5a2020", K: "#3a3540" }, [
    "aaaaaaaaaaaaaaaa",
    "aaaaaaaaaaaaaaaa",
    "aaKaaaKaaaKaaKaa",
    "aaSaaaSaaaSaaSaa",
    "aaSaaaSaaaSaaSaa",
    "aaDaaaDaaaDaaDaa",
    "aaaaaaaaaaaaaaaa",
    "aKaaaKaaaKaaaKaa",
    "aSaaaSaaaSaaaSaa",
    "aSaaaSaaaSaaaSaa",
    "aDaaaDaaaDaaaDaa",
    "aaaaaaaaaaaaaaaa",
    "aaKaaaKaaaKaaKaa",
    "aaSaaaSaaaSaaSaa",
    "aaDaaaDaaaDaaDaa",
    "aaaaaaaaaaaaaaaa"
  ]);

  /* ── 몬스터 ──────────────────────────────────────────── */

  def("rat", { G: "#6e6a60", D: "#4a473f", E: "#c94f4f", T: "#8a8378", P: "#d9a0a0" }, [
    "................",
    "................",
    "................",
    "................",
    "................",
    "..GG........GG..",
    "..GGG......GGG..",
    ".GGGGGGGGGGGGG..",
    "GGEGGGGGGGGGGGGT",
    "GPGGGGGGGGGGGTT.",
    ".GGGGGGGGGGGT...",
    "..DD..DD..DD....",
    "................",
    "................",
    "................",
    "................"
  ]);

  def("goblin", {
    G: "#6b8f3a", D: "#3f5620", E: "#e8d44a", C: "#7a4a2a",
    W: "#9aa0ab", B: "#4a3520"
  }, [
    "................",
    "..G..........G..",
    "..GG........GG..",
    "..GGG.GGGG.GGG..",
    "...GGGGGGGGGG...",
    "...GGEGGGGEGG...",
    "...GGGGGGGGGG...",
    "....GGDDDDGG....",
    ".....GGGGGG.....",
    "...CCCCCCCCC.W..",
    "..GCCCCCCCCCGW..",
    "...CCCCCCCCCWWW.",
    "...BBBBBBBB.....",
    "...GGG..GGG.....",
    "...GGG..GGG.....",
    "..DDD....DDD...."
  ]);

  def("orc", {
    G: "#4a7a3a", D: "#2d4a22", E: "#e85a3a", T: "#e8e4d8",
    A: "#6b5a3a", B: "#3a2f1e", M: "#8a8f9a"
  }, [
    "................",
    "...GGGGGGGGGG...",
    "..GGGGGGGGGGGG..",
    "..GGDGGGGGGDGG..",
    "..GGGGGGGGGGGG..",
    "..GGEGGGGGGEGG..",
    "..GGGGGGGGGGGG..",
    "..GGTGDDDDGTGG..",
    "...GGGGGGGGGG...",
    ".AAAAAAAAAAAAA.M",
    "GAAAAAAAAAAAAAGM",
    ".AAAAAAAAAAAAAMM",
    "..BBBBBBBBBBB.M.",
    "..GGGG..GGGG....",
    "..GGGG..GGGG....",
    ".DDDD....DDDD..."
  ]);

  def("skeleton", { W: "#ded9cc", D: "#8a8577", K: "#1a1a1a" }, [
    "................",
    "....WWWWWWWW....",
    "...WWWWWWWWWW...",
    "...WWWWWWWWWW...",
    "...WKKWWWWKKW...",
    "...WKKWWWWKKW...",
    "...WWWWWWWWWW...",
    "....WWKWKWKW....",
    ".....WWWWWW.....",
    "......DWWD......",
    "...WWWWWWWWWW...",
    "..WWDWWWWWWDWW..",
    "...WWWWWWWWWW...",
    "....WWW..WWW....",
    "....WWW..WWW....",
    "...DDD....DDD..."
  ]);

  def("troll", {
    G: "#3d6b4a", D: "#24402c", E: "#e8c84a", T: "#d8d4c8",
    B: "#5a3a20", N: "#2a1a10"
  }, [
    "..GGGGGGGGGGGG..",
    ".GGGGGGGGGGGGGG.",
    ".GGDGGGGGGGGDGG.",
    ".GGGGGGGGGGGGGG.",
    ".GGEEGGGGGGEEGG.",
    ".GGGGGGGGGGGGGG.",
    ".GGTGGDDDDGGTGG.",
    "..GGGGGGGGGGGG..",
    "GGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGG",
    "GGGGGGGGGGGGGGGG",
    ".GGGGGGGGGGGGGG.",
    "..BBBBBBBBBBBB..",
    "..GGGG..GGGGG...",
    "..GGGG..GGGGG...",
    ".NNNNN..NNNNN..."
  ]);

  def("wraith", {
    P: "#7a5a9e", D: "#4a3466", E: "#8ae8e8", L: "#9e7ac4", K: "#2a1d3a"
  }, [
    "....LLLLLLLL....",
    "...LLLLLLLLLL...",
    "..LLLLLLLLLLLL..",
    "..LLKKLLLLKKLL..",
    "..LLEKLLLLEKLL..",
    "..LLLLLLLLLLLL..",
    "..LLLLKKKKLLLL..",
    "..PPPPPPPPPPPP..",
    ".PPPPPPPPPPPPPP.",
    ".PPPPPPPPPPPPPP.",
    ".PPPPDDPPDDPPPP.",
    "..PPPPPPPPPPPP..",
    "..DPPPDDPPPDPD..",
    "...D.DD..DD.D...",
    "................",
    "................"
  ]);

  def("lord", {
    K: "#1a1020", R: "#c22a2a", F: "#e85a2a", G: "#c9a227",
    D: "#3a2040", S: "#8a2a8a"
  }, [
    "..G..G.GG.G..G..",
    "..GG.GGGGGG.GG..",
    "..KKKKKKKKKKKK..",
    ".KKKKKKKKKKKKKK.",
    ".KKRRKKKKKKRRKK.",
    ".KKRRKKKKKKRRKK.",
    ".KKKKKKKKKKKKKK.",
    ".KKKFKFFFFKFKKK.",
    "..KKKKKKKKKKKK..",
    ".SSSSSSSSSSSSSS.",
    "SSSSSKKKKSSSSSSS",
    "SSSSKKFFKKSSSSSS",
    ".SSSSKKKKSSSSSS.",
    "..DDDD..DDDD....",
    "..DDDD..DDDD....",
    ".KKKKK..KKKKK..."
  ]);

  /* ── 아이템 ──────────────────────────────────────────── */

  def("potion", { G: "#cfe8f0", L: "#e85a7a", C: "#7a5230", H: "#ffffff" }, [
    "................",
    "................",
    "......CCCC......",
    "......CCCC......",
    "......GGGG......",
    ".....GGGGGG.....",
    "....GGGGGGGG....",
    "...GGGGGGGGGG...",
    "...GHLLLLLLLG...",
    "...GHLLLLLLLG...",
    "...GLLLLLLLLG...",
    "...GLLLLLLLLG...",
    "...GLLLLLLLLG...",
    "....GLLLLLLG....",
    ".....GGGGGG.....",
    "................"
  ]);

  def("scroll", { P: "#e8e0c8", D: "#b8ad8e", I: "#3a3028", R: "#a02a2a" }, [
    "................",
    "................",
    "..DDDDDDDDDDDD..",
    "..DPPPPPPPPPPD..",
    "..DPIIIIIIIIPD..",
    "..DPPPPPPPPPPD..",
    "..DPIIIIIIPPPD..",
    "..DPPPPPPPPPPD..",
    "..DPIIIIIIIIPD..",
    "..DPPPPPPPPPPD..",
    "..DPIIIIPPPPPD..",
    "..DPPPPPPPPPPD..",
    "..DDDDDDDDDDDD..",
    "....RRRRRRRR....",
    "................",
    "................"
  ]);

  def("sword", { B: "#d8dde8", E: "#9aa0ab", G: "#c9a227", H: "#5a3a20" }, [
    "..............B.",
    ".............BEB",
    "............BEB.",
    "...........BEB..",
    "..........BEB...",
    ".........BEB....",
    "........BEB.....",
    ".......BEB......",
    "......BEB.......",
    ".....BEB........",
    "....GGGGG.......",
    "...GGGGGGG......",
    "....HHH.........",
    "...HHH..........",
    "..HHH...........",
    ".GG............."
  ]);

  def("armor", { S: "#9aa0ab", D: "#6a7080", L: "#c8ced8", G: "#c9a227" }, [
    "................",
    "....SS....SS....",
    "...SSSS..SSSS...",
    "..SSSSSSSSSSSS..",
    ".SSLLSSSSSSLLSS.",
    ".SSSSSSSSSSSSSS.",
    ".SSSSSGGGGSSSSS.",
    ".SSSSSGGGGSSSSS.",
    ".SSSSSSSSSSSSSS.",
    ".DSSSSSSSSSSSSD.",
    ".DSSSSSSSSSSSSD.",
    "..DSSSSSSSSSSD..",
    "..DDSSSSSSSSDD..",
    "...DDDDDDDDDD...",
    "................",
    "................"
  ]);

  def("gold", { G: "#e8c84a", D: "#b8931f", L: "#fff0a0" }, [
    "................",
    "................",
    "................",
    "................",
    ".....GGGGGG.....",
    "....GLLGGGGG....",
    "...GLGGGGGGGG...",
    "...GLGGGGGGGG...",
    "...GGGGGGGGGG...",
    "....GGGGGGGD....",
    ".....DDDDDD.....",
    "...GGGGGGGGGG...",
    "..GLGGGGGGGGDD..",
    "..GGGGGGGGGGDD..",
    "...DDDDDDDDDD...",
    "................"
  ]);

  def("corpse", { R: "#7a2020", D: "#4a1414", B: "#c8c0b0" }, [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "......DD........",
    "....DRRRRD......",
    "...DRRBRRRD.....",
    "..DRRRRRRRRD....",
    "...DRRRRRRD.....",
    "....DDRRDD......",
    "......DD........",
    "................",
    "................",
    "................"
  ]);

  global.SPRITES = { SIZE: SIZE, data: SPR, bake: bake, def: def };
})(window);
