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
    this.dpr = 1;
    this.viewW = 0; this.viewH = 0;
    this.zone = null;
    this._ao = null;
    this.baseZoom = 1.0;
    this.zoom = 1.0;
    this.resize();
  }

  View.prototype.calcBaseZoom = function () {
    var w = this.cssW || (this.canvas && this.canvas.parentNode ? this.canvas.parentNode.getBoundingClientRect().width : 1280);
    /* 던전 및 마을 시야 확장 — 너무 크게 확대되면 좁아서 답답하므로 축소 (모바일 1.15배, 태블릿 1.1배, PC 1.0배) */
    if (w < 600) return 1.15;
    if (w < 1100) return 1.1;
    return 1.0;
  };

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
    this.baseZoom = this.calcBaseZoom();
    this.zoom = this.baseZoom;
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
    /* 마을과 던전의 캐릭터 및 맵 크기를 완전히 일치시킨다.
     * 카메라가 플레이어를 중심에 두고 스크롤하므로 동일한 배율을 유지한다. */
    var want = this.baseZoom;
    if (Math.abs(want - this.zoom) > 0.001) {
      this.zoom = want;
      this.viewW = this.cssW / this.zoom;
      this.viewH = this.cssH / this.zoom;
    }
    var q = this.zoom * this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0a0e";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(q, 0, 0, q, 0, 0);
    ctx.imageSmoothingEnabled = false;

    /* 카메라 — 주인공의 보간된 자리를 화면 한가운데 둔다 */
    var camX = lerp(p.px, p.x, alpha) * TILE;
    var camY = lerp(p.py, p.y, alpha) * TILE;
    var ox = this.viewW / 2 - camX;
    var oy = this.viewH / 2 - camY;
    /* **지도 밖을 비추지 않는다.**
     * ⚠ 이게 없으면 가장자리에서 검은 띠가 보이고, 마을처럼 지도가 화면보다
     *   작을 때는 위가 잘려 **게이트 윗부분이 안 보였다**(실측).
     * ⚠ 지도가 화면보다 **작으면 가운데 놓는다** — 그때 clamp 를 그대로 쓰면
     *   한쪽 구석에 붙어 버린다(부등호가 뒤집힌다). */
    var mapW = lv.w * TILE, mapH = lv.h * TILE;
    if (mapW <= this.viewW) ox = (this.viewW - mapW) / 2;
    else ox = Math.min(0, Math.max(this.viewW - mapW, ox));
    if (mapH <= this.viewH) oy = (this.viewH - mapH) / 2;
    else oy = Math.min(0, Math.max(this.viewH - mapH, oy));
    /* 기기 픽셀 격자에 맞춘다 — 안 맞추면 도트 가장자리가 지글거린다 */
    ox = Math.round(ox * q) / q;
    oy = Math.round(oy * q) / q;
    if (world.shake > 0) {
      var sm = world.shakeMag || 3;
      ox += (Math.random() - 0.5) * sm;
      oy += (Math.random() - 0.5) * sm;
    }
    this.ox = ox; this.oy = oy;

    /* 보이는 범위만 — 한 칸씩 넉넉히 잡는다(가장자리 잘림 방지).
     * ⚠ 키 큰 그림이 위 칸에서 넘어오므로 위쪽은 두 칸 더 본다. */
    var x0 = Math.max(0, Math.floor(-ox / TILE) - 1);
    var y0 = Math.max(0, Math.floor(-oy / TILE) - 2);
    var x1 = Math.min(lv.w - 1, Math.ceil((this.viewW - ox) / TILE) + 1);
    var y1 = Math.min(lv.h - 1, Math.ceil((this.viewH - oy) / TILE) + 1);

    /* 팔레트 — **깊이에서 바로 구한다.** 바깥에서 넣어 주게 두면 층을 옮길 때
     * 한 곳을 빠뜨려 옛 색으로 남는다.
     * ⚠ 마을은 **자기 색**이 있다(world.zone). 전에는 null 을 줘서 던전 기본
     *   팔레트로 그려졌고, 그래서 아무리 꾸며도 던전 복도로 보였다. */
    var zone = world.inTown ? world.zone
      : (global.DATA ? global.DATA.zoneAt(world.depth) : this.zone);
    var fzone = world.fzone, zones = world.zones;
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
          /* 바닥은 **칸마다 다른 팔레트**로 같은 그림을 굽는다 — 흙길 · 석판길 ·
           * 목조(건물 안). 밝기가 갈라져야 어디로 가야 하는지, 어디가 안인지를
           * 바닥이 말해 준다.
           * ⚠ 번호가 목록 밖이면 기본 팔레트로 떨어뜨린다 — 지도를 고치다
           *   범위를 넘기면 여기서 조용히 undefined 가 되어 통째로 안 그려진다. */
          var fz = zone;
          if (fzone && zones) fz = zones[fzone[id]] || zone;
          ctx.drawImage(S.terrain("floor", variantAt(x, y, S.FLOOR_VARIANTS), fz), sx, sy);
          if (t === D.DOOR) ctx.drawImage(S.bake("door"), sx, sy);
          else if (t === D.DOOR_OPEN) ctx.drawImage(S.bake("door_open"), sx, sy);
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

    /* 2-a0) 바닥 타격 잔해(Debris) — 쓰러진 몬스터의 핏자국/흔적 */
    if (world.debris) {
      for (var bi = 0; bi < world.debris.length; bi++) {
        var deb = world.debris[bi];
        var dtx0 = Math.floor(deb.x), dty0 = Math.floor(deb.y);
        if (dtx0 < 0 || dty0 < 0 || dtx0 >= lv.w || dty0 >= lv.h) continue;
        if (!lv.visible[dty0 * lv.w + dtx0]) continue;
        var dbk = Math.max(0, 1 - deb.t / deb.life);
        var dbAlpha = (dbk * 0.45).toFixed(3);
        var dbx = deb.x * TILE + ox, dby = deb.y * TILE + oy;
        ctx.fillStyle = hexA(deb.color, parseFloat(dbAlpha));
        for (var dti = 0; dti < deb.dots.length; dti++) {
          var dot = deb.dots[dti];
          ctx.beginPath();
          ctx.arc(dbx + dot.dx * TILE, dby + dot.dy * TILE, dot.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* 2-a) 마을 물건(포탈·샘). 개체보다 **먼저** 그린다 — 앞을 지나가면
     *      사람이 앞에 서야 한다(뒤에 그리면 물건이 사람을 덮는다).
     * ⚠ 일렁이는 프레임은 **시간**으로 고른다(걸은 거리가 아니다 — 물건은 안 걷는다). */
    for (var pi = 0; pi < world.props.length; pi++) {
      var pr = world.props[pi];
      /* ⚠ 위상을 물건마다 어긋낸다 — 게이트와 보관함 룬이 똑같이 깜빡이면
       *   둘이 한 물건처럼 보인다. */
      var pf = S.hasFrames(pr.def.sprite)
        ? Math.floor(world.time * 4 + pi * 1.7) % S.framesOf(pr.def.sprite).length : 0;
      placeAt(ctx, S.bake(pr.def.sprite, pf), pr.def.sprite,
              (pr.x - 0.5) * TILE + ox, (pr.y - 0.5) * TILE + oy);
    }

    /* 2-a1) 마을 장식 — 등불·모닥불·나무·간판.
     * ⚠ 불빛을 **먼저** 깔고 그림을 나중에 얹는다. 순서를 바꾸면 빛이 그림을
     *   덮어 뿌옇게 된다.
     * ⚠ 흔들리는 것은 **시간**으로 프레임을 고른다(걸은 거리가 아니다 — 물건은
     *   안 걷는다). 개체마다 위상을 어긋내지 않으면 다 같이 깜빡여 기계 같다. */
    for (var ki = 0; ki < world.decor.length; ki++) {
      var dk = world.decor[ki];
      if (!dk.def.light) continue;
      var lx = dk.x * TILE + ox, ly = (dk.y - 0.35) * TILE + oy;
      var lr = dk.def.light * TILE;
      /* 숨 쉬듯 크기가 조금 변한다 — 고정이면 조명이 아니라 얼룩이다 */
      var puls = 1 + Math.sin(world.time * 2.2 + dk.phase * 6.3) * 0.06;
      var lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, lr * puls);
      lg.addColorStop(0, "rgba(255,190,110,.30)");
      lg.addColorStop(0.45, "rgba(255,160,80,.12)");
      lg.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lx, ly, lr * puls, 0, Math.PI * 2); ctx.fill();
    }
    for (var kj = 0; kj < world.decor.length; kj++) {
      var dd = world.decor[kj];
      var dtx = Math.floor(dd.x), dty = Math.floor(dd.y);
      if (dtx < x0 - 2 || dtx > x1 + 2 || dty < y0 - 2 || dty > y1 + 2) continue;
      var dfr = 0;
      if (dd.def.sway && S.hasFrames(dd.def.sprite)) {
        var nf = S.framesOf(dd.def.sprite).length;
        dfr = Math.floor(world.time * 6 + dd.phase * nf) % nf;
      }
      placeAt(ctx, S.bake(dd.def.sprite, dfr), dd.def.sprite,
              (dd.x - 0.5) * TILE + ox, (dd.y - 0.5) * TILE + oy);
    }

    /* 2-a2) 장판. **개체보다 아래**에 깐다 — 바닥에 붙은 것이다. */
    for (var fi = 0; fi < world.fields.length; fi++) {
      var fd = world.fields[fi];
      var fleft = fd.until - world.time;
      var fcx = fd.x * TILE + ox, fcy = fd.y * TILE + oy;
      var fr = fd.r * TILE;
      var fa = Math.min(1, fleft / 1.2);
      ctx.save();
      if (fd.type === "smoke") {
        var fg = ctx.createRadialGradient(fcx, fcy, fr * 0.1, fcx, fcy, fr);
        fg.addColorStop(0, "rgba(90,70,120," + (0.55 * fa).toFixed(3) + ")");
        fg.addColorStop(0.6, "rgba(50,40,70," + (0.38 * fa).toFixed(3) + ")");
        fg.addColorStop(1, "rgba(30,20,40,0)");
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(fcx, fcy, fr, 0, Math.PI * 2); ctx.fill();
        /* 연막 입자 구름 효과 */
        for (var smi = 0; smi < 4; smi++) {
          var sma = world.time * 2.2 + smi * 1.57;
          var smr = (smi % 2 === 0 ? 0.35 : 0.65) * fr;
          ctx.fillStyle = "rgba(160,140,190," + (0.28 * fa).toFixed(3) + ")";
          ctx.beginPath();
          ctx.arc(fcx + Math.cos(sma) * smr, fcy + Math.sin(sma) * smr * 0.7, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        var fg = ctx.createRadialGradient(fcx, fcy, fr * 0.2, fcx, fcy, fr);
        fg.addColorStop(0, "rgba(255,150,60," + (0.34 * fa).toFixed(3) + ")");
        fg.addColorStop(1, "rgba(200,60,20,0)");
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(fcx, fcy, fr, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    /* 2-a3) 날아가는 것 (화살 & 단검 투척) */
    for (var si = 0; si < world.shots.length; si++) {
      var sh = world.shots[si];
      var stx = Math.floor(sh.x), sty = Math.floor(sh.y);
      if (stx < 0 || sty < 0 || stx >= lv.w || sty >= lv.h) continue;
      if (!lv.visible[sty * lv.w + stx]) continue;
      var sxp = sh.x * TILE + ox, syp = sh.y * TILE + oy;
      var tl = Math.hypot(sh.vx, sh.vy) || 1;
      if (sh.kind === "dagger") {
        ctx.strokeStyle = "rgba(215,200,255,.90)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(sxp - sh.vx / tl * 13, syp - sh.vy / tl * 13);
        ctx.lineTo(sxp, syp);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(sxp, syp, 3.2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(255,210,140,.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sxp - sh.vx / tl * 9, syp - sh.vy / tl * 9);
        ctx.lineTo(sxp, syp);
        ctx.stroke();
        ctx.fillStyle = "#ffe9a8";
        ctx.beginPath(); ctx.arc(sxp, syp, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* 2-a4) 벼락 연출 (Lightning FX) */
    if (world.lightningFX && world.lightningFX.length) {
      for (var lfi = world.lightningFX.length - 1; lfi >= 0; lfi--) {
        var lfx = world.lightningFX[lfi];
        lfx.t += 0.033;
        var lk = 1 - lfx.t / lfx.life;
        if (lk <= 0) { world.lightningFX.splice(lfi, 1); continue; }
        var lcx = lfx.x * TILE + ox, lcy = lfx.y * TILE + oy;
        var lfr = lfx.r * TILE;
        ctx.save();
        ctx.strokeStyle = "rgba(255,240,110," + (lk * 0.9).toFixed(3) + ")";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(lcx, lcy, lfr * (1 - lk * 0.3), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255," + (lk * 0.95).toFixed(3) + ")";
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(lcx + (Math.sin(world.time * 20) * 12), lcy - 180);
        ctx.lineTo(lcx - 8, lcy - 120);
        ctx.lineTo(lcx + 10, lcy - 60);
        ctx.lineTo(lcx, lcy);
        ctx.stroke();
        ctx.restore();
      }
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
      /* 소환 예고 — **발밑에 고리**가 차오른다.
       * ⚠ 이게 없으면 해골이 어디서 나오는지 모른다. 술사를 먼저 잡으라고
       *   가르치려면 "지금 부르고 있다" 가 보여야 한다. */
      if (ce.cast.what === "summon") {
        var sr = (2.0 + 0.8 * ck) * TILE;
        var scx = lerp(ce.px, ce.x, alpha) * TILE + ox;
        var scy = lerp(ce.py, ce.y, alpha) * TILE + oy;
        ctx.strokeStyle = "rgba(126,231,135," + (0.30 + 0.45 * ck).toFixed(2) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(scx, scy, sr, 0, Math.PI * 2); ctx.stroke();
        /* 고리 위의 점 — 부를 자리를 미리 보여 준다 */
        for (var sk = 0; sk < 3; sk++) {
          var sa = world.time * 1.6 + sk * 2.094;
          ctx.fillStyle = "rgba(126,231,135,.75)";
          ctx.fillRect(Math.round(scx + Math.cos(sa) * sr) - 1,
                       Math.round(scy + Math.sin(sa) * sr * 0.6) - 1, 3, 3);
        }
      }
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
      /* 흔들림을 얹는다 — 걸음·공격·피격 */
      var mo = this.motionOf(e);
      sx += mo.x; sy += mo.y;
      /* 갓 불려 나온 것은 **떠오르며 나타난다.** 툭 생기면 어디서 왔는지
       * 모르고, 사령술사가 부른 것인지 원래 있던 것인지 구별이 안 된다. */
      var bornK = 1;
      if (e.summoned && e.bornAt !== undefined) {
        bornK = Math.min(1, (world.time - e.bornAt) / 0.35);
        if (bornK < 1) {
          ctx.globalAlpha = bornK;
          sy += Math.round((1 - bornK) * 5);
        }
      }
      /* 발밑 지속 효과 오라 (Buff / Debuff Aura FX) */
      this.drawEntityAuras(ctx, e, ex, ey, ox, oy, world);

      placeAt(ctx, S.bake(e.sprite, fr), e.sprite, sx, sy);
      /* 캐릭터 몸체 전면 버프 오라 레이어 */
      this.drawEntityAurasOver(ctx, e, ex, ey, ox, oy, world);
      if (bornK < 1) ctx.globalAlpha = 1;
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

    /* 전투 피드백 파티클(스파크) & 영혼/금화 흡수 구슬 */
    this.drawCombatFX(world, ox, oy);

    /* 마을 전용 앰비언트 파티클(불티, 반딧불이) & NPC 말풍선 */
    this.drawAmbientFX(world, ox, oy);
    this.drawTownBubbles(world, ox, oy);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /* 전투 타격 스파크 및 영혼/금화 흡수 구슬 FX */
  View.prototype.drawCombatFX = function (world, ox, oy) {
    var ctx = this.ctx;
    var i;

    /* 1) 타격 스파크 파티클 */
    if (world.sparks && world.sparks.length) {
      for (i = 0; i < world.sparks.length; i++) {
        var sp = world.sparks[i];
        var sk = 1 - sp.t / sp.life;
        if (sk <= 0) continue;
        var sx = sp.x * TILE + ox, sy = sp.y * TILE + oy;
        ctx.fillStyle = sp.color;
        ctx.globalAlpha = Math.min(1, sk * 1.6);
        ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      }
    }

    /* 2) 영혼/경험치 및 금화 흡수 구슬 (Orbs) */
    if (world.orbs && world.orbs.length) {
      for (i = 0; i < world.orbs.length; i++) {
        var ob = world.orbs[i];
        var oxp = ob.x * TILE + ox, oyp = ob.y * TILE + oy;
        var isGold = ob.kind === "gold";
        var colCore = isGold ? "#fff4b8" : "#e0f7ff";
        var colGlow = isGold ? "rgba(255,190,40,0.45)" : "rgba(110,220,255,0.50)";

        /* 외곽 광채 */
        ctx.fillStyle = colGlow;
        ctx.beginPath();
        ctx.arc(oxp, oyp, 4.5, 0, Math.PI * 2);
        ctx.fill();

        /* 중심 코어 */
        ctx.fillStyle = colCore;
        ctx.fillRect(Math.round(oxp - 1.5), Math.round(oyp - 1.5), 3, 3);
      }
    }
    ctx.globalAlpha = 1;
  };

  /* 마을 환경 파티클 — 모닥불 불티(Ember) & 반딧불이(Firefly) */
  View.prototype.drawAmbientFX = function (world, ox, oy) {
    if (!world.inTown) return;
    var ctx = this.ctx, t = world.time;

    /* 1) 모닥불 불티 — f 위치(15.5, 14.5) 부근에서 위로 피어오름 */
    var fireX = 15.5 * TILE + ox, fireY = 14.5 * TILE + oy;
    for (var i = 0; i < 8; i++) {
      var seed = i * 1.37;
      var age = (t * 1.8 + seed) % 1.5;
      var k = age / 1.5;
      var px = fireX + Math.sin(t * 3 + seed * 5) * (4 + k * 8) + (i % 2 === 0 ? -2 : 2);
      var py = fireY - 4 - k * 36;
      var alpha = (1 - k) * 0.85;
      ctx.fillStyle = k < 0.4 ? "rgba(255,230,120," + alpha.toFixed(2) + ")" : "rgba(240,110,40," + alpha.toFixed(2) + ")";
      ctx.fillRect(Math.round(px), Math.round(py), 2, 2);
    }

    /* 2) 반딧불이 — 마을의 풀밭/나무/우물가 주변을 날아다님 */
    var fireflySpawns = [
      { x: 3.5, y: 3.5 }, { x: 26.5, y: 3.5 },
      { x: 5.5, y: 12.5 }, { x: 24.5, y: 12.5 },
      { x: 6.5, y: 18.5 }, { x: 23.5, y: 18.5 },
      { x: 15.5, y: 17.5 }, { x: 10.5, y: 15.5 }, { x: 20.5, y: 15.5 }
    ];
    for (var fi = 0; fi < fireflySpawns.length; fi++) {
      var sp = fireflySpawns[fi];
      var fseed = fi * 2.11;
      var fx = (sp.x + Math.sin(t * 0.9 + fseed) * 1.8 + Math.cos(t * 1.4 + fseed * 2) * 0.8) * TILE + ox;
      var fy = (sp.y + Math.cos(t * 0.8 + fseed * 1.3) * 1.4 + Math.sin(t * 1.2 + fseed) * 0.6) * TILE + oy;
      var glow = Math.sin(t * 2.5 + fseed * 4) * 0.5 + 0.5;
      if (glow > 0.15) {
        ctx.fillStyle = "rgba(180,240,90," + (glow * 0.35).toFixed(2) + ")";
        ctx.beginPath();
        ctx.arc(fx, fy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(230,255,160," + (glow * 0.85).toFixed(2) + ")";
        ctx.fillRect(Math.round(fx - 1), Math.round(fy - 1), 2, 2);
      }
    }
  };

  /* NPC 상호작용 말풍선 */
  View.prototype.drawTownBubbles = function (world, ox, oy) {
    if (!world.inTown) return;
    var ctx = this.ctx, p = world.player;
    var npcs = [
      { id: "smith",   name: "대장장이", line: "장비를 벼려줄 테니 언제든 가져오게.", x: 8.5,  y: 8.5 },
      { id: "shop",    name: "잡화 상인", line: "심연에서 건져온 진귀한 물건이 있소.",   x: 20.5, y: 8.5 },
      { id: "stash",   name: "보관함",   line: "귀중품은 장부에 맡겨두시오.",          x: 15.5, y: 11.5 },
      { id: "portal",  name: "심연의 문", line: "아래에서 지워진 이름들이 부르고 있다...", x: 15.5, y: 4.5 },
      { id: "well",    name: "회복의 샘", line: "맑은 샘물이 지친 몸을 치유해줍니다.",  x: 5.5,  y: 17.5 },
      { id: "dummy1",  name: "허수아비", line: "[타격 훈련용 허수아비]",            x: 6.5,  y: 13.5 },
      { id: "dummy2",  name: "허수아비", line: "[타격 훈련용 허수아비]",            x: 23.5, y: 13.5 }
    ];

    for (var i = 0; i < npcs.length; i++) {
      var n = npcs[i];
      var dist = Math.hypot(p.x - n.x, p.y - n.y);
      if (dist > 3.0) continue;

      var alpha = Math.min(1, (3.0 - dist) / 0.8);
      var bx = n.x * TILE + ox;
      var by = (n.y - 1.45) * TILE + oy;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = "11px " + (global.NUM_FONT || "sans-serif");
      var textW = ctx.measureText(n.line).width;
      var padX = 8, padY = 4;
      var boxW = textW + padX * 2, boxH = 19;
      var rx = Math.round(bx - boxW / 2), ry = Math.round(by - boxH);

      ctx.fillStyle = "rgba(22, 17, 26, 0.92)";
      ctx.strokeStyle = "#8a6f4d";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(rx, ry, boxW, boxH, 4);
      } else {
        ctx.rect(rx, ry, boxW, boxH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#8a6f4d";
      ctx.beginPath();
      ctx.moveTo(bx - 3, ry + boxH);
      ctx.lineTo(bx + 3, ry + boxH);
      ctx.lineTo(bx, ry + boxH + 4);
      ctx.closePath();
      ctx.fill();

      ctx.textAlign = "center";
      ctx.fillStyle = n.id.indexOf("dummy") >= 0 ? "#b5a88e" : "#ffe9a8";
      ctx.fillText(n.line, bx, ry + 13.5);
      ctx.restore();
    }
  };

  /* 굵은 검기 궤적 & 스킬 타격 불꽃 파티클 (Dynamic Slash Trail & Spark Bursts) */
  View.prototype.swingArc = function (ctx, e, ex, ey, ox, oy) {
    var a = e.atk, m = a.m;
    var k = a.t / Math.max(0.01, m.windup);
    var live = a.t >= m.windup;
    var cx = ex * TILE + ox, cy = (ey - 0.35) * TILE + oy;
    var half = m.arc * Math.PI / 360;
    var radius = m.reach * TILE;
    ctx.save();

    if (live) {
      if (e.team === 0) {
        /* 날카로운 픽셀 검기 초승달 궤적 (Sharpened Blade Slash Flare) */
        ctx.beginPath();
        ctx.arc(cx, cy, radius, a.ang - half, a.ang + half);
        ctx.arc(cx, cy, radius * 0.45, a.ang + half, a.ang - half, true);
        ctx.closePath();
        var grad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
        grad.addColorStop(0, "rgba(255, 255, 220, 0.95)");
        grad.addColorStop(0.5, "rgba(255, 180, 50, 0.75)");
        grad.addColorStop(1, "rgba(255, 80, 20, 0)");
        ctx.fillStyle = grad;
        ctx.fill();

        /* 칼날 끝 스파크 입자 7개 */
        for (var spi = 0; spi < 7; spi++) {
          var spAng = a.ang - half + (spi / 6) * (half * 2);
          var spR = radius * (0.85 + (spi % 2 === 0 ? 0.15 : 0.05));
          var spx = cx + Math.cos(spAng) * spR;
          var spy = cy + Math.sin(spAng) * spR;
          ctx.fillStyle = (spi % 2 === 0) ? "#ffffff" : "#ffe080";
          ctx.fillRect(Math.round(spx) - 1, Math.round(spy) - 1, 3, 3);
        }
      } else {
        /* 몬스터 날카로운 붉은 손톱/위협적인 사선 베기 */
        ctx.beginPath();
        ctx.arc(cx, cy, radius, a.ang - half, a.ang + half);
        ctx.arc(cx, cy, radius * 0.5, a.ang + half, a.ang - half, true);
        ctx.closePath();
        ctx.fillStyle = "rgba(255, 60, 40, 0.65)";
        ctx.fill();
      }
    } else {
      /* 예고 — 다가오는 붉은/황금빛 사선 바닥 경고 파동 */
      ctx.beginPath();
      ctx.arc(cx, cy, radius * Math.min(1, k), a.ang - half, a.ang + half);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = e.team === 0 ? "rgba(255,220,140,0.18)" : "rgba(255,70,50,0.22)";
      ctx.fill();
    }
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

  /* 걸음 그림 */
  View.prototype.frameOf = function (e) {
    if (!S.hasFrames(e.sprite)) return 0;
    var moving = (e.mx || e.my) && (Math.abs(e.x - e.px) + Math.abs(e.y - e.py)) > 1e-5;
    if (!moving) return 0;
    return 1 + (Math.floor(e.walked / STRIDE) % 2);
  };

  View.prototype.motionOf = function (e) {
    var bx = 0, by = 0;
    var moving = (e.mx || e.my) && (Math.abs(e.x - e.px) + Math.abs(e.y - e.py)) > 1e-5;
    if (moving) {
      var ph = Math.floor(e.walked / (STRIDE * 0.5));
      by = (ph % 2) ? -1 : 0;
      bx = (Math.floor(ph / 2) % 2) ? 1 : -1;
    }
    var a = e.atk;
    if (a && a.m) {
      var w = a.m.windup || 0.2, r = a.m.recover || 0.2;
      var push = (a.t < w) ? -2 * (a.t / w) : 3 * (1 - Math.min(1, (a.t - w) / Math.max(0.01, r)));
      bx += Math.round(Math.cos(a.ang) * push);
      by += Math.round(Math.sin(a.ang) * push);
    }
    if (e.hurt > 0) bx += (Math.floor(e.hurt * 140) % 2) ? 1 : -1;
    return { x: bx, y: by };
  };

  /* 화면 좌표 → 월드 칸 좌표. */
  View.prototype.toWorld = function (clientX, clientY) {
    var box = this.canvas.getBoundingClientRect();
    var wx = (clientX - box.left) / this.zoom - this.ox;
    var wy = (clientY - box.top) / this.zoom - this.oy;
    return { x: wx / TILE, y: wy / TILE };
  };

  /* 개체 몸체/발밑 지속 효과 오라 — 단순 원형 선을 전면 삭제하고 피어오르는 붉은 불꽃/열기/입자로 표현 */
  View.prototype.drawEntityAuras = function (ctx, e, ex, ey, ox, oy, world) {
    if (e.dead) return;
    var bx = ex * TILE + ox, by = ey * TILE + oy;
    var cy = by - 16; /* 캐릭터 중심 높이 */
    ctx.save();

    /* 1) 둔화 상태 오라 (Slow Frost Shards under feet) */
    if (e.slowUntil && e.slowUntil > world.time) {
      for (var sfi = 0; sfi < 6; sfi++) {
        var sfa = sfi * (Math.PI / 3) + Math.sin(world.time * 2) * 0.2;
        var sfx = bx + Math.cos(sfa) * 14;
        var sfy = by - 4 + Math.sin(sfa) * 6;
        ctx.fillStyle = (sfi % 2 === 0) ? "#82d8ff" : "#ffffff";
        ctx.beginPath();
        ctx.moveTo(sfx, sfy - 7);
        ctx.lineTo(sfx + 3, sfy + 2);
        ctx.lineTo(sfx - 3, sfy + 2);
        ctx.closePath();
        ctx.fill();
      }
    }

    /* 2) 플레이어 전신 붉은 불꽃 오라 / 황금 신성 별빛 / 독기 피어오름 */
    if (e.kind === "player" && world.buffs && world.buffs.length) {
      for (var bi = 0; bi < world.buffs.length; bi++) {
        var bf = world.buffs[bi];

        if (bf.id === "shout" || bf.dmgPct > 20) {
          /* 🔴 붉은 광폭/함성 — 14개의 진짜 피어오르는 불꽃 덩어리가 캐릭터 몸 전체를 감싸 올라감 */
          for (var fi = 0; fi < 14; fi++) {
            var phase = world.time * 12 + fi * 0.45;
            var spreadX = Math.sin(phase * 1.3) * 13;
            var flameH = (world.time * 30 + fi * 9) % 32;
            var fx = bx + spreadX;
            var fy = by + 2 - flameH;
            var size = Math.max(1.5, (1 - flameH / 32) * 5.5);

            var fColor = "#d92418";
            if (flameH < 8) fColor = "#ff4820";
            else if (flameH < 18) fColor = "#ff9428";
            else if (flameH < 26) fColor = "#ffdb43";
            else fColor = "#ffffff";

            ctx.fillStyle = fColor;
            ctx.beginPath();
            ctx.arc(fx, fy, size, 0, Math.PI * 2);
            ctx.fill();
          }

          /* 피어오르는 붉은 열기 불티 파티클 8개 */
          ctx.fillStyle = "#ffe480";
          for (var pti = 0; pti < 8; pti++) {
            var pta = world.time * 5 + pti * 0.8;
            var ptx = bx + Math.sin(pta * 2.1) * 16;
            var pty = cy + 14 - ((world.time * 28 + pti * 6) % 36);
            ctx.fillRect(Math.round(ptx), Math.round(pty), 2, 2);
          }

        } else if (bf.id === "ward" || bf.armor > 0) {
          /* 🟡 황금 신성 별 빛 수호 */
          for (var wi = 0; wi < 6; wi++) {
            var wa = world.time * 2.5 + wi * 1.047;
            var wx = bx + Math.cos(wa) * 18;
            var wy = cy + Math.sin(wa * 2) * 10;
            ctx.fillStyle = (wi % 2 === 0) ? "#fff2a8" : "#ffd040";
            ctx.fillRect(Math.round(wx) - 1, Math.round(wy) - 4, 3, 9);
            ctx.fillRect(Math.round(wx) - 4, Math.round(wy) - 1, 9, 3);
          }

        } else if (bf.id === "venom") {
          /* 🟢 짙은 초록 독기 구름 8개 */
          for (var vi = 0; vi < 8; vi++) {
            var vp = world.time * 8 + vi * 0.78;
            var vx = bx + Math.sin(vp * 1.7) * 14;
            var vy = by - ((world.time * 18 + vi * 5) % 28);
            var vr = Math.max(1, (1 - ((world.time * 18 + vi * 5) % 28) / 28) * 4);
            ctx.fillStyle = (vi % 2 === 0) ? "#4fbf6a" : "#9cf0a8";
            ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  /* 개체 전면 전신 불꽃 레이어 */
  View.prototype.drawEntityAurasOver = function (ctx, e, ex, ey, ox, oy, world) {
    if (e.dead) return;
    var bx = ex * TILE + ox, by = ey * TILE + oy;
    var cy = by - 16;
    ctx.save();
    if (e.kind === "player" && world.buffs && world.buffs.length) {
      for (var bi = 0; bi < world.buffs.length; bi++) {
        var bf = world.buffs[bi];
        if (bf.id === "shout" || bf.dmgPct > 20) {
          /* 전면 불꽃 혀 6개 (캐릭터 몸 앞을 지나가며 붉은 불꽃이 입체적으로 피어오름) */
          for (var ffi = 0; ffi < 6; ffi++) {
            var ffa = world.time * 10 + ffi * 1.04;
            var ffx = bx + Math.cos(ffa) * 10;
            var ffy = cy + 10 - ((world.time * 24 + ffi * 8) % 26);
            ctx.fillStyle = (ffi % 2 === 0) ? "#ff4820" : "#ffdb43";
            ctx.beginPath(); ctx.arc(ffx, ffy, 3, 0, Math.PI * 2); ctx.fill();
          }
        }
      }
    }
    ctx.restore();
  };

  global.VIEW = { View: View, TILE: TILE, variantAt: variantAt, placeAt: placeAt };
})(window);
