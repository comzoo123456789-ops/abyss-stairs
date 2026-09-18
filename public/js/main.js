/* 입력과 부팅.
 *
 * 키 배치는 셋을 동시에 받는다 — 방향키 · WASD · 로그라이크 전통(hjklyubn).
 * 대각선이 없으면 몬스터에게 포위당했을 때 빠져나갈 수가 없어서 필수다.
 *
 * ⚠ 줍기는 Space 다(전에는 G 였다). G 도 계속 받는다 — 손에 익은 사람이 있고,
 *   받아 두는 비용이 0 이다. 대신 화면 안내 문구는 Space 하나로 통일한다.
 */
(function () {
  "use strict";

  var game, view;
  var els = {};

  /* 이동은 **화살표 4방향만** 이다. dx, dy
   *
   * ⚠ WASD·HJKL·YUBN·숫자패드를 되살리지 말 것. 대각선을 없앤 결정이라
   *   YUBN 을 남겨 두면 그 키로만 대각 이동이 되어 규칙이 두 개가 된다.
   *   몬스터도 4방향으로 움직이고 근접 판정도 4방향이다(js/game.js 의 adjacent). */
  var MOVE = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0]
  };

  function refresh() {
    view.draw();
    view.drawStats(els.stats);
    view.drawInventory(els.inv);
    view.drawLog(els.log);
    els.seed.textContent = "#" + game.seed.toString(16).toUpperCase();
    var ab = document.getElementById("abilityBtn");
    if (ab) ab.addEventListener("click", function () { game.useAbility(); afterAction(); });
    if (game.over) showEnd();
  }

  /* 플레이어 체력이 줄었으면 화면을 흔든다 — 로그만 보고는 맞은 줄 모른다. */
  var lastHp = null;
  function afterAction() {
    if (lastHp !== null && game.player.hp < lastHp) view.hurt();
    lastHp = game.player.hp;
    refresh();
  }

  function started() { return els.start.hidden; }

  function onKey(e) {
    /* 시작 화면에서는 1·2·3 으로 직업을 고른다 */
    if (!started()) {
      if (e.key >= "1" && e.key <= "3") {
        e.preventDefault();
        var c = window.DATA.CLASSES[parseInt(e.key, 10) - 1];
        if (c) newGame(c.id);
      }
      return;
    }
    if (els.end.hidden === false) {
      if (e.key === "Enter" || e.key === " " || e.key === "r" || e.key === "R") {
        e.preventDefault();
        showStart();
      }
      return;
    }
    if (els.help.hidden === false) {
      e.preventDefault();
      els.help.hidden = true;
      return;
    }

    var k = e.key;
    var mv = MOVE[k];
    if (mv) {
      e.preventDefault();
      game.move(mv[0], mv[1]);
      afterAction();
      return;
    }

    /* ⚠ Space 는 줍기다. 기본 동작(페이지 스크롤·버튼 재클릭)을 반드시 막는다 —
     *   안 막으면 마지막으로 누른 버튼이 다시 눌린다. */
    if (k === " " || e.code === "Space" || k === "g" || k === "G" || k === ",") {
      e.preventDefault(); game.pickUp(); afterAction(); return;
    }
    if (k === "." || e.code === "Numpad5") {
      e.preventDefault(); game.wait(); afterAction(); return;
    }
    if (k === "q" || k === "Q") {
      e.preventDefault(); game.useAbility(); afterAction(); return;
    }
    if (k === ">" || k === "Enter") {
      e.preventDefault(); game.descendIfStairs(); afterAction(); return;
    }
    if (k >= "1" && k <= "9") {
      e.preventDefault(); game.useItem(parseInt(k, 10) - 1); afterAction(); return;
    }
    if (k === "m" || k === "M") {
      e.preventDefault(); toggleSound(); return;
    }
    if (k === "?" || k === "/") {
      e.preventDefault(); els.help.hidden = false; return;
    }
    if (k === "Escape") {
      els.help.hidden = true; return;
    }
  }

  function showEnd() {
    var g = game;
    els.endTitle.textContent = g.won ? "던전을 정복했다" : "쓰러졌다";
    els.endTitle.className = g.won ? "win" : "lose";
    els.endBody.innerHTML =
      '<div class="score">' + g.score().toLocaleString() + "<em>점</em></div>" +
      "<dl>" +
      "<div><dt>직업</dt><dd>" + g.cls.name + "</dd></div>" +
      "<div><dt>도달 층</dt><dd>" + g.depth + "층</dd></div>" +
      "<div><dt>레벨</dt><dd>" + g.player.level + "</dd></div>" +
      "<div><dt>처치</dt><dd>" + g.kills + "체</dd></div>" +
      "<div><dt>금화</dt><dd>" + g.gold.toLocaleString() + "</dd></div>" +
      "<div><dt>턴</dt><dd>" + g.turn.toLocaleString() + "</dd></div>" +
      "</dl>";
    els.end.hidden = false;
    saveBest(g.score());
  }

  /* 최고점만 로컬에 남긴다. 세이브는 두지 않는다 —
   * 죽으면 끝인 것이 로그라이크의 규칙이고, 되돌리기가 있으면 긴장이 사라진다. */
  function saveBest(score) {
    try {
      var best = parseInt(localStorage.getItem("rl_best") || "0", 10);
      if (score > best) { localStorage.setItem("rl_best", String(score)); best = score; }
      els.best.textContent = best.toLocaleString();
    } catch (err) { /* 시크릿 모드 등 — 점수 저장이 안 되는 것뿐이라 무시한다 */ }
  }

  function loadBest() {
    try {
      els.best.textContent = parseInt(localStorage.getItem("rl_best") || "0", 10).toLocaleString();
    } catch (err) { els.best.textContent = "0"; }
  }

  /* ── 시작 화면 ──────────────────────────────────────── */

  function drawClasses() {
    var html = "";
    var list = window.DATA.CLASSES;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      html += '<button class="cls-card" data-cls="' + c.id + '">' +
        '<span class="cls-key">' + (i + 1) + "</span>" +
        '<canvas class="cls-art" width="96" height="96" data-sprite="' + c.sprite + '"></canvas>' +
        '<span class="cls-name">' + c.name + "</span>" +
        '<span class="cls-title">' + c.title + " · " + c.age + "</span>" +
        '<span class="cls-story">' + c.story + "</span>" +
        '<span class="cls-stats">체력 <b>' + c.hp + "</b> · 공격 <b>" + c.atk + "</b> · 방어 <b>" + c.def + "</b></span>" +
        '<span class="cls-ability">「' + c.ability.name + "」 " + c.ability.desc + "</span>" +
        '<span class="cls-blurb">' + c.blurb + "</span>" +
        "</button>";
    }
    els.classes.innerHTML = html;

    /* 직업 카드에 실제 도트 그림을 넣는다 — 글자만 있으면 누구를 고르는지 안 와닿는다.
     * ⚠ 32px 스프라이트를 96px 로 키우므로 정수배(3배)여야 한다. 3.5배 같은 값을 쓰면
     *   픽셀이 뭉개져 도트가 아니게 된다. */
    var arts = els.classes.querySelectorAll(".cls-art");
    for (var a = 0; a < arts.length; a++) {
      var cv = arts[a];
      var baked = window.SPRITES.bake(cv.getAttribute("data-sprite"));
      var x = cv.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.drawImage(baked, 0, 0, 32, 32, 0, 0, 96, 96);
    }
  }

  function showStart() {
    els.end.hidden = true;
    els.start.hidden = false;
  }

  function newGame(classId) {
    els.start.hidden = true;
    els.end.hidden = true;
    game = new window.Game(classId);
    view.game = game;
    lastHp = game.player.hp;
    view.resize();
    refresh();
  }

  function toggleSound() {
    if (!window.SFX) return;
    var on = window.SFX.toggle();
    els.soundBtn.textContent = on ? "소리" : "소리 끔";
    els.soundBtn.classList.toggle("off", !on);
  }

  function boot() {
    els.stats = document.getElementById("stats");
    els.inv = document.getElementById("inv");
    els.log = document.getElementById("log");
    els.end = document.getElementById("end");
    els.endTitle = document.getElementById("endTitle");
    els.endBody = document.getElementById("endBody");
    els.help = document.getElementById("help");
    els.best = document.getElementById("best");
    els.seed = document.getElementById("seed");
    els.start = document.getElementById("start");
    els.classes = document.getElementById("classes");
    els.soundBtn = document.getElementById("soundBtn");

    var canvas = document.getElementById("view");
    game = new window.Game("warrior");     /* 시작 화면 뒤에 깔릴 판 — 고르면 새로 만든다 */
    view = new window.Renderer(canvas, game);
    lastHp = game.player.hp;

    drawClasses();
    els.classes.addEventListener("click", function (e) {
      var btn = e.target.closest(".cls-card");
      if (btn) newGame(btn.getAttribute("data-cls"));
    });

    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", function () { view.resize(); refresh(); });

    /* 인벤토리는 클릭으로도 쓴다 — 숫자키를 외우게 강요하지 않는다 */
    els.inv.addEventListener("click", function (e) {
      var btn = e.target.closest(".inv-item");
      if (!btn) return;
      game.useItem(parseInt(btn.getAttribute("data-idx"), 10));
      afterAction();
    });

    /* 오른쪽 버튼 = 버리기(가방 자리 비우기).
     * ⚠ 브라우저 기본 메뉴를 반드시 막는다 — 안 막으면 메뉴가 떠서 눌린 줄 모른다. */
    els.inv.addEventListener("contextmenu", function (e) {
      var btn = e.target.closest(".inv-item");
      if (!btn) return;
      e.preventDefault();
      game.dropItem(parseInt(btn.getAttribute("data-idx"), 10));
      afterAction();
    });

    /* 터치에는 오른쪽 버튼이 없다 — 길게 누르면 버린다(0.45초).
     * 안 넣으면 휴대폰에서는 가방을 비울 방법이 아예 없다. */
    var holdTimer = null, holdIdx = -1, holdFired = false;
    els.inv.addEventListener("touchstart", function (e) {
      var btn = e.target.closest(".inv-item");
      if (!btn) return;
      holdIdx = parseInt(btn.getAttribute("data-idx"), 10);
      holdFired = false;
      holdTimer = setTimeout(function () {
        holdFired = true;
        game.dropItem(holdIdx);
        afterAction();
      }, 450);
    }, { passive: true });
    function cancelHold() { if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; } }
    els.inv.addEventListener("touchend", function (e) {
      cancelHold();
      /* 길게 눌러 이미 버렸으면 그 뒤의 click(=사용)을 막는다 */
      if (holdFired) { e.preventDefault(); holdFired = false; }
    });
    els.inv.addEventListener("touchmove", cancelHold, { passive: true });
    els.inv.addEventListener("touchcancel", cancelHold, { passive: true });

    document.getElementById("again").addEventListener("click", showStart);
    document.getElementById("helpBtn").addEventListener("click", function () { els.help.hidden = false; });
    document.getElementById("helpClose").addEventListener("click", function () { els.help.hidden = true; });
    els.soundBtn.addEventListener("click", toggleSound);
    els.help.addEventListener("click", function (e) {
      if (e.target === els.help) els.help.hidden = true;
    });

    if (window.SFX && !window.SFX.isOn()) {
      els.soundBtn.textContent = "소리 끔";
      els.soundBtn.classList.add("off");
    }

    /* 터치 기기면 방향 패드를 띄운다.
     * ⚠ CSS 의 `@media (pointer: coarse)` 에만 기대면 그 판정이 어긋나는 기기에서
     *   패드가 안 뜨는데, 휴대폰에는 키보드가 없어 **조작 수단이 아예 없어진다**.
     *   JS 로도 한 번 더 보고, 그래도 안 맞으면 사람이 직접 켤 수 있게 둔다. */
    var isTouch = (navigator.maxTouchPoints > 0) || ("ontouchstart" in window) ||
                  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (isTouch) document.body.classList.add("is-touch");

    var padBtn = document.getElementById("padBtn");
    try {
      if (localStorage.getItem("rl_pad") === "1") document.body.classList.add("pad-on");
      if (localStorage.getItem("rl_pad") === "0") document.body.classList.add("pad-off");
    } catch (err) { /* 저장이 막힌 브라우저 — 토글이 이번 판만 유지될 뿐이다 */ }

    padBtn.addEventListener("click", function () {
      var showing = getComputedStyle(document.querySelector(".pad")).display !== "none";
      document.body.classList.remove("pad-on", "pad-off");
      document.body.classList.add(showing ? "pad-off" : "pad-on");
      try { localStorage.setItem("rl_pad", showing ? "0" : "1"); } catch (err) {}
      view.resize();
      refresh();
    });

    /* 패드 버튼은 touchstart 에서 바로 처리한다.
     *
     * ⚠ click 만 쓰면 두 가지가 나쁘다:
     *   ① 브라우저가 더블탭 여부를 보려고 ~300ms 기다려 연타가 뚝뚝 끊긴다.
     *   ② 연달아 누르면 더블탭으로 판정해 **화면이 확대된다**(이동이 통째로 불편해진다).
     *   touchstart 에서 preventDefault 하면 둘 다 사라진다. 대신 그 뒤에 따라오는
     *   합성 click 을 막아야 한 번 누른 것이 두 번 먹지 않는다. */
    function bindPress(el, fn) {
      if (!el) return;
      var touched = false;
      el.addEventListener("touchstart", function (e) {
        e.preventDefault();          /* 확대·지연·합성 click 을 한 번에 막는다 */
        touched = true;
        fn();
      }, { passive: false });
      el.addEventListener("click", function () {
        if (touched) { touched = false; return; }   /* 터치로 이미 처리했다 */
        fn();
      });
    }

    document.querySelectorAll("[data-dir]").forEach(function (b) {
      var p = b.getAttribute("data-dir").split(",");
      var dx = parseInt(p[0], 10), dy = parseInt(p[1], 10);
      bindPress(b, function () { game.move(dx, dy); afterAction(); });
    });
    bindPress(document.getElementById("btnPick"), function () { game.pickUp(); afterAction(); });
    bindPress(document.getElementById("btnDown"), function () { game.descendIfStairs(); afterAction(); });
    bindPress(document.getElementById("btnWait"), function () { game.wait(); afterAction(); });
    bindPress(document.getElementById("btnAbility"), function () { game.useAbility(); afterAction(); });

    loadBest();
    view.resize();
    refresh();

    /* 점검기(tools/check.mjs)가 상태를 읽을 창구. 게임 로직은 이걸 쓰지 않는다 —
     * 화면에 드러난 값만 보고 검사하면 "안 움직였다" 를 "로그가 안 늘었다" 로 오독한다. */
    window.__peek = function () {
      return {
        depth: game.depth, turn: game.turn, over: game.over, won: game.won,
        x: game.player.x, y: game.player.y,
        hp: game.player.hp, maxhp: game.player.maxhp,
        level: game.player.level, xp: game.player.xp,
        atk: game.power(), def: game.guard(),
        cls: game.cls.id, cooldown: game.player.cooldown,
        monsters: game.monsters.length, items: game.items.length,
        bag: game.player.inventory.length,
        seed: game.seed,
        started: els.start.hidden,
        stairs: { x: game.level.downAt.x, y: game.level.downAt.y },
        onStairs: game.level.at(game.player.x, game.player.y) === window.DUNGEON.STAIRS,
        traps: (function () { var n = 0, t = game.level.traps; for (var i = 0; i < t.length; i++) if (t[i]) n++; return n; })(),
        treasure: !!game.level.treasure
      };
    };
    window.__start = function (id) { newGame(id); };

    /* 점검기가 길을 찾을 수 있게 통행 가능 여부만 넘긴다(지형 종류는 안 넘긴다).
     * 탐욕적 이동만으로는 L 자 복도에서 막혀 계단에 못 닿았다 — 908턴 동안 1층이었다. */
    window.__map = function () {
      var lv = game.level, walk = [];
      for (var y = 0; y < lv.h; y++)
        for (var x = 0; x < lv.w; x++) walk.push(lv.blocked(x, y) ? 0 : 1);
      return { w: lv.w, h: lv.h, walk: walk };
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
