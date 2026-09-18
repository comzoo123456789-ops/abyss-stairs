/* 던전 생성 + 시야(FOV).
 *
 * 생성: 겹치지 않는 방을 뿌리고 L 자 복도로 잇는다. 고전 로그 방식이다.
 * 시야: 재귀 그림자 던지기(recursive shadowcasting) 8분면.
 *       벽 뒤가 정확히 가려지고 대칭이라 "분명 보이는데 안 보인다" 가 안 생긴다.
 */
(function (global) {
  "use strict";

  var WALL = 0, FLOOR = 1, DOOR = 2, STAIRS = 3;

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
    this.rooms = [];
    this.upAt = null;
    this.downAt = null;
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
  function placeDoors(lv, rng) {
    for (var i = 0; i < lv.rooms.length; i++) {
      var r = lv.rooms[i];
      var edges = [];
      var x, y;
      for (x = r.x; x < r.x + r.w; x++) {
        if (lv.at(x, r.y - 1) === FLOOR) edges.push([x, r.y - 1]);
        if (lv.at(x, r.y + r.h) === FLOOR) edges.push([x, r.y + r.h]);
      }
      for (y = r.y; y < r.y + r.h; y++) {
        if (lv.at(r.x - 1, y) === FLOOR) edges.push([r.x - 1, y]);
        if (lv.at(r.x + r.w, y) === FLOOR) edges.push([r.x + r.w, y]);
      }
      for (var e = 0; e < edges.length; e++) {
        if (rng() < 0.45) {
          var p = edges[e];
          if (lv.at(p[0], p[1]) === FLOOR) lv.tiles[lv.idx(p[0], p[1])] = DOOR;
        }
      }
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

    /* 보물방 — 시작 방이 아닌 가장 작은 방 하나를 골라 둘레를 전부 문으로 만든다.
     * ⚠ 벽으로 막으면 안 된다. 들어갈 길이 없으면 아이템이 영영 안 닿는다
     *   (생성기가 만든 방이라 복도가 한 방향에서만 온다). */
    lv.treasure = null;
    if (depth >= 2 && rng() < 0.4 && lv.rooms.length >= 4) {
      var cands = lv.rooms.slice(1).sort(function (a, b) { return a.w * a.h - b.w * b.h; });
      var tr = cands[0];
      for (var ty = tr.y - 1; ty <= tr.y + tr.h; ty++) {
        for (var tx = tr.x - 1; tx <= tr.x + tr.w; tx++) {
          var edge = (ty === tr.y - 1 || ty === tr.y + tr.h || tx === tr.x - 1 || tx === tr.x + tr.w);
          if (!edge || !lv.inside(tx, ty)) continue;
          if (lv.at(tx, ty) === FLOOR || lv.at(tx, ty) === DOOR) lv.tiles[lv.idx(tx, ty)] = DOOR;
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
    WALL: WALL, FLOOR: FLOOR, DOOR: DOOR, STAIRS: STAIRS,
    makeRng: makeRng,
    generate: generate,
    randomFloor: randomFloor,
    computeFov: computeFov,
    revealAll: revealAll
  };
})(window);
