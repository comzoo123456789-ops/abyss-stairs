/* 세계 — 실시간 모의. **턴이 없다.**
 *
 * 턴제에서는 "한 번 움직인다" 가 곧 시간의 단위였다. 여기서는 시간이 먼저 있고
 * 모두가 그 위에서 움직인다. 그래서 두 가지가 반드시 필요하다.
 *
 * ① **고정 걸음(fixed timestep).** 화면 주사율은 기기마다 다르다(60·120·144Hz).
 *    흐른 시간을 그대로 규칙에 먹이면 **주사율이 높은 기기가 유리해진다** —
 *    부동소수 오차가 다르게 쌓여 같은 조작이 다른 결과를 낸다. 그래서 규칙은
 *    늘 1/60 초씩만 나아가고, 남은 자투리는 다음 프레임으로 넘긴다.
 * ② **그리기와 규칙의 분리.** 규칙이 60번 도는 동안 화면은 144번 그려질 수 있다.
 *    그 사이를 메우려고 지난 위치와 지금 위치를 섞는다(alpha) — 안 하면
 *    120Hz 화면에서 캐릭터가 눈에 띄게 덜덜거린다.
 *
 * ⚠ 속도는 전부 **초당 칸(tiles/sec)** 이다. 프레임당 몇 픽셀 같은 값을 쓰지 말 것 —
 *   그 순간 주사율이 게임 규칙이 된다.
 * ⚠ 위치는 칸 격자가 아니라 **실수 좌표**다. (12.4, 8.7) 은 12번 칸 안의 어딘가다.
 *   던전 생성기는 정수 격자 그대로 쓴다 — 지형은 여전히 칸이고 몸만 자유롭다.
 */
