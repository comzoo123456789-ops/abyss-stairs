/* 던전 생성 + 시야(FOV).
 *
 * 생성: 겹치지 않는 방을 뿌리고 L 자 복도로 잇는다. 고전 로그 방식이다.
 * 시야: 재귀 그림자 던지기(recursive shadowcasting) 8분면.
 *       벽 뒤가 정확히 가려지고 대칭이라 "분명 보이는데 안 보인다" 가 안 생긴다.
 */
(function (global) {
  "use strict";

  /* ⚠ DEEP 은 **두 번째 계단**이다. STAIRS 로 같이 두면 어느 쪽을 밟았는지
   *   구별할 수가 없다 — 칸 종류를 따로 둔다(그리기·길찾기·검사가 다 이걸 본다). */
  var WALL = 0, FLOOR = 1, DOOR = 2, STAIRS = 3, DEEP = 4;

  /* ── 씨앗 있는 난수 ──────────────────────────────────────
   * Math.random 을 그대로 쓰면 같은 층을 두 번 볼 수 없다.
   * 씨앗을 남겨 두면 "그 판 다시" 와 버그 재현이 된다. */
  function makeRng(seed) {
    var s = seed >>> 0;
    if (s === 0) s = 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function Level(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);      /* 지형 */
    this.visible = new Uint8Array(w * h);    /* 지금 보이는가 */
    this.seen = new Uint8Array(w * h);       /* 한 번이라도 봤는가(= 흐릿하게 기억) */
    /* 함정은 지형이 아니라 별도 층이다 — 지형에 섞으면 밟기 전에 벽처럼 보이거나
     * 발동한 뒤 바닥으로 되돌릴 때 원래 지형을 잃는다. 0=없음 1=숨음 2=드러남 */
    this.traps = new Uint8Array(w * h);
    /* 구역 장식(물웅덩이·책더미·뼈…). 규칙에 아무 영향이 없다 — 그리기용이다.
     * 0=없음, 그 외는 구역 장식 목록의 (번호+1). 지형에 섞지 않는 이유는 함정과 같다. */
    this.props = new Uint8Array(w * h);
    this.rooms = [];
    this.upAt = null;
    this.downAt = null;
    this.deepAt = null;
    this.treasure = null;
  }

  Level.prototype.idx = function (x, y) { return y * this.w + x; };
  Level.prototype.inside = function (x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  };
  Level.prototype.at = function (x, y) {
    if (!this.inside(x, y)) return WALL;
    return this.tiles[y * this.w + x];
  };
  Level.prototype.blocked = function (x, y) {
    return this.at(x, y) === WALL;
  };
  /* 문은 통과할 수 있지만 시야는 막는다 — 복도 너머가 다 보이면 긴장이 없다. */
  Level.prototype.opaque = function (x, y) {
    var t = this.at(x, y);
    return t === WALL || t === DOOR;
  };

  function overlaps(a, b) {
    /* 방 사이에 최소 한 칸 벽을 남긴다(붙으면 하나의 방으로 보인다) */
    return a.x <= b.x + b.w + 1 && a.x + a.w + 1 >= b.x &&
           a.y <= b.y + b.h + 1 && a.y + a.h + 1 >= b.y;
  }

  function carveRoom(lv, r) {
    for (var y = r.y; y < r.y + r.h; y++)
      for (var x = r.x; x < r.x + r.w; x++)
        lv.tiles[lv.idx(x, y)] = FLOOR;
  }

  function carveH(lv, x1, x2, y) {
    var a = Math.min(x1, x2), b = Math.max(x1, x2);
    for (var x = a; x <= b; x++)
      if (lv.tiles[lv.idx(x, y)] === WALL) lv.tiles[lv.idx(x, y)] = FLOOR;
  }

  function carveV(lv, y1, y2, x) {
    var a = Math.min(y1, y2), b = Math.max(y1, y2);
    for (var y = a; y <= b; y++)
      if (lv.tiles[lv.idx(x, y)] === WALL) lv.tiles[lv.idx(x, y)] = FLOOR;
  }

  /* 방 경계에 걸친 복도 입구를 문으로 바꾼다 — 시야가 끊겨 층이 넓게 느껴진다. */
  /* 문은 **진짜 병목**에만 세운다.
   *
   * ⚠ 예전에는 방 둘레에서 복도가 닿는 칸을 전부 후보로 잡고 45% 확률로 문을 만들었다.
   *   복도가 방 벽을 **따라** 지나가면 그 줄이 통째로 후보가 되어 문이 3~5개 줄줄이
   *   생겼다(사용자 신고: "왜 이리 문이 많이 나오는 거야"). 방 하나에 문이 넷 달린
   *   그림은 던전이 아니라 창고처럼 보인다.
   *
   * 문이 설 자리는 "지나가려면 반드시 여기를 통과해야 하는 한 칸" 이다 —
   * 좌우가 뚫려 있고 위아래가 벽이거나, 그 반대. 그리고 문 옆에 문을 두지 않는다. */
  function isChoke(lv, x, y) {
    if (lv.at(x, y) !== FLOOR) return false;
    var l = !lv.blocked(x - 1, y), r = !lv.blocked(x + 1, y);
    var u = !lv.blocked(x, y - 1), dn = !lv.blocked(x, y + 1);
    return (l && r && !u && !dn) || (u && dn && !l && !r);
  }

  function nearDoor(lv, x, y) {
    for (var j = -1; j <= 1; j++)
      for (var i = -1; i <= 1; i++)
        if (lv.at(x + i, y + j) === DOOR) return true;
    return false;
  }

  function placeDoors(lv, rng) {
    var cand = [];
    for (var y = 1; y < lv.h - 1; y++) {
      for (var x = 1; x < lv.w - 1; x++) {
        if (isChoke(lv, x, y)) cand.push([x, y]);
      }
    }
    /* 후보를 섞어 한쪽으로 몰리지 않게 한다 */
    for (var s = cand.length - 1; s > 0; s--) {
      var k = Math.floor(rng() * (s + 1));
      var t = cand[s]; cand[s] = cand[k]; cand[k] = t;
    }
    /* 층에 문 3~5개면 충분하다. 확률만 두면 층마다 0개~열몇 개로 들쭉날쭉하다. */
    var want = 3 + Math.floor(rng() * 3);
    var placed = 0;
    for (var c = 0; c < cand.length && placed < want; c++) {
      var p = cand[c];
      if (nearDoor(lv, p[0], p[1])) continue;
      lv.tiles[lv.idx(p[0], p[1])] = DOOR;
      placed++;
    }
  }

  function generate(w, h, depth, seed) {
    var rng = makeRng(seed);
    var lv = new Level(w, h);
    lv.seed = seed;
    lv.depth = depth;
    lv.rng = rng;

    var tries = 220;
    var maxRooms = 9 + Math.floor(rng() * 5);
    while (tries-- > 0 && lv.rooms.length < maxRooms) {
      var rw = 5 + Math.floor(rng() * 8);
      var rh = 4 + Math.floor(rng() * 6);
      var rx = 1 + Math.floor(rng() * (w - rw - 2));
      var ry = 1 + Math.floor(rng() * (h - rh - 2));
      var room = { x: rx, y: ry, w: rw, h: rh };
      var ok = true;
      for (var i = 0; i < lv.rooms.length; i++) {
        if (overlaps(room, lv.rooms[i])) { ok = false; break; }
      }
      if (!ok) continue;
      room.cx = rx + (rw >> 1);
      room.cy = ry + (rh >> 1);
      carveRoom(lv, room);
      if (lv.rooms.length) {
        var prev = lv.rooms[lv.rooms.length - 1];
        /* L 자 복도. 가로 먼저인지 세로 먼저인지를 섞어야 길이 뻔하지 않다. */
        if (rng() < 0.5) {
          carveH(lv, prev.cx, room.cx, prev.cy);
          carveV(lv, prev.cy, room.cy, room.cx);
        } else {
          carveV(lv, prev.cy, room.cy, prev.cx);
          carveH(lv, prev.cx, room.cx, room.cy);
        }
      }
      lv.rooms.push(room);
    }

    placeDoors(lv, rng);

    /* 보물방 — 시작 방이 아닌 가장 작은 방. **입구에만** 문을 단다.
     * ⚠ 예전에는 둘레를 전부 문으로 바꿨다. 복도가 방 옆을 따라 지나가면 그 줄이
     *   통째로 문이 되어 한 층에 문이 열 개씩 생겼다 — 그래서 문이 많아 보였다.
     * ⚠ 벽으로 막지도 않는다. 들어갈 길이 없으면 아이템이 영영 안 닿는다. */
    lv.treasure = null;
    if (depth >= 2 && rng() < 0.4 && lv.rooms.length >= 4) {
      var cands = lv.rooms.slice(1).sort(function (a, b) { return a.w * a.h - b.w * b.h; });
      var tr = cands[0];
      /* 방 안쪽 한 칸 테두리에서 '바깥과 이어지는 칸' 만 문으로 — 그게 입구다 */
      var doors = 0;
      for (var ty = tr.y; ty < tr.y + tr.h && doors < 2; ty++) {
        for (var tx = tr.x; tx < tr.x + tr.w && doors < 2; tx++) {
          var onEdge = (tx === tr.x || tx === tr.x + tr.w - 1 || ty === tr.y || ty === tr.y + tr.h - 1);
          if (!onEdge || lv.at(tx, ty) !== FLOOR) continue;
          /* 방 밖으로 통하는 이웃이 있는가 */
          var opens = false;
          for (var s2 = 0; s2 < 4; s2++) {
            var nx2 = tx + [0, 0, -1, 1][s2], ny2 = ty + [-1, 1, 0, 0][s2];
            if (nx2 >= tr.x && nx2 < tr.x + tr.w && ny2 >= tr.y && ny2 < tr.y + tr.h) continue;
            if (!lv.blocked(nx2, ny2)) { opens = true; break; }
          }
          if (!opens || nearDoor(lv, tx, ty)) continue;
          lv.tiles[lv.idx(tx, ty)] = DOOR;
          doors++;
        }
      }
      lv.treasure = tr;
    }

    /* 시작과 계단은 서로 가장 먼 두 방에 둔다 — 한 발짝 옆이 계단이면 층이 없는 셈이다. */
    var first = lv.rooms[0];
    var far = first, best = -1;
    for (var k = 1; k < lv.rooms.length; k++) {
      var d = Math.abs(lv.rooms[k].cx - first.cx) + Math.abs(lv.rooms[k].cy - first.cy);
      if (d > best) { best = d; far = lv.rooms[k]; }
    }
    lv.upAt = { x: first.cx, y: first.cy };
    lv.downAt = { x: far.cx, y: far.cy };
    lv.tiles[lv.idx(far.cx, far.cy)] = STAIRS;

    /* 깊은 계단 — **두 번째 길**. 더 험한 층으로 내려가는 대신 더 가져간다.
     * ⚠ 시작 방과 평범한 계단 **둘 다에서 먼** 방에 둔다. 셋이 몰려 있으면
     *   고르는 것이 아니라 둘 중 가까운 것을 밟는 것이 된다.
     * ⚠ 방이 셋 미만이면 안 둔다. 억지로 두면 같은 방에 계단 둘이 생긴다. */
    if (lv.rooms.length >= 3) {
      var deep = null, dbest = -1;
      for (var q = 1; q < lv.rooms.length; q++) {
        var r = lv.rooms[q];
        if (r === far) continue;
        var d1 = Math.abs(r.cx - first.cx) + Math.abs(r.cy - first.cy);
        var d2 = Math.abs(r.cx - far.cx) + Math.abs(r.cy - far.cy);
        var score = Math.min(d1, d2);          /* 둘 중 가까운 쪽을 최대로 */
        if (score > dbest) { dbest = score; deep = r; }
      }
      if (deep && dbest >= 6) {
        lv.deepAt = { x: deep.cx, y: deep.cy };
        lv.tiles[lv.idx(deep.cx, deep.cy)] = DEEP;
      }
    }

    return lv;
  }

  /* 방 안의 빈 바닥 한 칸. occupied(x,y) 가 true 면 피한다. */
  function randomFloor(lv, rng, occupied, avoid) {
    for (var t = 0; t < 400; t++) {
      var r = lv.rooms[Math.floor(rng() * lv.rooms.length)];
      var x = r.x + Math.floor(rng() * r.w);
      var y = r.y + Math.floor(rng() * r.h);
      if (lv.at(x, y) !== FLOOR) continue;
      if (occupied && occupied(x, y)) continue;
      if (avoid && Math.abs(avoid.x - x) + Math.abs(avoid.y - y) < 6) continue;
      return { x: x, y: y };
    }
    return null;
  }

  /* ── 시야: 재귀 그림자 던지기 ────────────────────────── */

  var OCTANTS = [
    [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
    [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]
  ];

  function castLight(lv, cx, cy, radius, row, startSlope, endSlope, oct) {
    if (startSlope < endSlope) return;
    var xx = oct[0], xy = oct[1], yx = oct[2], yy = oct[3];
    var nextStart = startSlope;
    var r2 = radius * radius;

    for (var i = row; i <= radius; i++) {
      var blockedRow = false;
      var dx = -i - 1, dy = -i;
      while (dx <= 0) {
        dx += 1;
        var mx = cx + dx * xx + dy * xy;
        var my = cy + dx * yx + dy * yy;
        var lSlope = (dx - 0.5) / (dy + 0.5);
        var rSlope = (dx + 0.5) / (dy - 0.5);

        if (rSlope > startSlope) continue;
        if (lSlope < endSlope) break;

        if (dx * dx + dy * dy <= r2 && lv.inside(mx, my)) {
          var id = lv.idx(mx, my);
          lv.visible[id] = 1;
          lv.seen[id] = 1;
        }

        var solid = !lv.inside(mx, my) || lv.opaque(mx, my);
        if (blockedRow) {
          if (solid) { nextStart = rSlope; continue; }
          blockedRow = false;
          startSlope = nextStart;
        } else if (solid && i < radius) {
          blockedRow = true;
          castLight(lv, cx, cy, radius, i + 1, startSlope, lSlope, oct);
          nextStart = rSlope;
        }
      }
      if (blockedRow) break;
    }
  }

  function computeFov(lv, cx, cy, radius) {
    lv.visible.fill(0);
    var id = lv.idx(cx, cy);
    lv.visible[id] = 1;
    lv.seen[id] = 1;
    for (var o = 0; o < OCTANTS.length; o++) {
      castLight(lv, cx, cy, radius, 1, 1.0, 0.0, OCTANTS[o]);
    }
    /* 방 안에서 벽을 보면 그 벽은 보여야 한다 — 위 알고리즘은 모서리 한 칸을
     * 가끔 빠뜨려 방 테두리에 구멍이 생긴다. 보이는 바닥에 닿은 벽을 채워 준다. */
    for (var y = 0; y < lv.h; y++) {
      for (var x = 0; x < lv.w; x++) {
        if (!lv.opaque(x, y)) continue;
        if (lv.visible[lv.idx(x, y)]) continue;
        var near = false;
        for (var j = -1; j <= 1 && !near; j++) {
          for (var k = -1; k <= 1; k++) {
            var nx = x + k, ny = y + j;
            if (!lv.inside(nx, ny)) continue;
            if (lv.opaque(nx, ny)) continue;
            if (!lv.visible[lv.idx(nx, ny)]) continue;
            /* 대각선 너머는 제외 — 안 그러면 벽 뒤 모서리가 새어 보인다 */
            var dd = Math.abs(nx - cx) + Math.abs(ny - cy);
            if (dd > radius + 1) continue;
            near = true; break;
          }
        }
        if (near) { lv.visible[lv.idx(x, y)] = 1; lv.seen[lv.idx(x, y)] = 1; }
      }
    }
  }

  function revealAll(lv) {
    lv.seen.fill(1);
  }

  global.DUNGEON = {
    WALL: WALL, FLOOR: FLOOR, DOOR: DOOR, STAIRS: STAIRS, DEEP: DEEP,
    makeRng: makeRng,
    generate: generate,
    randomFloor: randomFloor,
    computeFov: computeFov,
    revealAll: revealAll
  };
})(window);
