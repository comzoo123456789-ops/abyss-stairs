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

  /* ── 칸을 눌러 걸어가기 ───────────────────────────────
   *
   * Shattered Pixel Dungeon 이 휴대폰에서 정통 로그라이크를 성립시킨 자리다 —
   * 가상 방향키를 쓰지 않고 **빈 칸을 누르면 거기까지 걸어가고 적을 누르면 때린다.**
   * 방향 패드가 화면 아래 150px 를 먹고 있었는데(사용자: "화면이 좁아 조작이
   * 힘들다") 이걸 넣으면 패드를 접을 수 있다.
   *
   * ⚠ **자동으로 걷는 중에는 반드시 멈출 조건이 있어야 한다.** 안 두면 걸어가다
   *   맞아 죽는다 — 정통 로그라이크가 전부 이렇게 한다. 멈추는 이유는 여섯이다:
   *     ① 못 보던 몬스터가 눈에 들어왔다   ② 체력이 줄었다
   *     ③ 층이 바뀌었다                     ④ 레벨업·상점 창이 열렸다
   *     ⑤ 길이 막혔다(문이 닫혔거나 몬스터가 섰다) ⑥ 도착했다
   * ⚠ 이미 보이던 몬스터로는 **멈추지 않는다.** 그것까지 멈추면 적을 눌러 다가가는
   *   조작이 첫 걸음에서 취소된다(그래서 '시작할 때 보였던 놈' 을 기억해 둔다). */
  var travel = null;

  function travelStop(why) {
    if (!travel) return;
    if (travel.timer) clearInterval(travel.timer);
    travel = null;
    view.goalMark = null;
    if (why) { game.say(why, "warn"); refresh(); }
    else refresh();
  }

  function travelTick() {
    if (!travel) return;
    if (!started() || game.over) { travelStop(null); return; }
    if (game.busy()) { travelStop(null); return; }              /* ④ 창이 열렸다 */
    if (game.depth !== travel.depth) { travelStop(null); return; }   /* ③ */

    var p = game.player;
    var next = travel.path[travel.i];
    if (!next) {                                                /* ⑥ 도착 */
      travelStop(null);
      arriveAt(p.x, p.y);
      return;
    }

    /* 목적지가 몬스터면 붙었을 때 한 번 때리고 끝낸다(누른 뜻이 그것이다) */
    var mon = game.monsterAt(next.x, next.y);
    if (mon && travel.i === travel.path.length - 1) {
      var d = [next.x - p.x, next.y - p.y];
      travelStop(null);
      game.move(d[0], d[1]);
      afterAction();
      return;
    }
    /* ⑤ 길이 막혔다 — 다시 길을 내 본다. 그래도 없으면 멈춘다 */
    if (mon || game.level.blocked(next.x, next.y)) {
      var again = game.pathTo(travel.goal.x, travel.goal.y);
      if (!again || !again.length) { travelStop("길이 막혔다."); return; }
      travel.path = again; travel.i = 0;
      next = travel.path[0];
      if (!next) { travelStop(null); return; }
    }

    var hpBefore = p.hp;
    if (!game.move(next.x - p.x, next.y - p.y)) { travelStop("더 갈 수 없다."); return; }
    travel.i++;
    afterAction();

    if (p.hp < hpBefore) { travelStop(null); return; }            /* ② 맞았다 */
    var now = game.visibleMonsters();
    for (var i = 0; i < now.length; i++) {
      if (travel.known.indexOf(now[i]) < 0) {                     /* ① 새로 나타났다 */
        travelStop(null);
        return;
      }
    }
  }

  /* 발 밑에 뭔가 있으면 도착하면서 처리한다 — 한 번 더 누르게 하면 번거롭다 */
  function arriveAt(x, y) {
    if (game.itemAt(x, y)) { game.pickUp(); afterAction(); return; }
    if (game.level.at(x, y) === window.DUNGEON.STAIRS) { game.descendIfStairs(); afterAction(); }
  }

  /* 누른 칸을 해석한다. 붙어 있으면 한 걸음(=적이면 공격), 멀면 걸어간다. */
  function tapTile(tx, ty) {
    if (!started() || game.over || game.busy() || gearOpen()) return;
    stopHold();
    travelStop(null);
    var p = game.player;
    var dx = tx - p.x, dy = ty - p.y;

    if (dx === 0 && dy === 0) {                 /* 제자리 — 줍기·내려가기·쉬기 */
      if (game.itemAt(p.x, p.y)) game.pickUp();
      else if (game.level.at(p.x, p.y) === window.DUNGEON.STAIRS) game.descendIfStairs();
      else game.wait();
      afterAction();
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) === 1) {    /* 바로 옆 — 한 걸음(적이면 공격) */
      doMove([dx, dy]);
      /* 아무것도 없는 칸으로 한 걸음 갔으면 발 밑을 확인한다 */
      if (game.player.x === tx && game.player.y === ty) arriveAt(tx, ty);
      return;
    }

    var path = game.pathTo(tx, ty);
    if (!path || !path.length) {
      game.say("거기로 가는 길을 모른다.", "warn");
      refresh();
      return;
    }
    view.goalMark = { x: tx, y: ty, t: 0 };
    travel = { path: path, i: 0, goal: { x: tx, y: ty }, depth: game.depth,
               known: game.visibleMonsters() };
    travelTick();                                /* 첫 걸음은 바로 — 반응이 있어야 한다 */
    if (travel) travel.timer = setInterval(travelTick, stepInterval());
    kick();
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
    /* 일일 모드에서는 씨앗 숫자가 아무 뜻이 없다(모두 같다) — 날짜를 보여 준다 */
    els.seed.textContent = (game.mode === "daily" && window.DAILY)
      ? window.DAILY.dayLabel(window.DAILY.dayKey())
      : "#" + game.seed.toString(16).toUpperCase();
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
    /* 걸어가는 중에 키를 누르면 **먼저 멈춘다.** 안 멈추면 자동 이동과 손 조작이
     * 서로 밀어 캐릭터가 엉뚱하게 간다(그 상태를 사람은 고장으로 읽는다). */
    if (travel) travelStop(null);
    /* 시작 화면에서는 1·2·3 으로 직업을 고른다 */
    if (!started()) {
      if (e.key >= "1" && e.key <= "3") {
        e.preventDefault();
        var c = window.DATA.CLASSES[parseInt(e.key, 10) - 1];
        if (c) newGame(c.id);
      }
      return;
    }
    /* 장비 창이 열려 있으면 I·Esc 만 받는다(모달 뒤에서 움직이면 안 된다) */
    if (gearOpen() && e.key !== "i" && e.key !== "I" && e.key !== "Escape") {
      if (e.key !== "Tab") e.preventDefault();
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
    if (k === "i" || k === "I") {
      e.preventDefault();
      if (gearOpen()) closeGear(); else openGear();
      return;
    }
    if (k === "?" || k === "/") {
      e.preventDefault(); els.help.hidden = false; return;
    }
    if (k === "Escape") {
      els.help.hidden = true; closeGear(); return;
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
    writeLedger(g);
  }

  /* ── 장부 한 줄 ───────────────────────────────────────
   *
   * 이게 공유판이다. 세계관이 "이름 없이 몇 층까지 갔는가만 남는다" 이므로
   * 공유판과 세계관이 같은 말을 한다.
   * ⚠ 일일 모드는 여기서 **딱 한 번** 기록된다. 다시 적지 않는다(daily.js 의 record
   *   가 같은 날 항목을 덮어쓰지 않는다) — 덮어쓰면 죽고 다시 해서 좋은 기록만
   *   남기는 것이 되어 하루 한 번이라는 약속이 무의미해진다. */
  function runResult(g) {
    return {
      day: window.DAILY ? window.DAILY.dayKey() : "",
      mode: g.mode || "free",
      seed: g.seed,
      cls: g.cls.name,
      depth: g.depth, won: !!g.won, score: g.score(),
      kills: g.kills, crit: g.stats().crit, level: g.player.level, turn: g.turn,
      maxDepth: window.DATA.MAX_DEPTH,
      /* ⚠ host 만 적으면 카톡·디스코드에서 **링크가 안 걸린다** — 그러면 공유판을
       *   본 사람이 게임에 못 온다(공유판을 만든 이유의 절반이 사라진다). */
      url: location.origin || "https://abyss-stairs.bhmoon.workers.dev"
    };
  }

  function writeLedger(g) {
    if (!window.DAILY) return;
    var r = runResult(g);
    /* 시작할 때 잡아 둔 자리를 채운다. 이미 닫혔으면 그대로 둔다. */
    if (r.mode === "daily") r = window.DAILY.finish(r) || r;
    var text = window.DAILY.shareText(r);
    els.ledgerText.textContent = text;
    /* ⚠ 딱지에 날짜를 또 적으면 바로 아래 첫 줄과 똑같아 두 번 읽힌다.
     *   여기는 **무엇을 하는 자리인지**를 적는다. */
    els.ledgerLabel.textContent = r.mode === "daily"
      ? "베껴서 공유할 장부" : "베껴서 공유할 기록";
    els.ledgerNote.textContent = r.mode === "daily"
      ? "오늘 몫은 끝났다 · " + window.DAILY.untilText(window.DAILY.msUntilNextDay()) +
        " 뒤에 새 층이 배치된다" + streakText()
      : "같은 씨앗을 적어 두면 같은 던전을 다시 만들 수 있다";
    els.ledger.hidden = false;
    setupShare(els.ledgerCopy, els.ledgerShare, text);
  }

  function streakText() {
    var s = window.DAILY.streak();
    return s >= 2 ? " · 연속 " + s + "일" : "";
  }

  /* 베끼기 — 클립보드가 막힌 브라우저가 있어서 대비가 필요하다.
   * ⚠ navigator.clipboard 는 **보안 맥락(https)에서만** 있다. 로컬 파일로 열면
   *   없다 — 그때는 숨은 textarea + execCommand 로 떨어진다.
   * ⚠ 눌렀는데 아무 표시가 없으면 사람은 안 된 줄 안다. 반드시 글자를 바꿔 알린다. */
  function setupShare(copyBtn, shareBtn, text) {
    copyBtn.textContent = "장부 베끼기";
    copyBtn.onclick = function () {
      copyText(text, function (ok) {
        copyBtn.textContent = ok ? "베꼈다 ✓" : "직접 골라 복사하세요";
        setTimeout(function () { copyBtn.textContent = "장부 베끼기"; }, 2200);
      });
    };
    /* 휴대폰에는 기본 공유 창이 있다 — 있으면 그쪽이 훨씬 편하다 */
    var canShare = !!(navigator.share);
    shareBtn.hidden = !canShare;
    if (canShare) {
      shareBtn.onclick = function () {
        navigator.share({ text: text }).catch(function () { /* 사람이 취소한 것 */ });
      };
    }
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { done(true); })
        .catch(function () { done(fallbackCopy(text)); });
      return;
    }
    done(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch (err) { return false; }
  }

  /* ── 시작 화면의 모드 ─────────────────────────────────
   * ⚠ 오늘 몫을 썼으면 **여기서도 장부를 베낄 수 있어야 한다.** 끝 화면을 닫은
   *   뒤에는 공유할 방법이 없어진다(그러면 공유판이 있는 뜻이 절반 사라진다). */
  function showDailyDone() {
    var e = window.DAILY && window.DAILY.entryFor(window.DAILY.dayKey());
    if (!e) { els.dailyDone.hidden = true; return; }
    var text = window.DAILY.shareText(e);
    els.ddTitle.textContent = window.DAILY.dayLabel(e.day) + "의 장부는 이미 적혔다";
    els.ddUntil.textContent = window.DAILY.untilText(window.DAILY.msUntilNextDay()) +
                              " 뒤 새 층" + streakText();
    els.ddText.textContent = text;
    els.dailyDone.hidden = false;
    setupShare(els.ddCopy, els.ddShare, text);
  }

  function setMode(next) {
    mode = next;
    var cards = els.modes.querySelectorAll("[data-mode]");
    for (var i = 0; i < cards.length; i++)
      cards[i].classList.toggle("is-on", cards[i].getAttribute("data-mode") === next);
    var done = !!(window.DAILY && window.DAILY.doneToday());
    els.dailyDone.hidden = !(next === "daily" && done);
    if (!els.dailyDone.hidden) showDailyDone();
    els.startHint.innerHTML = (next === "daily" && done)
      ? "오늘 몫은 끝났다 — <b>자유 탐사</b>로는 계속할 수 있다"
      : (next === "daily"
          ? "직업을 고르면 <b>오늘의 던전</b>으로 내려간다 · <b>시작하면 오늘 몫을 쓴다</b>(중단해도 거기까지가 장부에 남는다)"
          : "직업을 고르면 시작한다 · 휴대폰은 <b>칸을 눌러</b> 움직인다");
  }

  function refreshDailyNote() {
    if (!window.DAILY || !els.modeDailyNote) return;
    var d = window.DAILY;
    var s = d.streak();
    els.modeDailyNote.textContent = d.dayLabel(d.dayKey()) + " · 모두 같은 던전" +
      (d.doneToday() ? " · 오늘 몫 끝" : " · 하루 한 번") + (s >= 2 ? " · 연속 " + s + "일" : "");
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

  function openGear() {
    if (!started() || game.over || game.busy()) return;
    stopHold();
    travelStop(null);
    view.drawGear(els.gearBody);
    els.gear.hidden = false;
  }
  function closeGear() { els.gear.hidden = true; }
  function gearOpen() { return els.gear && !els.gear.hidden; }

  function showStart() {
    els.end.hidden = true;
    els.start.hidden = false;
    /* ⚠ 판이 끝나면 오늘 몫이 소진된다 — 다시 읽지 않으면 "하루 한 번" 안내가
     *   옛 상태로 남아 눌렀을 때만 막히는 것처럼 보인다. */
    refreshDailyNote();
    setMode(mode);
  }

  /* ── 모드 ─────────────────────────────────────────────
   * "daily" 하루의 장부 — 날짜에서 씨앗을 뽑아 **모두가 같은 던전**을 하루 한 번.
   * "free"  자유 탐사   — 매번 새 씨앗, 횟수 제한 없음.
   * ⚠ 기본은 daily 다. 세계관이 장부이므로 그쪽이 이 게임의 본래 모습이고,
   *   공유판이 사람을 데려오는 입구다. */
  var mode = "daily";

  function newGame(classId, forceMode) {
    var use = forceMode || mode;
    /* ⚠ 오늘 몫을 이미 썼으면 **시작하지 않는다.** 여기서 막지 않으면 직업 카드를
     *   눌러 하루에 여러 번 돌 수 있어 "하루 한 번" 이 무의미해진다. */
    if (use === "daily" && window.DAILY && window.DAILY.doneToday()) {
      showDailyDone();
      return false;
    }
    mode = use;
    els.start.hidden = true;
    els.end.hidden = true;
    els.ledger.hidden = true;
    game = new window.Game(classId);
    if (use === "daily" && window.DAILY) game.reset(window.DAILY.seedToday(), classId);
    game.mode = use;
    /* ⚠ 오늘 몫은 **여기서** 쓴다(끝날 때가 아니라). 끝날 때 적으면 판이 나쁘게
     *   흘러갈 때 새로고침하고 다시 시작할 수 있어 "하루 한 번" 이 말뿐이 된다. */
    if (use === "daily" && window.DAILY) window.DAILY.begin(runResult(game));
    view.game = game;
    view.goalMark = null;
    lastHp = game.player.hp;
    view.resize();
    refresh();
    return true;
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
    els.modes = document.getElementById("modes");
    els.modeDailyNote = document.getElementById("modeDailyNote");
    els.dailyDone = document.getElementById("dailyDone");
    els.ddTitle = document.getElementById("ddTitle");
    els.ddUntil = document.getElementById("ddUntil");
    els.ddText = document.getElementById("ddText");
    els.ddCopy = document.getElementById("ddCopy");
    els.ddShare = document.getElementById("ddShare");
    els.ledger = document.getElementById("ledger");
    els.ledgerLabel = document.getElementById("ledgerLabel");
    els.ledgerText = document.getElementById("ledgerText");
    els.ledgerNote = document.getElementById("ledgerNote");
    els.ledgerCopy = document.getElementById("ledgerCopy");
    els.ledgerShare = document.getElementById("ledgerShare");
    els.startHint = document.getElementById("startHint");
    els.gear = document.getElementById("gear");
    els.gearBody = document.getElementById("gearBody");

    var canvas = document.getElementById("view");
    game = new window.Game("warrior");     /* 시작 화면 뒤에 깔릴 판 — 고르면 새로 만든다 */
    view = new window.Renderer(canvas, game);
    lastHp = game.player.hp;

    drawClasses();
    els.modes.addEventListener("click", function (e) {
      var b = e.target.closest("[data-mode]");
      if (b) setMode(b.getAttribute("data-mode"));
    });
    refreshDailyNote();
    setMode("daily");
    els.classes.addEventListener("click", function (e) {
      var btn = e.target.closest(".cls-card");
      if (btn) newGame(btn.getAttribute("data-cls"));
    });

    /* ── 캔버스 입력 ─────────────────────────────────
     * ⚠ click 하나로 끝내면 안 된다. 터치에서 click 은 **300ms 뒤**에 오고
     *   그 사이에 스크롤·확대 판정이 끼어 반응이 느리게 느껴진다.
     *   touchstart 로 먼저 처리하고, 그때 click 을 막는다(둘 다 받으면 두 번 눌린다).
     * ⚠ 손가락이 움직였으면 취소한다 — 화면을 쓸어 보려던 것을 이동으로 읽으면
     *   안 된다. */
    var tapSwallow = 0;
    canvas.addEventListener("touchstart", function (e) {
      if (!e.touches.length) return;
      var t = e.touches[0];
      canvas._tapAt = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    canvas.addEventListener("touchend", function (e) {
      var at = canvas._tapAt;
      canvas._tapAt = null;
      if (!at) return;
      var t = e.changedTouches && e.changedTouches[0];
      if (t && (Math.abs(t.clientX - at.x) > 14 || Math.abs(t.clientY - at.y) > 14)) return;
      e.preventDefault();
      tapSwallow = Date.now();
      var tile = view.tileAtPoint(at.x, at.y);
      if (tile) tapTile(tile.x, tile.y);
    });
    canvas.addEventListener("touchmove", function () { canvas._tapAt = null; }, { passive: true });
    canvas.addEventListener("click", function (e) {
      if (Date.now() - tapSwallow < 600) return;     /* 방금 터치로 처리했다 */
      var tile = view.tileAtPoint(e.clientX, e.clientY);
      if (tile) tapTile(tile.x, tile.y);
    });
    /* 캔버스 우클릭은 브라우저 메뉴만 띄운다 — 막아 둔다(가방 우클릭과 헷갈린다) */
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

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
     * 안 넣으면 휴대폰에서는 가방을 비울 방법이 아예 없다.
     * ⚠ 가방이 이제 **두 곳**에 있다(사이드바 · 장비 창). 배선을 베끼면 한쪽만
     *   고쳐지므로 함수로 뺐다 — 새 가방 자리를 만들면 여기에 붙이면 된다. */
    function bindLongPress(host, onDrop) {
      var timer = null, idx = -1, fired = false;
      host.addEventListener("touchstart", function (e) {
        var btn = e.target.closest(".inv-item");
        if (!btn) return;
        idx = parseInt(btn.getAttribute("data-idx"), 10);
        fired = false;
        timer = setTimeout(function () { fired = true; onDrop(idx); }, 450);
      }, { passive: true });
      function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
      host.addEventListener("touchend", function (e) {
        cancel();
        /* 길게 눌러 이미 버렸으면 그 뒤의 click(=사용)을 막는다 */
        if (fired) { e.preventDefault(); fired = false; }
      });
      host.addEventListener("touchmove", cancel, { passive: true });
      host.addEventListener("touchcancel", cancel, { passive: true });
    }
    bindLongPress(els.inv, function (i) { game.dropItem(i); afterAction(); });

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

    /* ── 장비 창 ──
     * ⚠ **턴을 쓰지 않는다.** 여는 것만으로 몬스터가 움직이면 정보를 보는 것이
     *   위험해져 아무도 안 연다. 열려 있는 동안 조작도 막는다(모달 뒤에서 캐릭터가
     *   움직이면 무슨 일이 났는지 모른다 — 레벨업·상점 창과 같은 규칙). */
    document.getElementById("gearBtn").addEventListener("click", openGear);
    document.getElementById("gearClose").addEventListener("click", closeGear);
    els.gear.addEventListener("click", function (e) { if (e.target === els.gear) closeGear(); });
    /* 가방 칸을 눌러 쓰고, 길게 눌러 버린다 — 사이드바와 같은 조작이다 */
    els.gearBody.addEventListener("click", function (e) {
      var btn = e.target.closest(".inv-item");
      if (!btn) return;
      game.useItem(parseInt(btn.getAttribute("data-idx"), 10));
      afterAction();
      if (game.over || game.busy()) closeGear(); else view.drawGear(els.gearBody);
    });
    els.gearBody.addEventListener("contextmenu", function (e) {
      var btn = e.target.closest(".inv-item");
      if (!btn) return;
      e.preventDefault();
      game.dropItem(parseInt(btn.getAttribute("data-idx"), 10));
      afterAction();
      view.drawGear(els.gearBody);
    });
    bindLongPress(els.gearBody, function (idx) {
      game.dropItem(idx); afterAction(); view.drawGear(els.gearBody);
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

    /* ⚠ 옛 토글(rl_pad)은 지운다 — 버튼이 없어졌으므로 "꺼짐" 이 남으면 되돌릴
     *   방법이 없었다(휴대폰에는 키보드가 없다). */
    try { localStorage.removeItem("rl_pad"); } catch (err) {}

    /* ── 방향 패드 접기 ──────────────────────────────
     * 탭 이동이 생겼으니 패드는 **선택**이다. 접으면 캔버스가 그만큼 커진다.
     * ⚠ 접은 상태에서도 **펴는 손잡이는 항상 보인다.** 완전히 감추면 저장된
     *   "접힘" 때문에 조작 수단이 사라지는 사고가 다시 난다(옛 rl_pad 가 그랬다).
     * ⚠ 접고 펼 때마다 view.resize() 를 부른다 — 안 부르면 캔버스가 옛 크기로
     *   남아 아래가 검게 비거나 잘린다. */
    var padEl = document.querySelector(".pad");
    var padFold = document.getElementById("padFold");
    function setPadFold(folded, save) {
      document.body.classList.toggle("pad-folded", folded);
      padFold.textContent = folded ? "▲ 방향 패드 펴기" : "▼";
      padFold.setAttribute("aria-expanded", folded ? "false" : "true");
      if (save) { try { localStorage.setItem("rl_pad2", folded ? "1" : "0"); } catch (err) {} }
      view.resize();
      refresh();
    }
    padFold.addEventListener("click", function () {
      setPadFold(!document.body.classList.contains("pad-folded"), true);
    });
    try {
      if (localStorage.getItem("rl_pad2") === "1") setPadFold(true, false);
    } catch (err) {}

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
        /* 첫 스킬의 남은 쿨다운. ⚠ 점검기가 "스킬이 터졌나" 를 이 값으로 가른다 —
         *   없으면 undefined 가 되어 성공 갈래가 통째로 죽는다(실제로 그랬다). */
        cooldown: game.player.skills.length ? game.player.skills[0].cd : 0,
        crit: game.stats().crit, critMult: game.stats().critMult,
        ail: Object.keys(game.player.ail),
        perkOpen: !!game.pendingPerks, shopOpen: !!game.shop,
        merchant: !!game.merchant,
        weapon: game.player.weapon ? game.player.weapon.name : null,
        rarity: game.player.weapon ? game.player.weapon.rarity : null,
        monsters: game.monsters.length, items: game.items.length,
        /* 지금 붙어 있는 적 수. 점검기가 **기회 공격이 터질 상황인지** 알아야
         * "한 칸 가고 멈췄다" 를 고장으로 오진하지 않는다(실제로 오진했다). */
        foes: game.adjacentFoes(game.player.x, game.player.y).length,
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
    /* 긴 기록이 캔버스 밖으로 새지 않는지 재려면 긴 문장을 직접 밀어 넣어야 한다.
     * 실제 판에서 제일 긴 문장이 언제 나올지 정할 수 없어 검사가 성립하지 않는다. */
    window.__say = function (text, tone) { game.say(text, tone || ""); refresh(); };
    /* 그려진 토스트의 실제 상자 — 캔버스 위 글자는 DOM 넘침 검사에 안 잡힌다 */
    window.__toastBoxes = function () { return view.toastBoxes || []; };
    /* 점검기가 칸을 눌러 보는 창구 — 화면 좌표가 아니라 **칸 좌표**를 받는다
     * (좌표 변환은 tileAtPoint 가 따로 검사된다). */
    window.__tap = function (x, y) { tapTile(x, y); };
    window.__tapAtPoint = function (px, py) {
      var t = view.tileAtPoint(px, py);
      if (t) tapTile(t.x, t.y);
      return t;
    };
    /* 걷는 중에 **못 보던 적이 나타나면 멈추는가** 를 재려면 적을 심을 수단이
     * 필요하다. 이 규칙이 안 지켜지면 걸어가다 맞아 죽는데, 실제 판에서는
     * 언제 적이 나타날지 정할 수 없어 검사가 성립하지 않는다. */
    window.__putMonster = function (id) {
      var DATA = window.DATA, p = game.player, lv = game.level;
      var def = DATA.byId(DATA.MONSTERS, id || "rat");
      if (!def) return null;
      for (var r = 2; r <= 6; r++) {
        for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
          var x = p.x + dx, y = p.y + dy;
          if (!lv.inside(x, y) || lv.blocked(x, y)) continue;
          if (game.monsterAt(x, y) || (x === p.x && y === p.y)) continue;
          if (!game.isVisible(x, y)) continue;
          var mon = game.spawn(def, x, y, true);
          mon.awake = false;                 /* 깨우지 않는다 — 보이는 것만으로 멈춰야 한다 */
          /* ⚠ spawn() 은 객체만 돌려준다 — 목록에 넣는 것은 부르는 쪽 일이다.
           *   빠뜨렸다가 "적이 나타났는데 안 멈춘다" 는 거짓 실패를 봤다. */
          game.monsters.push(mon);
          return { x: x, y: y };
        }
      }
      return null;
    };
    /* 점검기 전용 — 지금 층의 적을 치운다.
      * ⚠ 「층 이동 스냅」 같은 검사는 계단까지 걸어가야 하는데, 기회 공격이 생긴
      *   뒤로는 가는 길에 맞아 죽어 **검사 자체가 못 돌았다**. 애니메이션 검사가
      *   전투 생존 검사를 겸할 이유가 없다. */
     window.__clearMonsters = function () { game.monsters = []; refresh(); return true; };
    window.__travel = function () {
      return travel ? { goal: travel.goal, left: travel.path.length - travel.i } : null;
    };
    /* ⚠ 기본을 **자유 탐사**로 둔다. 기존 화면 검사가 전부 __start 로 판을 켜는데
     *   일일 모드로 켜면 두 번째 검사부터 "오늘 몫 끝" 에 막혀 통째로 빨개진다.
     *   일일 모드는 아래 창구로 따로 검사한다. */
    window.__start = function (id, useMode) { return newGame(id, useMode || "free"); };
    window.__mode = function () { return mode; };
    /* 판을 끝낸다 — 장부가 적히는지 보려면 죽어야 하는데, 실제로 죽을 때까지
     * 돌리면 씨앗마다 시간이 달라 검사가 흔들린다. 끝 화면이 뜨는 길은 하나뿐이라
     * (refresh 에서 game.over 를 본다) 같은 자리를 쓴다. */
    window.__endRun = function (won) {
      game.over = true; game.won = !!won;
      refresh();
      return { over: game.over, won: game.won };
    };
    window.__setMode = function (v) { setMode(v); return mode; };
    window.__gear = function (open) {
      if (open === true) openGear(); else if (open === false) closeGear();
      return { open: gearOpen(), text: els.gearBody.textContent.replace(/s+/g, " ").trim() };
    };
    window.__relics = function () { return (game.player.relics || []).slice(); };
    /* 구역을 눈으로 보려면 그 층까지 내려가야 한다 — 검사용 창구.
     * ⚠ 게임 로직은 쓰지 않는다(__force·__putMonster 와 같은 자리). */
    window.__lvl = function () { return game.level; };
    window.__redraw = function () { view.draw(0); };
    window.__toDepth = function (d) {
      var guard = 0;
      while (game.depth < d && guard++ < 30) game.descend();
      game.player.hp = game.maxhp();
      refresh();
      return { depth: game.depth, zone: window.DATA.zoneAt(game.depth).name };
    };
    window.__giveRelic = function (id) { return game.takeRelic(id); };
    window.__ledger = function () {
      return { shown: !els.ledger.hidden, text: els.ledgerText.textContent,
               label: els.ledgerLabel.textContent, note: els.ledgerNote.textContent,
               doneShown: !els.dailyDone.hidden, doneText: els.ddText.textContent };
    };
    /* 일일 기록을 비운다 — 검사가 "오늘 몫" 을 쓰기 전 상태에서 시작할 수 있게 */
    window.__clearDaily = function () {
      try { localStorage.removeItem("rl_ledger"); } catch (err) {}
      refreshDailyNote(); setMode(mode);
    };
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
      var lv = game.level, walk = [], seen = [];
      for (var y = 0; y < lv.h; y++)
        for (var x = 0; x < lv.w; x++) {
          walk.push(lv.blocked(x, y) ? 0 : 1);
          /* 탭 이동은 **본 칸만** 지나간다 — 검사도 같은 조건으로 목적지를 골라야
           * "안 걷는다" 로 오진하지 않는다. */
          seen.push(lv.seen[lv.idx(x, y)] ? 1 : 0);
        }
      return { w: lv.w, h: lv.h, walk: walk, seen: seen };
    };
    /* 화면 좌표 ↔ 칸 좌표 변환을 검사가 **스스로 뒤집어** 확인할 수 있게 카메라를
     * 내놓는다(devicePixelRatio 를 잘못 쓰면 여기서 어긋난다). */
    window.__cam = function () { return { x: view.cam.x, y: view.cam.y, tile: window.TILE_PX || 32 }; };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
