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
  /* 마우스 — **PC 에서 조준은 마우스다.** 이것이 손가락 조작과 가장 크게 다른 점이고
   * PC 부터 만들기로 한 이유다(엄지 두 개로는 이동과 조준을 동시에 못 한다). */
  var mouse = { cx: 0, cy: 0, down: false, has: false };

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

    /* 누르고 있으면 계속 휘두른다 — 공격속도는 COMBAT 이 지킨다.
     * ⚠ 여기서 주기를 다시 세지 말 것. 두 곳이 되면 한쪽만 고쳐져 어긋난다. */
    if (mouse.down && !world.player.dead) {
      var a = aim();
      world.swing(a.x, a.y);
    }

    var r = world.advance(dt);
    view.draw(world, r.alpha);

    fps.t += dt; fps.n++;
    if (fps.t >= 0.5) { fps.v = Math.round(fps.n / fps.t); fps.t = 0; fps.n = 0; diag(); }
  }

  /* 마우스가 가리키는 **월드 좌표**. 아직 움직인 적이 없으면 바라보는 쪽으로. */
  function aim() {
    var p = world.player;
    if (!mouse.has) return { x: p.x + p.face, y: p.y };
    return view.toWorld(mouse.cx, mouse.cy);
  }

  function diag() {
    var el = document.getElementById("diag");
    if (!el) return;
    var p = world.player;
    var alive = 0;
    for (var i = 0; i < world.ents.length; i++)
      if (!world.ents[i].dead && world.ents[i].team !== 0) alive++;
    el.textContent = fps.v + "fps · 체력 " + p.hp + "/" + p.maxHp +
      " · 적 " + alive + "마리 · " + world.time.toFixed(1) + "초" +
      (p.dead ? " · 죽었다(R 로 다시)" : "");
  }

  function start(opt) {
    if (raf) cancelAnimationFrame(raf);
    world = new W.World(opt || {});
    last = 0;
    raf = requestAnimationFrame(frame);
    return world;
  }

  /* 배경음은 **첫 조작 뒤에** 켠다.
   * ⚠ 브라우저는 사용자가 뭔가 누르기 전에는 소리를 못 내게 막는다(자동재생 정책).
   *   페이지가 뜨자마자 부르면 조용히 실패하고 그 뒤로 영영 안 나온다. */
  var musicOn = false;
  function wakeAudio() {
    if (musicOn) return;
    musicOn = true;
    if (global.MUSIC) global.MUSIC.zone("office");
  }

  function boot() {
    var canvas = document.getElementById("view");
    view = new V.View(canvas);
    start({});

    global.addEventListener("resize", function () { view.resize(); });
    global.addEventListener("keydown", function (e) {
      wakeAudio();
      if (MOVE[e.code]) { keys[e.code] = 1; e.preventDefault(); }
      if (e.code === "KeyR") start({});
      /* 스페이스로도 친다 — 마우스에 손이 없어도 때릴 수 있어야 한다 */
      if (e.code === "Space") { var a = aim(); world.swing(a.x, a.y); e.preventDefault(); }
    });
    global.addEventListener("keyup", function (e) { keys[e.code] = 0; });

    canvas.addEventListener("mousemove", function (e) {
      mouse.cx = e.clientX; mouse.cy = e.clientY; mouse.has = true;
    });
    canvas.addEventListener("mousedown", function (e) {
      mouse.cx = e.clientX; mouse.cy = e.clientY; mouse.has = true;
      mouse.down = true; wakeAudio(); e.preventDefault();
    });
    /* ⚠ mouseup 을 캔버스에만 걸면, 캔버스 밖에서 손을 떼었을 때 **계속 눌린
     *   상태로 굳는다.** 창 전체에서 받는다. */
    global.addEventListener("mouseup", function () { mouse.down = false; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    /* ⚠ 창에서 초점이 나가면 keyup 이 안 온다 — 누른 채로 굳어 혼자 걸어간다. */
    global.addEventListener("blur", function () { keys = Object.create(null); });

    /* 점검기용 손잡이. 화면을 눈으로 보는 것만으로는 60Hz 규칙이 맞는지 모른다. */
    global.__w = function () { return world; };
    global.__v = function () { return view; };
    global.__fps = function () { return fps.v; };
    global.__wake = wakeAudio;
    global.__music = function () {
      return global.MUSIC ? { zone: global.MUSIC.current(), on: global.MUSIC.isOn() }
                          : { zone: null, on: false };
    };
    global.__start = start;
    global.__hold = function (codes) {
      keys = Object.create(null);
      (codes || []).forEach(function (c) { keys[c] = 1; });
    };
    global.__peek = function () {
      var p = world.player;
      var foes = world.ents.filter(function (e) { return e.team !== 0 && !e.dead; });
      return { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, dead: p.dead,
               steps: world.steps, time: world.time, fps: fps.v,
               foes: foes.length, atk: !!p.atk, rest: p.atkRest };
    };
    /* 검사가 마우스 없이 조준·공격할 수 있어야 한다 */
    global.__swing = function (wx, wy) { return world.swing(wx, wy); };
    global.__aimAt = function (wx, wy) {
      mouse.has = false;                 /* 화면 좌표 대신 월드 좌표를 바로 쓴다 */
      return world.swing(wx, wy);
    };
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
