/* 화면 — 던전 캔버스 · 상태창 · 인벤토리 · 메시지 로그.
 *
 * 카메라는 플레이어를 중심에 두되 맵 끝에서는 클램프한다(밖의 검은 띠를 안 보이게).
 * 안 보이는 칸은 "한 번 봤으면 어둡게, 아니면 안 그림" 이다 — 이 기억이 있어야
 * 지도를 머릿속에 그릴 수 있다.
 */
(function (global) {
  "use strict";

  var D = global.DUNGEON;
  var S = global.SPRITES;

  /* ⚠ 한 칸 32px = 스프라이트 32px 그대로다(확대 없음).
   *   16×16 을 2배로 늘려 쓰던 때보다 픽셀이 4배라 얼굴·장식이 들어간다.
   *   24px 로 뒀던 시절엔 맵이 화면에 거의 다 들어와 카메라가 따라다니지 못했다. */
  var TILE = 32;

  /* 바닥·벽은 한 장만 깔면 같은 무늬가 격자로 반복돼 눈에 걸린다.
   * 좌표로 변종을 골라 쓴다 — 난수로 고르면 매 프레임 무늬가 바뀐다. */
  function variantAt(x, y, n) {
    var h = (x * 73856093) ^ (y * 19349663);
    return ((h >>> 0) % n);
  }

  /* 미식별 물약은 겉모습 색이 곧 정보다 — 색마다 한 번 구워 둔다.
   * ⚠ 색칠을 메인 캔버스에 `source-atop` 으로 하면 안 된다. 그 합성은 "이미 그려진
   *   곳" 전체에 걸리는데 배경을 불투명하게 칠해 둔 상태라 바닥까지 물든다. */
  var potionCache = {};
  function tintedPotion(color) {
    if (potionCache[color]) return potionCache[color];
    var base = S.bake("potion");
    var c = document.createElement("canvas");
    c.width = base.width; c.height = base.height;
    var x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    x.drawImage(base, 0, 0);
    x.globalCompositeOperation = "source-atop";
    x.globalAlpha = 0.72;
    x.fillStyle = color;
    x.beginPath();
    x.arc(16, 21, 6, 0, Math.PI * 2);      /* 액체 부분만 */
    x.fill();
    potionCache[color] = c;
    return c;
  }

  function Renderer(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;   /* 도트가 뭉개지면 도트가 아니다 */
    this.game = game;
    this.shake = 0;
    this.flash = 0;
    this.cam = { x: 0, y: 0 };
  }

  Renderer.prototype.resize = function () {
    var box = this.canvas.parentNode.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(320, Math.floor(box.width));
    var h = Math.max(240, Math.floor(box.height));
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.viewW = w;
    this.viewH = h;
    this.colsShown = Math.ceil(w / TILE) + 1;
    this.rowsShown = Math.ceil(h / TILE) + 1;
    this._vig = null;
  };

  Renderer.prototype.updateCamera = function () {
    var g = this.game, lv = g.level;
    var px = g.player.x * TILE + TILE / 2;
    var py = g.player.y * TILE + TILE / 2;
    var maxX = lv.w * TILE - this.viewW;
    var maxY = lv.h * TILE - this.viewH;
    var cx = px - this.viewW / 2, cy = py - this.viewH / 2;
    this.cam.x = maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, cx));
    this.cam.y = maxY <= 0 ? maxY / 2 : Math.max(0, Math.min(maxY, cy));
  };

  Renderer.prototype.hit = function () { this.shake = 6; };
  Renderer.prototype.hurt = function () { this.shake = 10; this.flash = 0.45; };

  Renderer.prototype.draw = function () {
    var g = this.game, lv = g.level, ctx = this.ctx;
    this.updateCamera();

    var ox = -this.cam.x, oy = -this.cam.y;
    if (this.shake > 0) {
      ox += (Math.random() - 0.5) * this.shake;
      oy += (Math.random() - 0.5) * this.shake;
      this.shake *= 0.78;
      if (this.shake < 0.4) this.shake = 0;
    }
    ox = Math.round(ox); oy = Math.round(oy);

    ctx.fillStyle = "#08070b";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    var x0 = Math.max(0, Math.floor(this.cam.x / TILE));
    var y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    var x1 = Math.min(lv.w - 1, x0 + this.colsShown);
    var y1 = Math.min(lv.h - 1, y0 + this.rowsShown);

    var x, y, id, t, sx, sy;

    /* 1) 지형. 문·계단은 바닥을 먼저 깔고 그 위에 올린다 —
     *    안 그러면 문 틈으로 검은 구멍이 보인다. */
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = lv.idx(x, y);
        if (!lv.seen[id]) continue;
        t = lv.tiles[id];
        sx = x * TILE + ox;
        sy = y * TILE + oy;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.30;   /* 기억은 어둡게 */
        if (t === D.WALL) {
          ctx.drawImage(S.terrain("wall", variantAt(x, y, S.WALL_VARIANTS)), sx, sy);
        } else {
          ctx.drawImage(S.terrain("floor", variantAt(x, y, S.FLOOR_VARIANTS)), sx, sy);
          if (t === D.DOOR) ctx.drawImage(S.bake("door"), sx, sy);
          else if (t === D.STAIRS) ctx.drawImage(S.bake("stairs"), sx, sy);
        }
      }
    }
    ctx.globalAlpha = 1;

    /* 1-b) 드러난 함정. 숨은 함정(1)은 그리지 않는다 — 그리면 함정이 아니다. */
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = lv.idx(x, y);
        if (lv.traps[id] !== 2 || !lv.seen[id]) continue;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.30;
        ctx.drawImage(S.bake("trap"), x * TILE + ox, y * TILE + oy);
      }
    }
    ctx.globalAlpha = 1;

    /* 2) 아이템 — 보이는 칸에만. 기억에 남기면 이미 주운 물건이 유령으로 남는다. */
    for (var i = 0; i < g.items.length; i++) {
      var it = g.items[i];
      if (!lv.visible[lv.idx(it.x, it.y)]) continue;
      var ix = it.x * TILE + ox, iy = it.y * TILE + oy;
      var tint = g.itemColor ? g.itemColor(it) : null;
      ctx.drawImage(tint ? tintedPotion(tint) : S.bake(it.sprite), ix, iy);
    }

    /* 3) 몬스터 + 체력 띠 */
    for (var m = 0; m < g.monsters.length; m++) {
      var mo = g.monsters[m];
      if (!lv.visible[lv.idx(mo.x, mo.y)]) continue;
      sx = mo.x * TILE + ox;
      sy = mo.y * TILE + oy;
      ctx.drawImage(S.bake(mo.sprite), sx, sy);
      if (mo.hp < mo.maxhp) {
        var frac = Math.max(0, mo.hp / mo.maxhp);
        ctx.fillStyle = "rgba(0,0,0,.72)";
        ctx.fillRect(sx + 3, sy - 5, TILE - 6, 4);
        ctx.fillStyle = frac > 0.5 ? "#6ec06e" : frac > 0.25 ? "#e0b84a" : "#e05a5a";
        ctx.fillRect(sx + 4, sy - 4, Math.round((TILE - 8) * frac), 2);
      }
    }

    /* 4) 플레이어. 바닥에 옅은 빛을 깔아 준다 —
     *    도트 타일이 깔린 화면에서 내가 어디 있는지 한눈에 못 찾으면 그것만으로 못 논다. */
    var pxp = g.player.x * TILE + ox, pyp = g.player.y * TILE + oy;
    var glow = ctx.createRadialGradient(
      pxp + TILE / 2, pyp + TILE / 2, 2,
      pxp + TILE / 2, pyp + TILE / 2, TILE * 1.3);
    glow.addColorStop(0, "rgba(255, 226, 150, .20)");
    glow.addColorStop(1, "rgba(255, 226, 150, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(pxp - TILE, pyp - TILE, TILE * 3, TILE * 3);
    ctx.drawImage(S.bake(g.player.sprite || "warrior"), pxp, pyp);

    /* 5) 가장자리를 어둡게 — 탐험 안 된 검은 여백이 '고장' 이 아니라 '깊이' 로 읽힌다. */
    if (!this._vig) {
      var vg = ctx.createRadialGradient(
        this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.34,
        this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.72);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,.55)");
      this._vig = vg;
    }
    ctx.fillStyle = this._vig;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    /* 6) 맞았을 때 붉은 막 */
    if (this.flash > 0.01) {
      ctx.fillStyle = "rgba(180,30,30," + this.flash.toFixed(3) + ")";
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      this.flash *= 0.82;
    }

    this.drawDepthBadge();
  };

  /* 층 표시 — 예전엔 검은 사각형에 글자였다. 깊이가 한눈에 읽히도록
   * 칸을 10개 찍어 현재 층을 채운다(장부의 눈금처럼). */
  Renderer.prototype.drawDepthBadge = function () {
    var g = this.game, ctx = this.ctx;
    var max = global.DATA.MAX_DEPTH;
    var w = 14 + max * 9, h = 40, x = 12, y = 12;

    ctx.fillStyle = "rgba(10,9,14,.82)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(201,162,39,.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    ctx.font = "600 11px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#8b8477";
    ctx.fillText("심연", x + 8, y + 15);
    ctx.font = "700 12px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#c9a227";
    ctx.fillText(g.depth + " / " + max + "층", x + 38, y + 15);

    /* 눈금 — 지나온 층은 채우고, 마지막 층은 붉게(군주가 있다) */
    for (var i = 1; i <= max; i++) {
      var bx = x + 7 + (i - 1) * 9, by = y + 22, bw = 7, bh = 10;
      if (i <= g.depth) ctx.fillStyle = (i === max) ? "#c0453f" : "#c9a227";
      else ctx.fillStyle = (i === max) ? "rgba(192,69,63,.28)" : "rgba(139,132,119,.28)";
      ctx.fillRect(bx, by, bw, bh);
    }
  };

  /* ── 사이드바 ───────────────────────────────────────── */

  function bar(cur, max, cls, label) {
    var pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    return '<div class="meter ' + cls + '">' +
             '<i style="width:' + pct.toFixed(1) + '%"></i>' +
             '<u>' + label + "</u>" +
             '<b>' + cur + '<s>/' + max + "</s></b>" +
           "</div>";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  Renderer.prototype.drawStats = function (el) {
    var g = this.game, p = g.player, c = g.cls;
    var t = global.DATA.XP_TABLE;
    var need = p.level < t.length ? t[p.level] : p.xp;
    var prev = t[p.level - 1] || 0;
    var ab = c.ability;
    var ready = p.cooldown <= 0;
    var cdPct = ready ? 100 : Math.round((1 - p.cooldown / ab.cd) * 100);

    var html = "";

    /* 머리 — 초상화 + 이름. 누구로 내려왔는지가 제일 위에 있어야 한다. */
    html += '<div class="who">' +
      '<canvas class="who-art" width="32" height="32" data-sprite="' + esc(p.sprite) + '"></canvas>' +
      '<div class="who-txt">' +
        '<b>' + esc(c.title || c.name) + "</b>" +
        '<em>' + esc(c.name) + ' · Lv.' + p.level + "</em>" +
      "</div>" +
      "</div>";

    html += bar(p.hp, p.maxhp, "hp", "체력");
    html += bar(Math.max(0, p.xp - prev), Math.max(1, need - prev), "xp", "경험");

    /* 능력 — 쿨다운이 게이지로 차오른다. 숫자만으로는 "얼마나 남았나" 가 안 읽힌다. */
    html += '<button class="ability' + (ready ? " ready" : "") + '" id="abilityBtn"' +
      (ready ? "" : " disabled") + ' title="' + esc(ab.desc) + '">' +
      '<i style="width:' + cdPct + '%"></i>' +
      '<span class="k">Q</span>' +
      '<span class="n">' + esc(ab.name) + "</span>" +
      '<span class="cd">' + (ready ? "준비됨" : p.cooldown + "턴") + "</span>" +
      "</button>";

    /* 능력치 — 아이콘 대신 굵은 숫자. 네 칸이 같은 무게로 보이게. */
    html += '<div class="stat-grid">' +
      '<div><em>공격</em><b>' + g.power() + "</b></div>" +
      '<div><em>방어</em><b>' + g.guard() + "</b></div>" +
      '<div><em>금화</em><b>' + g.gold.toLocaleString() + "</b></div>" +
      '<div><em>처치</em><b>' + g.kills + "</b></div>" +
      "</div>";

    html += '<div class="equip">' +
      '<div><em>무기</em><b>' + (p.weapon ? esc(p.weapon.name) + ' <s>+' + p.weapon.power + "</s>" : "맨손") + "</b></div>" +
      '<div><em>갑옷</em><b>' + (p.armor ? esc(p.armor.name) + ' <s>+' + p.armor.power + "</s>" : "없음") + "</b></div>" +
      "</div>";

    el.innerHTML = html;

    /* 초상화에 실제 도트를 넣는다 — 글자만 있으면 누구인지 안 와닿는다 */
    var art = el.querySelector(".who-art");
    if (art) {
      var x = art.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.drawImage(S.bake(art.getAttribute("data-sprite")), 0, 0);
    }
  };

  Renderer.prototype.drawInventory = function (el) {
    var g = this.game, p = g.player;
    if (!p.inventory.length) {
      el.innerHTML = '<div class="empty">가방이 비어 있다.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < p.inventory.length; i++) {
      var it = p.inventory[i];
      var worn = (it === p.weapon || it === p.armor);
      /* 미식별 물약은 겉모습 이름으로 부르고 그 색 점을 찍는다 —
       * 이름만으로는 화면의 병과 가방 속 병을 짝지을 수 없다. */
      var nm = g.itemName(it), ds = g.itemDesc(it), col = g.itemColor(it);
      var unknown = (it.kind === "potion" && !g.identified[it.id]);
      html += '<button class="inv-item' + (worn ? " worn" : "") + (unknown ? " unknown" : "") +
        '" data-idx="' + i + '" title="' + esc(ds || "") + ' (우클릭: 버리기)">' +
        '<span class="key">' + (i + 1 <= 9 ? (i + 1) : "·") + "</span>" +
        '<span class="nm">' +
        (col ? '<i class="dot" style="background:' + esc(col) + '"></i>' : "") +
        esc(nm) + (worn ? " <i>착용중</i>" : "") + "</span>" +
        '<span class="ds">' + esc(ds || "") + "</span>" +
        "</button>";
    }
    el.innerHTML = html;
  };

  Renderer.prototype.drawLog = function (el) {
    var log = this.game.log;
    var start = Math.max(0, log.length - 60);
    var html = "";
    for (var i = start; i < log.length; i++) {
      html += '<p class="m ' + log[i].tone + '">' + esc(log[i].text) + "</p>";
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  };

  global.Renderer = Renderer;
  global.TILE = TILE;
})(window);
