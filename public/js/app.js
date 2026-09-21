/* 띄우기 · 입력 · 주 순환.
 *
 * ⚠ 규칙(WORLD)과 그리기(VIEW)를 여기서만 잇는다. 둘이 서로를 부르면
 *   "화면을 고쳤는데 규칙이 달라지는" 일이 생긴다.
 * ⚠ 지금은 **PC 웹만** 본다. 손가락 조작은 뼈대가 선 뒤에 붙인다 —
 *   조작을 둘로 두고 시작하면 둘 다 반쯤 된 채로 굳는다.
 */
(function (global) {
  "use strict";

  var W = global.WORLD, V = global.VIEW;
  var world = null, view = null;
  var keys = Object.create(null);
  var last = 0, raf = 0;
  var fps = { t: 0, n: 0, v: 0 };

  /* 키 → 방향. e.code 로 읽는다 —
   * ⚠ e.key 로 읽으면 한글 입력 상태에서 "ㅏ" 같은 값이 와서 조작이 통째로 죽는다.
   *   실제로 겪은 적 있다(게임에서 가장 흔한 한국어권 버그다). */
  var MOVE = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1],  ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0],  ArrowRight: [1, 0]
  };

  function intent() {
    var x = 0, y = 0;
    for (var k in keys) {
      if (!keys[k]) continue;
      var d = MOVE[k];
      if (d) { x += d[0]; y += d[1]; }
    }
    /* ⚠ 반대 방향을 함께 누르면 0 이 되어야 한다(WD-002 키보드처럼 눌림이
     *   남는 경우가 있다). 합으로 두면 저절로 상쇄된다 — 정규화는 규칙 쪽에서 한다. */
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;

    var i = intent();
    world.player.mx = i.x;
    world.player.my = i.y;

    var r = world.advance(dt);
    view.draw(world, r.alpha);

    fps.t += dt; fps.n++;
    if (fps.t >= 0.5) { fps.v = Math.round(fps.n / fps.t); fps.t = 0; fps.n = 0; diag(); }
  }

  function diag() {
    var el = document.getElementById("diag");
    if (!el) return;
    var p = world.player;
    el.textContent = fps.v + "fps · " + p.x.toFixed(2) + ", " + p.y.toFixed(2) +
      " · 걸음 " + world.steps + " · " + world.time.toFixed(1) + "초";
  }

  function start(opt) {
    if (raf) cancelAnimationFrame(raf);
    world = new W.World(opt || {});
    last = 0;
    raf = requestAnimationFrame(frame);
    return world;
  }

  function boot() {
    var canvas = document.getElementById("view");
    view = new V.View(canvas);
    start({});

    global.addEventListener("resize", function () { view.resize(); });
    global.addEventListener("keydown", function (e) {
      if (MOVE[e.code]) { keys[e.code] = 1; e.preventDefault(); }
      if (e.code === "KeyR") start({});
    });
    global.addEventListener("keyup", function (e) { keys[e.code] = 0; });
    /* ⚠ 창에서 초점이 나가면 keyup 이 안 온다 — 누른 채로 굳어 혼자 걸어간다. */
    global.addEventListener("blur", function () { keys = Object.create(null); });

    /* 점검기용 손잡이. 화면을 눈으로 보는 것만으로는 60Hz 규칙이 맞는지 모른다. */
    global.__w = function () { return world; };
    global.__v = function () { return view; };
    global.__fps = function () { return fps.v; };
    global.__start = start;
    global.__hold = function (codes) {
      keys = Object.create(null);
      (codes || []).forEach(function (c) { keys[c] = 1; });
    };
    global.__peek = function () {
      var p = world.player;
      return { x: p.x, y: p.y, steps: world.steps, time: world.time, fps: fps.v };
    };
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
