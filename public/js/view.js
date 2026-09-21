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

  /* "#e0742a" + 투명도 → rgba(). 등급 빛에 쓴다. */
  function hexA(hex, a) {
    if (!hex) return "rgba(255,255,255," + a + ")";
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return "rgba(" + ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255) + "," + a + ")";
  }

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

    /* 구역 팔레트 — **깊이에서 바로 구한다.** 바깥에서 넣어 주게 두면
     * 층을 옮길 때 한 곳을 빠뜨려 옛 색으로 남는다(마을은 구역이 없다). */
    var zone = world.inTown ? null
      : (global.DATA ? global.DATA.zoneAt(world.depth) : this.zone);
    var x, y, id, t, sx, sy;

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

    /* 2-a) 마을 물건(포탈·샘). 개체보다 **먼저** 그린다 — 앞을 지나가면
     *      사람이 앞에 서야 한다(뒤에 그리면 물건이 사람을 덮는다).
     * ⚠ 일렁이는 프레임은 **시간**으로 고른다(걸은 거리가 아니다 — 물건은 안 걷는다). */
    for (var pi = 0; pi < world.props.length; pi++) {
      var pr = world.props[pi];
      var pf = S.hasFrames(pr.def.sprite)
        ? Math.floor(world.time * 4) % S.framesOf(pr.def.sprite).length : 0;
      placeAt(ctx, S.bake(pr.def.sprite, pf), pr.def.sprite,
              (pr.x - 0.5) * TILE + ox, (pr.y - 0.5) * TILE + oy);
    }

    /* 2-a2) 장판. **개체보다 아래**에 깐다 — 바닥에 붙은 것이다. */
    for (var fi = 0; fi < world.fields.length; fi++) {
      var fd = world.fields[fi];
      var fleft = fd.until - world.time;
      var fcx = fd.x * TILE + ox, fcy = fd.y * TILE + oy;
      var fr = fd.r * TILE;
      var fg = ctx.createRadialGradient(fcx, fcy, fr * 0.2, fcx, fcy, fr);
      /* ⚠ 끝나기 전에 **옅어진다.** 안 그러면 사라지는 순간을 못 읽어
       *   "아직 타는 줄 알고" 서 있게 된다. */
      var fa = Math.min(1, fleft / 1.2);
      fg.addColorStop(0, "rgba(255,150,60," + (0.34 * fa).toFixed(3) + ")");
      fg.addColorStop(1, "rgba(200,60,20,0)");
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(fcx, fcy, fr, 0, Math.PI * 2); ctx.fill();
    }

    /* 2-a3) 날아가는 것. **바닥보다 위 · 개체보다 아래**에 둔다 —
     *       개체 위에 그리면 화살이 사람 얼굴을 가린다. */
    for (var si = 0; si < world.shots.length; si++) {
      var sh = world.shots[si];
      var stx = Math.floor(sh.x), sty = Math.floor(sh.y);
      if (stx < 0 || sty < 0 || stx >= lv.w || sty >= lv.h) continue;
      if (!lv.visible[sty * lv.w + stx]) continue;
      var sxp = sh.x * TILE + ox, syp = sh.y * TILE + oy;
      /* 꼬리를 남긴다 — 점 하나만 그리면 **어디서 오는지** 못 읽는다 */
      var tl = Math.hypot(sh.vx, sh.vy) || 1;
      ctx.strokeStyle = "rgba(255,210,140,.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sxp - sh.vx / tl * 9, syp - sh.vy / tl * 9);
      ctx.lineTo(sxp, syp);
      ctx.stroke();
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath(); ctx.arc(sxp, syp, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    /* 2-b) 바닥의 전리품. **개체보다 먼저** — 사람이 그 위에 서야 한다.
     * ⚠ 등급 빛을 **아래에 깐다**(위에 얹으면 그림을 덮어 뭔지 안 보인다).
     * ⚠ 위아래로 살짝 떠 있게 한다. 바닥 무늬에 섞이면 못 보고 지나친다 —
     *   전리품이 안 보이는 것은 "안 떨어진 것" 과 구별이 안 된다. */
    for (var di = 0; di < world.drops.length; di++) {
      var dp = world.drops[di];
      var dtx = Math.floor(dp.x), dty = Math.floor(dp.y);
      if (dtx < 0 || dty < 0 || dtx >= lv.w || dty >= lv.h) continue;
      if (!lv.visible[dty * lv.w + dtx]) continue;
      var bob = Math.sin((world.time + dp.id * 0.7) * 3) * 2;
      var dx0 = dp.x * TILE + ox, dy0 = dp.y * TILE + oy + bob;
      if (dp.item) {
        var tc = global.ITEMS ? global.ITEMS.tierOf(dp.item.tier).color : "#fff";
        var gr = ctx.createRadialGradient(dx0, dy0, 1, dx0, dy0, 15);
        gr.addColorStop(0, hexA(tc, 0.55));
        gr.addColorStop(1, hexA(tc, 0));
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(dx0, dy0, 15, 0, Math.PI * 2); ctx.fill();
        placeAt(ctx, S.bake(dp.item.sprite), dp.item.sprite,
                dx0 - TILE / 2, dy0 - TILE / 2);
      } else {
        placeAt(ctx, S.bake("gold"), "gold", dx0 - TILE / 2, dy0 - TILE / 2);
      }
    }

    /* 3) 휘두르는 부채꼴 — **개체보다 먼저, 한 벌로** 깐다.
     *
     * ⚠ 개체마다 자기 부채꼴을 그리게 두었더니, 주인공보다 **아래에 선 몬스터**의
     *   빨간 예고가 y 정렬 때문에 주인공 위에 덮였다(실측: 몸이 통째로 빨개져
     *   맞은 줄 알았다). 예고는 바닥에 그린 표시지 서 있는 물건이 아니다. */
    /* 시전 예고 — **차오르는 고리.** 이걸 안 보여 주면 상대도 나도
     * 무엇이 오는지 모르고, 그럼 시전 시간이 아무 뜻이 없어진다. */
    /* 몬스터 시전 예고 — **이게 없으면 원거리 공격을 피할 수가 없다.**
     * ⚠ 사람 것과 색을 갈라 둔다(붉은색 = 나에게 오는 것). */
    for (var ci = 0; ci < world.ents.length; ci++) {
      var ce = world.ents[ci];
      if (!ce.cast || ce.dead || ce.team === 0) continue;
      var ctx0 = Math.floor(ce.x), cty0 = Math.floor(ce.y);
      if (!lv.visible[cty0 * lv.w + ctx0]) continue;
      var ck = Math.min(1, ce.cast.t / Math.max(0.01, ce.cast.sk.cast));
      var mx0 = lerp(ce.px, ce.x, alpha) * TILE + ox;
      var my0 = (lerp(ce.py, ce.y, alpha) - 0.5) * TILE + oy;
      ctx.strokeStyle = "rgba(255,110,90,.75)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(mx0, my0, 13, -Math.PI / 2, -Math.PI / 2 + ck * Math.PI * 2);
      ctx.stroke();
      /* 겨눈 자리도 보여 준다 — 술사의 장판이 어디 깔릴지 */
      if (ce.cast.what === "field") {
        var fr2 = (ce.mob && ce.mob.field ? ce.mob.field.r : 2) * TILE;
        ctx.strokeStyle = "rgba(255,140,60," + (0.25 + 0.4 * ck).toFixed(2) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ce.cast.x * TILE + ox, ce.cast.y * TILE + oy, fr2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    var pc = world.player.cast;
    if (pc && pc.sk.cast > 0) {
      var k2 = Math.min(1, pc.t / pc.sk.cast);
      var ccx = lerp(world.player.px, world.player.x, alpha) * TILE + ox;
      var ccy = (lerp(world.player.py, world.player.y, alpha) - 0.3) * TILE + oy;
      var rr = (pc.sk.reach || 1.5) * TILE;
      ctx.strokeStyle = "rgba(255,225,150,.55)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ccx, ccy, rr, -Math.PI / 2, -Math.PI / 2 + k2 * Math.PI * 2);
      ctx.stroke();
    }

    for (var ai = 0; ai < world.ents.length; ai++) {
      var ae = world.ents[ai];
      if (!ae.atk || ae.dead) continue;
      var aex = lerp(ae.px, ae.x, alpha), aey = lerp(ae.py, ae.y, alpha);
      var atx = Math.floor(aex), aty = Math.floor(aey);
      if (ae.kind !== "player" && !lv.visible[aty * lv.w + atx]) continue;
      this.swingArc(ctx, ae, aex, aey, ox, oy);
    }

    /* 4) 개체 — 발이 아래에 있는 것을 나중에 그린다(앞뒤가 맞아야 한다) */
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
      var fr = this.frameOf(e);
      placeAt(ctx, S.bake(e.sprite, fr), e.sprite, sx, sy);
      /* 맞은 티 — **덧칠**이다. 색을 통째로 바꾸면(실측) 몸이 빨간 실루엣이 되어
       * 누가 누구인지 안 보인다. 원래 그림 위에 옅게 얹고 금방 뺀다. */
      if (e.hurt > 0) {
        ctx.globalAlpha = Math.min(1, e.hurt / 0.18) * 0.55;
        placeAt(ctx, S.bake(e.sprite, fr, "#ff6a52"), e.sprite, sx, sy);
        ctx.globalAlpha = 1;
      }

      /* 머리 위 체력 — **다친 적에게만.** 전부에게 띄우면 화면이 막대밭이 된다. */
      /* ⚠ 보스는 **멀쩡할 때도** 체력을 보여 준다. 안 보여 주면 얼마나 남았는지
       *   몰라 언제 물러설지 못 정한다. */
      if (e.kind !== "player" && !e.dead && (e.boss || e.hp < e.maxHp))
        this.hpBar(ctx, ex, ey, ox, oy, e.hp / e.maxHp, e.boss);
    }

    /* 떠오르는 숫자 — 개체보다 **위에** 그린다(가려지면 없는 것과 같다) */
    for (i = 0; i < world.floaters.length; i++) {
      var f = world.floaters[i];
      var k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;                 /* 끝에 가서 훅 사라진다 */
      ctx.textAlign = "center";
      /* ⚠ 치명타는 **한눈에 달라 보여야** 한다 — 같은 색·같은 크기면
       *   치명타가 터졌는지 아무도 모르고, 그럼 치명타 옵션이 무의미해진다. */
      ctx.font = (f.crit ? "bold 15px " : "bold 11px ") + (global.NUM_FONT || "monospace");
      ctx.fillStyle = f.crit ? "#ffd34d" : (f.foe ? "#ffe9a8" : "#ff8d7a");
      ctx.strokeStyle = "rgba(0,0,0,.85)";
      ctx.lineWidth = 3;
      var fx2 = f.x * TILE + ox, fy2 = (f.y - k * 0.7) * TILE + oy;
      ctx.strokeText(f.text, fx2, fy2);
      ctx.fillText(f.text, fx2, fy2);
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /* 부채꼴. 선딜 동안은 **엷게 예고**하고, 판정 순간 한 번 밝아진다. */
  View.prototype.swingArc = function (ctx, e, ex, ey, ox, oy) {
    var a = e.atk, m = a.m;
    var k = a.t / m.windup;
    var live = a.t >= m.windup;
    var cx = ex * TILE + ox, cy = (ey - 0.35) * TILE + oy;
    var half = m.arc * Math.PI / 360;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, m.reach * TILE, a.ang - half, a.ang + half);
    ctx.closePath();
    if (live) {
      ctx.fillStyle = e.team === 0 ? "rgba(255,240,200,.30)" : "rgba(255,110,90,.30)";
    } else {
      /* 차오르는 예고 — 다 차면 나간다는 뜻이다 */
      ctx.fillStyle = e.team === 0 ? "rgba(255,240,200,.09)" : "rgba(255,90,70,"
        + (0.06 + 0.16 * Math.min(1, k)).toFixed(3) + ")";
    }
    ctx.fill();
    ctx.restore();
  };

  View.prototype.hpBar = function (ctx, ex, ey, ox, oy, frac, big) {
    var w = big ? 40 : 22, h = big ? 5 : 3;
    var x = Math.round(ex * TILE + ox - w / 2);
    var y = Math.round((ey - 1.35) * TILE + oy);
    ctx.fillStyle = "rgba(0,0,0,.72)";
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#3a2b2b";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = frac > 0.5 ? "#7bbd5a" : (frac > 0.22 ? "#d9a441" : "#c4463a");
    ctx.fillRect(x, y, Math.max(1, Math.round(w * frac)), h);
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
