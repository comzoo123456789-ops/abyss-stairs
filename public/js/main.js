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

  /* ── 그리는 고리 ─────────────────────────────────────────
   *
   * 이동을 부드럽게 하려면 한 번 그리고 끝낼 수 없다. 다만 **가만히 있을 때는
   * 돌리지 않는다** — 턴제 게임이 60fps 로 배터리를 태울 이유가 없다.
   * 애니메이션이 남아 있는 동안만 다음 프레임을 예약하고, 끝나면 멈춘다.
   *
   * ⚠ 규칙은 이 고리와 무관하게 즉시 진행된다. 애니메이션을 기다렸다가 규칙을
   *   돌리면 연타가 밀려 "눌렀는데 안 움직인다" 가 된다. */
  var rafId = 0, lastT = 0;

  /* ── 누르고 있을 때의 걸음 ────────────────────────────────
   *
   * ⚠ OS 키 반복은 애니메이션(115ms)보다 훨씬 빠르다(보통 30ms 간격). 그걸 그대로
   *   받으면 화살표를 쭉 누르는 순간 캐릭터가 지도를 **슝 하고 건너간다**
   *   (사용자 신고: "너무 빨라"). 그래서 ① OS 반복 이벤트(e.repeat)는 **버리고**
   *   ② 우리가 걸음 간격으로 직접 반복한다. 그러면 누르고 있는 동안 일정한
   *   속도로 걷는다 — 애니메이션 한 걸음이 끝나는 자리에서 다음 걸음이 시작된다. */
  var heldKey = null, heldTimer = 0;
  function stepInterval() { return Math.max(60, window.STEP_MS || 120); }

  function startHold(key, mv) {
    stopHold();
    heldKey = key;
    doMove(mv);
    heldTimer = setInterval(function () {
      /* 창이 열리거나 게임이 끝나면 멈춘다 — 모달 뒤에서 계속 걸으면 안 된다 */
      if (!heldKey || game.over || game.busy() || !started()) { stopHold(); return; }
      doMove(MOVE[heldKey]);
    }, stepInterval());
  }
  function stopHold() {
    if (heldTimer) { clearInterval(heldTimer); heldTimer = 0; }
    heldKey = null;
  }
  function doMove(mv) {
    if (!mv) return;
    game.move(mv[0], mv[1]);
    afterAction();
  }

  function loop(now) {
    rafId = 0;
    var dt = lastT ? (now - lastT) : 16;
    lastT = now;
    var busy = view.draw(dt);
    if (busy) rafId = requestAnimationFrame(loop);
    else lastT = 0;
  }

  function kick() {
    if (!rafId) { lastT = 0; rafId = requestAnimationFrame(loop); }
  }

  /* 화면 전체 갱신 — 캔버스는 고리에 맡기고 DOM(상태창·가방·기록)만 여기서 다시 쓴다.
   * DOM 을 매 프레임 다시 쓰면 60fps 로 innerHTML 을 갈아 치우는 셈이라 느려진다. */
  function refresh() {
    view.draw(0);
    kick();
    view.drawHud(els.hud);
    view.drawStats(els.stats);
    view.drawInventory(els.inv);
    view.drawLog(els.log);
    els.seed.textContent = "#" + game.seed.toString(16).toUpperCase();
    /* 스킬 버튼은 매번 다시 그려지므로 그때마다 배선한다 */
    els.stats.querySelectorAll("[data-skill]").forEach(function (b) {
      b.addEventListener("click", function () {
        game.useSkill(parseInt(b.getAttribute("data-skill"), 10));
        afterAction();
      });
    });

    /* 레벨업 선택 — 열려 있으면 다른 조작을 막는다(뒤에서 몬스터가 때리면 안 된다) */
    if (game.pendingPerks) {
      view.drawPerks(els.perkList);
      els.perks.hidden = false;
    } else {
      els.perks.hidden = true;
    }

    if (game.shop) {
      view.drawShop(els.shopBuy, els.shopSell, els.shopGold);
      els.shop.hidden = false;
    } else {
      els.shop.hidden = true;
    }

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
    /* ⚠ 레벨업·상점이 열려 있으면 그쪽 키만 받는다. 안 그러면 모달 뒤에서
     *   캐릭터가 움직여 "뭐가 일어났는지 모르는" 상태가 된다. */
    if (els.perks.hidden === false) {
      if (e.key >= "1" && e.key <= "3") {
        e.preventDefault();
        game.choosePerk(parseInt(e.key, 10) - 1);
        afterAction();
      }
      return;
    }
    if (els.shop.hidden === false) {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); game.closeShop(); refresh(); }
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
      /* ⚠ OS 가 만들어 내는 반복은 버린다 — 우리가 걸음 간격으로 반복한다 */
      if (e.repeat) return;
      startHold(k, mv);
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
    /* 스킬 4칸 — Q W E R */
    var slot = { q: 0, Q: 0, w: 1, W: 1, e: 2, E: 2, r: 3, R: 3 }[k];
    if (slot !== undefined) {
      e.preventDefault(); game.useSkill(slot); afterAction(); return;
    }
    if (k === "f" || k === "F") {
      e.preventDefault(); game.shoot(); afterAction(); return;
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
        '<span class="cls-ability">「' + window.DATA.byId(window.DATA.SKILLS, c.skill).name + "」 " +
          window.DATA.byId(window.DATA.SKILLS, c.skill).desc + "</span>" +
        '<span class="cls-gear">시작 무기: ' + window.DATA.byId(window.DATA.WEAPON_KINDS, c.startWeapon.kind).name + "</span>" +
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

  /* 소리는 **M 키로만** 켜고 끈다 — 헤더 버튼을 지웠다(좁은 화면에서 제목과
   * 폭을 다투다 상태가 들어갈 자리가 없었다). 껐는지는 토스트로 알린다. */
  function toggleSound() {
    if (!window.SFX) return;
    var on = window.SFX.toggle();
    if (!game || !els.start.hidden) return;      /* 시작 화면 — 알릴 데가 없다 */
    game.say(on ? "효과음을 켰다." : "효과음을 껐다.", "");
    refresh();
  }

  function boot() {
    els.hud = document.getElementById("hud");
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
    els.perks = document.getElementById("perks");
    els.perkList = document.getElementById("perkList");
    els.shop = document.getElementById("shop");
    els.shopBuy = document.getElementById("shopBuy");
    els.shopSell = document.getElementById("shopSell");
    els.shopGold = document.getElementById("shopGold");

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
    window.addEventListener("keyup", function (e) { if (e.key === heldKey) stopHold(); });
    /* 창을 떠나면 keyup 을 못 받는다 — 그대로 두면 돌아왔을 때 혼자 걷고 있다 */
    window.addEventListener("blur", stopHold);
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

    els.perkList.addEventListener("click", function (e) {
      var b = e.target.closest("[data-perk]");
      if (!b) return;
      game.choosePerk(parseInt(b.getAttribute("data-perk"), 10));
      afterAction();
    });
    els.shopBuy.addEventListener("click", function (e) {
      var b = e.target.closest("[data-buy]");
      if (!b) return;
      game.buy(parseInt(b.getAttribute("data-buy"), 10));
      refresh();
    });
    els.shopSell.addEventListener("click", function (e) {
      var b = e.target.closest("[data-sell]");
      if (!b) return;
      game.sell(parseInt(b.getAttribute("data-sell"), 10));
      refresh();
    });
    document.getElementById("shopClose").addEventListener("click", function () {
      game.closeShop(); refresh();
    });

    document.getElementById("again").addEventListener("click", showStart);
    document.getElementById("helpClose").addEventListener("click", function () { els.help.hidden = true; });
    els.help.addEventListener("click", function (e) {
      if (e.target === els.help) els.help.hidden = true;
    });

    /* 터치 기기면 방향 패드를 띄운다.
     * ⚠ CSS 의 `@media (pointer: coarse)` 에만 기대면 그 판정이 어긋나는 기기에서
     *   패드가 안 뜨는데, 휴대폰에는 키보드가 없어 **조작 수단이 아예 없어진다**.
     *   JS 로도 한 번 더 보고, 그래도 안 맞으면 사람이 직접 켤 수 있게 둔다. */
    var isTouch = (navigator.maxTouchPoints > 0) || ("ontouchstart" in window) ||
                  (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (isTouch) document.body.classList.add("is-touch");

    /* ⚠ 사람이 켜고 끄는 토글 버튼은 지웠다. 그래서 **전에 껐던 기록도 지운다** —
     *   남겨 두면 그 브라우저에서는 패드가 영영 안 뜨는데 되돌릴 버튼이 없다
     *   (휴대폰에는 키보드가 없으므로 조작 수단이 통째로 사라진다). */
    try { localStorage.removeItem("rl_pad"); } catch (err) {}

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

    /* 터치 패드도 꾹 누르면 걷는 속도로 계속 간다(키보드와 같은 규칙) */
    document.querySelectorAll("[data-dir]").forEach(function (b) {
      var p = b.getAttribute("data-dir").split(",");
      var dx = parseInt(p[0], 10), dy = parseInt(p[1], 10);
      var timer = 0;
      function begin(e) {
        if (e) e.preventDefault();
        doMove([dx, dy]);
        clearInterval(timer);
        timer = setInterval(function () {
          if (game.over || game.busy() || !started()) { clearInterval(timer); timer = 0; return; }
          doMove([dx, dy]);
        }, stepInterval());
      }
      function end() { if (timer) { clearInterval(timer); timer = 0; } }
      b.addEventListener("touchstart", begin, { passive: false });
      b.addEventListener("touchend", end);
      b.addEventListener("touchcancel", end);
      b.addEventListener("mousedown", begin);
      b.addEventListener("mouseup", end);
      b.addEventListener("mouseleave", end);
    });
    bindPress(document.getElementById("btnPick"), function () { game.pickUp(); afterAction(); });
    bindPress(document.getElementById("btnDown"), function () { game.descendIfStairs(); afterAction(); });
    bindPress(document.getElementById("btnWait"), function () { game.wait(); afterAction(); });
    bindPress(document.getElementById("btnShoot"), function () { game.shoot(); afterAction(); });
    document.querySelectorAll("[data-skillbtn]").forEach(function (b) {
      var sl = parseInt(b.getAttribute("data-skillbtn"), 10);
      bindPress(b, function () { game.useSkill(sl); afterAction(); });
    });

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
        cls: game.cls.id,
        skills: game.player.skills.map(function (s) { return { id: s.id, rank: s.rank, cd: s.cd }; }),
        crit: game.stats().crit, critMult: game.stats().critMult,
        ail: Object.keys(game.player.ail),
        perkOpen: !!game.pendingPerks, shopOpen: !!game.shop,
        merchant: !!game.merchant,
        weapon: game.player.weapon ? game.player.weapon.name : null,
        rarity: game.player.weapon ? game.player.weapon.rarity : null,
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
    window.__toasts = function () { return view.toasts.length; };
    window.__start = function (id) { newGame(id); };
    /* 점검기가 창을 닫을 창구 — 상점·레벨업이 열려 있으면 모든 행동이 막히므로
     * 자동 주행이 거기서 멈춘다. 게임 로직은 이 함수들을 쓰지 않는다. */
    /* 점검기가 창을 실제 경로로 띄울 창구 — 화면 모양을 눈으로 보려면 필요하다 */
    window.__force = function (what) {
      if (what === "perk") { game.gainXp(10000); }
      else if (what === "shop") {
        game.gold += 4000;
        if (!game.merchant) game.merchant = { x: game.player.x, y: game.player.y, stock: game.rollShop(game.depth + 2) };
        game.openShop();
      }
      refresh();
    };
    window.__closeShop = function () { game.closeShop(); refresh(); };
    window.__pickPerk = function (i) { game.choosePerk(i || 0); afterAction(); };

    /* 점검기가 "칸 사이에 있는 순간" 을 잡을 창구.
     * ⚠ 논리 좌표만 보면 애니메이션이 도는지 알 수 없다(그건 즉시 바뀐다).
     *   보이는 좌표가 정수가 아닌 순간이 있어야 실제로 보간되는 것이다. */
    window.__vis = function () {
      var v = view.visOf(game.player);
      return { vx: v.vx, vy: v.vy, t: v.t, stride: v.stride,
               moving: v.t < 1, raf: !!rafId };
    };

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
