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

  /* ══ 지도 확대 ═══════════════════════════════════════════
   *
   * 칸은 32px 로 굳어 있었다. 1920 화면에서 62x38 층 가운데 50x30 이
   * 한꺼번에 보였다 — **층의 63%**. 사람은 캔버스 세로의 3.3% 였다.
   * 작아 보이는 원인은 그림 크기가 아니라 **너무 많이 보이는 것**이다.
   *
   * ⚠ **정수배만 쓴다.** 이 저장소의 그림은 전부 코드로 구운 픽셀 아트다.
   *   1.5배로 늘리면 픽셀이 뭉갠다. Cogmind 도 지도 확대를 붙이면서 같은
   *   결론에 닿았다 — 크기로는 1배와 2배 사이가 이상적이지만 정수배라야
   *   픽셀 정확도와 격자 정렬이 산다.
   * ⚠ 58군데의 `TILE` 셈을 건드리지 않는다. 그리기 **직전에 변환 한 번**으로
   *   확대한다. 좌표를 하나하나 곱하면 반드시 어딘가 빠뜨린다.
   *   대신 `viewW/viewH` 는 **세계 좌표**가 된다(화면 px / 확대배).
   */
  /* 벽 밑 그림자의 두께(세계 px). 한 칸(32)의 3분의 1 남짓이다 */
  var AO_H = 10;

  var ZOOM_MIN = 1, ZOOM_MAX = 3;
  /* 확대해도 이만큼은 보여야 한다. 1920 에서 2배면 25x15 로 이 문턱을
   * 넘고, 3배면 16x10 이라 못 넘는다. 1280 에서는 2배가 15x9 라 1배로 남는다. */
  var MIN_COLS = 22, MIN_ROWS = 13;

  function autoZoom(w, h) {
    for (var z = ZOOM_MAX; z > ZOOM_MIN; z--) {
      if (w / (TILE * z) >= MIN_COLS && h / (TILE * z) >= MIN_ROWS) return z;
    }
    return ZOOM_MIN;
  }

  /* 바닥·벽은 한 장만 깔면 같은 무늬가 격자로 반복돼 눈에 걸린다.
   * 좌표로 변종을 골라 쓴다 — 난수로 고르면 매 프레임 무늬가 바뀐다. */
  /* 이 칸에 몇 번 그림을 깔 것인가.
   *
   * ⚠ **하위 비트를 섞어야 한다.** 전에는 `(x*73856093) ^ (y*19349663)` 를
   *   그대로 나머지 연산했는데, 두 상수의 하위 4비트가 13 과 15 라 변종이
   *   `(13x) xor (15y) mod 16` 이 됐다 — 16칸 주기의 규칙적인 무늬다.
   *   곱셈은 **상위 비트로** 뒤섞이므로 섞기(avalanche) 한 판을 거친다.
   * ⚠ 자리로만 정한다(난수 아님). 새로고침할 때마다 바닥이 바뀌면 안 된다. */
  function variantAt(x, y, n) {
    var h = (x | 0) * 374761393 + (y | 0) * 668265263;
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h % n;
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
    /* ── 타격감 ──────────────────────────────────────
     * 조사한 정석대로 넷을 겹친다(예비 → 타격 → 마무리):
     *   ① 맞은 그림이 흰색으로 짧게 번쩍   ② 짧은 히트스톱
     *   ③ **공격 방향으로만** 흔들기        ④ 떠오르는 피해 숫자
     * ⚠ 히트스톱은 **그림만** 멈춘다. 규칙은 이미 끝났고 입력도 안 막는다 —
     *   막으면 연타가 밀려 "눌렀는데 안 움직인다" 가 된다.
     * ⚠ 흔들기를 사방 난수로 두면 멀미가 난다. 방향을 주고 그 축으로 민다. */
    this.swings = [];          /* 무기별 베기 궤적 */
    this.dmgs = [];            /* 떠오르는 피해 숫자 */
    this.bolts = [];           /* 날아가는 것(화살·투척·저격) */
    this.blooms = [];          /* 스킬이 터지는 고리 */
    this.whites = [];          /* 맞은 그림이 하얗게 번쩍 — {e, t} */
    this.ghosts = new WeakMap();  /* 몬스터 체력 띠가 뒤따라 닳는다 */
    this.freeze = 0;           /* 히트스톱(ms) */
    this.shakeDir = { x: 0, y: 0 };
    this.last = 0;
  }

  /* 무기가 무엇이냐에 따라 궤적이 다르다.
   *   arc   휘두르는 각도(0 이면 직선 찌르기, 6.28 이면 한 바퀴)
   *   n     몇 번 긋는가 — 단검은 둘(쌍검), 몬스터 발톱은 셋
   * ⚠ 색은 **고정된 몇 가지**만 쓴다. 값에서 만들어 넘기면 구운 판이 무한정 는다. */
  var SWING = {
    sword:  { ms: 200, arc: 2.3, r: 21, w: 3, col: "#eef2ff", n: 1, spread: 0 },
    axe:    { ms: 280, arc: 2.7, r: 25, w: 5, col: "#ffd9a0", n: 1, spread: 0 },
    dagger: { ms: 160, arc: 1.4, r: 17, w: 2, col: "#cfe9ff", n: 2, spread: 0.9 },
    spear:  { ms: 180, arc: 0,   r: 28, w: 3, col: "#e6e2cf", n: 1, spread: 0 },
    staff:  { ms: 260, arc: 6.28, r: 18, w: 2, col: "#c79ae8", n: 1, spread: 0 },
    bow:    { ms: 130, arc: 0,   r: 15, w: 2, col: "#e6e2cf", n: 1, spread: 0 },
    fist:   { ms: 150, arc: 1.5, r: 15, w: 2, col: "#e6e2cf", n: 1, spread: 0 },
    claw:   { ms: 180, arc: 1.1, r: 19, w: 2, col: "#f07a7a", n: 3, spread: 0.55 },
    stone:  { ms: 150, arc: 0,   r: 13, w: 3, col: "#d8cfbb", n: 1, spread: 0 }
  };

  /* 스킬마다 다른 터짐. kind 로 고르고 없으면 기본값을 쓴다. */
  var BLOOM = {
    cleave: { col: "#ffd9a0", r: 46, ms: 320, rings: 1 },
    blast:  { col: "#ff9a3a", r: 58, ms: 430, rings: 2 },
    quake:  { col: "#c98a4a", r: 82, ms: 540, rings: 3 },
    ail:    { col: "#6ec06e", r: 54, ms: 470, rings: 2 },
    ward:   { col: "#8fb8d8", r: 30, ms: 430, rings: 1 },
    heal:   { col: "#7ed07e", r: 28, ms: 430, rings: 1 },
    charge: { col: "#e0d6ad", r: 36, ms: 270, rings: 1 },
    drain:  { col: "#c79ae8", r: 36, ms: 390, rings: 1 },
    throw:  { col: "#cfe9ff", r: 22, ms: 230, rings: 1 },
    snipe:  { col: "#ffe08a", r: 24, ms: 270, rings: 1 }
  };

  /* 흰 섬광과 상태이상 색. **고정 문자열**이라 구운 판이 스프라이트당 넷을 안 넘는다. */
  var WHITE_TINT = "rgba(255,255,255,.86)";
  /* ⚠ 색은 **고정된 몇 가지**만 쓴다(구운 판이 스프라이트당 그만큼 는다).
   *   여덟 가지 상태이상을 다 물들이지 않고 **몸이 변하는 넷**만 고른다 —
   *   나머지(둔화·실명·공포·취약)는 발밑 색 점과 상단 표로 알린다. */
  var AIL_TINT = {
    poison: "rgba(110,192,110,.42)",
    bleed:  "rgba(224,90,90,.36)",
    burn:   "rgba(255,140,58,.44)",
    stun:   "rgba(232,212,74,.38)"
  };
  var WHITE_MS = 110;        /* 조사 기준 0.1초 */
  var HITSTOP_MS = 55;       /* 보통 타격 */
  var HITSTOP_CRIT_MS = 120; /* 묵직한 한 방 */

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

  /* 그 칸에 선 개체. 흰 섬광과 색 입히기는 좌표가 아니라 **개체**에 걸어야
   * 걸어가는 동안에도 따라간다(좌표에 걸면 제자리에 남는다). */
  Renderer.prototype.entityAt = function (x, y) {
    var g = this.game;
    if (g.player.x === x && g.player.y === y) return g.player;
    return g.monsterAt(x, y);
  };

  /* 맞은 그림을 흰색으로 짧게 번쩍인다. 같은 개체가 연달아 맞으면 시간만 되감는다. */
  Renderer.prototype.flashWhite = function (e) {
    if (!e) return;
    for (var i = 0; i < this.whites.length; i++) {
      if (this.whites[i].e === e) { this.whites[i].t = 0; return; }
    }
    this.whites.push({ e: e, t: 0 });
  };
  Renderer.prototype.isWhite = function (e) {
    for (var i = 0; i < this.whites.length; i++) if (this.whites[i].e === e) return true;
    return false;
  };

  /* 그릴 때 입힐 색. 흰 섬광이 먼저고, 없으면 걸린 상태이상 색이다.
   * ⚠ 돌려주는 문자열은 **고정된 넷** 중 하나다(흰색 · 독 · 출혈 · 기절).
   *   알파를 시간에 따라 바꾸면 구운 판이 프레임마다 하나씩 늘어난다. */
  /* 갑옷 등급 덧그림 이름. 일반 등급이면 없다.
   * ⚠ 한 곳에서만 고른다. 지도·초상·장비창이 각자 고르면 조용히 어긋난다. */
  function armorArt(p) {
    var r = p && p.armor && p.armor.rarity;
    return (r && r !== "common") ? "eq_" + r : null;
  }
  global.ARMOR_ART = armorArt;

  /* 손에 든 무기 덧그림 이름.
   * ⚠ 무기 종류 id 가 곧 이름이다(sword·axe·dagger·staff·bow·spear).
   *   data.js 의 WEAPON_KINDS 와 **같은 id** 를 쓴다 — 표를 베껴 적지 말 것.
   * ⚠ 맨손이면 주먹을 그린다. 아무것도 안 그리면 오른손이 뭉텅 비어 보인다. */
  function weaponArt(p) {
    var k = p && p.weapon && p.weapon.weaponKind;
    return "w_" + (k || "fist");
  }
  global.WEAPON_ART = weaponArt;

  /* 몸 → 갑옷 → 무기. 세 자리(지도·상단 초상·사이드바 초상)가 **같은 순서**로
   * 그려야 한다. 한 곳만 순서가 다르면 거기서만 무기가 어깨에 가린다. */
  function drawFigure(ctx, p, sprite, frame, tint, x, y) {
    /* ⚠ bake 는 이름이 틀리면 **null 을 준다.** 그대로 drawImage 에 넘기면
     *   그리기가 통째로 터져 화면이 안 뜬다 — 하나씩 확인하고 넘긴다. */
    var body = S.bake(sprite, frame, tint);
    if (body) ctx.drawImage(body, x, y);
    var a = armorArt(p) && S.bake(armorArt(p), 0, tint);
    if (a) ctx.drawImage(a, x, y);
    var w = S.bake(weaponArt(p), 0, tint);
    if (w) ctx.drawImage(w, x, y);
  }

  Renderer.prototype.tintOf = function (e) {
    if (this.isWhite(e)) return WHITE_TINT;
    if (!e.ail) return null;
    /* 순서가 곧 우선순위다. 불이 붙었으면 그것부터 보여야 한다. */
    if (e.ail.burn && e.ail.burn.turns > 0) return AIL_TINT.burn;
    if (e.ail.poison && e.ail.poison.turns > 0) return AIL_TINT.poison;
    if (e.ail.bleed && e.ail.bleed.turns > 0) return AIL_TINT.bleed;
    if (e.ail.stun && e.ail.stun.turns > 0) return AIL_TINT.stun;
    return null;
  };

  /* 규칙이 쌓아 둔 효과 신호를 비워 간다.
   * ⚠ 규칙은 화면을 모른다 — 신호만 쌓는다. 화면이 없어도(검사·헤드리스)
   *   40개에서 잘려 나갈 뿐이라 아무것도 안 깨진다. */
  Renderer.prototype.drainEffects = function () {
    var g = this.game, fx = g.effects;
    if (!fx || !fx.length) return;
    for (var i = 0; i < fx.length; i++) {
      var f = fx[i], who;
      if (f.type === "lunge") {
        who = this.entityAt(f.x, f.y);
        if (who) this.lunges.set(who, { dx: f.dx, dy: f.dy, t: 0 });

      } else if (f.type === "swing") {
        var sw = SWING[f.w] || SWING.fist;
        this.swings.push({ x: f.x, y: f.y, dx: f.dx, dy: f.dy, t: 0, s: sw });
        /* 맞는 쪽이 나면 그 방향으로 화면을 민다 */
        if (g.player.x === f.x && g.player.y === f.y) { this.shakeDir.x = f.dx; this.shakeDir.y = f.dy; }
        else { this.shakeDir.x = f.dx * 0.5; this.shakeDir.y = f.dy * 0.5; }

      } else if (f.type === "hit" || f.type === "crit") {
        var isCrit = f.type === "crit";
        this.hits.push({ x: f.x, y: f.y, t: 0, big: false });
        this.flashWhite(this.entityAt(f.x, f.y));
        if (f.n) this.dmgs.push({ x: f.x, y: f.y, t: 0, n: f.n,
                                  col: isCrit ? "#ffb347" : "#f2ead2", big: isCrit });
        this.shake = Math.max(this.shake, isCrit ? 11 : 6);
        this.freeze = Math.max(this.freeze, isCrit ? HITSTOP_CRIT_MS : HITSTOP_MS);

      } else if (f.type === "hurt") {
        this.flashWhite(g.player);
        if (f.n) this.dmgs.push({ x: f.x, y: f.y, t: 0, n: f.n, col: "#ff6b6b", big: false, down: true });
        this.freeze = Math.max(this.freeze, HITSTOP_MS);

      } else if (f.type === "ward") {
        this.blooms.push({ x: f.x, y: f.y, t: 0, b: BLOOM.ward });
        if (f.n) this.dmgs.push({ x: f.x, y: f.y, t: 0, n: f.n, col: "#8fb8d8", big: false, down: true });

      } else if (f.type === "burst") {
        this.hits.push({ x: f.x, y: f.y, t: 0, big: true });

      } else if (f.type === "heal") {
        this.blooms.push({ x: f.x, y: f.y, t: 0, b: BLOOM.heal });

      } else if (f.type === "skill") {
        this.blooms.push({ x: f.x, y: f.y, t: 0, b: BLOOM[f.sk] || BLOOM.cleave });
        if (f.sk === "quake") { this.shake = Math.max(this.shake, 16); }

      } else if (f.type === "bolt") {
        this.bolts.push({ x: f.x, y: f.y, dx: f.dx, dy: f.dy, t: 0 });
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
    /* 사람이 고른 값이 있으면 그것을, 없으면 화면을 보고 고른다 */
    var z = this.zoomSet ? this.zoomSet : autoZoom(w, h);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    /* ⚠ 확대와 dpr 을 **같은 변환에** 곱한다. 두 번 걸면 네 배가 된다. */
    this.ctx.setTransform(dpr * this.zoom, 0, 0, dpr * this.zoom, 0, 0);
    /* ⚠ 픽셀 아트라 반드시 꺼야 한다. 켜 두면 2배에서 통째로 흐려진다. */
    this.ctx.imageSmoothingEnabled = false;
    /* ⚠ 여기부터 viewW/viewH 는 **세계 좌표**다. 카메라 한계도 칠하는 넓이도
     *   전부 이 값을 쓰므로 확대해도 그대로 맞는다. */
    this.viewW = w / this.zoom;
    this.viewH = h / this.zoom;
    /* ⚠ 캔버스 위 **UI**(미니맵·층 표시·토스트)는 지도와 같이 커지면 안 된다.
     *   2배에서 토스트 글자가 두 배가 되어 지도를 덮었다. 그것들은 화면
     *   좌표로 그린다 — 그래서 확대가 안 걸린 크기를 따로 들고 있는다. */
    this.screenW = w;
    this.screenH = h;
    this.dpr = dpr;
    this.colsShown = Math.ceil(this.viewW / TILE) + 1;
    this.rowsShown = Math.ceil(this.viewH / TILE) + 1;
    this._vig = null;
  };

  /* 확대를 한 단 올리거나 내린다. `null` 을 주면 화면을 보고 고르는 쪽으로
   * 돌아간다. 고른 값은 부르는 쪽이 저장한다(render 는 저장소를 안 쓴다). */
  Renderer.prototype.stepZoom = function (d) {
    var now = this.zoom || 1;
    var next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, now + d));
    this.zoomSet = next;
    this.resize();
    return next;
  };
  Renderer.prototype.autoZoomAgain = function () {
    this.zoomSet = null; this.resize(); return this.zoom;
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

  /* 화면의 한 점이 어느 칸인가.
   * ⚠ 카메라 흔들림(shake)은 **빼고** 계산한다. 그걸 넣으면 맞는 순간에 누른
   *   칸이 한둘 어긋난다 — 사람은 흔들리기 전 화면을 보고 눌렀다.
   * ⚠ 캔버스는 CSS 픽셀과 실제 픽셀이 다르다(devicePixelRatio) — 반드시
   *   getBoundingClientRect 로 CSS 기준을 쓴다. */
  Renderer.prototype.tileAtPoint = function (clientX, clientY) {
    if (!this.camReady) return null;
    var box = this.canvas.getBoundingClientRect();
    /* ⚠ 화면 px 를 **확대배로 나눠야** 세계 좌표가 된다. 안 나누면 2배에서
     *   누른 칸이 두 배로 멀리 잡힌다(화면 오른쪽 아래를 눌러도 가운데 근처가
     *   찍힌다). */
    var z = this.zoom || 1;
    var px = (clientX - box.left) / z + this.cam.x;
    var py = (clientY - box.top) / z + this.cam.y;
    var tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (!this.game.level.inside(tx, ty)) return null;
    return { x: tx, y: ty };
  };

  /* 목적지 표시 — 걸어가는 동안 어디로 가는지 보여 준다.
   * ⚠ 이게 없으면 "왜 혼자 움직이지" 가 된다. 누른 자리를 반드시 표시한다.
   *   깜박이게 두는 편이 정지된 표식보다 눈에 걸린다(대신 아주 약하게). */
  Renderer.prototype.drawGoal = function () {
    var gl = this.goalMark;
    if (!gl) return false;
    var ctx = this.ctx;
    var ox = -Math.round(this.cam.x), oy = -Math.round(this.cam.y);
    var x = gl.x * TILE + ox, y = gl.y * TILE + oy;
    if (x < -TILE || y < -TILE || x > this.viewW || y > this.viewH) return true;
    gl.t = (gl.t || 0) + 0.04;
    var a = 0.35 + 0.25 * Math.sin(gl.t * 3);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#c9a227";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3.5, y + 3.5, TILE - 7, TILE - 7);
    ctx.globalAlpha = a * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + TILE / 2, y + 8); ctx.lineTo(x + TILE / 2, y + TILE - 8);
    ctx.moveTo(x + 8, y + TILE / 2); ctx.lineTo(x + TILE - 8, y + TILE / 2);
    ctx.stroke();
    ctx.restore();
    return true;                                    /* 깜박이므로 계속 다시 그려야 한다 */
  };

  /* 베기 궤적 · 날아가는 것 · 스킬 터짐. 스프라이트 **위**에 그린다. */
  Renderer.prototype.drawImpacts = function (ctx, ox, oy) {
    var i, j;
    ctx.lineCap = "round";

    /* ① 무기별 베기. 검은 내리치고 · 도끼는 크게 돌고 · 단검은 두 번 긋고(쌍검)
     *    · 창은 곧게 찌르고 · 지팡이는 고리를 두르고 · 발톱은 세 줄을 낸다. */
    for (i = 0; i < this.swings.length; i++) {
      var sw = this.swings[i], d = sw.s;
      var cx = sw.x * TILE + ox + TILE / 2, cy = sw.y * TILE + oy + TILE / 2;
      var base = Math.atan2(sw.dy, sw.dx);
      for (j = 0; j < d.n; j++) {
        var tj = sw.t * (1 + (d.n - 1) * 0.22) - j * 0.22;
        if (tj <= 0 || tj >= 1) continue;
        ctx.globalAlpha = Math.min(1, (1 - tj) * 1.5);
        ctx.strokeStyle = d.col;
        ctx.lineWidth = d.w;
        ctx.beginPath();
        if (d.arc === 0) {
          /* 찌르기 — 뻗었다가 들어온다(예비 → 타격 → 마무리가 한 곡선에 담긴다) */
          var back = d.r * 0.65, len = d.r * Math.sin(tj * Math.PI);
          ctx.moveTo(cx - sw.dx * back, cy - sw.dy * back);
          ctx.lineTo(cx - sw.dx * back + sw.dx * len, cy - sw.dy * back + sw.dy * len);
        } else {
          var off = (j - (d.n - 1) / 2) * d.spread;
          var head = base - d.arc / 2 + d.arc * tj + off;
          ctx.arc(cx, cy, d.r, head - d.arc * 0.5, head);
        }
        ctx.stroke();
      }
    }

    /* ② 날아가는 것 — 짧은 선이 지나간다. 점으로 두면 무엇이 날아갔는지 안 보인다. */
    for (i = 0; i < this.bolts.length; i++) {
      var b = this.bolts[i];
      var bx0 = b.x * TILE + ox + TILE / 2, by0 = b.y * TILE + oy + TILE / 2;
      var len2 = Math.max(1, Math.sqrt(b.dx * b.dx + b.dy * b.dy));
      var ux = b.dx / len2, uy = b.dy / len2;
      var px = bx0 + b.dx * TILE * b.t, py = by0 + b.dy * TILE * b.t;
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = "#ffe3a0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - ux * 10, py - uy * 10);
      ctx.lineTo(px + ux * 4, py + uy * 4);
      ctx.stroke();
    }

    /* ③ 스킬 터짐 — 고리가 퍼진다. 지진은 셋, 폭발은 둘. */
    for (i = 0; i < this.blooms.length; i++) {
      var bl = this.blooms[i], bd = bl.b;
      var lx = bl.x * TILE + ox + TILE / 2, ly = bl.y * TILE + oy + TILE / 2;
      for (j = 0; j < bd.rings; j++) {
        var rt = bl.t * (1 + (bd.rings - 1) * 0.18) - j * 0.18;
        if (rt <= 0 || rt >= 1) continue;
        ctx.globalAlpha = Math.max(0, 1 - rt) * 0.8;
        ctx.strokeStyle = bd.col;
        ctx.lineWidth = 1 + (bd.rings - j);
        ctx.beginPath();
        ctx.arc(lx, ly, bd.r * (0.22 + rt * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  };

  /* 떠오르는 피해 숫자. **가장 위**에 그린다 — 어둡게 깔린 막 밑에 두면 안 읽힌다.
   * ⚠ 검은 테두리를 두르지 않으면 밝은 바닥 위에서 사라진다. */
  Renderer.prototype.drawDmgs = function (ctx, ox, oy) {
    if (!this.dmgs.length) return;
    var font = global.NUM_FONT || global.TOAST_FONT ||
               '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (var i = 0; i < this.dmgs.length; i++) {
      var n = this.dmgs[i];
      var nx = n.x * TILE + ox + TILE / 2;
      /* 내가 맞은 것은 아래로 떨어지고 적이 맞은 것은 위로 뜬다 — 누가 맞았는지가 갈린다 */
      var ny = n.down ? (n.y * TILE + oy + TILE + 4 + n.t * 13)
                      : (n.y * TILE + oy + 2 - n.t * 21);
      ctx.globalAlpha = 1 - Math.max(0, (n.t - 0.55) / 0.45);
      ctx.font = (n.big ? "400 26px " : "400 19px ") + font;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = "rgba(0,0,0,.88)";
      ctx.strokeText(String(n.n), nx, ny);
      ctx.fillStyle = n.col;
      ctx.fillText(String(n.n), nx, ny);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
  };

  /* 아직 못 본 어둠.
   *
   * ⚠ 순수 검정으로 두면 "빈 화면" 으로 읽힌다(제안서 진단 2번: 검은 여백이 화면의
   *   절반 이상). 같은 어둠이라도 **결이 있으면** "아직 못 본 곳" 으로 읽힌다.
   * ⚠ 한 번 구워 두고 패턴으로 깐다. 프레임마다 난수를 돌리면 어둠이 지글거려
   *   눈이 그쪽으로 끌린다 — 배경은 조용해야 한다.
   * ⚠ 밝기를 올리지 말 것. 바닥 타일보다 밝아지는 순간 "여기도 방인가" 로 읽힌다. */
  Renderer.prototype.voidPattern = function () {
    if (this._void) return this._void;
    var c = document.createElement("canvas");
    c.width = 64; c.height = 64;
    var x = c.getContext("2d");
    x.fillStyle = "#120e0a";
    x.fillRect(0, 0, 64, 64);
    /* 굵은 알갱이 — 고정된 의사난수라 판마다 같다 */
    var seed = 1234567;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var i = 0; i < 300; i++) {
      var px = Math.floor(rnd() * 64), py = Math.floor(rnd() * 64);
      var v = rnd();
      x.fillStyle = v > 0.72 ? "#1a1410" : (v > 0.4 ? "#161109" : "#0e0b07");
      x.fillRect(px, py, 2, 2);
    }
    this._void = x.createPattern(c, "repeat");
    return this._void;
  };

  /* 미니맵 — 본 곳 · 나 · 계단.
   *
   * ⚠ **본 칸만 그린다.** 안 본 지형을 보여 주면 탐험이 통째로 사라진다
   *   (탭 이동이 본 칸만 지나가는 것과 같은 규칙이다).
   * ⚠ 몬스터는 안 그린다. 지도에서 적 위치를 다 알면 시야가 의미를 잃는다.
   * ⚠ 한 칸 2px. 62x38 짜리 층이 124x76 이라 화면 구석에 들어간다. */
  Renderer.prototype.drawMinimap = function (ctx) {
    /* ⚠ 좁은 화면에서는 한 칸 1px 로 줄인다. 2px 로 두면 62칸짜리 층이 132px 라
     *   390px 화면의 3분의 1을 덮는다. */
    /* ⚠ **화면 폭**을 본다. `viewW` 는 확대가 걸린 뒤의 세계 좌표라 2배에서
     *   절반으로 보여, 넓은 화면인데 좁은 화면 배치가 걸린다. */
    var g = this.game, lv = g.level, S2 = this.screenW < 620 ? 1 : 2, pad = 4;
    var w = lv.w * S2, h = lv.h * S2, x = 12, y = 12;
    ctx.fillStyle = "rgba(10,9,7,.86)";
    ctx.fillRect(x, y, w + pad * 2, h + pad * 2);
    pxFrame(ctx, x, y, w + pad * 2, h + pad * 2);

    /* ⚠ 한 층이 62x38 = 2,356칸이다. 매 프레임 다시 칠하면 애니메이션이 도는
     *   동안 초당 14만 번 채우기가 된다. **턴이 바뀔 때만** 다시 굽는다. */
    var key = g.depth + ":" + g.turn + ":" + S2 + ":" + lv.w + "x" + lv.h;
    if (!this._mm || this._mmKey !== key) {
      if (!this._mm) this._mm = document.createElement("canvas");
      this._mm.width = w; this._mm.height = h;
      var mx = this._mm.getContext("2d");
      mx.clearRect(0, 0, w, h);
      for (var ty = 0; ty < lv.h; ty++) {
        for (var tx = 0; tx < lv.w; tx++) {
          var id = lv.idx(tx, ty);
          if (!lv.seen[id]) continue;
          var t = lv.at(tx, ty);
          var col;
          if (lv.blocked(tx, ty)) col = "#3a3129";
          else if (t === D.STAIRS) col = "#d9a441";
          else if (t === D.DEEP) col = "#e0742a";
          else if (t === D.DOOR) col = "#8a6a33";
          else col = lv.visible[id] ? "#6b6055" : "#453d34";
          mx.fillStyle = col;
          mx.fillRect(tx * S2, ty * S2, S2, S2);
        }
      }
      this._mmKey = key;
    }
    var ox = x + pad, oy = y + pad;
    ctx.drawImage(this._mm, ox, oy);
    /* 나 — 제일 밝게, 한 칸보다 크게. 지도에서 나를 못 찾으면 지도가 아니다. */
    ctx.fillStyle = "#ffe9a8";
    ctx.fillRect(ox + g.player.x * S2 - 1, oy + g.player.y * S2 - 1, S2 + 2, S2 + 2);
    return { x: x, y: y, w: w + pad * 2, h: h + pad * 2 };
  };

  /* 각진 픽셀 테두리 — CSS 의 --frame 과 같은 모양을 캔버스에 그린다.
   * ⚠ 화면 안팎이 같은 모양이어야 "하나의 UI" 가 된다. */
  function pxFrame(ctx, x, y, w, h) {
    ctx.fillStyle = "#4a3826";
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillRect(x + w - 2, y, 2, h);
    ctx.fillStyle = "#7a6336";
    ctx.fillRect(x, y, 3, 3);
    ctx.fillRect(x + w - 3, y, 3, 3);
    ctx.fillRect(x, y + h - 3, 3, 3);
    ctx.fillRect(x + w - 3, y + h - 3, 3, 3);
  }

  Renderer.prototype.hit = function () { this.shake = 6; };
  Renderer.prototype.hurt = function () { this.shake = 10; this.flash = 0.45; };

  /* dt(ms)를 받아 한 프레임 그린다. 아직 움직이는 것이 남았으면 true —
   * main.js 가 그걸 보고 다음 프레임을 예약한다(가만히 있을 때는 안 돈다). */
  Renderer.prototype.draw = function (dt) {
    var g = this.game, lv = g.level, ctx = this.ctx;
    dt = (dt === undefined) ? 16 : Math.min(48, dt);   /* 탭을 오래 떠났다 와도 한 번에 안 튀게 */
    var busy = false;
    this.idleAnim = false;
    /* 일렁임이 쓰는 시계. ⚠ `Date.now()` 를 쓰지 않는다 — 탭이 멈췄다 돌아오면
     *   빛이 껑충 뛴다. 프레임 간격을 쌓는다. */
    this.clock = (this.clock || 0) + dt;
    var i;

    this.drainEffects();
    /* 히트스톱 — **그림만** 멈춘다(dt 를 0 으로 둔다). 규칙은 이미 끝났고 입력도
     * 안 막는다. busy 를 세워야 멈춰 있는 동안에도 프레임이 이어진다. */
    if (this.freeze > 0) { this.freeze = Math.max(0, this.freeze - dt); dt = 0; busy = true; }
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
    /* 베기·날아가는 것·터짐·숫자·흰 섬광 — 전부 시간(dt) 기준이다.
     * ⚠ 프레임 수 기준으로 두면 느린 기기에서 연출이 늘어진다. */
    for (i = this.swings.length - 1; i >= 0; i--) {
      var swv = this.swings[i];
      swv.t += dt / (swv.s.ms + (swv.s.n - 1) * swv.s.ms * 0.22);
      if (swv.t >= 1) this.swings.splice(i, 1); else busy = true;
    }
    for (i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].t += dt / 190;
      if (this.bolts[i].t >= 1) this.bolts.splice(i, 1); else busy = true;
    }
    for (i = this.blooms.length - 1; i >= 0; i--) {
      var blv = this.blooms[i];
      blv.t += dt / (blv.b.ms + (blv.b.rings - 1) * blv.b.ms * 0.18);
      if (blv.t >= 1) this.blooms.splice(i, 1); else busy = true;
    }
    for (i = this.dmgs.length - 1; i >= 0; i--) {
      this.dmgs[i].t += dt / 780;
      if (this.dmgs[i].t >= 1) this.dmgs.splice(i, 1); else busy = true;
    }
    for (i = this.whites.length - 1; i >= 0; i--) {
      this.whites[i].t += dt / WHITE_MS;
      if (this.whites[i].t >= 1) this.whites.splice(i, 1); else busy = true;
    }

    this.updateCamera(pv);

    var ox = -this.cam.x, oy = -this.cam.y;
    if (this.shake > 0) {
      /* 공격 방향 축으로 밀고, 그 직각으로만 아주 조금 떤다.
       * ⚠ 사방 난수로 흔들면 멀미가 나고 **무엇에 맞았는지도 안 읽힌다.**
       *   조사한 정석도 "공격 벡터를 따라 두어 프레임" 이다. */
      var sd = this.shakeDir;
      if (sd.x || sd.y) {
        var jit = (Math.random() - 0.5) * this.shake * 0.4;
        ox += sd.x * this.shake - sd.y * jit;
        oy += sd.y * this.shake + sd.x * jit;
      } else {
        ox += (Math.random() - 0.5) * this.shake;
        oy += (Math.random() - 0.5) * this.shake;
      }
      this.shake *= Math.pow(0.72, dt / 16);       /* 시간 기준으로 줄인다 */
      if (this.shake < 0.4) { this.shake = 0; sd.x = 0; sd.y = 0; } else busy = true;
    }
    ox = Math.round(ox); oy = Math.round(oy);

    /* ⚠ CSS 의 --bg 와 같은 값이어야 한다. 한쪽만 밝히면 던전이 화면에
     *   뚫린 구멍처럼 보인다.
     * ⚠ 순수 색이 아니라 **결 있는 어둠**을 깐다 — "빈 화면" 이 아니라
     *   "아직 못 본 곳" 으로 읽혀야 한다(제안서 진단 2번). */
    ctx.fillStyle = this.voidPattern() || "#120e0a";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    var x0 = Math.max(0, Math.floor(this.cam.x / TILE));
    var y0 = Math.max(0, Math.floor(this.cam.y / TILE));
    var x1 = Math.min(lv.w - 1, x0 + this.colsShown);
    var y1 = Math.min(lv.h - 1, y0 + this.rowsShown);

    var x, y, id, t, sx, sy;
    /* 이 층이 어느 구역인가 — 돌 색과 장식이 여기서 갈린다 */
    var zone = global.DATA.zoneAt(g.depth);

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
          /* 2.5D — **아래가 바닥인 벽만** 사람을 마주보는 앞면을 그린다.
           * ⚠ 위아래가 다 바닥인 **한 칸 두께 벽**(층당 15칸)은 윗면을 넣을
           *   자리가 없다. 앞면만 칸 전체에 세운다 — 안 그러면 그 칸만 벽이
           *   절반 높이로 보인다.
           * ⚠ 문도 '아래가 지나갈 수 있는 칸' 이다. 문 위 벽에 앞면이 없으면
           *   문틀만 떠 보인다. */
          var below = lv.at(x, y + 1), above = lv.at(x, y - 1);
          var openBelow = (below === D.FLOOR || below === D.DOOR ||
                           below === D.STAIRS || below === D.DEEP);
          var openAbove = (above === D.FLOOR || above === D.DOOR ||
                           above === D.STAIRS || above === D.DEEP);
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
    ctx.globalAlpha = 1;

    /* 1-a2) 벽 밑 그림자(AO) — 벽과 바닥의 경계를 끊어 준다.
     *
     * ⚠ **두께를 한 칸(32px)으로 주면 안 된다.** 2배 확대에서 64px 이 되어
     *   바닥의 절반이 검어진다. 10px 이면 확대해도 20px 이라 경계만 짚는다.
     * ⚠ 위 칸이 벽인 **바닥** 칸에 깐다. 벽 칸에 깔면 벽 위에 얹혀 벽이 두 겹
     *   으로 보인다.
     * ⚠ 장식·함정·아이템보다 **먼저** 깐다. 나중에 깔면 상자와 물건이 그늘에
     *   묻힌다.
     * ⚠ 그라디언트를 칸마다 새로 만들지 않는다 — 한 번 만들어 쓴다.
     *   칸마다 만들면 한 프레임에 백 번 넘게 만들어진다. */
    if (!this._ao) {
      var aoc = document.createElement("canvas");
      aoc.width = 1; aoc.height = AO_H;
      var aox = aoc.getContext("2d");
      var aog = aox.createLinearGradient(0, 0, 0, AO_H);
      aog.addColorStop(0, "rgba(6, 5, 9, .62)");
      aog.addColorStop(0.55, "rgba(6, 5, 9, .22)");
      aog.addColorStop(1, "rgba(6, 5, 9, 0)");
      aox.fillStyle = aog;
      aox.fillRect(0, 0, 1, AO_H);
      this._ao = aoc;
    }
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        id = lv.idx(x, y);
        if (!lv.seen[id] || lv.tiles[id] === D.WALL) continue;
        if (lv.at(x, y - 1) !== D.WALL) continue;
        ctx.globalAlpha = lv.visible[id] ? 1 : 0.30;
        ctx.drawImage(this._ao, 0, 0, 1, AO_H,
                      x * TILE + ox, y * TILE + oy, TILE, AO_H);
      }
    }
    ctx.globalAlpha = 1;

    /* 1-a) 구역 장식 — 바닥 바로 위, 함정·아이템보다 **아래**다.
     * ⚠ 순서를 바꾸면 물웅덩이가 아이템을 덮는다. 장식은 언제나 맨 밑이다. */
    if (lv.props && zone.props) {
      /* 횃불 빛을 **먼저** 깐다. 그림보다 위에 깔면 불이 빛에 묻힌다.
       * ⚠ 보이는 칸에만 깐다. 기억으로만 아는 자리까지 밝히면 지금 보이는 곳과
       *   구별이 안 된다(안개의 뜻이 사라진다).
       *
       * 일렁임 —
       * ⚠ **게임 난수를 쓰지 않는다.** 이 저장소는 같은 씨앗이 같은 판이어야
       *   한다. 시각 효과가 `this.rng` 를 건드리면 씨앗이 어긋난다.
       *   자리와 시계로만 만든다(sin 둘을 어긋난 주기로 겹친다).
       * ⚠ 횃불마다 **위상을 달리한다.** 같은 위상이면 층 전체가 한꺼번에
       *   깜빡여 형광등처럼 보인다.
       * ⚠ 그라디언트를 칸마다 새로 만들지 않는다. 한 번 구워 두고 **그릴 때
       *   크기만 바꾼다** — 프레임마다 만들면 그리기 시간이 는다. */
      if (!this._glow) {
        var gc = document.createElement("canvas");
        var GR = 64;                                   /* 구워 두는 반지름 */
        gc.width = GR * 2; gc.height = GR * 2;
        var gx2 = gc.getContext("2d");
        var gg = gx2.createRadialGradient(GR, GR, 2, GR, GR, GR);
        gg.addColorStop(0, "rgba(255, 176, 74, 1)");
        gg.addColorStop(0.45, "rgba(255, 158, 62, .38)");
        gg.addColorStop(1, "rgba(255, 150, 58, 0)");
        gx2.fillStyle = gg;
        gx2.fillRect(0, 0, GR * 2, GR * 2);
        this._glow = gc;
      }
      var now = this.clock || 0;
      var litTorch = 0;
      ctx.globalCompositeOperation = "lighter";
      for (y = y0; y <= y1; y++) {
        for (x = x0; x <= x1; x++) {
          id = lv.idx(x, y);
          if (!lv.visible[id] || !lv.props[id]) continue;
          if (zone.props[(lv.props[id] - 1) % zone.props.length] !== "torch") continue;
          var ph = (x * 12.9898 + y * 78.233);          /* 횃불마다 다른 위상 */
          var fl = 1 +
            Math.sin(now * 0.0091 + ph) * 0.055 +
            Math.sin(now * 0.0237 + ph * 1.7) * 0.032;
          var rad = TILE * 2.1 * fl;
          var tcx = x * TILE + ox + TILE / 2, tcy = y * TILE + oy + 8;
          ctx.globalAlpha = 0.30 * fl;
          ctx.drawImage(this._glow, tcx - rad, tcy - rad, rad * 2, rad * 2);
          litTorch++;
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      /* ⚠ 일렁이려면 **계속 다시 그려야** 한다. 이 고리는 할 일이 없으면
       *   멈추므로(main.js 의 loop) 횃불이 보일 때만 깨워 둔다. 항상 깨워
       *   두면 턴제인데도 쉬는 동안 CPU 를 계속 쓴다. */
      /* ⚠ 여기서 `busy = true` 를 주면 **유휴에도 60fps 로 돈다.** 턴제인데
       *   가만히 있는 동안 CPU 한 코어를 계속 쓰는 셈이다(검사 「유휴 시
       *   정지」가 그걸 지킨다). 일렁임은 **느린 박자로 충분하다** —
       *   따로 알려서 부르는 쪽이 쉬엄쉬엄 부르게 한다. */
      this.idleAnim = litTorch > 0;
      for (y = y0; y <= y1; y++) {
        for (x = x0; x <= x1; x++) {
          id = lv.idx(x, y);
          if (!lv.seen[id] || !lv.props[id]) continue;
          var pname = zone.props[(lv.props[id] - 1) % zone.props.length];
          if (!pname) continue;
          ctx.globalAlpha = lv.visible[id] ? 1 : 0.30;
          ctx.drawImage(S.bake("p_" + pname), x * TILE + ox, y * TILE + oy);
        }
      }
      ctx.globalAlpha = 1;
    }

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

    /* 2-a2) 제단 — 다 쓰면 불을 죽인다.
     * ⚠ **다 쓴 제단도 그린다.** 지우면 "내가 저기서 뭘 했더라" 가 안 남고,
     *   무엇보다 방금 쓴 것이 사라져 버그처럼 보인다. 어둡게만 둔다. */
    if (g.altar && lv.visible[lv.idx(g.altar.x, g.altar.y)]) {
      var ax2 = g.altar.x * TILE + ox, ay2 = g.altar.y * TILE + oy;
      if (!g.altar.used) {
        var hal = ctx.createRadialGradient(ax2 + TILE / 2, ay2 + TILE / 2, 2,
                                           ax2 + TILE / 2, ay2 + TILE / 2, TILE * 1.4);
        hal.addColorStop(0, "rgba(217, 164, 65, .22)");
        hal.addColorStop(1, "rgba(217, 164, 65, 0)");
        ctx.fillStyle = hal;
        ctx.fillRect(ax2 - TILE, ay2 - TILE, TILE * 3, TILE * 3);
        ctx.drawImage(S.bake("altar"), ax2, ay2);
      } else {
        ctx.globalAlpha = 0.5;
        ctx.drawImage(S.bake("altar"), ax2, ay2);
        ctx.globalAlpha = 1;
      }
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
      ctx.drawImage(S.bake(mo.sprite, S.hasFrames(mo.sprite) ? frameOf(mv) : 0,
                           this.tintOf(mo)), sx, sy);
      if (mo.hp < mo.maxhp) {
        var frac = Math.max(0, mo.hp / mo.maxhp);
        /* 뒤따라 닳는 띠 — 방금 얼마나 깎였는지가 눈에 남는다.
         * ⚠ 개체에 건다(WeakMap). 죽거나 층이 바뀌면 알아서 사라진다. */
        var gh = this.ghosts.get(mo);
        if (gh === undefined || gh < frac) gh = frac;
        else if (gh > frac) { gh = Math.max(frac, gh - dt / 620); busy = true; }
        this.ghosts.set(mo, gh);
        ctx.fillStyle = "rgba(0,0,0,.72)";
        ctx.fillRect(sx + 3, sy - 5, TILE - 6, 4);
        if (gh > frac + 0.001) {
          ctx.fillStyle = "#8d2f2f";
          ctx.fillRect(sx + 4, sy - 4, Math.round((TILE - 8) * gh), 2);
        }
        ctx.fillStyle = frac > 0.5 ? "#6ec06e" : frac > 0.25 ? "#e0b84a" : "#e05a5a";
        ctx.fillRect(sx + 4, sy - 4, Math.round((TILE - 8) * frac), 2);
      }
      /* 위험 표식 — **몇 대에 죽는가**를 머리 위 삼각으로 보인다.
       * ⚠ 숫자를 적지 않는다. 32px 칸 위에 숫자를 얹으면 지도가 표가 된다.
       *   셋 · 둘 · 하나로 세기만 하면 눈이 훑으며 읽는다.
       * ⚠ 색만 쓰지 않는다(색맹). **개수**가 같이 말한다.
       * ⚠ 안전한 놈에게는 아무것도 안 그린다 — 다 그리면 아무것도 안 읽힌다. */
      var th = g.threatOf(mo);
      var pips = th.hitsOnMe <= 2 ? 3 : (th.hitsOnMe <= 4 ? 2 : (th.hitsOnMe <= 7 ? 1 : 0));
      if (pips) {
        ctx.fillStyle = pips === 3 ? "#e05a5a" : (pips === 2 ? "#e0a03a" : "#c9c088");
        /* ⚠ **정수 좌표로 그린다.** 소수점 좌표로 채우면 가장자리가 섞여 도트가
         *   뭉개진다 — 픽셀 그림 위에서는 그 자체가 잘못이고, 색으로 재는 검사도
         *   못 찾는다(실측: 표식 픽셀이 6 → 0 으로 흔들렸다). */
        var pw = 4, gap = 5;
        var px0 = Math.round(sx + TILE / 2 - (pips * gap - 1) / 2);
        for (var pi = 0; pi < pips; pi++) {
          var px2 = px0 + pi * gap;
          ctx.fillRect(px2, sy - 10, pw, 3);
        }
      }

      /* 엘리트 — 이름만으로는 화면에서 못 가린다. 머리 위에 표식을 둔다 */
      if (mo.elite) {
        ctx.fillStyle = "#e0742a";
        ctx.fillRect(sx + TILE / 2 - 4, sy - 14, 8, 3);
        ctx.fillRect(sx + TILE / 2 - 1, sy - 16, 2, 2);
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
    /* 몸 → 갑옷 → 무기. 장비를 껴도 외형이 안 변하던 것을 고친다 */
    drawFigure(ctx, g.player, g.player.sprite || "warrior", frameOf(pv),
               this.tintOf(g.player), pxp, pyp);

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

    /* 4-c) 베기 궤적 · 날아가는 것 · 스킬 터짐 */
    this.drawImpacts(ctx, ox, oy);

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

    /* 7) 상단 체력 띠가 뒤따라 닳는다. DOM 이라 여기서 직접 민다 —
     *    drawHud 가 매번 다시 그리므로 CSS transition 으로는 안 된다. */
    if (this.hudGhostEl) {
      var hpNow = g.maxhp() > 0 ? Math.max(0, Math.min(100, (g.player.hp / g.maxhp()) * 100)) : 0;
      if (this.hudGhost > hpNow) {
        this.hudGhost = Math.max(hpNow, this.hudGhost - dt * 0.075);
        this.hudGhostEl.style.width = this.hudGhost.toFixed(1) + "%";
        busy = true;
      } else if (this.hudGhost < hpNow) {
        this.hudGhost = hpNow;                       /* 회복은 즉시 따라간다 */
      }
    }

    /* 8) 피해 숫자 — 어둡게 깔린 막과 붉은 막 **위**여야 읽힌다 */
    this.drawDmgs(ctx, ox, oy);

    if (this.drawGoal()) busy = true;
    /* 좌상단 미니맵 · 우하단 층 표시 · 토스트 — **화면 좌표로** 그린다.
     *
     * ⚠ 여기서 확대 변환을 풀지 않으면 이것들이 지도와 같이 2배가 된다.
     *   실제로 그랬다 — 토스트 글자가 두 배가 되어 지도 아래쪽을 덮고
     *   퀵슬롯까지 가렸다. 이건 지도 위에 얹힌 **UI** 지 지도가 아니다.
     * ⚠ 풀었으면 반드시 되돌린다. 다음 프레임이 이 변환을 물려받으면
     *   지도가 확대되지 않은 채로 그려진다. */
    var zsave = this.zoom || 1, dsave = this.dpr || 1;
    ctx.setTransform(dsave, 0, 0, dsave, 0, 0);
    this.drawMinimap(ctx);
    this.drawDepthBadge();
    this.drawToasts();
    /* 뷰포트를 픽셀 테두리로 감싼다 — 화면 안에 "떠 있는 느낌" 을 없앤다 */
    pxFrame(ctx, 0, 0, this.screenW, this.screenH);
    ctx.setTransform(dsave * zsave, 0, 0, dsave * zsave, 0, 0);
    return busy;
  };

  /* 최근 메시지 — 캔버스 아래쪽에 쌓아 올리고 서서히 사라진다.
   * 아래가 최신이다(기록 패널과 같은 순서라 헷갈리지 않는다). */
  /* 한 줄이 상자보다 길면 접어서 여러 줄로 만든다.
   * ⚠ 휴대폰에서는 **토스트가 유일한 기록이다**(기록 패널을 감췄다). 그래서 넘치는
   *   글을 잘라 버리면 정보가 통째로 사라진다 — 실측 390px 에서 "관리소 장부에
   *   층수 칸만 비워 두고 계단을 내려간다. 10층 아래에" 가 오른쪽으로 새어 나갔다.
   * ⚠ 말줄임(…)도 쓰지 않는다. 같은 이유다 — 접는다.
   * ⚠ 한국어는 띄어쓰기가 드물어 한 덩어리가 상자보다 길 수 있다. 그때는
   *   글자 단위로 끊는다(안 그러면 그 줄만 다시 새어 나간다). */
  function wrapText(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return [text];
    var out = [], words = String(text).split(" "), line = "";
    function pushHard(chunk) {
      var cur = "";
      for (var c = 0; c < chunk.length; c++) {
        if (ctx.measureText(cur + chunk[c]).width > maxW && cur) { out.push(cur); cur = ""; }
        cur += chunk[c];
      }
      return cur;
    }
    for (var i = 0; i < words.length; i++) {
      var probe = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(probe).width <= maxW) { line = probe; continue; }
      if (line) { out.push(line); line = ""; }
      if (ctx.measureText(words[i]).width > maxW) line = pushHard(words[i]);
      else line = words[i];
    }
    if (line) out.push(line);
    return out;
  }

  Renderer.prototype.drawToasts = function () {
    if (!this.toasts.length) return;
    var ctx = this.ctx;
    var lh = 20, pad = 9, left = 14;
    var maxW = Math.max(60, this.screenW - left * 2 - pad * 2);
    ctx.font = "600 12.5px " + (global.TOAST_FONT || '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif');
    ctx.textBaseline = "middle";

    /* 먼저 전부 접어 줄 수를 센다 — 아래가 최신이라 총 높이를 알아야 자리가 정해진다 */
    var blocks = [], total = 0, i, j;
    for (i = 0; i < this.toasts.length; i++) {
      var m = this.toasts[i];
      var lines = wrapText(ctx, m.text, maxW);
      blocks.push({ m: m, lines: lines });
      total += lines.length;
    }
    /* 화면보다 높으면 오래된 것부터 버린다 — 게임을 덮으면 안 된다 */
    var room = Math.max(1, Math.floor((this.screenH - 60) / lh));
    while (total > room && blocks.length > 1) { total -= blocks[0].lines.length; blocks.shift(); }

    var y = this.screenH - 12 - (total - 1) * lh;
    /* 그린 상자를 남긴다 — 캔버스 위 글자는 DOM 넘침 검사에 안 잡히므로
     * 점검기가 이 값으로 "새어 나갔는가" 를 센다. */
    this.toastBoxes = [];
    for (i = 0; i < blocks.length; i++) {
      var bl = blocks[i], t = bl.m.t;
      /* 마지막 25% 구간에서만 사라진다 — 바로 흐려지면 읽을 시간이 없다 */
      var al = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25);
      var color = TONE_COLOR[bl.m.tone] || TONE_COLOR[""];
      for (j = 0; j < bl.lines.length; j++) {
        var w = ctx.measureText(bl.lines[j]).width + pad * 2;
        ctx.globalAlpha = al * 0.78;
        ctx.fillStyle = "#0b0a0f";
        ctx.fillRect(left, y - lh / 2 + 1, w, lh - 2);
        ctx.globalAlpha = al * 0.5;
        ctx.fillStyle = color;
        ctx.fillRect(left, y - lh / 2 + 1, 2, lh - 2);      /* 색 띠로 종류를 표시 */
        ctx.globalAlpha = al;
        ctx.fillStyle = color;
        ctx.fillText(bl.lines[j], left + pad, y);
        this.toastBoxes.push({ left: left, right: left + w, top: y - lh / 2, bottom: y + lh / 2,
                               text: bl.lines[j] });
        y += lh;
      }
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  };

  /* 층 표시 — 예전엔 검은 사각형에 글자였다. 깊이가 한눈에 읽히도록
   * 칸을 10개 찍어 현재 층을 채운다(장부의 눈금처럼). */
  Renderer.prototype.drawDepthBadge = function () {
    var g = this.game, ctx = this.ctx;
    var DATA = global.DATA;
    var max = DATA.MAX_DEPTH;
    var zone = DATA.zoneAt(g.depth);
    /* ⚠ 구역 이름이 들어가면서 상자가 넓어졌다 — 눈금 폭이 아니라 **글자 폭**으로
     *   재야 한다(이름 길이가 구역마다 다르다). */
    ctx.font = "600 11px " + (global.TOAST_FONT || '"Pretendard Variable", Pretendard, sans-serif');
    var nameW = ctx.measureText(zone.name).width;
    /* ⚠ 좌상단은 미니맵이 쓴다. 층 표시는 **우하단**으로 옮겼다(제안서 배치).
     *   둘 다 왼쪽 위에 두면 겹친다.
     * ⚠ 좁은 화면에서는 **우상단**이다. 아래쪽은 토스트가 넓게 깔려 우하단에
     *   두면 가린다(390px 에서 실제로 가렸다). 위쪽은 미니맵 옆이 비어 있다. */
    var w = Math.max(14 + max * 9, nameW + 20), h = 54;
    var narrow = this.screenW < 620;
    var x = Math.max(12, this.screenW - w - 12);
    var y = narrow ? 12 : Math.max(12, this.screenH - h - 12);

    ctx.fillStyle = "rgba(10,9,7,.86)";
    ctx.fillRect(x, y, w, h);
    pxFrame(ctx, x, y, w, h);

    ctx.font = "600 11px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#8b8477";
    ctx.fillText("심연", x + 8, y + 15);
    ctx.font = "700 12px ui-monospace, Consolas, monospace";
    ctx.fillStyle = "#c9a227";
    ctx.fillText(g.depth + " / " + max + "층", x + 38, y + 15);

    /* 구역 이름 — 어디까지 내려왔는지가 숫자만으로는 안 읽힌다 */
    ctx.font = "600 11px " + (global.TOAST_FONT || '"Pretendard Variable", Pretendard, sans-serif');
    ctx.fillStyle = "#ded6c2";
    ctx.fillText(zone.name, x + 8, y + 31);

    /* 눈금 — 지나온 층은 채운다. **구역이 바뀌는 자리에 틈을 준다** —
     * 그래야 열 칸이 다섯 구역으로 읽힌다(그냥 열 칸이면 그냥 열 칸이다). */
    var zi = 0, gap = 0;
    for (var i = 1; i <= max; i++) {
      var z = DATA.zoneAt(i);
      if (i > 1 && z !== DATA.zoneAt(i - 1)) gap += 3;
      var bx = x + 7 + (i - 1) * 8 + gap, by = y + 38, bw = 6, bh = 10;
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

  /* ghost 를 주면 그만큼 어두운 띠를 **뒤에** 깔고 그 위에 현재 값을 그린다.
   * ⚠ drawHud 는 innerHTML 로 통째로 다시 그린다 — 그래서 CSS transition 이
   *   안 먹는다(새 요소는 처음부터 최종 너비다). 줄어드는 것은 그림 고리가 민다. */
  function meter(cur, max, cls, label, ghost) {
    var pct = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
    var gp = (ghost !== undefined && ghost > pct) ? Math.min(100, ghost) : 0;
    return '<div class="meter ' + cls + '">' +
             (gp ? '<em class="ghost" style="width:' + gp.toFixed(1) + '%"></em>' : "") +
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
        /* ⚠ 특화 이름은 사이드바 `.who` 에만 있었다. 그 줄이 HUD 와 통째로
         *   겹쳐서 없앴으므로(css 참조) **여기로 옮겨 왔다.** 옮기기 전에
         *   지우면 특화가 어디에도 안 보인다. */
        '<div class="hud-name"><b>' + esc(c.name) + "</b><em>" + esc(c.title) +
          (p.specName ? " · " + esc(p.specName) : "") + "</em></div>" +
      "</div>" +
      '<div class="hud-bars">' +
        meter(p.hp, mx, "hp", hpLabel, this.hudGhost) +
        meter(Math.max(0, p.xp - prev), Math.max(1, need - prev), "xp", "경험") +
      "</div>" +
      (ails.length ? '<div class="hud-ail">' + ails.join("") + "</div>" : "") +
      '<div class="hud-num">' +
        '<span><em>Lv</em><b>' + p.level + "</b></span>" +
        '<span class="d"><b>' + g.depth + "</b>층</span>" +
        '<span class="g"><b>' + g.gold.toLocaleString() + "</b>금</span>" +
      "</div>";

    /* 이 회차의 닳는 띠를 붙잡아 둔다 — 그림 고리가 매 프레임 너비를 줄인다 */
    this.hudGhostEl = el.querySelector(".meter.hp .ghost");
    var hpPct = mx > 0 ? Math.max(0, Math.min(100, (p.hp / mx) * 100)) : 0;
    if (this.hudGhost === undefined || this.hudGhost < hpPct) this.hudGhost = hpPct;

    var art = el.querySelector(".hud-art");
    if (art) {
      var x = art.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, 32, 32);
      /* 몸 → 갑옷 → 무기. 지도와 **같은 순서**여야 한다 */
      drawFigure(x, g.player, art.getAttribute("data-sprite"), 0, null, 0, 0);
    }
  };

  /* 유물 목록. full=true 면 설명까지 편다(장비 창용). */
  function relicHtml(g, full) {
    var ids = g.player.relics || [];
    if (!ids.length) return full ? '<div class="empty">아직 유물이 없다.</div>' : "";
    var DATA = global.DATA, out = "";
    for (var i = 0; i < ids.length; i++) {
      var d = DATA.byId(DATA.RELICS, ids[i]);
      if (!d) continue;
      out += '<div class="relic-row"' + (full ? "" : ' title="' + esc(d.note) + '"') + ">" +
        '<b>' + esc(d.name) + "</b>" +
        (full ? '<em>' + esc(d.note) + "</em>" : "") +
        "</div>";
    }
    return '<div class="relics' + (full ? " full" : "") + '">' +
           (full ? "" : '<u>유물</u>') + out + "</div>";
  }

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
        '<em>' + esc(c.name) + (p.specName ? " · " + esc(p.specName) : "") + " · Lv." + p.level + "</em>" +
      "</div>" +
      '<span class="who-gold"><i class="ic ic-gold"></i>' + g.gold.toLocaleString() + "<i>금</i></span>" +
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

    /* ⚠ 스킬 네 칸은 **여기 없다.** 화면 아래 가운데(`drawQuick`)로 옮겼다.
     *   사이드바에 있으면 싸우는 중에 시선이 오른쪽 끝까지 갔다 와야 하고,
     *   사이드바 세로도 네 줄 먹는다. 같은 것을 두 군데서 그리지 않는다. */

    /* 핵심 수치 — **한 줄**이다.
     * ⚠ 2×2 상자표였다. 네 칸에 테두리를 두르니 좁은 화면에서 세로를 80px 넘게
     *   먹었는데, 담긴 것은 숫자 네 개뿐이었다(사용자 지적: "표로 보여주지 말고
     *   그냥 간략하게"). 같은 정보를 한 줄에 담으면 20px 다. */
    /* ⚠ 아이콘을 글자 **앞**에 둔다. 반복되는 네 수치를 눈이 모양으로 먼저
     *   집으므로 읽는 속도가 달라진다(제안서 원칙 3). */
    html += '<div class="stat-line">' +
      '<span><i class="ic ic-atk"></i><em>공격</em><b>' + g.power() + "</b></span>" +
      '<span><i class="ic ic-def"></i><em>방어</em><b>' + g.guard() + "</b></span>" +
      '<span><i class="ic ic-crit"></i><em>치명</em><b>' + pct(st.crit) + "</b><s>×" + st.critMult.toFixed(1) + "</s></span>" +
      '<span><i class="ic ic-ail"></i><em>이상</em><b>' + pct(st.ailChance) + "</b></span>" +
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

    /* 유물 — 규칙을 바꾸는 것들이라 **무엇을 갖고 있는지 늘 보여야 한다.**
     * 안 보이면 "왜 이렇게 되지" 를 설명할 길이 없다. */
    html += relicHtml(g, false);

    /* 장비 — 등급 색으로 한눈에 */
    /* ⚠ 빈 칸도 **보여 준다.** 비어 있다는 것이 정보다(제안서: "빈 칸도 정보").
     *   안 보여 주면 보조 장비를 낄 수 있다는 것조차 모른다. */
    /* ⚠ 칸을 키웠다. 스킬 네 줄이 빠져나간 자리를 여기에 쓴다.
     *   아이콘·칸 이름·물건 이름·수치가 **각자 제 줄**을 갖는다. 전에는 한 줄에
     *   밀어 넣어 물건 이름이 말줄임으로 잘렸다. */
    html += '<div class="equip">';
    var slots = [["weapon", "무기", "ic-atk"], ["armor", "갑옷", "ic-armor"], ["offhand", "보조", "ic-off"]];
    for (var q = 0; q < slots.length; q++) {
      var it = p[slots[q][0]];
      html += '<div class="eq-row' + (it ? "" : " none") + '">' +
        '<span class="eq-slot' + (it ? " on" + rarCls(it) : "") + '"><i class="ic ' + slots[q][2] + '"></i></span>' +
        "<em>" + slots[q][1] + "</em>" +
        (it ? '<b class="' + rarCls(it).trim() + '">' + esc(it.name) + "</b><s>+" + it.power + "</s>"
            : '<b class="dim">비어 있다</b>') + "</div>";
    }
    html += "</div>";

    el.innerHTML = html;

    var art = el.querySelector(".who-art");
    if (art) {
      var x = art.getContext("2d");
      x.imageSmoothingEnabled = false;
      /* 몸 → 갑옷 → 무기. 지도와 **같은 순서**여야 한다 */
      drawFigure(x, g.player, art.getAttribute("data-sprite"), 0, null, 0, 0);
    }
  };

  /* ── 스킬 퀵슬롯 ──────────────────────────────────────
   *
   * 화면 아래 가운데. 한 칸에 **셋**이 보인다.
   *   단축키(Q W E R) · 스킬 이름 · 남은 턴
   *
   * ⚠ 쿨다운을 **칸이 차오르는 것**으로 보여 준다. 숫자만 있으면 곁눈으로는
   *   못 읽는다. 턴제라도 싸우는 중에 눈은 지도에 있다.
   * ⚠ 빈 자리도 그린다. 비어 있다는 것이 정보다 — 안 보여 주면 스킬을 넣을
   *   수 있다는 것조차 모른다.
   * ⚠ 이 함수가 스킬을 그리는 **유일한 곳**이다. 사이드바에도 있고 여기에도
   *   있으면 한쪽만 고쳐져 어긋난다.
   */
  var QUICK_KEYS = ["Q", "W", "E", "R"];

  Renderer.prototype.drawQuick = function (el) {
    if (!el) return;
    var g = this.game, p = g.player, DATA = global.DATA;
    var html = "";
    for (var i = 0; i < DATA.SKILL_SLOTS; i++) {
      var s = p.skills[i];
      if (!s) {
        html += '<div class="qs empty"><b class="k">' + QUICK_KEYS[i] + "</b>" +
                '<span class="n">빈 자리</span></div>';
        continue;
      }
      var def = DATA.byId(DATA.SKILLS, s.id);
      var cd = g.skillCd(s);
      var ready = s.cd <= 0;
      /* 남은 만큼 위에서 덮는다 — 덮인 넓이가 곧 남은 턴이다 */
      var left = ready ? 0 : Math.round(s.cd / Math.max(1, cd) * 100);
      html += '<button class="qs' + (ready ? " ready" : "") + '" data-skill="' + i + '"' +
        (ready ? "" : " disabled") +
        ' title="' + esc(def.name) + " — " + esc(def.desc) + '">' +
        '<u style="height:' + left + '%"></u>' +
        '<b class="k">' + QUICK_KEYS[i] + "</b>" +
        '<span class="rk">' + s.rank + "단</span>" +
        '<span class="n">' + esc(def.name) + "</span>" +
        '<span class="cd">' + (ready ? "준비" : s.cd + "턴") + "</span>" +
        "</button>";
    }
    el.innerHTML = html;
  };

  /* ── 장비 창 ──────────────────────────────────────────
   *
   * 휴대폰에서는 사이드바가 27vh 뿐이라 장비·가방·유물이 스크롤 저 아래에 있었다
   * (사용자 지적: "모바일에서 아이템 뭘 얻었는지 너무 불편해"). 한 화면에 모아
   * 언제든 열 수 있게 한다.
   * ⚠ 이 창은 **턴을 쓰지 않는다.** 여는 것만으로 몬스터가 움직이면 정보를 보는
   *   것이 위험해져 아무도 안 열게 된다. */
  Renderer.prototype.drawGear = function (el) {
    var g = this.game, p = g.player, st = g.stats();
    var slots = [["weapon", "무기"], ["armor", "갑옷"], ["offhand", "보조"]];
    var html = '<div class="gear-sec"><h3>착용 중</h3><div class="gear-slots">';
    for (var i = 0; i < slots.length; i++) {
      var it = p[slots[i][0]];
      html += '<div class="gear-slot' + (it ? "" : " none") + '">' +
        '<span class="gs-kind">' + slots[i][1] + "</span>" +
        (it
          ? '<canvas class="gs-art" width="32" height="32" data-sprite="' + esc(it.sprite) + '"></canvas>' +
            '<span class="gs-nm" style="color:' + esc(it.color) + '">' + esc(it.name) + "</span>" +
            '<span class="gs-pw">+' + it.power + "</span>" +
            '<span class="gs-ds">' + g.itemLines(it).map(esc).join(" · ") + "</span>"
          : '<span class="gs-nm">비어 있다</span>') +
        "</div>";
    }
    html += "</div></div>";

    /* 쌓인 옵션 — 내가 무엇이 됐는가 */
    html += '<div class="gear-sec"><h3>지금 나</h3>' +
      '<div class="stat-line wide">' +
        '<span><em>공격</em><b>' + g.power() + "</b></span>" +
        '<span><em>방어</em><b>' + g.guard() + "</b></span>" +
        '<span><em>체력</em><b>' + p.hp + "</b><s>/" + g.maxhp() + "</s></span>" +
        '<span><em>치명</em><b>' + pct(st.crit) + "</b><s>×" + st.critMult.toFixed(1) + "</s></span>" +
        '<span><em>이상</em><b>' + pct(st.ailChance) + "</b></span>" +
        '<span><em>금화</em><b>' + g.gold.toLocaleString() + "</b></span>" +
      "</div>";
    var extra = [];
    function add(label, v, unit) {
      if (!v) return;
      extra.push("<span><em>" + label + "</em><b>" +
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
    html += "</div>";

    html += '<div class="gear-sec"><h3>유물 <small>규칙을 바꾼다</small></h3>' +
      relicHtml(g, true) + "</div>";

    html += '<div class="gear-sec"><h3>가방 <small>눌러서 쓰기 · 길게 눌러 버리기</small></h3>' +
      '<div class="inv" id="gearInv"></div></div>';

    el.innerHTML = html;
    var arts = el.querySelectorAll(".gs-art");
    for (var a = 0; a < arts.length; a++) {
      var x = arts[a].getContext("2d");
      x.imageSmoothingEnabled = false;
      x.drawImage(S.bake(arts[a].getAttribute("data-sprite")), 0, 0);
    }
    this.drawInventory(el.querySelector("#gearInv"));
  };

  /* 가방 — 등급 색 + 옵션 줄. 아이템을 고르는 것이 빌드이므로 옵션이 보여야 한다. */
  Renderer.prototype.drawInventory = function (el) {
    var g = this.game, p = g.player;
    var cap = global.DATA.BAG_MAX;
    var html = "";
    if (!p.inventory.length) html += '<div class="empty">가방이 비어 있다.</div>';
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
    /* 남은 자리를 **한 줄짜리 띠**로 그린다. 몇 칸이 비었는지가 숫자가 아니라
     * 모양으로 보인다(제안서: 슬롯 그리드).
     * ⚠ 칸마다 한 줄씩 그렸더니 빈 칸 다섯이 세로 130px 를 먹어 정작 가진 물건이
     *   스크롤 밖으로 밀렸다. 작은 네모를 한 줄에 늘어놓는 편이 같은 말을 한다.
     * ⚠ button 이 아니라 div 다 — 눌러도 아무 일이 없어야 하고, 점검기가
     *   .inv-item 을 세는 것도 흐트러지면 안 된다. */
    var free = cap - p.inventory.length;
    if (free > 0) {
      /* ⚠ 네모를 스무 개 늘어놓으면 그것대로 시끄럽다. 열두 개까지만 그리고
       *   나머지는 숫자로 말한다. */
      var boxes = Math.min(free, 12);
      html += '<div class="inv-free" title="남은 자리 ' + free + '칸">';
      for (var e = 0; e < boxes; e++) html += "<i></i>";
      html += "<span>남은 자리 " + free + "</span></div>";
    }
    el.innerHTML = html;
  };

/* 기록 한 줄 앞에 붙는 갈래 표. 색만으로는 무슨 일인지 안 읽힌다 —
   * 짧은 말 하나를 앞에 두면 훑어보는 눈이 원하는 줄을 바로 찾는다.
   * ⚠ 톤 이름은 game.js 의 say() 가 정한다. 여기 없는 톤은 뱃지를 안 붙인다 —
   *   모르는 톤에 아무 말이나 붙이면 거짓말이 된다. */
  /* 등급을 **클래스**로 돌려준다. 인라인 색으로는 글자색밖에 못 바꾼다 —
   * 테두리까지 등급색으로 두려면 클래스여야 한다(제안서 지적).
   * ⚠ 클래스 이름의 등급 id 는 data.js 의 RARITY 와 같다. 값을 여기 베껴
   *   적지 말 것 — 색은 style.css 한 곳에만 둔다. */
  function rarCls(it) {
    var r = it && (it.rarity || (it.src && it.src.rarity));
    return r ? " rar-" + r : "";
  }

  var LOG_TAG = {
    hit: "전투", bad: "피해", good: "처치", crit: "치명",
    item: "획득", warn: "주의", depth: "층", level: "성장", win: "승리"
  };

  Renderer.prototype.drawLog = function (el) {
    var log = this.game.log;
    var start = Math.max(0, log.length - 70);
    var html = "";
    for (var i = start; i < log.length; i++) {
      var tag = LOG_TAG[log[i].tone];
      html += '<p class="m ' + log[i].tone + '">' +
              (tag ? '<span class="tag">' + tag + "</span>" : "") +
              esc(log[i].text) + "</p>";
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
      } else if (c.what === "spec") {
        kind = "relic"; title = c.spec.name; tag = "특화 · " + c.spec.tag;
        note = c.spec.note;
      } else if (c.what === "relic") {
        /* ⚠ 유물은 **왜 좋은지**까지 적는다. 규칙을 바꾸는 물건이라 효과만 읽어서는
         *   지금 내 빌드에 맞는지 판단이 안 된다(그러면 아무거나 고르게 된다). */
        kind = "relic"; title = c.relic.name; tag = "유물";
        note = c.relic.note + " — " + c.relic.why;
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
  /* 제단 창 — 한 줄이 곧 거래다. **주는 것과 받는 것을 한 줄에 나란히** 둔다.
   * ⚠ 값을 작은 글씨로 밑에 깔지 않는다. 대가가 눈에 안 들어오면 거래가 아니다. */
  Renderer.prototype.drawAltar = function (el) {
    var g = this.game;
    if (!g.altarPanel) return;
    var html = "";
    for (var i = 0; i < g.altarPanel.length; i++) {
      var r = g.altarPanel[i];
      html += '<button class="altar-row' + (r.poor ? " poor" : "") + '" data-altar="' + r.id + '"' +
        (r.poor ? " disabled" : "") + '>' +
        '<span class="altar-nm">' + r.name + "</span>" +
        '<span class="altar-give">' + r.give + "</span>" +
        '<span class="altar-arrow">→</span>' +
        '<span class="altar-take">' + r.take + "</span>" +
        '<span class="altar-note">' + r.note + "</span>" +
        "</button>";
    }
    el.innerHTML = html;
  };

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
      } else if (row.what === "relic") {
        var rd = DATA.byId(DATA.RELICS, row.relic);
        name = rd.name;
        lines = [rd.note];
        col = "#e0742a";                       /* 유물 등급색과 같은 주황 */
      } else {
        name = g.itemName(row.item);
        lines = g.itemLines(row.item);
        col = row.item.color || g.itemColor(row.item) || null;
      }
      html += '<button class="shop-row' + (row.item ? rarCls(row.item) : "") +
        (row.sold ? " sold" : (can ? "" : " poor")) +
        '" data-buy="' + i + '"' + (row.sold || !can ? " disabled" : "") + ">" +
        '<span class="shop-kind">' +
          (row.what === "skill" ? "스킬" : (row.what === "relic" ? "유물" : "물건")) + "</span>" +
        '<span class="shop-nm' + (row.item ? rarCls(row.item) : "") + '"' +
          (col && !row.item ? ' style="color:' + esc(col) + '"' : "") + ">" + esc(name) + "</span>" +
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
      html += '<button class="shop-row sell' + rarCls(it) + '" data-sell="' + i + '">' +
        '<span class="shop-kind">' + (worn ? "착용" : "가방") + "</span>" +
        '<span class="shop-nm' + rarCls(it) + '">' +
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
  global.TILE_PX = TILE;     /* 점검기가 좌표 변환을 뒤집어 확인하는 데 쓴다 */
  global.ZOOM_RANGE = { min: ZOOM_MIN, max: ZOOM_MAX };
})(window);
