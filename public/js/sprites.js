/* 도트 스프라이트 엔진 — 32×32.
 *
 * ⚠ 32줄 × 32칸을 문자로 적지 않는다. 16×16 일 때는 문자 그림이 편했지만
 *   32 에서는 한 픽셀을 옮기려고 줄 전체를 다시 세야 해서 사실상 못 고친다.
 *   그래서 **원시 도형을 쌓아** 만든다 — 숫자 하나만 고쳐 위치를 옮길 수 있고,
 *   윤곽선과 명암을 마지막에 한 번에 입힐 수 있다(그게 도트가 '깔끔해' 보이는 이유다).
 *
 * ⚠ 한 칸이 32px 이고 스프라이트도 32px 이라 **확대가 없다**(scale 1).
 *   16×16 을 2배로 늘려 쓰던 때보다 픽셀이 4배라 얼굴·장식이 들어간다.
 *
 * 쓰는 쪽:  SPRITES.bake("warrior")  → 캔버스(32×32). 한 번 굽고 계속 쓴다.
 */
(function (global) {
  "use strict";

  var SIZE = 32;

  /* ── 그리는 판 ─────────────────────────────────────── */

  function Board(size) {
    this.n = size;
    this.px = new Array(size * size).fill(null);   /* 색 문자열 또는 null(투명) */
  }
  Board.prototype.get = function (x, y) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return null;
    return this.px[y * this.n + x];
  };
  Board.prototype.set = function (x, y, c) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return;
    this.px[y * this.n + x] = c;
  };
  Board.prototype.rect = function (x, y, w, h, c) {
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.set(x + i, y + j, c);
  };
  /* 중심 (cx,cy) · 반지름 (rx,ry) 채운 타원. 정수 좌표라 계단이 남는다(그게 도트다). */
  Board.prototype.ell = function (cx, cy, rx, ry, c) {
    for (var y = -ry; y <= ry; y++) {
      for (var x = -rx; x <= rx; x++) {
        var a = (x + 0.5) / (rx + 0.5), b = (y + 0.5) / (ry + 0.5);
        if (a * a + b * b <= 1) this.set(cx + x, cy + y, c);
      }
    }
  };
  Board.prototype.line = function (x0, y0, x1, y1, c) {
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  /* 다각형 채우기 — 어깨·망토·모자처럼 기울어진 덩어리에 쓴다 */
  Board.prototype.poly = function (pts, c) {
    var minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < pts.length; i++) { minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]); }
    for (var y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      var xs = [];
      for (i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
        }
      }
      xs.sort(function (p, q) { return p - q; });
      for (i = 0; i + 1 < xs.length; i += 2) {
        for (var x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) this.set(x, y, c);
      }
    }
  };
  /* 이미 칠해진 색만 바꿔치기 — 명암을 나중에 손볼 때 쓴다 */
  Board.prototype.swap = function (from, to) {
    for (var i = 0; i < this.px.length; i++) if (this.px[i] === from) this.px[i] = to;
  };

  /* 실루엣 밖으로 1px 윤곽선. 어두운 바닥에서 형체가 살아난다 —
   * 윤곽선이 없으면 던전 색과 섞여 "뭔가 뭉개져 있다" 로 보인다. */
  function outline(b, c) {
    var add = [];
    for (var y = 0; y < b.n; y++) {
      for (var x = 0; x < b.n; x++) {
        if (b.get(x, y)) continue;
        if (b.get(x - 1, y) || b.get(x + 1, y) || b.get(x, y - 1) || b.get(x, y + 1)) add.push([x, y]);
      }
    }
    for (var i = 0; i < add.length; i++) b.set(add[i][0], add[i][1], c);
  }

  /* 위쪽 경계는 밝게, 아래쪽 경계는 어둡게 — 위에서 빛이 온다는 약속.
   * 색마다 밝은/어두운 짝을 미리 정해 둔 곳(pair)만 손댄다. */
  function rim(b, pair) {
    var snap = b.px.slice();
    function at(x, y) {
      if (x < 0 || y < 0 || x >= b.n || y >= b.n) return null;
      return snap[y * b.n + x];
    }
    for (var y = 0; y < b.n; y++) {
      for (var x = 0; x < b.n; x++) {
        var c = at(x, y);
        if (!c || !pair[c]) continue;
        var up = at(x, y - 1), dn = at(x, y + 1);
        if (!up || up !== c) b.set(x, y, pair[c][0]);        /* 위가 비었거나 다른 색 → 밝게 */
        else if (!dn || dn !== c) b.set(x, y, pair[c][1]);   /* 아래가 그러면 → 어둡게 */
      }
    }
  }

  /* ── 스프라이트 등록 ───────────────────────────────── */

  var SPR = {};

  /* ops 는 [연산, ...인자] 목록이다. 색은 팔레트 키로 적는다.
   *   ["rect", x,y,w,h, key] · ["ell", cx,cy,rx,ry, key] · ["line", x0,y0,x1,y1, key]
   *   ["poly", [[x,y],...], key] · ["px", [[x,y],...], key]
   *   ["swap", fromKey, toKey] · ["rim", {key:[lightKey,darkKey]}] · ["outline", key]
   */
  function art(name, pal, ops, opt) {
    SPR[name] = { pal: pal, ops: ops, opt: opt || {}, baked: {} };
  }

  /* 걸음 프레임.
   *
   * 다리만 다른 그림을 통째로 한 벌 더 적는 건 낭비이고, 몸을 고치면 두 곳을
   * 고쳐야 해서 반드시 어긋난다. 그래서 **프레임 필터**를 둔다:
   *   ["f", 0]  → 이 뒤의 연산은 프레임 0 에서만 그린다(선 자세)
   *   ["f", 1]  → 프레임 1 에서만(왼발)   ["f", 2] → 프레임 2 에서만(오른발)
   *   ["f", null] → 다시 모든 프레임에서
   * 몸통은 필터 밖에 두고 다리만 갈라 적으면 된다. */
  function draw(name, frame) {
    var s = SPR[name];
    var b = new Board(SIZE);
    var P = s.pal;
    var only = null;
    for (var i = 0; i < s.ops.length; i++) {
      var o = s.ops[i], k = o[0];
      if (k === "f") { only = (o[1] === null || o[1] === undefined) ? null : o[1]; continue; }
      if (only !== null && only !== frame) continue;
      if (k === "rect") b.rect(o[1], o[2], o[3], o[4], P[o[5]]);
      else if (k === "ell") b.ell(o[1], o[2], o[3], o[4], P[o[5]]);
      else if (k === "line") b.line(o[1], o[2], o[3], o[4], P[o[5]]);
      else if (k === "poly") b.poly(o[1], P[o[2]]);
      else if (k === "px") { for (var j = 0; j < o[1].length; j++) b.set(o[1][j][0], o[1][j][1], P[o[2]]); }
      else if (k === "swap") b.swap(P[o[1]], P[o[2]]);
      else if (k === "rim") {
        var pair = {};
        for (var key in o[1]) pair[P[key]] = [P[o[1][key][0]], P[o[1][key][1]]];
        rim(b, pair);
      }
      else if (k === "outline") outline(b, P[o[1]]);
    }
    return b;
  }

  /* 색을 입힌 판.
   *
   * ⚠ 메인 캔버스에 source-atop 으로 칠하면 그 합성이 **이미 그려진 곳 전체**에
   *   걸려 바닥까지 물든다(구역 작업에서 겪은 것). 그래서 스프라이트마다
   *   오프스크린에서 굽고 캐시한다. 열쇠에 색을 넣어야 흰 섬광과 독 색이
   *   서로를 덮어쓰지 않는다.
   * ⚠ 쓰는 색은 몇 가지뿐이다(흰 섬광 · 상태이상 3~4색). 캔버스가 무한정
   *   늘지 않는다 — 색을 값에서 만들어 넘기지 말 것. */
  function bake(name, frame, tint) {
    var s = SPR[name];
    if (!s) return null;
    var f = frame || 0;
    if (tint) {
      var key = f + "|" + tint;
      if (s.baked[key]) return s.baked[key];
      var base = bake(name, f);
      if (!base) return null;
      var tc = document.createElement("canvas");
      tc.width = SIZE; tc.height = SIZE;
      var tx = tc.getContext("2d");
      tx.imageSmoothingEnabled = false;
      tx.drawImage(base, 0, 0);
      tx.globalCompositeOperation = "source-atop";   /* 그려진 픽셀 위에만 */
      tx.fillStyle = tint;
      tx.fillRect(0, 0, SIZE, SIZE);
      s.baked[key] = tc;
      return tc;
    }
    if (s.baked[f]) return s.baked[f];
    var b = draw(name, f);
    var c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    var x = c.getContext("2d");
    for (var y = 0; y < SIZE; y++) {
      for (var i = 0; i < SIZE; i++) {
        var col = b.get(i, y);
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(i, y, 1, 1);
      }
    }
    s.baked[f] = c;
    return c;
  }

  /* 이 스프라이트에 걸음 프레임이 있는가 — 없으면 렌더러가 굳이 프레임을 안 바꾼다 */
  function hasFrames(name) {
    var s = SPR[name];
    if (!s) return false;
    if (s._hf === undefined) {
      s._hf = false;
      for (var i = 0; i < s.ops.length; i++) {
        if (s.ops[i][0] === "f" && s.ops[i][1]) { s._hf = true; break; }
      }
    }
    return s._hf;
  }

  /* ── 공용 색 ───────────────────────────────────────── */

  var OUT = "#12111a";          /* 윤곽선 — 모든 생물·물건이 같은 색을 쓴다(한 세트로 보인다) */
  var VOID = "#0a090d";

  /* ── 지형 ──────────────────────────────────────────
   *
   * 지형은 도형보다 **패턴**이라 따로 그린다. 그리고 한 장만 만들어 깔면
   * 같은 무늬가 격자로 반복돼 눈에 걸린다 — 변종을 여러 장 구워 두고
   * 좌표로 골라 쓴다(js/render.js 의 variant). */

  /* ⚠ **바닥 변종이 4개뿐이었다.** 한 화면 375칸에 같은 그림 넉 장이 94번씩
   *   깔렸고, 금과 조약돌이 **항상 같은 픽셀 자리**에 있었다. 그래서 질감이
   *   아니라 **격자 무늬**로 읽혔다 — "바닥이 밋밋하다" 의 진짜 원인이다.
   *   색은 이미 줄눈·판석면·윗빛·아랫그늘·돌결 2종·금·조약돌 3종이 다 있었다.
   *   16장이면 한 화면에 같은 그림이 23번으로 줄고, 자국 자리도 장마다 다르다.
   * ⚠ 16장을 구워도 32x32 라 256KB 남짓이다. 굽기는 처음 한 번뿐이다. */
  var FLOOR_VARIANTS = 16, WALL_VARIANTS = 6;

  /* 씨앗 있는 난수 — 변종이 매번 달라지면 새로고침마다 바닥이 바뀐다 */
  function rnd(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  /* 판석 바닥.
   *
   * ⚠ 변종마다 이음선을 **다른 자리**에 둬야 한다. 처음엔 모든 변종이 비슷한 높이에
   *   가로 이음선을 가졌는데, 그걸 깔아 보니 바닥 전체가 **가로 줄무늬**로 보였다
   *   (돌이 아니라 나무 판자 같았다). 배치표를 변종마다 통째로 다르게 둔다.
   * ⚠ 판석은 타일 가장자리에 붙인다. 안쪽으로 들이면 32px 격자가 눈에 드러난다 —
   *   이웃 타일의 판석과 맞닿아야 하나의 큰 바닥으로 읽힌다. */
  var FLOOR_LAYOUTS = [
    [[0, 0, 18, 15], [18, 0, 14, 15], [0, 15, 13, 17], [13, 15, 19, 17]],
    [[0, 0, 13, 21], [13, 0, 19, 11], [13, 11, 19, 10], [0, 21, 32, 11]],
    [[0, 0, 32, 12], [0, 12, 11, 20], [11, 12, 21, 20]],
    [[0, 0, 15, 9], [15, 0, 17, 23], [0, 9, 15, 23], [15, 23, 17, 9]],
    [[0, 0, 11, 18], [11, 0, 21, 8], [11, 8, 21, 10], [0, 18, 20, 14], [20, 18, 12, 14]],
    [[0, 0, 22, 10], [22, 0, 10, 22], [0, 10, 12, 22], [12, 10, 10, 12], [12, 22, 20, 10]],
    [[0, 0, 16, 32], [16, 0, 16, 13], [16, 13, 16, 19]],
    [[0, 0, 32, 20], [0, 20, 17, 12], [17, 20, 15, 12]]
  ];

  /* 기본 팔레트 — 구역이 없을 때(그리고 data.js 가 없는 검사 환경에서) 쓰는 값.
   * ⚠ 구역 팔레트는 **명도를 붙잡고 색상만 돌린다.** 바닥이 어두워지면 그 위의
   *   도트가 안 보인다. */
  var FLOOR_BASE = {
    mortar: "#1e1b26", face: "#302b3a", lit: "#3a3446", dim: "#272233",
    grain1: "#363040", grain2: "#2a2534", crack: "#241f2e",
    peb1: "#423b4e", peb2: "#4a4257", peb3: "#332d3e"
  };
  var WALL_BASE = {
    mortar: "#3c3846", face: "#585264", lit: "#6d6679", dim: "#433e4e",
    grain1: "#615b6e", grain2: "#4e4859", moss: "#3f5040"
  };

  function floorTile(v, pal) {
    var P = pal || FLOOR_BASE;
    var b = new Board(SIZE);
    /* ⚠ 씨앗에 변종 번호를 섞어 **장마다 다른 난수 줄기**를 탄다. 예전에는
     *   금과 조약돌을 고정 좌표에 박아 둬서, 같은 자국이 화면 곳곳에 똑같이
     *   되풀이됐다. 자리를 굴리는 것이 장 수를 늘리는 것보다 중요하다. */
    var r = rnd(1000 + v * 7717 + v * v * 131);
    var MORTAR = P.mortar, FACE = P.face, LIT = P.lit, DIM = P.dim;
    b.rect(0, 0, SIZE, SIZE, MORTAR);

    var L = FLOOR_LAYOUTS[v % FLOOR_LAYOUTS.length];
    for (var i = 0; i < L.length; i++) {
      var x = L[i][0], y = L[i][1], w = L[i][2], h = L[i][3];
      b.rect(x, y, w - 1, h - 1, FACE);            /* 1px 은 줄눈으로 남긴다 */
      b.rect(x, y, w - 1, 1, LIT);                 /* 위 모서리에 빛 */
      b.rect(x, y + h - 2, w - 1, 1, DIM);         /* 아래 모서리에 그늘 */
    }

    /* 돌결 — 판석 면에만 얹는다(줄눈에 얹으면 줄눈이 흐려진다) */
    for (var s = 0; s < 90; s++) {
      var px = Math.floor(r() * SIZE), py = Math.floor(r() * SIZE);
      if (b.get(px, py) !== FACE) continue;
      b.set(px, py, r() < 0.5 ? P.grain1 : P.grain2);
    }
    /* 금 — 있는 장이 절반, 자리와 길이와 방향을 전부 굴린다 */
    if (r() < 0.5) {
      var cracks = 1 + (r() < 0.25 ? 1 : 0);
      for (var ci = 0; ci < cracks; ci++) {
        var cx = 4 + Math.floor(r() * 24), cy = 3 + Math.floor(r() * 24);
        var dx = Math.floor(r() * 11) - 5, dy = 3 + Math.floor(r() * 6);
        b.line(cx, cy, cx + dx, cy + dy, P.crack);
        if (r() < 0.4) b.line(cx + dx, cy + dy, cx + dx + Math.floor(r() * 7) - 3,
                              cy + dy + 2 + Math.floor(r() * 4), P.crack);
      }
    }
    /* 조약돌 — 다섯 장에 하나꼴. 무리 지어 놓아야 돌로 읽힌다 */
    if (r() < 0.22) {
      var groups = 1 + (r() < 0.35 ? 1 : 0);
      for (var gi = 0; gi < groups; gi++) {
        var gx = 3 + Math.floor(r() * 26), gy = 3 + Math.floor(r() * 26);
        b.set(gx, gy, P.peb1);
        b.set(gx + 1, gy, P.peb2);
        if (r() < 0.7) b.set(gx + 1, gy + 1, P.peb3);
        if (r() < 0.4) b.set(gx - 1, gy + 1, P.peb1);
      }
    }
    /* 깨진 판석 — 열 장에 하나꼴로 줄눈 색 조각이 한 귀퉁이를 먹는다 */
    if (r() < 0.12) {
      var bx = 2 + Math.floor(r() * 24), by = 2 + Math.floor(r() * 24);
      b.poly([[bx, by], [bx + 4 + Math.floor(r() * 4), by + 1],
              [bx + 3, by + 4 + Math.floor(r() * 3)]], P.crack);
    }
    return b;
  }

  /* 벽 **윗면**. 사람이 위에서 내려다보는 면이라 벽돌이 눕는다.
   * ⚠ 벽돌 단의 높이와 어긋남을 변종마다 굴린다. 전에는 셋 다 같은 줄에
   *   같은 어긋남이라, 벽이 이어지면 가로줄이 화면을 가로질렀다. */
  function wallTile(v, pal) {
    var P = pal || WALL_BASE;
    var b = new Board(SIZE);
    var r = rnd(2000 + v * 3313 + v * v * 97);
    b.rect(0, 0, SIZE, SIZE, P.mortar);        /* 줄눈(모르타르) */
    /* 벽돌 3~4단 — 단마다 어긋남을 굴린다 */
    var bands = r() < 0.4 ? 4 : 3;
    var hEach = Math.floor(SIZE / bands);
    for (var ri = 0; ri < bands; ri++) {
      var y = ri * hEach, h = (ri === bands - 1) ? (SIZE - y) : hEach;
      var off = -Math.floor(r() * 16);
      var step = 14 + Math.floor(r() * 5);
      for (var x = off; x < SIZE; x += step) {
        var bw = Math.min(step, SIZE - Math.max(0, x)) - 2;
        var bx = Math.max(0, x) + 1;
        if (bw <= 1) continue;
        b.rect(bx, y + 1, bw, h - 2, P.face);
        b.rect(bx, y + 1, bw, 1, P.lit);         /* 위 하이라이트 */
        b.rect(bx, y + h - 2, bw, 1, P.dim);      /* 아래 그림자 */
      }
    }
    /* 돌 표면 잡티 */
    for (var i = 0; i < 80; i++) {
      var px = Math.floor(r() * SIZE), py = Math.floor(r() * SIZE);
      if (b.get(px, py) === P.face) b.set(px, py, r() < 0.5 ? P.grain1 : P.grain2);
    }
    /* 이끼 — 세 장에 하나꼴, 아래쪽에만 살짝 */
    if (r() < 0.34) {
      for (var m = 0; m < 26; m++) {
        var mx = Math.floor(r() * SIZE), my = 24 + Math.floor(r() * 8);
        if (b.get(mx, my)) b.set(mx, my, P.moss);
      }
    }
    return b;
  }

  /* 벽 **앞면**. 사람을 마주보는 면이다.
   *
   * 탑다운에서 벽을 평평한 한 장으로 두면 바닥과 구별이 안 된다. 정석은
   * 윗면과 앞면을 나눠 그리는 것이다(조사한 32px 탑다운 타일셋들이 전부
   * 그 구조다). 아래가 바닥인 벽 칸에만 이 면을 쓴다 — 실측으로 벽의 11%,
   * 층당 161칸이다.
   *
   * ⚠ `thin` 은 **위아래가 다 바닥인 한 칸 두께 벽**이다(층당 15칸). 그 칸에
   *   윗면과 앞면을 같이 넣으면 벽이 절반 높이로 보인다. 이때는 앞면만
   *   칸 전체에 세운다. 이걸 안 정하고 시작하면 층마다 열댓 칸이 깨진다.
   * ⚠ 앞면은 벽돌을 **세로로** 쌓는다. 윗면과 같은 눕힌 벽돌이면 두 면이
   *   한 면으로 뭉쳐 높이가 안 읽힌다.
   * ⚠ 맨 아래 두 줄은 가장 어둡게. 바닥과 닿는 자리가 밝으면 벽이 떠 보인다. */
  function wallFaceTile(v, pal, thin) {
    var P = pal || WALL_BASE;
    var b = new Board(SIZE);
    var r = rnd(4000 + v * 6151 + (thin ? 733 : 0));
    /* 윗면이 보이는 높이. thin 이면 0 — 칸 전체가 앞면이다 */
    var cap = thin ? 0 : 10;
    if (cap > 0) {
      /* 윗면 단면 — 어두운 돌. 여기가 '벽 꼭대기' 다 */
      b.rect(0, 0, SIZE, cap, P.mortar);
      for (var tx = 0; tx < SIZE; tx += 11) {
        var tw = Math.min(11, SIZE - tx) - 2;
        if (tw <= 1) continue;
        b.rect(tx + 1, 1, tw, cap - 3, P.dim);
        b.rect(tx + 1, 1, tw, 1, P.face);
      }
      b.rect(0, cap - 2, SIZE, 2, P.lit);      /* 꼭대기 모서리에 빛 */
    }
    /* 앞면 — 세로로 세운 벽돌 */
    b.rect(0, cap, SIZE, SIZE - cap, P.mortar);
    var colW = 10 + Math.floor(r() * 3);
    for (var x = -Math.floor(r() * colW); x < SIZE; x += colW) {
      var bx = Math.max(0, x) + 1;
      var bw = Math.min(colW, SIZE - Math.max(0, x)) - 2;
      if (bw <= 1) continue;
      var top = cap + 1 + Math.floor(r() * 3);
      b.rect(bx, top, bw, SIZE - top - 2, P.face);
      b.rect(bx, top, 1, SIZE - top - 2, P.lit);        /* 왼쪽 모서리에 빛 */
      b.rect(bx + bw - 1, top, 1, SIZE - top - 2, P.dim);
    }
    /* 돌결 */
    for (var i = 0; i < 70; i++) {
      var px = Math.floor(r() * SIZE), py = cap + Math.floor(r() * (SIZE - cap));
      if (b.get(px, py) === P.face) b.set(px, py, r() < 0.5 ? P.grain1 : P.grain2);
    }
    /* 바닥과 닿는 두 줄은 가장 어둡게 — 벽이 바닥에 **박혀** 있어야 한다 */
    b.rect(0, SIZE - 2, SIZE, 2, P.mortar);
    return b;
  }

  function bakeBoard(b) {
    var c = document.createElement("canvas");
    c.width = SIZE; c.height = SIZE;
    var x = c.getContext("2d");
    for (var y = 0; y < SIZE; y++) {
      for (var i = 0; i < SIZE; i++) {
        var col = b.get(i, y);
        if (!col) continue;
        x.fillStyle = col;
        x.fillRect(i, y, 1, 1);
      }
    }
    return c;
  }

  var terrainCache = {};
  /* zone 은 data.js 의 ZONES 항목(없으면 기본 팔레트).
   * ⚠ 캐시 열쇠에 **구역 id 를 반드시 넣는다.** 안 넣으면 1층에서 구운 타일이
   *   10층까지 그대로 쓰여 색이 안 바뀐다(그리고 원인이 안 보인다). */
  function terrain(kind, variant, zone) {
    var zid = zone ? zone.id : "_";
    var key = kind + ":" + variant + ":" + zid;
    if (terrainCache[key]) return terrainCache[key];
    var b;
    if (kind === "floor") b = floorTile(variant % FLOOR_VARIANTS, zone && zone.floor);
    else if (kind === "wall") b = wallTile(variant % WALL_VARIANTS, zone && zone.wall);
    else if (kind === "wallface") b = wallFaceTile(variant % WALL_VARIANTS, zone && zone.wall, false);
    else if (kind === "wallthin") b = wallFaceTile(variant % WALL_VARIANTS, zone && zone.wall, true);
    else b = floorTile(0, zone && zone.floor);
    terrainCache[key] = bakeBoard(b);
    return terrainCache[key];
  }

  /* 문 — 나무 판자 + 철 띠 + 고리. 바닥 위에 얹는다(문틀 사이로 바닥이 보인다). */
/* 문 — **돌 문틀** 안에 나무 문짝.
   * ⚠ 예전에는 문짝만 있어 벽에 널판을 댄 것처럼 보였다(제안서 지적:
   *   "지나갈 수 있는 곳" 임이 안 읽힌다). 기둥 둘과 인방을 두르면 그 자리가
   *   **뚫린 곳**이라는 것이 문짝보다 먼저 읽힌다. */
  /* ⚠ **문 나무와 상자 나무가 같은 색이었다.** 문 #7b5330/#96663c 와
   *   상자 #7a5730/#966c3c — 눈으로 가를 수 없는 차이다. 지도를 2배로 키우자
   *   갈색 덩어리 여섯 개가 한 화면에 보이는데 셋만 문이었고, 그래서 "문이
   *   갑자기 많아졌다" 로 느껴졌다(실제 문 수는 층당 4.7개로 그대로였다).
   *
   *   색과 생김새를 **둘 다** 가른다.
   *     문   — 밝은 석재 아치가 먼저 보이고, 문짝은 **어둡고 차가운** 나무
   *     상자 — 석재가 없고 **밝고 노란** 나무에 X 버팀대
   *   멀리서 보면 문은 "밝은 테두리 + 어두운 속", 상자는 "밝은 덩어리" 다.
   *   실루엣이 반대라 색을 못 봐도 갈린다.
   * ⚠ 아치 어깨를 깎아 둔다. 네모 인방이면 '벽에 댄 널판' 으로 읽힌다. */
  art("door", {
    o: OUT, w: "#4e3520", W: "#63442a", d: "#33210f", i: "#5b5666", I: "#837d90",
    k: "#c9a227", s: "#7b7486", S: "#9a93aa", n: "#3b3646", V: "#17131d"
  }, [
    /* 석재 문틀 — 기둥을 5px 로 두껍게. 얇으면 문짝만 보인다 */
    ["rect", 0, 0, 32, 7, "s"],                 /* 인방 */
    ["rect", 0, 0, 32, 2, "S"],
    ["rect", 0, 6, 32, 1, "n"],
    ["rect", 0, 0, 5, 32, "s"],                 /* 왼 기둥 */
    ["rect", 0, 0, 2, 32, "S"],
    ["rect", 4, 0, 1, 32, "n"],
    ["rect", 27, 0, 5, 32, "s"],                /* 오른 기둥 */
    ["rect", 27, 0, 1, 32, "n"],
    ["rect", 30, 0, 2, 32, "S"],
    /* 아치 어깨 — 모서리를 채워 둥글린다 */
    ["px", [[5, 7], [6, 7], [5, 8], [25, 7], [26, 7], [26, 8]], "s"],
    ["px", [[5, 7], [26, 7]], "S"],
    /* 문짝 뒤 어둠 — '뚫린 곳' 이라는 것이 여기서 읽힌다 */
    ["rect", 5, 7, 22, 25, "V"],
    /* 문짝 — 어둡고 차가운 나무. 세로 널 셋 */
    ["rect", 6, 9, 20, 23, "d"],
    ["rect", 7, 10, 18, 21, "w"],
    ["rect", 7, 10, 18, 1, "W"],
    ["rect", 13, 10, 1, 21, "d"],               /* 널 사이 홈 */
    ["rect", 19, 10, 1, 21, "d"],
    /* 철띠 둘 + 못 */
    ["rect", 6, 13, 20, 3, "i"],
    ["rect", 6, 13, 20, 1, "I"],
    ["rect", 6, 25, 20, 3, "i"],
    ["rect", 6, 25, 20, 1, "I"],
    ["px", [[8, 14], [16, 14], [24, 14], [8, 26], [16, 26], [24, 26]], "I"],
    /* 고리 손잡이 */
    ["ell", 22, 20, 3, 3, "k"],
    ["ell", 22, 20, 1, 2, "V"],
    ["outline", "o"]
  ]);

  /* 계단 — 아래로 멀어지는 단. 좌우 대칭으로 좁아지고 맨 아래가 검다.
   * ⚠ 처음엔 단을 왼쪽에만 들여 검은 구멍이 한쪽에 몰렸다 — 계단이 아니라
   *   벽 구멍처럼 보였다. 양쪽을 같이 들여야 '내려간다' 로 읽힌다. */
  art("stairs", {
    o: OUT, s: "#98909f", m: "#7a7384", d: "#585165", n: "#3d3847", v: VOID
  }, [
    ["rect", 0, 0, 32, 32, "n"],
    ["rect", 1, 2, 30, 5, "s"],            /* 첫 단 */
    ["rect", 1, 7, 30, 2, "d"],
    ["rect", 4, 9, 24, 5, "m"],
    ["rect", 4, 14, 24, 2, "d"],
    ["rect", 7, 16, 18, 4, "m"],
    ["rect", 7, 20, 18, 2, "d"],
    ["rect", 10, 22, 12, 4, "d"],
    ["rect", 12, 26, 8, 5, "v"],           /* 더 아래는 어둠 */
    ["rim", { s: ["s", "d"], m: ["s", "d"] }]
  ]);

  /* 깊은 계단 — **같은 계단이되 한눈에 다르다.** 돌이 검고 아래에서 불빛이 샌다.
   * ⚠ 모양을 아주 다르게 그리지 않는다. "계단" 으로 안 읽히면 선택지가 아니라
   *   못 보던 물건이 된다 — 같은 실루엣에 색과 빛만 바꾼다. */
  art("deep", {
    o: OUT, s: "#5e5560", m: "#4a4350", d: "#332e3a", n: "#221e28", v: "#0a0709",
    E: "#e0742a", e: "#94491c"
  }, [
    ["rect", 0, 0, 32, 32, "n"],
    ["rect", 1, 2, 30, 5, "s"],
    ["rect", 1, 7, 30, 2, "d"],
    ["rect", 4, 9, 24, 5, "m"],
    ["rect", 4, 14, 24, 2, "d"],
    ["rect", 7, 16, 18, 4, "m"],
    ["rect", 7, 20, 18, 2, "d"],
    ["rect", 10, 22, 12, 4, "d"],
    ["rect", 12, 26, 8, 5, "v"],
    ["rect", 13, 28, 6, 3, "e"],           /* 아래에서 새는 불빛 */
    ["rect", 14, 29, 4, 2, "E"],
    ["px", [[11, 25], [20, 25]], "e"],
    ["rim", { s: ["s", "d"], m: ["s", "d"] }]
  ]);

  /* 함정 — 바닥 판에서 솟은 가시. 드러난 뒤에만 그린다. */
  art("trap", {
    o: OUT, p: "#332e3c", s: "#a9aebb", S: "#cfd4df", d: "#6b2222", h: "#4a4452"
  }, [
    ["rect", 3, 3, 26, 26, "p"],
    ["rect", 3, 3, 26, 1, "h"],
    ["px", [[8, 26], [16, 26], [24, 26], [12, 27], [20, 27]], "h"],
    ["poly", [[7, 26], [9, 26], [8, 12]], "s"],
    ["poly", [[15, 26], [17, 26], [16, 9]], "s"],
    ["poly", [[23, 26], [25, 26], [24, 13]], "s"],
    ["poly", [[11, 28], [13, 28], [12, 17]], "s"],
    ["poly", [[19, 28], [21, 28], [20, 16]], "s"],
    ["px", [[8, 13], [16, 10], [24, 14], [12, 18], [20, 17]], "S"],
    ["px", [[8, 24], [16, 24], [24, 24], [12, 26], [20, 26]], "d"],
    ["outline", "o"]
  ]);

  global.SPRITES = {
    SIZE: SIZE,
    OUT: OUT,
    FLOOR_VARIANTS: FLOOR_VARIANTS,
    WALL_VARIANTS: WALL_VARIANTS,
    art: art,
    bake: bake,
    /* 점검기 전용 — 구운 판이 몇 벌인가.
     * ⚠ 색을 값에서 만들어 넘기면(알파를 시간에 따라 바꾸는 식) 여기가 프레임마다
     *   하나씩 늘어 메모리를 먹는다. 검사가 이 수를 지킨다. */
    cacheCount: function () {
      var total = 0, worst = 0, worstName = "";
      for (var k in SPR) {
        var c = 0;
        for (var f in SPR[k].baked) c++;
        total += c;
        if (c > worst) { worst = c; worstName = k; }
      }
      return { total: total, worst: worst, name: worstName };
    },
    hasFrames: hasFrames,
    terrain: terrain,
    data: SPR
  };
})(window);
