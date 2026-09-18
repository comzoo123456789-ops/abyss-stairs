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
  /* "#e0742a" + 투명도 → rgba(). 등급 빛에 쓴다 */
  function hexA(hex, a) {
    if (!hex) return "rgba(255,255,255," + a + ")";
    var h = hex.replace("#", "");
    var n2 = parseInt(h.length === 3 ? h.replace(/./g, "  var potionCache = {};  var potionCache = {};") : h, 16);
    return "rgba(" + ((n2 >> 16) & 255) + "," + ((n2 >> 8) & 255) + "," + (n2 & 255) + "," + a + ")";
  }

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

  /* ── 부드러운 이동 ─────────────────────────────────────
   *
   * 규칙은 한 칸씩 즉시 움직인다(턴제니까). 화면만 그 뒤를 따라간다.
   *
   * ⚠ 이 분리가 핵심이다. 애니메이션이 끝날 때까지 규칙을 붙잡으면 연타가 밀려
   *   "눌렀는데 안 움직인다" 가 된다. 논리 좌표는 즉시 바뀌고, 렌더러는 그 좌표를
   *   보고 "지금 보이는 자리" 를 쫓아가게 한다 — 그래서 규칙 코드를 한 줄도
   *   안 고치고 붙을 수 있다(검사도 그대로 돈다).
   * ⚠ 한 칸을 넘는 이동(순간이동·층 이동)은 보간하지 않는다. 지도 절반을 미끄러져
   *   가면 무엇이 일어났는지 알 수 없다 — 그냥 순간이동으로 보여 준다. */
  var STEP_MS = 115;          /* 한 칸 걷는 시간. 더 길면 연타가 답답하다 */
  var LUNGE_MS = 130;         /* 공격 찌르기 */

  function makeVis(e) {
    return { vx: e.x, vy: e.y, sx: e.x, sy: e.y, tx: e.x, ty: e.y, t: 1, stride: 1 };
  }

  /* 한 개체의 보이는 자리를 목표로 한 걸음 옮긴다. 아직 움직이는 중이면 true */
  function stepVis(v, e, dt) {
    if (v.tx !== e.x || v.ty !== e.y) {
      var far = Math.abs(e.x - v.tx) + Math.abs(e.y - v.ty) > 1;
      v.sx = far ? e.x : v.vx;
      v.sy = far ? e.y : v.vy;
      v.tx = e.x; v.ty = e.y;
      v.t = far ? 1 : 0;
      v.stride = v.stride === 1 ? 2 : 1;      /* 걸음마다 발을 바꾼다 */
      if (far) { v.vx = e.x; v.vy = e.y; }
    }
    if (v.t >= 1) { v.vx = v.tx; v.vy = v.ty; return false; }
    v.t = Math.min(1, v.t + dt / STEP_MS);
    var p = v.t * v.t * (3 - 2 * v.t);        /* smoothstep — 시작·끝이 부드럽다 */
    v.vx = v.sx + (v.tx - v.sx) * p;
    v.vy = v.sy + (v.ty - v.sy) * p;
    return v.t < 1;
  }

  /* 걷는 동안 몸이 한 픽셀 들린다 — 다리 프레임만으로는 '걷는다' 가 약하다 */
  function bobOf(v) {
    if (v.t >= 1) return 0;
    return (v.t > 0.15 && v.t < 0.85) ? -1 : 0;
  }
  function frameOf(v) {
    return v.t >= 1 ? 0 : v.stride;
  }

  function Renderer(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;   /* 도트가 뭉개지면 도트가 아니다 */
    this.game = game;
    this.shake = 0;
    this.flash = 0;
    this.cam = { x: 0, y: 0 };
    this.camReady = false;
    /* 개체 → 보이는 자리. WeakMap 이라 몬스터가 죽거나 층이 바뀌면 알아서 사라진다
     * (모델 객체에 화면 값을 심으면 규칙 코드가 화면을 알게 되어 섞인다). */
    this.vis = new WeakMap();
    this.hits = [];            /* 피격 표시 */
    /* 최근 메시지를 화면 위에 띄운다 — 사이드바를 안 봐도 무슨 일이 났는지 안다.
     * ⚠ 사용자 신고: "기록이 실시간으로 안 따라온다". 기록 패널 자리를 고정한 것과
     *   별개로, 전투 중에 눈이 캔버스에 있으므로 그 자리에서도 알려 줘야 한다. */
    this.toasts = [];
    this.logSeen = 0;
    this.lunges = new WeakMap();
    this.last = 0;
  }

  Renderer.prototype.visOf = function (e) {
    var v = this.vis.get(e);
    if (!v) { v = makeVis(e); this.vis.set(e, v); }
    return v;
  };

  /* 새로 늘어난 기록을 토스트로 옮긴다. 규칙은 이것을 모른다(로그만 쌓는다). */
  var TOAST_MS = 3600;
  var TONE_COLOR = {
    "": "#b9b2a4", good: "#7ed07e", bad: "#f07a7a", hit: "#e0d6ad",
    item: "#8fb8d8", warn: "#e0b73a", depth: "#e8c14a", level: "#c79ae8",
    crit: "#ffb347", win: "#ffd75e"
  };
  Renderer.prototype.drainLog = function () {
    var log = this.game.log;
    if (this.logSeen > log.length) this.logSeen = 0;      /* 새 판 — 기록이 비워졌다 */
    for (var i = this.logSeen; i < log.length; i++) {
      this.toasts.push({ text: log[i].text, tone: log[i].tone || "", t: 0 });
    }
    this.logSeen = log.length;
    /* 한 번에 여럿 쏟아지면 오래된 것부터 버린다 — 화면을 덮으면 게임이 안 보인다 */
    while (this.toasts.length > 5) this.toasts.shift();
  };

  /* 규칙이 쌓아 둔 효과 신호를 비워 간다 */
  Renderer.prototype.drainEffects = function () {
    var g = this.game, fx = g.effects;
    if (!fx || !fx.length) return;
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i];
      if (f.type === "lunge") {
        var who = (g.player.x === f.x && g.player.y === f.y) ? g.player : g.monsterAt(f.x, f.y);
        if (who) this.lunges.set(who, { dx: f.dx, dy: f.dy, t: 0 });
      } else if (f.type === "hit" || f.type === "burst") {
        this.hits.push({ x: f.x, y: f.y, t: 0, big: f.type === "burst" });
      }
    }
    fx.length = 0;
  };

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

  /* 카메라는 **보이는** 플레이어 자리를 따라간다 — 논리 좌표를 따라가면
   * 캐릭터가 부드럽게 걷는데 배경만 한 칸씩 툭 튄다. */
  Renderer.prototype.updateCamera = function (pv) {
    var lv = this.game.level;
    var px = pv.vx * TILE + TILE / 2;
    var py = pv.vy * TILE + TILE / 2;
    var maxX = lv.w * TILE - this.viewW;
    var maxY = lv.h * TILE - this.viewH;
    var cx = px - this.viewW / 2, cy = py - this.viewH / 2;
    this.cam.x = maxX <= 0 ? maxX / 2 : Math.max(0, Math.min(maxX, cx));
    this.cam.y = maxY <= 0 ? maxY / 2 : Math.max(0, Math.min(maxY, cy));
    this.camReady = true;
  };

  Renderer.prototype.hit = function () { this.shake = 6; };
  Renderer.prototype.hurt = function () { this.shake = 10; this.flash = 0.45; };

  /* dt(ms)를 받아 한 프레임 그린다. 아직 움직이는 것이 남았으면 true —
   * main.js 가 그걸 보고 다음 프레임을 예약한다(가만히 있을 때는 안 돈다). */
  Renderer.prototype.draw = function (dt) {
    var g = this.game, lv = g.level, ctx = this.ctx;
    dt = (dt === undefined) ? 16 : Math.min(48, dt);   /* 탭을 오래 떠났다 와도 한 번에 안 튀게 */
    var busy = false;
    var i;

    this.drainEffects();
    this.drainLog();
    for (i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].t += dt / TOAST_MS;
      if (this.toasts[i].t >= 1) this.toasts.splice(i, 1);
      else busy = true;
    }

    /* 1) 보이는 자리 갱신 */
    var pv = this.visOf(g.player);
    if (stepVis(pv, g.player, dt)) busy = true;
    for (i = 0; i < g.monsters.length; i++) {
      if (stepVis(this.visOf(g.monsters[i]), g.monsters[i], dt)) busy = true;
    }

    /* 찌르기·피격 타이머 */
    var self = this;
    function tickLunge(e) {
      var l = self.lunges.get(e);
      if (!l) return 0;
      l.t += dt / LUNGE_MS;
      if (l.t >= 1) { self.lunges.delete(e); return 0; }
      busy = true;
      return Math.sin(l.t * Math.PI) * 6;         /* 0 → 6px → 0 */
    }
    for (i = this.hits.length - 1; i >= 0; i--) {
      this.hits[i].t += dt / 220;
      if (this.hits[i].t >= 1) this.hits.splice(i, 1);
      else busy = true;
    }

    this.updateCamera(pv);

    var ox = -this.cam.x, oy = -this.cam.y;
    if (this.shake > 0) {
      ox += (Math.random() - 0.5) * this.shake;
      oy += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.78, dt / 16);       /* 시간 기준으로 줄인다 */
      if (this.shake < 0.4) this.shake = 0; else busy = true;
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
      /* 등급 빛 — 바닥에서도 좋은 물건이 눈에 걸려야 한다(주우러 갈 이유가 생긴다).
       * ⚠ 일반 등급에는 안 깐다. 전부 빛나면 아무 것도 눈에 안 걸린다. */
      if (it.slot && it.rarity && it.rarity !== "common") {
        var rg = ctx.createRadialGradient(ix + TILE / 2, iy + TILE / 2, 2,
                                          ix + TILE / 2, iy + TILE / 2, TILE * 0.95);
        rg.addColorStop(0, hexA(it.color, it.rarity === "relic" ? 0.42 : 0.26));
        rg.addColorStop(1, hexA(it.color, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(ix - TILE / 2, iy - TILE / 2, TILE * 2, TILE * 2);
      }
      var tint = g.itemColor ? g.itemColor(it) : null;
      ctx.drawImage(tint ? tintedPotion(tint) : S.bake(it.sprite), ix, iy);
    }

    /* 2-b) 상인 — 등불을 깔아 멀리서도 눈에 띄게 한다(여기가 금화를 쓰는 자리다) */
    if (g.merchant && lv.visible[lv.idx(g.merchant.x, g.merchant.y)]) {
      var mx2 = g.merchant.x * TILE + ox, my2 = g.merchant.y * TILE + oy;
      var lamp = ctx.createRadialGradient(mx2 + TILE / 2, my2 + TILE / 2, 2,
                                          mx2 + TILE / 2, my2 + TILE / 2, TILE * 1.6);
      lamp.addColorStop(0, "rgba(255, 196, 90, .26)");
      lamp.addColorStop(1, "rgba(255, 196, 90, 0)");
      ctx.fillStyle = lamp;
      ctx.fillRect(mx2 - TILE, my2 - TILE, TILE * 3, TILE * 3);
      ctx.drawImage(S.bake("merchant"), mx2, my2);
    }

    /* 3) 몬스터 + 체력 띠. 보이는 자리(보간)로 그린다 */
    for (var m = 0; m < g.monsters.length; m++) {
      var mo = g.monsters[m];
      if (!lv.visible[lv.idx(mo.x, mo.y)]) continue;
      var mv = this.visOf(mo);
      var ml = tickLunge(mo);
      sx = Math.round(mv.vx * TILE + ox + (this.lunges.get(mo) ? this.lunges.get(mo).dx * ml : 0));
      sy = Math.round(mv.vy * TILE + oy + bobOf(mv) +
                      (this.lunges.get(mo) ? this.lunges.get(mo).dy * ml : 0));
      ctx.drawImage(S.bake(mo.sprite, S.hasFrames(mo.sprite) ? frameOf(mv) : 0), sx, sy);
      if (mo.hp < mo.maxhp) {
        var frac = Math.max(0, mo.hp / mo.maxhp);
        ctx.fillStyle = "rgba(0,0,0,.72)";
        ctx.fillRect(sx + 3, sy - 5, TILE - 6, 4);
        ctx.fillStyle = frac > 0.5 ? "#6ec06e" : frac > 0.25 ? "#e0b84a" : "#e05a5a";
        ctx.fillRect(sx + 4, sy - 4, Math.round((TILE - 8) * frac), 2);
      }
      /* 엘리트 — 이름만으로는 화면에서 못 가린다. 머리 위에 표식을 둔다 */
      if (mo.elite) {
        ctx.fillStyle = "#e0742a";
        ctx.fillRect(sx + TILE / 2 - 4, sy - 10, 8, 3);
        ctx.fillRect(sx + TILE / 2 - 1, sy - 12, 2, 2);
      }
      /* 걸린 상태이상 — 색 점. "독이 일하고 있다" 가 보여야 빌드가 재미있다 */
      var adx = 0;
      for (var ak in mo.ail) {
        var adef = global.DATA.AILMENTS[ak];
        if (!adef || !mo.ail[ak] || mo.ail[ak].turns <= 0) continue;
        ctx.fillStyle = adef.color;
        ctx.fillRect(sx + 3 + adx * 5, sy + TILE - 2, 3, 3);
        adx++;
      }
    }

    /* 4) 플레이어. 바닥에 옅은 빛을 깔아 준다 —
     *    도트 타일이 깔린 화면에서 내가 어디 있는지 한눈에 못 찾으면 그것만으로 못 논다. */
    var pl = this.lunges.get(g.player);
    var plAmt = tickLunge(g.player);
    var pxp = Math.round(pv.vx * TILE + ox + (pl ? pl.dx * plAmt : 0));
    var pyp = Math.round(pv.vy * TILE + oy + bobOf(pv) + (pl ? pl.dy * plAmt : 0));
    var glow = ctx.createRadialGradient(
      pxp + TILE / 2, pyp + TILE / 2, 2,
      pxp + TILE / 2, pyp + TILE / 2, TILE * 1.3);
    glow.addColorStop(0, "rgba(255, 226, 150, .20)");
    glow.addColorStop(1, "rgba(255, 226, 150, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(pxp - TILE, pyp - TILE, TILE * 3, TILE * 3);
    ctx.drawImage(S.bake(g.player.sprite || "warrior", frameOf(pv)), pxp, pyp);

    /* 4-b) 피격 표시 — 맞은 자리에 짧게 튀는 빛. 로그를 안 봐도 뭔가 맞았음을 안다 */
    for (i = 0; i < this.hits.length; i++) {
      var h = this.hits[i];
      var hx = h.x * TILE + ox + TILE / 2, hy = h.y * TILE + oy + TILE / 2;
      var r = (h.big ? 26 : 12) * (0.4 + h.t * 0.9);
      ctx.globalAlpha = Math.max(0, 1 - h.t) * (h.big ? 0.5 : 0.65);
      ctx.strokeStyle = h.big ? "#f0913a" : "#fff0c0";
      ctx.lineWidth = h.big ? 3 : 2;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

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
      this.flash *= Math.pow(0.82, dt / 16);
      busy = true;
    }

    this.drawDepthBadge();
    this.drawToasts();
    return busy;
  };

  /* 최근 메시지 — 캔버스 아래쪽에 쌓아 올리고 서서히 사라진다.
   * 아래가 최신이다(기록 패널과 같은 순서라 헷갈리지 않는다). */
  Renderer.prototype.drawToasts = function () {
    if (!this.toasts.length) return;
    var ctx = this.ctx;
    var lh = 20, pad = 9;
    var bottom = this.viewH - 12;
    ctx.font = "600 12.5px " + (global.TOAST_FONT || '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif');
    ctx.textBaseline = "middle";
    for (var i = 0; i < this.toasts.length; i++) {
      var m = this.toasts[i];
      /* 마지막 25% 구간에서만 사라진다 — 바로 흐려지면 읽을 시간이 없다 */
      var a = m.t < 0.75 ? 1 : Math.max(0, 1 - (m.t - 0.75) / 0.25);
      var y = bottom - (this.toasts.length - 1 - i) * lh;
      var w = ctx.measureText(m.text).width + pad * 2;
      ctx.globalAlpha = a * 0.78;
      ctx.fillStyle = "#0b0a0f";
      ctx.fillRect(14, y - lh / 2 + 1, w, lh - 2);
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = TONE_COLOR[m.tone] || TONE_COLOR[""];
      ctx.fillRect(14, y - lh / 2 + 1, 2, lh - 2);          /* 색 띠로 종류를 표시 */
      ctx.globalAlpha = a;
      ctx.fillStyle = TONE_COLOR[m.tone] || TONE_COLOR[""];
      ctx.fillText(m.text, 14 + pad, y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
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
  /* ── 사이드바 ─────────────────────────────────────────
   *
   * 정보 위계(Brogue·Slay the Spire 에서 배운 것):
   *   ① 지금 위험한가 — 체력·상태이상
   *   ② 지금 쓸 수 있는 것 — 스킬 쿨다운
   *   ③ 내가 무엇이 됐나 — 쌓인 옵션(빌드)
   *   ④ 가진 것 — 가방
   * ⚠ 수치를 숨기지 않는다. "치명타 34%" 라고 적어 줘야 다음 선택을 계산할 수 있다. */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function meter(cur, max, cls, label) {
    var pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    return '<div class="meter ' + cls + '">' +
             '<i style="width:' + pct.toFixed(1) + '%"></i>' +
             '<u>' + label + "</u>" +
             '<b>' + cur + '<s>/' + max + "</s></b>" +
           "</div>";
  }

  function pct(v) { return Math.round(v * 100) + "%"; }

  /* 상단 상태줄 — 체력 · 경험 · 층 · 금화 · 상태이상.
   *
   * ⚠ 화면이 아무리 좁아도 이 줄은 안 사라진다. 죽기 직전인 것을 모르고 한 칸
   *   더 걷는 일이 없어야 한다. 방벽(ward)은 줄을 늘리지 않고 체력 칸에 "+N" 으로
   *   붙인다 — 한 줄을 더 쓰면 좁은 화면에서 캔버스가 그만큼 줄어든다. */
  Renderer.prototype.drawHud = function (el) {
    var g = this.game, p = g.player, c = g.cls;
    var DATA = global.DATA;
    var t = DATA.XP_TABLE;
    var need = p.level < t.length ? t[p.level] : p.xp;
    var prev = t[p.level - 1] || 0;
    var mx = g.maxhp();

    var hpLabel = "체력" + (p.ward > 0 ? " +" + p.ward : "");
    var ails = [];
    for (var k in p.ail) {
      var a = DATA.AILMENTS[k];
      if (a) ails.push('<span style="border-color:' + a.color + ';color:' + a.color + '">' +
                       a.name + p.ail[k].turns + "</span>");
    }

    el.innerHTML =
      '<div class="hud-who">' +
        '<canvas class="hud-art" width="32" height="32" data-sprite="' + esc(p.sprite) + '"></canvas>' +
        '<div class="hud-name"><b>' + esc(c.name) + "</b><em>" + esc(c.title) + "</em></div>" +
      "</div>" +
      '<div class="hud-bars">' +
        meter(p.hp, mx, "hp", hpLabel) +
        meter(Math.max(0, p.xp - prev), Math.max(1, need - prev), "xp", "경험") +
      "</div>" +
      (ails.length ? '<div class="hud-ail">' + ails.join("") + "</div>" : "") +
      '<div class="hud-num">' +
        '<span><em>Lv</em><b>' + p.level + "</b></span>" +
        '<span class="d"><b>' + g.depth + "</b>층</span>" +
        '<span class="g"><b>' + g.gold.toLocaleString() + "</b>금</span>" +
      "</div>";

    var art = el.querySelector(".hud-art");
    if (art) {
      var x = art.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, 32, 32);
      x.drawImage(S.bake(art.getAttribute("data-sprite")), 0, 0);
    }
  };

  Renderer.prototype.drawStats = function (el) {
    var g = this.game, p = g.player, c = g.cls;
    var DATA = global.DATA;
    var t = DATA.XP_TABLE;
    var need = p.level < t.length ? t[p.level] : p.xp;
    var prev = t[p.level - 1] || 0;
    var st = g.stats();
    var mx = g.maxhp();

    var html = "";

    /* 누구인가 */
    html += '<div class="who">' +
      '<canvas class="who-art" width="32" height="32" data-sprite="' + esc(p.sprite) + '"></canvas>' +
      '<div class="who-txt">' +
        '<b>' + esc(c.title) + "</b>" +
        '<em>' + esc(c.name) + " · Lv." + p.level + "</em>" +
      "</div>" +
      '<span class="who-gold">' + g.gold.toLocaleString() + "<i>금</i></span>" +
      "</div>";

    /* ⚠ 체력·경험 막대는 여기 없다 — **상단 상태줄(drawHud)** 로 옮겼다.
     *   휴대폰에서 사이드바를 스크롤해야 체력이 보이던 것이 문제였다.
     *   같은 값을 두 군데서 그리면 한쪽만 고쳐져 어긋나므로 한쪽만 둔다. */

    /* 상태이상 — 지금 나를 갉아먹는 것이 제일 위에 보여야 한다 */
    var ails = [];
    for (var k in p.ail) {
      var a = DATA.AILMENTS[k];
      if (a) ails.push('<span class="ail" style="border-color:' + a.color + ';color:' + a.color + '">' +
                       a.name + " " + p.ail[k].turns + "턴</span>");
    }
    if (ails.length) html += '<div class="ails">' + ails.join("") + "</div>";

    /* 스킬 — 쿨다운이 게이지로 차오른다. 키는 Q W E R */
    var keys = ["Q", "W", "E", "R"];
    html += '<div class="skills">';
    for (var i = 0; i < DATA.SKILL_SLOTS; i++) {
      var s = p.skills[i];
      if (!s) {
        html += '<div class="skill empty"><span class="k">' + keys[i] + "</span>" +
                '<span class="n">빈 자리</span></div>';
        continue;
      }
      var def = DATA.byId(DATA.SKILLS, s.id);
      var cd = g.skillCd(s);
      var ready = s.cd <= 0;
      var fill = ready ? 100 : Math.round((1 - s.cd / Math.max(1, cd)) * 100);
      html += '<button class="skill' + (ready ? " ready" : "") + '" data-skill="' + i + '"' +
        (ready ? "" : " disabled") + ' title="' + esc(def.desc) + '">' +
        '<i style="width:' + fill + '%"></i>' +
        '<span class="k">' + keys[i] + "</span>" +
        '<span class="n">' + esc(def.name) + '<em>' + s.rank + "단</em></span>" +
        '<span class="cd">' + (ready ? "준비" : s.cd + "턴") + "</span>" +
        "</button>";
    }
    html += "</div>";

    /* 핵심 수치 */
    html += '<div class="stat-grid">' +
      '<div><em>공격</em><b>' + g.power() + "</b></div>" +
      '<div><em>방어</em><b>' + g.guard() + "</b></div>" +
      '<div><em>치명</em><b>' + pct(st.crit) + '<s>×' + st.critMult.toFixed(1) + "</s></b></div>" +
      '<div><em>상태이상</em><b>' + pct(st.ailChance) + "</b></div>" +
      "</div>";

    /* 쌓인 옵션 — 이게 "내 빌드" 다. 0 인 것은 안 보여 준다(줄만 늘어난다) */
    var extra = [];
    function add(label, v, unit) {
      if (!v) return;
      extra.push('<span><em>' + label + "</em><b>" +
        (unit === "%" ? "+" + Math.round(v * 100) + "%" : (unit === "턴" ? "−" + Math.round(v) + "턴" : "+" + Math.round(v))) +
        "</b></span>");
    }
    add("스킬 피해", st.skillPower, "%");
    add("상태이상 피해", st.ailPower, "%");
    add("쿨다운", st.cdReduce, "턴");
    add("생명 흡수", st.lifesteal, "%");
    add("물약 효과", st.potionBoost, "%");
    add("금화 획득", st.goldBoost, "%");
    if (extra.length) html += '<div class="build">' + extra.join("") + "</div>";

    /* 장비 — 등급 색으로 한눈에 */
    html += '<div class="equip">';
    var slots = [["weapon", "무기"], ["armor", "갑옷"], ["offhand", "보조"]];
    for (var q = 0; q < slots.length; q++) {
      var it = p[slots[q][0]];
      html += "<div><em>" + slots[q][1] + "</em>" +
        (it ? '<b style="color:' + esc(it.color) + '">' + esc(it.name) +
              "<s>+" + it.power + "</s></b>"
            : "<b>없음</b>") + "</div>";
    }
    html += "</div>";

    el.innerHTML = html;

    var art = el.querySelector(".who-art");
    if (art) {
      var x = art.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.drawImage(S.bake(art.getAttribute("data-sprite")), 0, 0);
    }
  };

  /* 가방 — 등급 색 + 옵션 줄. 아이템을 고르는 것이 빌드이므로 옵션이 보여야 한다. */
  Renderer.prototype.drawInventory = function (el) {
    var g = this.game, p = g.player;
    if (!p.inventory.length) {
      el.innerHTML = '<div class="empty">가방이 비어 있다.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < p.inventory.length; i++) {
      var it = p.inventory[i];
      var worn = it.slot && p[it.slot] === it;
      var nm = g.itemName(it);
      var col = g.itemColor(it) || it.color || null;
      var unknown = (it.kind === "potion" && !g.identified[it.id]);
      var lines = g.itemLines(it);
      html += '<button class="inv-item' + (worn ? " worn" : "") + (unknown ? " unknown" : "") +
        '" data-idx="' + i + '" title="우클릭: 버리기">' +
        '<span class="key">' + (i + 1 <= 9 ? (i + 1) : "·") + "</span>" +
        '<span class="nm"' + (col ? ' style="color:' + esc(col) + '"' : "") + ">" +
        (it.kind === "potion" ? '<i class="dot" style="background:' + esc(col || "#888") + '"></i>' : "") +
        esc(nm) + (worn ? " <i>착용</i>" : "") + "</span>" +
        '<span class="ds">' + lines.map(esc).join(" · ") + "</span>" +
        "</button>";
    }
    el.innerHTML = html;
  };

  Renderer.prototype.drawLog = function (el) {
    var log = this.game.log;
    var start = Math.max(0, log.length - 70);
    var html = "";
    for (var i = start; i < log.length; i++) {
      html += '<p class="m ' + log[i].tone + '">' + esc(log[i].text) + "</p>";
    }
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  };

  /* ── 레벨업 선택 ─────────────────────────────────────
   * 항상 3개를 나란히 보여 준다(Hades 방식). 무엇을 포기하는지가 보여야 선택이 된다. */
  Renderer.prototype.drawPerks = function (el) {
    var g = this.game, DATA = global.DATA;
    if (!g.pendingPerks) return;
    var html = "";
    for (var i = 0; i < g.pendingPerks.length; i++) {
      var c = g.pendingPerks[i];
      var kind, title, note, tag;
      if (c.what === "perk") {
        kind = "stat"; title = c.perk.label; note = c.perk.note; tag = "능력치";
      } else {
        var def = DATA.byId(DATA.SKILLS, c.skill);
        if (c.what === "skillnew") { kind = "new"; title = def.name; note = def.desc; tag = "새 스킬"; }
        else { kind = "up"; title = def.name + " → " + c.rank + "단"; note = def.desc; tag = "스킬 강화"; }
      }
      html += '<button class="perk ' + kind + '" data-perk="' + i + '">' +
        '<span class="perk-key">' + (i + 1) + "</span>" +
        '<span class="perk-tag">' + tag + "</span>" +
        '<span class="perk-title">' + esc(title) + "</span>" +
        '<span class="perk-note">' + esc(note) + "</span>" +
        "</button>";
    }
    el.innerHTML = html;
  };

  /* ── 상점 ────────────────────────────────────────────
   * 왼쪽에 파는 물건, 오른쪽에 내 가방(팔 수 있다). 금화가 힘이 되는 자리다. */
  Renderer.prototype.drawShop = function (elBuy, elSell, elGold) {
    var g = this.game, DATA = global.DATA;
    if (!g.shop) return;
    elGold.textContent = g.gold.toLocaleString();

    var html = "", i;
    for (i = 0; i < g.shop.length; i++) {
      var row = g.shop[i];
      var can = !row.sold && g.gold >= row.cost;
      var name, lines, col;
      if (row.what === "skill") {
        var def = DATA.byId(DATA.SKILLS, row.skill);
        name = def.name + " " + row.rank + "단";
        lines = [def.desc];
        col = "#8ae8f0";
      } else {
        name = g.itemName(row.item);
        lines = g.itemLines(row.item);
        col = row.item.color || g.itemColor(row.item) || null;
      }
      html += '<button class="shop-row' + (row.sold ? " sold" : (can ? "" : " poor")) +
        '" data-buy="' + i + '"' + (row.sold || !can ? " disabled" : "") + ">" +
        '<span class="shop-kind">' + (row.what === "skill" ? "스킬" : "물건") + "</span>" +
        '<span class="shop-nm"' + (col ? ' style="color:' + esc(col) + '"' : "") + ">" + esc(name) + "</span>" +
        '<span class="shop-ds">' + lines.map(esc).join(" · ") + "</span>" +
        '<span class="shop-cost">' + (row.sold ? "판매됨" : row.cost + " 금") + "</span>" +
        "</button>";
    }
    elBuy.innerHTML = html || '<div class="empty">물건이 없다.</div>';

    html = "";
    for (i = 0; i < g.player.inventory.length; i++) {
      var it = g.player.inventory[i];
      var price = Math.max(4, Math.round((it.cost || 10) * 0.42));
      var worn = it.slot && g.player[it.slot] === it;
      html += '<button class="shop-row sell" data-sell="' + i + '">' +
        '<span class="shop-kind">' + (worn ? "착용" : "가방") + "</span>" +
        '<span class="shop-nm"' + (it.color ? ' style="color:' + esc(it.color) + '"' : "") + ">" +
        esc(g.itemName(it)) + "</span>" +
        '<span class="shop-ds">' + g.itemLines(it).map(esc).join(" · ") + "</span>" +
        '<span class="shop-cost">+' + price + " 금</span>" +
        "</button>";
    }
    elSell.innerHTML = html || '<div class="empty">팔 것이 없다.</div>';
  };

  global.Renderer = Renderer;
  global.TILE = TILE;
  /* 입력 반복 간격을 여기에 맞춘다 — 어긋나면 걸음이 끊기거나 겹친다 */
  global.STEP_MS = STEP_MS;
})(window);
