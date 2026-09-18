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

  /* ⚠ 한 칸은 32px = 스프라이트 16px × 정수배 2 다.
   *   ① 정수배가 아니면 픽셀이 뭉개져 도트가 도트로 안 보인다.
   *   ② 24px 로 뒀더니 62×38 맵이 1488×912 라 1440 화면에 거의 다 들어와서,
   *      카메라가 움직일 자리가 없고 화면 대부분이 탐험 안 된 검은 여백이었다
   *      (실측: 밝은 픽셀 2.5%). 32px 이면 맵이 1984×1216 이라 카메라가 따라다닌다. */
  var TILE = 32;
  var SCALE = TILE / S.SIZE;

  /* 미식별 물약은 겉모습 색이 곧 정보다 — 색마다 물약 스프라이트를 한 번 구워 둔다.
   * ⚠ 색칠을 메인 캔버스에 `source-atop` 으로 하면 안 된다. 그 합성은 "이미 그려진
   *   곳" 전체에 걸리는데 배경을 불투명하게 칠해 둔 상태라 바닥까지 물든다.
   *   투명한 오프스크린에서 칠해야 병 모양에만 묻는다. */
  var potionCache = {};
  function tintedPotion(color) {
    if (potionCache[color]) return potionCache[color];
    var base = S.bake("potion", SCALE);
    var c = document.createElement("canvas");
    c.width = base.width; c.height = base.height;
    var x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    x.drawImage(base, 0, 0);
    x.globalCompositeOperation = "source-atop";
    x.globalAlpha = 0.62;
    x.fillStyle = color;
    x.fillRect(0, Math.round(base.height * 0.42), base.width, base.height);  /* 병 아랫부분(액체) */
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
  };

  Renderer.prototype.updateCamera = function () {
    var g = this.game, lv = g.level;
    var halfW = this.viewW / 2, halfH = this.viewH / 2;
    var px = g.player.x * TILE + TILE / 2;
    var py = g.player.y * TILE + TILE / 2;
    var maxX = lv.w * TILE - this.viewW;
    var maxY = lv.h * TILE - this.viewH;
    var cx = px - halfW, cy = py - halfH;
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

    ctx.fillStyle = "#0a090d";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    var x0 = Math.max(0, Math.floor(this.cam.x / TILE));
    var y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    var x1 = Math.min(lv.w - 1, x0 + this.colsShown);
    var y1 = Math.min(lv.h - 1, y0 + this.rowsShown);

    var x, y, id, t, spr, sx, sy;

    /* 1) 지형 */
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = lv.idx(x, y);
        if (!lv.seen[id]) continue;
        t = lv.tiles[id];
        spr = t === D.WALL ? "wall" : t === D.DOOR ? "door" : t === D.STAIRS ? "stairs" : "floor";
        sx = x * TILE + ox;
        sy = y * TILE + oy;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.32;   /* 기억은 어둡게 */
        ctx.drawImage(S.bake(spr, SCALE), sx, sy);
      }
    }
    ctx.globalAlpha = 1;

    /* 1-b) 드러난 함정. 숨은 함정(1)은 그리지 않는다 — 그리면 함정이 아니다.
     *      지형 위·아이템 아래에 둔다(물건이 함정 위에 떨어질 수 있다). */
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = lv.idx(x, y);
        if (lv.traps[id] !== 2 || !lv.seen[id]) continue;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.32;
        ctx.drawImage(S.bake("trap", SCALE), x * TILE + ox, y * TILE + oy);
      }
    }
    ctx.globalAlpha = 1;

    /* 2) 아이템 — 보이는 칸에만. 기억에 남기면 이미 주운 물건이 유령으로 남는다.
     *    물약은 미식별이라 겉모습 색이 곧 정보다 — 스프라이트 위에 그 색을 덧씌운다. */
    for (var i = 0; i < g.items.length; i++) {
      var it = g.items[i];
      if (!lv.visible[lv.idx(it.x, it.y)]) continue;
      var ix = it.x * TILE + ox, iy = it.y * TILE + oy;
      var tint = g.itemColor ? g.itemColor(it) : null;
      ctx.drawImage(tint ? tintedPotion(tint) : S.bake(it.sprite, SCALE), ix, iy);
    }

    /* 3) 몬스터 + 체력 띠 */
    for (var m = 0; m < g.monsters.length; m++) {
      var mo = g.monsters[m];
      if (!lv.visible[lv.idx(mo.x, mo.y)]) continue;
      sx = mo.x * TILE + ox;
      sy = mo.y * TILE + oy;
      ctx.drawImage(S.bake(mo.sprite, SCALE), sx, sy);
      if (mo.hp < mo.maxhp) {
        var frac = Math.max(0, mo.hp / mo.maxhp);
        ctx.fillStyle = "rgba(0,0,0,.65)";
        ctx.fillRect(sx + 2, sy - 4, TILE - 4, 3);
        ctx.fillStyle = frac > 0.5 ? "#6ec06e" : frac > 0.25 ? "#e0b84a" : "#e05a5a";
        ctx.fillRect(sx + 2, sy - 4, Math.round((TILE - 4) * frac), 3);
      }
    }

    /* 4) 플레이어. 바닥에 옅은 빛을 깔아 준다 —
     *    도트 타일이 깔린 화면에서 내가 어디 있는지 한눈에 못 찾으면 그것만으로 못 논다. */
    var pxp = g.player.x * TILE + ox, pyp = g.player.y * TILE + oy;
    var glow = ctx.createRadialGradient(
      pxp + TILE / 2, pyp + TILE / 2, 2,
      pxp + TILE / 2, pyp + TILE / 2, TILE * 1.25);
    glow.addColorStop(0, "rgba(255, 226, 150, .22)");
    glow.addColorStop(1, "rgba(255, 226, 150, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(pxp - TILE, pyp - TILE, TILE * 3, TILE * 3);
    ctx.drawImage(S.bake(g.player.sprite || "warrior", SCALE), pxp, pyp);

    /* 5) 가장자리를 어둡게 — 탐험 안 된 검은 여백이 '고장' 이 아니라 '깊이' 로 읽힌다.
     *    한 번만 만들어 두고 다시 쓴다(매 프레임 그라디언트를 만들면 비싸다). */
    if (!this._vig || this._vigW !== this.viewW || this._vigH !== this.viewH) {
      var vg = ctx.createRadialGradient(
        this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.34,
        this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.72);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(0,0,0,.55)");
      this._vig = vg;
      this._vigW = this.viewW;
      this._vigH = this.viewH;
    }
    ctx.fillStyle = this._vig;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    /* 6) 맞았을 때 붉은 막 */
    if (this.flash > 0.01) {
      ctx.fillStyle = "rgba(180,30,30," + this.flash.toFixed(3) + ")";
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      this.flash *= 0.82;
    }

    /* 7) 층 표시 */
    ctx.font = "bold 13px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(8, 8, 96, 24);
    ctx.fillStyle = "#c9b98a";
    ctx.fillText("던전 " + g.depth + "층", 18, 24);
  };

  /* ── 사이드바 ───────────────────────────────────────── */

  function bar(cur, max, cls) {
    var pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    return '<div class="bar ' + cls + '"><i style="width:' + pct.toFixed(1) + '%"></i>' +
           '<b>' + cur + " / " + max + "</b></div>";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  Renderer.prototype.drawStats = function (el) {
    var g = this.game, p = g.player;
    var t = global.DATA.XP_TABLE;
    var need = p.level < t.length ? t[p.level] : p.xp;
    var prev = t[p.level - 1] || 0;

    var ab = g.cls.ability;
    var ready = p.cooldown <= 0;

    var html = "";
    html += '<div class="stat-name">' + esc(p.name) + ' <span class="lv">Lv.' + p.level + "</span></div>";
    html += '<div class="stat-row"><span>체력</span>' + bar(p.hp, p.maxhp, "hp") + "</div>";
    html += '<div class="stat-row"><span>경험</span>' +
            bar(Math.max(0, p.xp - prev), Math.max(1, need - prev), "xp") + "</div>";
    /* 능력이 준비됐는지는 한눈에 보여야 한다 — 매번 Q 를 눌러 확인하게 두면 턴만 버린다 */
    html += '<button class="ability' + (ready ? " ready" : "") + '" id="abilityBtn"' +
            (ready ? "" : " disabled") + ' title="' + esc(ab.desc) + '">' +
            '<span class="k">Q</span><span class="n">' + esc(ab.name) + "</span>" +
            '<span class="cd">' + (ready ? "사용 가능" : p.cooldown + "턴 남음") + "</span></button>";
    html += '<div class="stat-grid">' +
      '<div><em>공격</em><b>' + g.power() + "</b></div>" +
      '<div><em>방어</em><b>' + g.guard() + "</b></div>" +
      '<div><em>금화</em><b>' + g.gold + "</b></div>" +
      '<div><em>처치</em><b>' + g.kills + "</b></div>" +
      "</div>";
    html += '<div class="equip">' +
      '<div><em>무기</em><b>' + (p.weapon ? esc(p.weapon.name) + " (+" + p.weapon.power + ")" : "맨손") + "</b></div>" +
      '<div><em>갑옷</em><b>' + (p.armor ? esc(p.armor.name) + " (+" + p.armor.power + ")" : "없음") + "</b></div>" +
      "</div>";
    el.innerHTML = html;
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
        '" data-idx="' + i + '" title="' + esc(ds || "") + '">' +
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
