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

  
  function getPdHelmSprite(it) {
    if (!it) return null;
    var id = it.id || "";
    if (id === "crown_kings") return "pd_helm_crown";
    if (id === "hood" || id === "shadow_hood") return "pd_helm_hood";
    if (id === "helm" || id === "dragon_helm") return "pd_helm_iron";
    return "pd_helm_cap";
  }

  function getPdArmorSprite(it) {
    if (!it) return null;
    var id = it.id || "";
    if (id === "arcane_robe" || id === "robe") return "pd_armor_robe";
    if (id === "shadow_coat" || id === "coat") return "pd_armor_shadow";
    return "pd_armor_plate";
  }

  function getPdShieldSprite(it) {
    if (!it) return null;
    return "pd_shield_aegis";
  }

  function getPdWeaponSprite(it) {
    if (!it) return null;
    var id = it.id || "";
    if (id === "excalibur") return "pd_weapon_excalibur";
    if (id === "dragonslayer") return "pd_weapon_dragonslayer";
    if (id === "arcanestaff" || id === "staff") return "pd_weapon_arcanestaff";
    if (id === "shadowdagger" || id === "dagger") return "pd_weapon_shadowdagger";
    if (id === "celestialbow" || id === "bow") return "pd_weapon_celestialbow";
    return "pd_weapon_excalibur";
  }

  function drawPaperdollOverlays(ctx, e, sx, sy, fr, world) {
    if (e.kind !== "player" || !global.SAVE || !global.SAVE.liveEquip) return;
    var hero = world.player ? world.player.hero : null;
    if (!hero) return;
    var eq = global.SAVE.liveEquip(hero);
    if (!eq) return;

    if (eq.body) {
      var pdBody = getPdArmorSprite(eq.body);
      if (pdBody && S.has(pdBody)) placeAt(ctx, S.bake(pdBody, fr), pdBody, sx, sy);
    }
    if (eq.head) {
      var pdHead = getPdHelmSprite(eq.head);
      if (pdHead && S.has(pdHead)) placeAt(ctx, S.bake(pdHead, fr), pdHead, sx, sy);
    }
    if (eq.shield) {
      var pdShield = getPdShieldSprite(eq.shield);
      if (pdShield && S.has(pdShield)) placeAt(ctx, S.bake(pdShield, fr), pdShield, sx, sy);
    }
    if (eq.weapon) {
      var pdWeapon = getPdWeaponSprite(eq.weapon);
      if (pdWeapon && S.has(pdWeapon)) placeAt(ctx, S.bake(pdWeapon, fr), pdWeapon, sx, sy);
    }
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
    if (w < 600) return 1.30;
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
    /* ⚠ 카메라가 지금 얼마나 밀렸는지를 남긴다. 이것이 없으면
     * 밖에서는 주인공이 화면 어디에 있는지 알 길이 없다 — 레벨 경계에서는
     * 한가운데가 아니라서, 검사가 그것을 어림하다 빈 칸만 재다. */
    this.ox = ox; this.oy = oy;
    /* 기기 픽셀 격자에 맞춘다 — 안 맞추면 도트 가장자리가 지글거린다 */
    ox = Math.round(ox * q) / q;
    oy = Math.round(oy * q) / q;
    if (world.shake > 0) {
      var sm = world.shakeMag || 3;
      ox += (Math.random() - 0.5) * sm;
      oy += (Math.random() - 0.5) * sm;
    }
    this.ox = ox; this.oy = oy;

    /* 지도가 화면 **어디에** 놓였는지 CSS 에 알린다.
     *
     * 마을은 30x22칸 = 960x704px 로 고정이다. 창이 그보다 크면 남는 곳은
     * 전부 검은 바깥이다 — 실측으로 1916x945 에서 그려진 픽셀이 37% 였고,
     * 위 메뉴는 캐릭터에서 898px 떨어져 있었다. 창 가장자리에 붙어 있어서다.
     *
     * UI 를 **창이 아니라 지도에** 붙이면 그 거리가 절반으로 준다(1024x700,
     * 즉 창과 지도가 같은 크기일 때가 465px 이다). 그래서 지도의 네 변까지의
     * 여백을 그대로 내보내고, CSS 가 거기에 붙인다.
     *
     * ⚠ 매 프레임 쓰면 안 된다. CSS 변수를 바꾸면 그때마다 다시 계산한다.
     *   **값이 바뀔 때만** 쓴다.
     * ⚠ 흔들림(shake)은 뺀 값으로 쓴다. 맞을 때마다 UI 가 같이 떨면 멀미가 난다. */
    var sw = Math.min(mapW, this.viewW), sh = Math.min(mapH, this.viewH);
    var sl = Math.max(0, Math.round(mapW <= this.viewW ? (this.viewW - mapW) / 2 : 0));
    var st = Math.max(0, Math.round(mapH <= this.viewH ? (this.viewH - mapH) / 2 : 0));
    var sr = Math.max(0, Math.round(this.viewW - sl - sw));
    var sb = Math.max(0, Math.round(this.viewH - st - sh));
    if (sl !== this._sl || st !== this._st || sr !== this._sr || sb !== this._sb) {
      this._sl = sl; this._st = st; this._sr = sr; this._sb = sb;
      var root = document.documentElement.style;
      root.setProperty("--stage-l", sl + "px");
      root.setProperty("--stage-t", st + "px");
      root.setProperty("--stage-r", sr + "px");
      root.setProperty("--stage-b", sb + "px");
    }

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
      } else if (sh.kind === "staff") {
        /* 지팡이 — **휘둘러 날린 기운**이다. 둥근 알이 아니다.
         *
         * ⚠ 처음에 빛나는 구체로 그렸더니 **총알처럼** 보였다
         *   (훈님 지적 2026-09-25). 지팡이는 휘두르는 무기니 나가는 것도
         *   **날아가는 초승달**이어야 한다 — 날아가는 방향과 직각으로 선다.
         * ⚠ 둥글게 되돌리지 말 것. */
        var sux = sh.vx / tl, suy = sh.vy / tl;
        var sang = Math.atan2(suy, sux);
        ctx.save();
        ctx.translate(sxp, syp);
        ctx.rotate(sang);
        /* 꾬리 — 지나온 자리가 엷게 남는다 */
        var gT = ctx.createLinearGradient(-26, 0, 0, 0);
        gT.addColorStop(0, "rgba(120,150,255,0)");
        gT.addColorStop(1, "rgba(170,200,255,.45)");
        ctx.strokeStyle = gT;
        ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-4, 0); ctx.stroke();
        /* 초승달 두 겹 */
        ctx.strokeStyle = "rgba(150,190,255,.85)";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(-9, 0, 13, -1.0, 1.0); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,.95)";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(-7, 0, 13, -0.8, 0.8); ctx.stroke();
        ctx.restore();
      } else if (sh.kind === "bow") {
        /* 활 — 화살. 촉 · 대 · 깃이 보여야 화살로 읽힌다 */
        var ux = sh.vx / tl, uy = sh.vy / tl;
        var px2 = -uy, py2 = ux;
        ctx.strokeStyle = "#c9a86a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sxp - ux * 16, syp - uy * 16);
        ctx.lineTo(sxp, syp);
        ctx.stroke();
        ctx.fillStyle = "#f1faee";                       /* 촉 */
        ctx.beginPath();
        ctx.moveTo(sxp + ux * 4, syp + uy * 4);
        ctx.lineTo(sxp - ux * 3 + px2 * 3, syp - uy * 3 + py2 * 3);
        ctx.lineTo(sxp - ux * 3 - px2 * 3, syp - uy * 3 - py2 * 3);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "rgba(230,230,240,.8)";        /* 깃 */
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sxp - ux * 16 + px2 * 3, syp - uy * 16 + py2 * 3);
        ctx.lineTo(sxp - ux * 11, syp - uy * 11);
        ctx.moveTo(sxp - ux * 16 - px2 * 3, syp - uy * 16 - py2 * 3);
        ctx.lineTo(sxp - ux * 11, syp - uy * 11);
        ctx.stroke();
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
      drawPaperdollOverlays(ctx, e, sx, sy, fr, world);
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

    /* 떠오르는 숫자 — 개체보다 **위에** 그린다 (가이더스 스타일 팝업 연출) */
    for (i = 0; i < world.floaters.length; i++) {
      var f = world.floaters[i];
      var k = f.t / f.life;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.textAlign = "center";

      var fx2 = f.x * TILE + ox;
      var fy2 = (f.y - Math.sin(k * Math.PI * 0.85) * 0.85) * TILE + oy;

      if (f.crit) {
        var bounceScale = k < 0.2 ? 1 + (0.2 - k) * 2.2 : 1.0;
        ctx.save();
        ctx.translate(fx2, fy2);
        ctx.scale(bounceScale, bounceScale);
        ctx.font = "bold 16px " + (global.NUM_FONT || "monospace");
        ctx.strokeStyle = "#6a0000";
        ctx.lineWidth = 4;
        ctx.strokeText(f.text, 0, 0);
        ctx.fillStyle = "#ffea43";
        ctx.fillText(f.text, 0, 0);
        /* CRIT! 뱃지 팝업 */
        ctx.font = "bold 9px " + (global.NUM_FONT || "monospace");
        ctx.fillStyle = "#ff3344";
        ctx.fillText("CRIT!", 0, -14);
        ctx.restore();
      } else {
        ctx.font = "bold 12px " + (global.NUM_FONT || "monospace");
        ctx.strokeStyle = "rgba(10,8,14,0.9)";
        ctx.lineWidth = 3;
        ctx.strokeText(f.text, fx2, fy2);
        ctx.fillStyle = f.foe ? "#ffe9a8" : "#ff8d7a";
        ctx.fillText(f.text, fx2, fy2);
      }
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

  /* 가이더스 스타일 픽셀 검기 궤적 & 무기별 이펙트 (Guidus Dynamic Slash Trail & Spark Bursts) */
  /* 무기마다 다른 휘두름.
   *
   * ⚠ **여기가 진실원이다.** 예전에는 `if (wId === "dagger" || ...)` 사슬이라
   *   무기를 더할 때마다 사슬이 길어졌고, 실제로 **지팡이와 활이 빠져 있었다.**
   *   표에 없으면 "slash"(장검)로 떨어진다 — 새 무기가 조용히 안 보이는 것보다
   *   낫다.
   * ⚠ 지팡이 · 활은 `arc: 0` 이다(원거리라 부채꼴 판정이 없다). 그래서
   *   `half = 0` 이 되어 **부채꼴이 폭 0 으로 그려졌다** — 휘둘러도 화면에
   *   아무 일도 안 일어났다(실측 2026-09-25). 그 둘은 부채꼴이 아니라
   *   **손에서 터지는 것**으로 그린다.
   * ⚠ 원거리는 `reach` 가 7.5~9칸이다. 그 값을 반지름으로 쓰면 효과가
   *   화면을 덮는다 — 손 언저리(0.9칸)로 못 박는다. */
  var SWING_STYLE = {
    dagger: "stab", shadowdagger: "stab",
    sword: "slash",
    axe: "crush", dragonslayer: "crush",
    mace: "smash",
    spear: "thrust",
    staff: "cast",
    bow: "draw"
  };

  View.prototype.swingArc = function (ctx, e, ex, ey, ox, oy) {
    var a = e.atk, m = a.m;
    var k = a.t / Math.max(0.01, m.windup);
    var live = a.t >= m.windup;
    var cx = ex * TILE + ox, cy = (ey - 0.35) * TILE + oy;
    var half = m.arc * Math.PI / 360;
    var radius = m.reach * TILE;

    /* 무엇을 들었나 — **휘두르는 그 몸에서** 읽는다.
     *
     * ⚠ 예전에는 e.equipped 를 봤는데, 그것은 **Entity 생성자가 빈
     *   객체로 두고** applyHero 는 그것을 **World 에** 담는다(world.js 673).
     *   빈 객체도 참이라 || 뒤의 되돌림길이 한 번도 안 타고,
     *   wId 가 늘 문자열이 돼 **모든 무기가 장검으로** 떨어졌다.
     *   단검·도끼·장창의 그림이 화면에서는 **한 번도 나온 적이 없었다**
     *   (실측 2026-09-25 · 검사는 가짜 객체를 넣어 통과했다).
     *   지팡이·활은 그 장검 부채꼴을 arc 0 으로 그려 **아무것도 안 나왔다.**
     * ⚠ swing.base 는 derive 가 넣고 applyHero 가 몸에 붙인다 — 그것이
     *   유일한 진실원이다. 화면이 저장을 다시 뒤지게 두지 말 것. */
    var style = "claw";
    if (e.team === 0) {
      var wId = (e.swing && e.swing.base) || "";
      style = SWING_STYLE[wId] || "slash";
    }
    var shoots = (style === "cast" || style === "draw");
    if (shoots) { radius = TILE * 0.9; half = Math.PI / 5; }

    /* 손 언저리 — 쏘는 무기는 여기서 터진다 */
    var hx = cx + Math.cos(a.ang) * TILE * 0.55;
    var hy = cy + Math.sin(a.ang) * TILE * 0.55;

    ctx.save();

    if (!live) {
      /* 예고 — 다가오는 바닥 경고 파동.
       * ⚠ 쏘는 무기는 부채꼴이 없어 **예고도 안 보였다.** 손에 기운이
       *   모이는 것으로 바꾼다 — 언제 나가는지 알아야 피할 수 있다. */
      if (shoots) {
        var chg = Math.min(1, k);
        var gC = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14 * chg + 3);
        gC.addColorStop(0, style === "cast" ? "rgba(200,220,255,.85)" : "rgba(255,240,200,.8)");
        gC.addColorStop(1, style === "cast" ? "rgba(90,120,255,0)" : "rgba(200,150,60,0)");
        ctx.fillStyle = gC;
        ctx.beginPath(); ctx.arc(hx, hy, 14 * chg + 3, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, radius * Math.min(1, k), a.ang - half, a.ang + half);
        ctx.lineTo(cx, cy);
        ctx.closePath();
        ctx.fillStyle = e.team === 0 ? "rgba(255,220,140,0.22)" : "rgba(255,70,50,0.25)";
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    /* ── 쓸려 지나간다 ──────────────────────────────────
     *
     * ⚠ 예전에는 부채꼴 **한 장이 통째로** 떴다가 사라졌다. 그래서 무기를
     *   바꿔도 "불이 켜졌다 꺼졌다" 로만 보였다(훈님 지적 2026-09-25:
     *   "왜 공격 이펙트가 다 똑같아? 라이트 비추는 효과냐").
     *   진짜 베기는 **날이 한쪽 끝에서 다른 쪽 끝으로 지나간다.**
     *
     *   sw   0 → 1   후딜(recover) 동안의 진행. 여기가 휘두름의 전부다.
     *   head            날이 지금 있는 자리 — 앞의 45% 에 다 지나간다(빠르다)
     *   tail            자국의 꼬리 — 30% 부터 뒤따라와 끝에서 만난다(사라진다)
     *
     * ⚠ 머리와 꼬리를 **같은 속도로 움직이지 말 것.** 같이 가면 폭이 일정한
     *   띠가 미끄러지는 꼴이라 칼이 아니라 자가 지나가는 것처럼 보인다.
     * ⚠ 꼬리가 머리를 따라잡으면 폭이 0 이 되어 저절로 사라진다 — 따로
     *   투명도를 깎지 않는다(깎으면 끝에서 흐릿하게 뭉개진다). */
    var sw = Math.min(1, Math.max(0, (a.t - m.windup) / Math.max(0.02, m.recover || 0.2)));
    function eOut(x) { x = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - x, 3); }
    function eIn(x) { x = Math.min(1, Math.max(0, x)); return x * x; }
    var headK = eOut(sw / 0.45);
    /* ⚠ 꼬리가 너무 뒤에 처지면 중간에 **부채를 꽉 채운 불빛**이 된다
     *   (실측: 35% 지점에서 띄 폭이 부채의 98% 였다). 자국 길이를
     *   부채의 45% 로 묶는다 — 그것이 날이 지나간 자리로 읽히는 폭이다. */
    /* ⚠ 꼬리를 `eIn` 으로 당겼더니 **뒷절반이 거의 멈춰 있었다**
     *   (50%→85% 사이에 바뀜 칸이 32칸뿐). `eOut` 이어야 자국이
     *   눈에 보이게 걱혀 사라진다 — 날이 지나간 자리는 마지막까지 움직인다. */
    var tailK = Math.max(eOut((sw - 0.30) / 0.70), headK - 0.45);
    var span = half * 2;
    var aTail = a.ang - half + span * tailK;
    var aHead = a.ang - half + span * headK;

    /* 자국 한 벌. 띠를 몇 조각으로 갈라 **뒤로 갈수록 옅게** 칠한다 —
     * 그래야 지나간 자리로 읽힌다(한 색으로 칠하면 그냥 부채다). */
    function wedge(outR, inR, c0, c1, c2) {
      var N = 6;
      for (var wi = 0; wi < N; wi++) {
        var t0 = aTail + (aHead - aTail) * (wi / N);
        var t1 = aTail + (aHead - aTail) * ((wi + 1) / N);
        if (t1 - t0 < 1e-4) continue;
        ctx.save();
        ctx.globalAlpha = 0.22 + 0.78 * ((wi + 1) / N);
        ctx.beginPath();
        ctx.arc(cx, cy, radius * outR, t0, t1);
        ctx.arc(cx, cy, radius * inR, t1, t0, true);
        ctx.closePath();
        var g = ctx.createRadialGradient(cx, cy, radius * inR, cx, cy, radius * outR);
        g.addColorStop(0, c0); g.addColorStop(0.5, c1); g.addColorStop(1, c2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
      }
    }

    if (style === "stab") {
      /* 단검 — 빠르고 날카로운 이중 민트/청록 베기 */
      wedge(1.05, 0.35, "rgba(255,255,255,0.98)", "rgba(100,240,255,0.85)", "rgba(0,180,220,0)");
    } else if (style === "crush") {
      /* 전투도끼 — 무겁고 붉은 화염 궤적 */
      wedge(1.25, 0.25, "rgba(255,255,220,0.98)", "rgba(255,120,30,0.88)", "rgba(255,30,10,0)");
    } else if (style === "smash") {
      /* 철퇴 — 베는 것이 아니라 **찧는 것**이다. 궤적을 짧게 하고 끝에
       * 충격 고리를 둔다. ⚠ 도끼와 같은 불꽃을 쓰지 말 것 — 둘이 한
       * 무기로 보인다(전에 그랬다). */
      wedge(0.95, 0.45, "rgba(255,255,255,0.95)", "rgba(210,210,225,0.75)", "rgba(140,140,160,0)");
      /* ⚠ **닿고 나서** 고리가 퍼진다. 처음부터 띄우면 때리기도 전에
       *   충격이 있는 꼴이라 찧는 맛이 사라진다. 날이 앞쪽(60%)을 지난 뒤부터. */
      /* ⚠ headK 로 몰았더니 sw 0.45 에 이미 1 이 돼 **절반 지점에서는
       *   고리가 사라진다.** 그러면 남는 것은 회색 초승달뿐이라 단검과
       *   14.5% 밖에 안 달랐다(실측). 찜는 맛은 이 고리에 있으니
       *   **휘두름 끝까지** 퍼져 나가게 한다. */
      if (sw > 0.25) {
        var hk = (sw - 0.25) / 0.75;
        var ix = cx + Math.cos(a.ang) * radius * 0.95;
        var iy = cy + Math.sin(a.ang) * radius * 0.95;
        ctx.save();
        ctx.globalAlpha = 1 - eIn(hk);
        ctx.strokeStyle = "rgba(255,255,255,.9)";
        ctx.lineWidth = 3 - 1.5 * hk;
        ctx.beginPath(); ctx.arc(ix, iy, 6 + 16 * hk, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgba(200,200,215,.6)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(ix, iy, 3 + 26 * hk, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    } else if (style === "thrust") {
      /* 장창 — **찌르는 것은 돌지 않는다.** 각도로 쓸지 말고 앞으로 뻗었다
       * 되돌아온다. 뻗는 데 45% · 빼는 데 나머지. */
      var reachK = (sw < 0.45) ? eOut(sw / 0.45) : (1 - eIn((sw - 0.45) / 0.55));
      var far = radius * (0.35 + 0.95 * reachK);
      var tx = cx + Math.cos(a.ang) * far;
      var ty = cy + Math.sin(a.ang) * far;
      var wide = 5 + 9 * reachK;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * reachK;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tx + Math.cos(a.ang + 1.57) * wide, ty + Math.sin(a.ang + 1.57) * wide);
      ctx.lineTo(tx - Math.cos(a.ang + 1.57) * wide, ty - Math.sin(a.ang + 1.57) * wide);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 240, 160, 0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.95)";      /* 촉 — 끝에서 가장 밝다 */
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a.ang) * radius * 0.3, cy + Math.sin(a.ang) * radius * 0.3);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
    } else if (style === "cast") {
      /* 지팡이 — **휘두른다.** 마법진을 손에 띄워 두었더니
       * 효과 층이 **개체보다 먼저** 그려져 스프라이트 밑에 깔렸고,
       * 화면에는 둘레 아무것도 없이 **알만 날아갔다**(실측 2026-09-25).
       * 몸 밖으로 뻗는 초승달이어야 휘두른 것으로 보인다.
       * ⚠ 반지름은 여전히 손 언저리다 — reach(7.5칸)를 쓰면 화면을 덮는다. */
      wedge(1.45, 0.55, "rgba(255,255,255,0.95)", "rgba(150,170,255,0.8)", "rgba(110,80,220,0)");
      /* 손에서 피어나가는 지팡이 끝의 빛 */
      var gM = ctx.createRadialGradient(hx, hy, 0, hx, hy, 11);
      gM.addColorStop(0, "rgba(255,255,255,.9)");
      gM.addColorStop(1, "rgba(120,150,255,0)");
      ctx.fillStyle = gM;
      ctx.beginPath(); ctx.arc(hx, hy, 11, 0, Math.PI * 2); ctx.fill();
    } else if (style === "draw") {
      /* 활 — 시위가 튕긴다. 앞으로 터지는 것이 아니라 **뒤로 되튀는** 결이다 */
      /* ⚠ 처음에 활대 14 · 시위 13 으로 두었더니 칠한 칸이 544 로
       *   일곱 중 꼴찌였고, 화면에서는 갈색 얼룩으로 보였다.
       *   활은 **마름모가 큰 무기**다 — 크게 그려야 활로 읽힌다. */
      /* ⚠ 활은 부채꼴이 없어 그대로 두면 **한 장이 박혀 있다**(실측:
       *   휘두르는 동안 바뀜 칸 2칸). 시위가 **뒤에서 앞으로 튕겨** 나가고
       *   그 뒤에 활대가 사라져야 쌀다는 것을 본다. */
      var ux = Math.cos(a.ang), uy = Math.sin(a.ang);
      var pxn = -uy, pyn = ux;
      /* ⚠ sw / 0.35 로 두었더니 **처음 15% 안에 튕김이 다 끝나**
       *   나머지는 멈춰 있었다(실측: 15%→85% 사이 11.4% 밖에 안 달라졌다).
       *   후딜 전체에 펌다 — 빠르게 튕기고 천천히 멈춘다. */
      var rel = eOut(sw);                                /* 0 당김 → 1 튕김 */
      var fade = 1 - eIn(Math.max(0, (sw - 0.45) / 0.55));
      ctx.save();
      ctx.globalAlpha = fade;
      /* 활대 — 당겼을 때는 깊게 휘고, 놓으면 **펎지면서 되튀다.**
       * ⚠ 활대를 박아 두었더니 그것이 칠한 칸의 대부분이라, 시위만
       *   움직여서는 휘두름 전체가 11.3% 밖에 안 달라졌다(실측). */
      var bowR = 19 + 6 * rel;
      var bowH = 1.30 - 0.28 * rel;
      var bowB = 6 + 6 * rel;                            /* 되튀어 물러난다 */
      ctx.strokeStyle = "rgba(200,160,90,.85)";
      ctx.lineWidth = 4 - 1.2 * rel;
      ctx.beginPath();
      ctx.arc(hx - ux * bowB, hy - uy * bowB, bowR, a.ang - bowH, a.ang + bowH);
      ctx.stroke();
      /* 시위 — 뒤로 당겼다가(-14) 앞으로(+14) 지나간다 */
      var pull = -14 + 28 * rel;
      ctx.strokeStyle = "rgba(255,250,230,.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx - ux * bowB + pxn * bowR * 0.9, hy - uy * bowB + pyn * bowR * 0.9);
      ctx.quadraticCurveTo(hx + ux * pull, hy + uy * pull,
                           hx - ux * bowB - pxn * bowR * 0.9, hy - uy * bowB - pyn * bowR * 0.9);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,235,175,.45)";         /* 지나온 자리 */
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(hx - ux * bowB + pxn * bowR * 0.9, hy - uy * bowB + pyn * bowR * 0.9);
      ctx.quadraticCurveTo(hx + ux * (pull - 10), hy + uy * (pull - 10),
                           hx - ux * bowB - pxn * bowR * 0.9, hy - uy * bowB - pyn * bowR * 0.9);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,230,.8)";          /* 나간 쪽 섬광 */
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx + ux * (10 + 26 * rel), hy + uy * (10 + 26 * rel));
      ctx.lineTo(hx + ux * (30 + 46 * rel), hy + uy * (30 + 46 * rel));
      ctx.stroke();
      var gB = ctx.createRadialGradient(hx, hy, 0, hx, hy, 18);
      gB.addColorStop(0, "rgba(255,255,255," + (0.85 * (1 - rel * 0.6)).toFixed(2) + ")");
      gB.addColorStop(1, "rgba(255,210,120,0)");
      ctx.fillStyle = gB;
      ctx.beginPath(); ctx.arc(hx, hy, 18, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (style === "claw") {
      /* 몬스터 — 붉은 발톱 */
      wedge(1, 0.45, "rgba(255,50,40,0.7)", "rgba(255,50,40,0.7)", "rgba(255,50,40,0.7)");
    } else {
      /* 장검과 표에 없는 무기 — 황금 초승달 */
      wedge(1, 0.4, "rgba(255,255,240,0.98)", "rgba(255,210,60,0.85)", "rgba(255,100,20,0)");
    }

    /* 날 끝 선 — 부채꼴의 **바깥 획을 한 줄** 긋는다.
     *
     * ⚠ 예전에는 굤적 둘레에 **네모 여덟을 흑뿌렸다.** 어두운
     *   바닥에서 그것이 **산탄처럼** 보였다(훈님 지적 2026-09-25).
     *   베는 것은 알이 튀는 것이 아니다 — 날이 지나간 **한 줄**이다.
     * ⚠ 점을 찍지 말 것. 넣는 순간 다시 산탄으로 보인다. */
    if (e.team === 0 && !shoots && aHead - aTail > 1e-3) {
      /* ⚠ **지금 날이 있는 자리**에 긋는다. 부채 전체에 두르면 다시 정지
       *   화면이 된다 — 움직이는 것은 이 한 줄이다. */
      ctx.strokeStyle = "rgba(255,255,255,.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(aHead) * radius * 0.30, cy + Math.sin(aHead) * radius * 0.30);
      ctx.lineTo(cx + Math.cos(aHead) * radius * 1.02, cy + Math.sin(aHead) * radius * 1.02);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* 검사가 "무기마다 다른 결인가" 를 볼 수 있어야 한다 — 표를 내준다 */
  View.SWING_STYLE = SWING_STYLE;

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

  /* 개체 몸체/발밑 지속 효과 오라 — 드래곤볼 초사이언 스타일 에너지 폭발 오라 (Super Saiyan Energy Aura & Electrical Lightning) */
  View.prototype.drawEntityAuras = function (ctx, e, ex, ey, ox, oy, world) {
    if (e.dead) return;
    var bx = ex * TILE + ox, by = ey * TILE + oy;
    var cy = by - 16; /* 캐릭터 중심 높이 */
    var t = world.time;
    ctx.save();

    /* 1) 둔화 상태 오라 (Slow Frost Shards under feet) */
    if (e.slowUntil && e.slowUntil > t) {
      for (var sfi = 0; sfi < 6; sfi++) {
        var sfa = sfi * (Math.PI / 3) + Math.sin(t * 2) * 0.2;
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

    /* 2) 플레이어 초사이언 에너지 폭발 오라 & 전기 스파크 번개 */
    if (e.kind === "player") {
      var activeBuffs = world.buffs || [];
      var hasShout = false, hasWard = false, hasVenom = false;
      for (var bi = 0; bi < activeBuffs.length; bi++) {
        var bf = activeBuffs[bi];
        if (bf.id === "shout" || bf.dmgPct > 20) hasShout = true;
        if (bf.id === "ward" || bf.armor > 0) hasWard = true;
        if (bf.id === "venom") hasVenom = true;
      }

      /* 활성화된 버프가 있거나 플레이어 스킬 사용 중인 경우 초사이언 기 폭발 효과 */
      if (hasShout || hasWard || hasVenom) {
        var coreColor = "#ffffff";
        var midColor = "#ffdb43";
        var outerColor = "#d92418";
        var elecColor = "#ffffff";

        if (hasVenom) {
          midColor = "#8bff68";
          outerColor = "#0e8538";
          elecColor = "#c8ff9e";
        } else if (hasWard && !hasShout) {
          midColor = "#ffea75";
          outerColor = "#d99b00";
          elecColor = "#ffffff";
        }

        /* (A) 발밑 지면 에너지 분출 충격파 파동 (Ground Energy Shockwave Ring) */
        var waveK = (t * 2.8) % 1.0;
        var waveR = 8 + waveK * 22;
        ctx.strokeStyle = outerColor;
        ctx.lineWidth = Math.max(1, (1 - waveK) * 3);
        ctx.globalAlpha = (1 - waveK) * 0.75;
        ctx.beginPath();
        ctx.ellipse(bx, by - 2, waveR, waveR * 0.45, 0, 0, Math.PI * 2);
        ctx.stroke();

        /* (B) 뾰족한 초사이언 에너지 불기둥 오라 실루엣 (Spiky Upward Energy Aura Flare) */
        ctx.globalAlpha = 0.85;
        var spikeCount = 9;
        ctx.beginPath();
        for (var spi = 0; spi <= spikeCount; spi++) {
          var angle = (spi / spikeCount) * Math.PI - Math.PI; // -PI ~ 0 (위쪽 반원)
          var noise = Math.sin(t * 28 + spi * 3.7) * 4 + Math.cos(t * 20 - spi * 2.1) * 3;
          var heightMult = 1.0 + Math.abs(Math.sin(angle)) * 0.85; // 중앙일수록 위로 높게 피어오름
          var radX = (16 + noise) * Math.cos(angle);
          var radY = (30 + noise) * heightMult * Math.sin(angle);
          var ax = bx + radX;
          var ay = by - 2 + radY;
          if (spi === 0) ctx.moveTo(ax, ay);
          else ctx.lineTo(ax, ay);
        }
        ctx.lineTo(bx + 18, by);
        ctx.lineTo(bx - 18, by);
        ctx.closePath();

        var auraGrad = ctx.createRadialGradient(bx, cy, 4, bx, cy - 8, 32);
        auraGrad.addColorStop(0, coreColor);
        auraGrad.addColorStop(0.35, midColor);
        auraGrad.addColorStop(0.8, outerColor);
        auraGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = auraGrad;
        ctx.fill();

        /* (C) 초사이언 번개 전기 스파크 (Zig-zag Electrical Lightning Arcs) */
        ctx.globalAlpha = 0.92;
        ctx.strokeStyle = elecColor;
        ctx.lineWidth = 1.5;
        for (var li = 0; li < 3; li++) {
          var lSeed = Math.floor(t * 16 + li * 7);
          if ((lSeed % 3) === 0) {
            var lx1 = bx + (Math.sin(lSeed * 1.3) * 18);
            var ly1 = by - (lSeed % 32);
            var lx2 = lx1 + (Math.cos(lSeed * 2.7) * 9);
            var ly2 = ly1 - 7;
            var lx3 = lx2 - (Math.sin(lSeed * 3.1) * 8);
            var ly3 = ly2 - 8;

            ctx.beginPath();
            ctx.moveTo(lx1, ly1);
            ctx.lineTo(lx2, ly2);
            ctx.lineTo(lx3, ly3);
            ctx.stroke();

            /* 스파크 지점에 강렬한 점 플래시 */
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(Math.round(lx3) - 1, Math.round(ly3) - 1, 3, 3);
          }
        }

        /* (D) 위로 피어오르는 초사이언 입자 불티 (Rising Energy Embers) */
        for (var pti = 0; pti < 12; pti++) {
          var pPhase = t * 14 + pti * 0.7;
          var ptx = bx + Math.sin(pPhase * 1.4) * (10 + (pti % 5) * 2);
          var pLife = (t * 24 + pti * 7) % 36;
          var pty = by + 2 - pLife;
          var pSize = Math.max(1, (1 - pLife / 36) * 4);
          ctx.fillStyle = (pti % 3 === 0) ? coreColor : (pti % 2 === 0 ? midColor : outerColor);
          ctx.globalAlpha = (1 - pLife / 36) * 0.9;
          ctx.fillRect(Math.round(ptx - pSize / 2), Math.round(pty - pSize / 2), Math.round(pSize), Math.round(pSize));
        }
      }
    }
    ctx.restore();
  };

  /* 개체 전면 입체 불꽃 레이어 */
  View.prototype.drawEntityAurasOver = function (ctx, e, ex, ey, ox, oy, world) {
    if (e.dead) return;
    var bx = ex * TILE + ox, by = ey * TILE + oy;
    var cy = by - 16;
    var t = world.time;
    ctx.save();
    if (e.kind === "player" && world.buffs && world.buffs.length) {
      for (var bi = 0; bi < world.buffs.length; bi++) {
        var bf = world.buffs[bi];
        if (bf.id === "shout" || bf.dmgPct > 20 || bf.id === "ward" || bf.id === "venom") {
          var fColor = bf.id === "venom" ? "#8bff68" : "#ffea75";
          for (var ffi = 0; ffi < 6; ffi++) {
            var ffa = t * 12 + ffi * 1.25;
            var ffx = bx + Math.sin(ffa) * 12;
            var ffy = cy + 12 - ((t * 26 + ffi * 7) % 28);
            ctx.fillStyle = (ffi % 2 === 0) ? "#ffffff" : fColor;
            ctx.globalAlpha = 0.75;
            ctx.fillRect(Math.round(ffx) - 1.5, Math.round(ffy) - 1.5, 3, 3);
          }
        }
      }
    }
    ctx.restore();
  };

  global.VIEW = { View: View, TILE: TILE, variantAt: variantAt, placeAt: placeAt,
                  SWING_STYLE: SWING_STYLE };
})(window);
