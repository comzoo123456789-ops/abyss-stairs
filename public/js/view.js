/* 그리기 — 실시간판.
 *
 * 턴제 렌더러와 가장 크게 다른 점: **카메라가 칸이 아니라 픽셀을 따라간다.**
 * 그리고 규칙은 1/60 초마다만 움직이는데 화면은 그보다 자주 그려지므로,
 * 지난 자리와 지금 자리 사이를 alpha 로 메운다(보간).
 *
 * ⚠ 카메라를 **기기 픽셀 격자에 맞춰** 반올림한다. 안 맞추면 도트가 프레임마다
 *   반 픽셀씩 어긋나 가장자리가 지글거린다(pixel shimmer). 확대와 dpr 을
 *   곱한 값이 실제 격자다 — 월드 픽셀로 반올림하면 확대 2배에서 2px 씩 튄다.
 * ⚠ 보이는 칸만 그린다. 56×40 을 전부 그리면 2,240번 drawImage 다.
 */
(function (global) {
  "use strict";

  var S = global.SPRITES;
  var D = global.DUNGEON;
  var TILE = 32;
  var STRIDE = 0.55;          /* 이만큼 걸을 때마다 걸음 그림이 바뀐다(칸) */

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* 바닥·벽 변종을 **자리로만** 정한다(난수 아님) — 새로고침마다 무늬가
   * 바뀌면 안 된다. 하위 비트가 규칙적으로 도는 것을 막으려고 한 번 섞는다. */
  function variantAt(x, y, n) {
    var h = (x | 0) * 374761393 + (y | 0) * 668265263;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h % n;
  }

  /* 키가 큰 그림(주인공은 32×48)은 **발밑을 칸에 맞춘다.** 왼쪽 위를 맞추면
   * 머리가 칸에 붙고 발이 아래 칸으로 삐져나온다. */
  function placeAt(ctx, img, name, sx, sy) {
    if (!img) return;
    var z = S.sizeOf ? S.sizeOf(name) : { w: TILE, h: TILE };
    ctx.drawImage(img, Math.round(sx - (z.w - TILE) / 2), Math.round(sy - (z.h - TILE)));
  }

  function View(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.zoom = 2;
    this.dpr = 1;
    this.viewW = 0; this.viewH = 0;
    this.zone = null;
    this._ao = null;
    this.resize();
  }

  View.prototype.resize = function () {
    var box = this.canvas.parentNode.getBoundingClientRect();
    var w = Math.max(160, Math.floor(box.width));
    var h = Math.max(120, Math.floor(box.height));
    var dpr = Math.min(2, global.devicePixelRatio || 1);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.dpr = dpr;
    this.cssW = w; this.cssH = h;
    this.viewW = w / this.zoom;     /* 화면에 들어오는 월드 픽셀 */
    this.viewH = h / this.zoom;
    this.ctx.imageSmoothingEnabled = false;   /* 도트는 흐리면 안 된다 */
  };

  /* 벽 밑 그늘 — 벽과 바닥의 경계를 끊어 준다.
   * ⚠ 칸마다 그라디언트를 새로 만들면 한 프레임에 백 번 넘게 만든다. 한 번 굽는다. */
  View.prototype.ao = function () {
    if (this._ao) return this._ao;
    var c = document.createElement("canvas");
    c.width = TILE; c.height = 10;
    var g = c.getContext("2d");
    var grad = g.createLinearGradient(0, 0, 0, 10);
    grad.addColorStop(0, "rgba(0,0,0,0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, TILE, 10);
    this._ao = c;
    return c;
  };

  View.prototype.draw = function (world, alpha) {
    var ctx = this.ctx, lv = world.level;
    var p = world.player;
    var q = this.zoom * this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0a0e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.imageSmoothingEnabled = false;

    /* 카메라 — 주인공의 보간된 자리를 화면 한가운데 둔다 */
    var camX = lerp(p.px, p.x, alpha) * TILE;
    var camY = lerp(p.py, p.y, alpha) * TILE;
    var ox = Math.round((this.viewW / 2 - camX) * q) / q;
    var oy = Math.round((this.viewH / 2 - camY) * q) / q;
    this.ox = ox; this.oy = oy;

    /* 보이는 범위만 — 한 칸씩 넉넉히 잡는다(가장자리 잘림 방지).
     * ⚠ 키 큰 그림이 위 칸에서 넘어오므로 위쪽은 두 칸 더 본다. */
    var x0 = Math.max(0, Math.floor(-ox / TILE) - 1);
    var y0 = Math.max(0, Math.floor(-oy / TILE) - 2);
    var x1 = Math.min(lv.w - 1, Math.ceil((this.viewW - ox) / TILE) + 1);
    var y1 = Math.min(lv.h - 1, Math.ceil((this.viewH - oy) / TILE) + 1);

    var zone = this.zone, x, y, id, t, sx, sy;

    /* 1) 지형 */
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = y * lv.w + x;
        if (!lv.seen[id]) continue;
        t = lv.tiles[id];
        sx = x * TILE + ox; sy = y * TILE + oy;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.30;    /* 기억은 어둡게 */
        if (t === D.WALL) {
          /* 2.5D — 아래가 지나갈 수 있는 칸인 벽만 사람을 마주보는 앞면을 세운다.
           * 위아래가 다 뚫린 한 칸 두께 벽은 앞면을 칸 전체에 세운다. */
          var below = lv.at(x, y + 1), above = lv.at(x, y - 1);
          var openBelow = below !== D.WALL, openAbove = above !== D.WALL;
          var kind = !openBelow ? "wall" : (openAbove ? "wallthin" : "wallface");
          ctx.drawImage(S.terrain(kind, variantAt(x, y, S.WALL_VARIANTS), zone), sx, sy);
        } else {
          ctx.drawImage(S.terrain("floor", variantAt(x, y, S.FLOOR_VARIANTS), zone), sx, sy);
          if (t === D.DOOR) ctx.drawImage(S.bake("door"), sx, sy);
          else if (t === D.STAIRS) ctx.drawImage(S.bake("stairs"), sx, sy);
          else if (t === D.DEEP) ctx.drawImage(S.bake("deep"), sx, sy);
        }
      }
    }

    /* 2) 벽 밑 그늘 — 위 칸이 벽인 **바닥** 칸에 깐다(벽 칸에 깔면 두 겹이 된다) */
    var ao = this.ao();
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = y * lv.w + x;
        if (!lv.seen[id] || lv.tiles[id] === D.WALL) continue;
        if (lv.at(x, y - 1) !== D.WALL) continue;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.30;
        ctx.drawImage(ao, x * TILE + ox, y * TILE + oy);
      }
    }
    ctx.globalAlpha = 1;

    /* 3) 개체 — 발이 아래에 있는 것을 나중에 그린다(앞뒤가 맞아야 한다) */
    var list = world.ents.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var ex = lerp(e.px, e.x, alpha), ey = lerp(e.py, e.y, alpha);
      var tx = Math.floor(ex), ty = Math.floor(ey);
      if (e.kind !== "player" && !lv.visible[ty * lv.w + tx]) continue;
      /* 발밑을 칸 바닥에 맞춘다 — 몸의 중심이 아니라 서 있는 자리다 */
      sx = (ex - 0.5) * TILE + ox;
      sy = (ey - 0.5) * TILE + oy;
      /* ⚠ 그림이 정면을 보는 도트라 좌우 반전은 쓰지 않는다(뒤집어도 같아 보이고,
       *   무기 든 손만 반대로 간다). face 는 공격 방향에만 쓴다. */
      placeAt(ctx, S.bake(e.sprite, this.frameOf(e)), e.sprite, sx, sy);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /* 걸음 그림 — **시간이 아니라 걸은 거리**로 고른다. 시간으로 고르면
   * 벽에 막혀 제자리인데도 다리가 계속 움직인다(허공답보). */
  View.prototype.frameOf = function (e) {
    if (!S.hasFrames(e.sprite)) return 0;
    var moving = (e.mx || e.my) && (Math.abs(e.x - e.px) + Math.abs(e.y - e.py)) > 1e-5;
    if (!moving) return 0;
    return 1 + (Math.floor(e.walked / STRIDE) % 2);
  };

  /* 화면 좌표 → 월드 칸 좌표. 마우스 조준이 이것을 쓴다. */
  View.prototype.toWorld = function (clientX, clientY) {
    var box = this.canvas.getBoundingClientRect();
    var wx = (clientX - box.left) / this.zoom - this.ox;
    var wy = (clientY - box.top) / this.zoom - this.oy;
    return { x: wx / TILE, y: wy / TILE };
  };

  global.VIEW = { View: View, TILE: TILE, variantAt: variantAt, placeAt: placeAt };
})(window);