(function (global) {
  "use strict";

  var D = global.DUNGEON;

  var SIM_HZ = 60;
  var SIM_DT = 1 / SIM_HZ;
  /* 창을 오래 감춰 두면 흐른 시간이 몇 초씩 쌓인다. 그걸 한 프레임에 다 따라잡으려
   * 들면 수백 걸음을 돌다가 더 늦어지고, 그 사이 또 시간이 흘러 영영 못 따라잡는다
   * (죽음의 나선). 한 프레임에 밟을 수 있는 걸음 수를 막고 나머지는 **버린다**. */
  var MAX_STEPS = 5;
  var EPS = 1e-4;
  /* 벽에 파고들지 않을 만큼만 띄운다. 너무 크면 문틀에 어깨가 걸린다. */
  var BODY = 0.34;
  var FOV_R = 9;

  /* ── 지형 ──────────────────────────────────────────────── */

  function solid(lv, tx, ty) {
    /* 바깥은 벽으로 친다 — 안 그러면 지도 밖으로 걸어 나간다 */
    if (tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h) return true;
    return lv.tiles[ty * lv.w + tx] === D.WALL;
  }

  /* 몸을 (x,y) 에 두었을 때 벽에 겹치는가.
   * ⚠ 몸을 원이 아니라 **네모**로 본다. 칸 격자에서는 이쪽이 모서리에 안 끼고
   *   결과를 예측하기 쉽다(원으로 두면 대각 모서리에서 미끄러져 빠져나간다).
   * ⚠ x+r 이 딱 정수일 때 floor 가 한 칸 더 집는다 — EPS 로 당겨 준다. */
  function boxFree(lv, x, y, r) {
    var x0 = Math.floor(x - r + EPS), x1 = Math.floor(x + r - EPS);
    var y0 = Math.floor(y - r + EPS), y1 = Math.floor(y + r - EPS);
    for (var ty = y0; ty <= y1; ty++)
      for (var tx = x0; tx <= x1; tx++)
        if (solid(lv, tx, ty)) return false;
    return true;
  }

  /* 한 축씩 따로 옮긴다. 이것이 **벽을 타고 미끄러지는 느낌**의 정체다 —
   * 두 축을 한꺼번에 판정하면 벽에 비스듬히 부딪힌 순간 그 자리에 멈춰 선다.
   * ⚠ 막혔을 때 그냥 안 움직이면 벽과 몸 사이에 최대 한 걸음치 틈이 남아
   *   벽을 따라 걸을 때 덜덜거린다. 벽면에 **딱 붙여** 준다.
   * ⚠ 붙일 때 반드시 원래 자리 쪽으로 clamp 할 것 — 안 하면 막힌 판정이
   *   거꾸로 몸을 벽 **안으로** 밀어 넣는 경우가 생긴다. */
  function slide(lv, e, dx, dy) {
    var hit = 0;
    if (dx) {
      var nx = e.x + dx;
      if (boxFree(lv, nx, e.y, e.r)) e.x = nx;
      else {
        hit |= 1;
        if (dx > 0) e.x = Math.max(e.x, Math.floor(nx + e.r) - e.r - EPS);
        else        e.x = Math.min(e.x, Math.floor(nx - e.r) + 1 + e.r + EPS);
      }
    }
    if (dy) {
      var ny = e.y + dy;
      if (boxFree(lv, e.x, ny, e.r)) e.y = ny;
      else {
        hit |= 2;
        if (dy > 0) e.y = Math.max(e.y, Math.floor(ny + e.r) - e.r - EPS);
        else        e.y = Math.min(e.y, Math.floor(ny - e.r) + 1 + e.r + EPS);
      }
    }
    return hit;
  }

  /* 한 걸음에 반 칸 넘게 움직이면 얇은 벽을 **뚫고 지나간다**(터널링).
   * 지금 속도로는 안 나지만, 나중에 돌진 스킬이 붙으면 반드시 난다 —
   * 그때 원인을 못 찾는 대신 지금 쪼개 둔다. */
  function moveBy(lv, e, dx, dy) {
    var far = Math.max(Math.abs(dx), Math.abs(dy));
    var n = far > 0.4 ? Math.ceil(far / 0.4) : 1;
    var hit = 0;
    for (var i = 0; i < n; i++) hit |= slide(lv, e, dx / n, dy / n);
    return hit;
  }

  /* ── 개체 ──────────────────────────────────────────────── */

  function Entity(o) {
    this.x = o.x; this.y = o.y;
    this.px = o.x; this.py = o.y;      /* 지난 걸음의 자리 — 그리기가 그 사이를 메운다 */
    this.r = o.r === undefined ? BODY : o.r;
    this.spd = o.spd === undefined ? 4.2 : o.spd;   /* 초당 칸 */
    this.face = o.face === undefined ? 1 : o.face;  /* -1 왼쪽 · 1 오른쪽 */
    this.sprite = o.sprite || "warrior";
    this.kind = o.kind || "mob";
    this.walked = 0;                   /* 걸은 거리(칸) — 걷는 그림을 고를 때 쓴다 */
    this.mx = 0; this.my = 0;          /* 이번 걸음에 가려는 방향(정규화) */
  }

  /* ── 세계 ──────────────────────────────────────────────── */

  function World(opt) {
    opt = opt || {};
    var seed = opt.seed === undefined ? (Date.now() & 0x7fffffff) : opt.seed;
    this.seed = seed;
    this.depth = opt.depth || 1;
    this.level = D.generate(opt.w || 56, opt.h || 40, this.depth, seed);
    this.ents = [];
    this.time = 0;          /* 세계가 흐른 초 — 스킬 재사용도 전부 이 값이 기준이다 */
    this.steps = 0;
    this._acc = 0;
    this._fovAt = null;

    var s = this.level.upAt || { x: 2, y: 2 };
    this.player = new Entity({
      x: s.x + 0.5, y: s.y + 0.5, kind: "player", sprite: opt.sprite || "warrior"
    });
    this.ents.push(this.player);
    this.refreshFov();
  }

  World.prototype.refreshFov = function () {
    var tx = Math.floor(this.player.x), ty = Math.floor(this.player.y);
    var k = tx + "," + ty;
    if (k === this._fovAt) return false;
    this._fovAt = k;
    D.computeFov(this.level, tx, ty, FOV_R);
    return true;
  };

  /* 규칙 한 걸음. **여기 들어오는 dt 는 언제나 SIM_DT 다.** */
  World.prototype.step = function () {
    var i, e;
    for (i = 0; i < this.ents.length; i++) {
      e = this.ents[i];
      e.px = e.x; e.py = e.y;
    }

    for (i = 0; i < this.ents.length; i++) {
      e = this.ents[i];
      var mx = e.mx, my = e.my;
      var len = Math.sqrt(mx * mx + my * my);
      if (len > 1e-6) {
        /* ⚠ 대각선을 정규화하지 않으면 **대각이 1.41배 빠르다.** 그러면 모두가
         *   지그재그로만 다닌다(실제로 많은 게임이 이 버그를 달고 나왔다). */
        if (len > 1) { mx /= len; my /= len; }
        var d = e.spd * SIM_DT;
        moveBy(this.level, e, mx * d, my * d);
        var went = Math.abs(e.x - e.px) + Math.abs(e.y - e.py);
        e.walked += went;
        if (Math.abs(mx) > 0.2) e.face = mx > 0 ? 1 : -1;
      }
    }

    this.refreshFov();
    this.time += SIM_DT;
    this.steps++;
  };

  /* 실제로 흐른 시간을 받아 규칙을 따라잡고, 그리기가 쓸 보간값을 돌려준다. */
  World.prototype.advance = function (realDt) {
    if (!(realDt > 0)) realDt = 0;
    if (realDt > 0.25) realDt = 0.25;     /* 탭을 오래 감췄다 돌아온 경우 */
    this._acc += realDt;
    var n = 0;
    while (this._acc >= SIM_DT && n < MAX_STEPS) {
      this.step();
      this._acc -= SIM_DT;
      n++;
    }
    if (n === MAX_STEPS) this._acc = 0;   /* 못 따라잡은 건 버린다 */
    return { steps: n, alpha: this._acc / SIM_DT };
  };

  global.WORLD = {
    SIM_DT: SIM_DT, SIM_HZ: SIM_HZ, BODY: BODY, FOV_R: FOV_R,
    World: World, Entity: Entity,
    boxFree: boxFree, moveBy: moveBy, solid: solid
  };
})(window);
