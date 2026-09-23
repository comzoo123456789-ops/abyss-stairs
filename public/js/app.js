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
  /* 마우스 — **PC 에서 조준은 마우스다.** */
  var mouse = { cx: 0, cy: 0, down: false, has: false };
  /* 모바일 터치 및 가상 조이스틱 상태 */
  var touchMove = { x: 0, y: 0 };
  var touchAttacking = false;
  var stickTouchId = null;
  var stickStartX = 0, stickStartY = 0;

  /* 캐릭터. **세계보다 오래 산다** — 층을 옮겨도 이 객체 하나를 계속 들고 다닌다.
   * ⚠ 층마다 새로 불러오지 말 것. 저장이 마지막으로 쓰인 시점으로 되감긴다. */
  var hero = null;
  var saveAcc = 0;

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
    if (touchMove.x || touchMove.y) {
      x += touchMove.x;
      y += touchMove.y;
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
    if ((mouse.down || touchAttacking) && !world.player.dead) {
      var a = aim();
      world.swing(a.x, a.y);
    }

    var r = world.advance(dt);
    view.draw(world, r.alpha);

    /* 논 시간도 캐릭터의 시간이다(죽어 있을 때는 안 센다) */
    if (!world.player.dead) hero.playSec += dt;

    /* 자동 저장 — **묶어서 드문드문.** 맞을 때마다 쓰면 초당 수십 번 쓴다.
     * ⚠ 값이 안 바뀌었으면 SAVE 가 알아서 건너뛴다. */
    saveAcc += dt;
    if (saveAcc >= global.SAVE.AUTO_EVERY) { saveAcc = 0; global.SAVE.save(hero); }

    /* 귀환이 다 찼다 — 마을로 */
    if (world.recallDone) { world.recallDone = false; toTown(); }

    /* 죽으면 **마을에서** 깬다. 대가는 아직 정하지 않았다(보류) — 세어만 둔다.
     * ⚠ 죽자마자 옮기면 무슨 일이 있었는지 모른다. 1.2초를 둔다. */
    if (world.player.dead && world.time - world.playerDeadAt > 1.2) revive();

    hud();
    drawBar();

    fps.t += dt; fps.n++;
    if (fps.t >= 0.5) { fps.v = Math.round(fps.n / fps.t); fps.t = 0; fps.n = 0; diag(); }
  }

  /* 마우스나 8방향 이동/조이스틱/타겟 방향이 가리키는 **월드 좌표**. */
  function aim() {
    var p = world.player;
    /* 1) 키보드(WASD 8방향) 또는 터치 조이스틱(8방향/360도) 이동 중일 때 */
    var ix = p.mx || 0, iy = p.my || 0;
    if (touchMove.x || touchMove.y) {
      ix = touchMove.x; iy = touchMove.y;
    }
    var ilen = Math.hypot(ix, iy);
    if (ilen > 0.05) {
      var idx = ix / ilen, idy = iy / ilen;
      p.dirX = idx; p.dirY = idy;
      if (Math.abs(idx) > 0.05) p.face = idx > 0 ? 1 : -1;
      return { x: p.x + idx * 2, y: p.y + idy * 2 };
    }

    /* 2) 서 있는 상태일 때 — 주변 8방향 적 자동 스마트 타게팅 (최우선) */
    if (world && world.ents) {
      var nearestFoe = null, minD = 3.5;
      for (var ei = 0; ei < world.ents.length; ei++) {
        var ent = world.ents[ei];
        if (ent.dead || ent === p || ent.team === p.team) continue;
        var ed = Math.hypot(ent.x - p.x, ent.y - p.y);
        if (ed < minD) { minD = ed; nearestFoe = ent; }
      }
      if (nearestFoe) {
        var fdx = nearestFoe.x - p.x, fdy = nearestFoe.y - p.y;
        var flen = Math.hypot(fdx, fdy) || 1;
        p.dirX = fdx / flen; p.dirY = fdy / flen;
        if (Math.abs(p.dirX) > 0.05) p.face = p.dirX > 0 ? 1 : -1;
        return { x: p.x + (fdx / flen) * 2, y: p.y + (fdy / flen) * 2 };
      }
    }

    /* 3) 터치 조작 / 8방향 유지 조준 (마지막 이동 8방향 벡터) */
    if (touchAttacking || !mouse.has) {
      var dx = p.dirX !== undefined ? p.dirX : (p.face || 1);
      var dy = p.dirY !== undefined ? p.dirY : 0;
      var dlen = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / dlen) * 2, y: p.y + (dy / dlen) * 2 };
    }

    /* 4) 데스크톱 마우스 커서 기반 조준 */
    return view.toWorld(mouse.cx, mouse.cy);
  }

  /* 마을로. 체력은 마을에 들어가면 알아서 다 찬다(World 안에서). */
  function toTown() {
    closePanel();
    start({ depth: 0 });
    global.SAVE.save(hero);
  }

  /* 던전으로. **도달한 층까지만** 갈 수 있다 — 안 그러면 1레벨이 30층에 간다. */
  function toDepth(d) {
    closePanel();
    /* ⚠ 되사기는 **이번 방문 동안만**이다. 계속 쌓아 두면 무한 보관함이 된다. */
    buyback.length = 0;
    /* ⚠ 테스트 모드에서도 **상한은 지킨다.** 31층은 구역이 없어 빈 층이 된다. */
    var cap = devOn() ? (global.DATA ? global.DATA.MAX_DEPTH : 30) : hero.maxDepth;
    d = Math.max(1, Math.min(cap, Math.floor(d) || 1));
    start({ depth: d });
    global.SAVE.save(hero);
  }

  /* 한 층 더 깊이 — 계단을 밟고 눌렀을 때.
   * ⚠ 여기서만 maxDepth 가 는다(포탈은 이미 가 본 곳만 연다). 그래서
   *   "내려가 본 적 없는 층으로 포탈이 열리는" 일이 안 생긴다. */
  function descend() {
    var d = world.depth + 1;
    start({ depth: d, hp: world.player.hp });
    global.SAVE.save(hero);
  }

  /* 죽으면 마을에서 깬다. 캐릭터는 그대로다 — 대가는 보류다(사용자 결정). */
  function revive() {
    hero.deaths++;
    toTown();
  }

  /* 발밑에 무엇이 있고 무엇을 누르면 되는지.
   * ⚠ **눌러야 뭔가 일어나는 자리에는 반드시 글자가 있어야 한다.** 아이콘만
   *   두거나 아무 표시도 없으면 회원은 그 자리를 그냥 지나친다(마을에 서서
   *   "어디로 가야 하지" 를 묻게 된다). */
  /* ── 던전 미니맵 (걸어온 길 탐험 지도) ────────────────────────── */
  var miniCanvas = null;
  var miniCtx = null;

  function renderMinimap() {
    var box = document.getElementById("minimapBox");
    if (!box) return;
    if (world.inTown || world.depth === 0) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";

    if (!miniCanvas) {
      miniCanvas = document.getElementById("minimap");
      if (miniCanvas) miniCtx = miniCanvas.getContext("2d");
    }
    if (!miniCanvas || !miniCtx) return;

    var lv = world.level;
    var mw = miniCanvas.width;
    var mh = miniCanvas.height;
    var scaleX = mw / lv.w;
    var scaleY = mh / lv.h;

    miniCtx.fillStyle = "#120e17";
    miniCtx.fillRect(0, 0, mw, mh);

    var D = global.DUNGEON;
    for (var y = 0; y < lv.h; y++) {
      for (var x = 0; x < lv.w; x++) {
        var id = y * lv.w + x;
        if (!lv.seen[id]) continue;
        var t = lv.tiles[id];
        var rx = x * scaleX, ry = y * scaleY;
        var rw = Math.max(1, scaleX), rh = Math.max(1, scaleY);

        if (t === D.WALL) {
          miniCtx.fillStyle = "#261f30";
          miniCtx.fillRect(rx, ry, rw, rh);
        } else if (t === D.DOOR) {
          miniCtx.fillStyle = "#eab308";
          miniCtx.fillRect(rx, ry, rw, rh);
        } else if (t === D.DOOR_OPEN) {
          miniCtx.fillStyle = "#22c55e";
          miniCtx.fillRect(rx, ry, rw, rh);
        } else if (t === D.STAIRS) {
          miniCtx.fillStyle = "#06b6d4";
          miniCtx.fillRect(rx, ry, rw, rh);
        } else if (t === D.DEEP) {
          miniCtx.fillStyle = "#ec4899";
          miniCtx.fillRect(rx, ry, rw, rh);
        } else {
          if (lv.walked && lv.walked[id]) {
            miniCtx.fillStyle = "#a28ebd";
          } else {
            miniCtx.fillStyle = "#4a3e59";
          }
          miniCtx.fillRect(rx, ry, rw, rh);
        }
      }
    }

    /* 시야 안의 적 표시 */
    miniCtx.fillStyle = "#ef4444";
    for (var i = 0; i < world.ents.length; i++) {
      var e = world.ents[i];
      if (e.dead || e.team === 0 || e.kind === "dummy") continue;
      var ex = Math.floor(e.x), ey = Math.floor(e.y);
      if (lv.inside(ex, ey) && lv.visible[ey * lv.w + ex]) {
        miniCtx.fillRect(e.x * scaleX - 1, e.y * scaleY - 1, 2, 2);
      }
    }

    /* 플레이어 위치 */
    var p = world.player;
    var px = p.x * scaleX, py = p.y * scaleY;
    miniCtx.fillStyle = "#ffd24a";
    miniCtx.beginPath();
    miniCtx.arc(px, py, 2.5, 0, Math.PI * 2);
    miniCtx.fill();
    miniCtx.fillStyle = "#ffffff";
    miniCtx.fillRect(px - 0.75, py - 0.75, 1.5, 1.5);
  }

  function hud() {
    renderMinimap();
    var el = document.getElementById("act");
    if (!el) return;
    var txt = "";
    if (world.recall) {
      txt = "마을로 돌아가는 중… " + world.recallLeft().toFixed(1) + "초 (움직이면 끊긴다)";
    } else if (world.player.dead) {
      txt = "쓰러졌다…";
    } else {
      var dp = world.nearDrop();
      var pr = world.nearProp();
      var dr = world.nearDoor();
      /* ⚠ 전리품을 **먼저** 본다. 포탈 위에 떨어진 물건을 못 줍는 일이 없게. */
      if (dp) {
        var ti = global.ITEMS.tierOf(dp.item.tier);
        txt = "[E] " + dp.item.name + " (" + ti.name + " · " +
              global.ITEMS.SLOT_NAME[dp.item.slot] + " · Lv." + dp.item.req + ")";
      }
      else if (pr) txt = "[E] " + pr.def.label + " — " + pr.def.verb;
      else if (world.onStairs()) txt = "[E] 계단 — 더 깊이 내려간다 (" + (world.depth + 1) + "층)";
      else if (dr) txt = dr.open ? "[E] 문 — 닫기" : "[E] 문 — 열기";
      else if (!world.inTown) txt = "[T] 마을로 귀환 (2초간 가만히)";
    }
    el.textContent = txt;
    el.style.visibility = txt ? "visible" : "hidden";

    var eBtn = document.getElementById("btnTouchInteract");
    if (eBtn) {
      var hasInteract = !world.player.dead && !!(world.nearDrop() || world.nearProp() || world.onStairs() || world.nearDoor());
      eBtn.classList.toggle("highlight", hasInteract);
    }
  }

  /* 물약 — 실시간에서는 **멈추지 않는다.** 마시는 동안에도 맞는다.
   * ⚠ 즉시 다 채우면 물약이 무적 버튼이 된다. 절반만, 그리고 쿨다운을 둔다. */
  var POTION_CD = 8;
  var potionAt = -99;
  function drink() {
    var p = world.player;
    if (p.dead) return;
    if (hero.potions <= 0) return toast("물약이 없다");
    if (world.time - potionAt < POTION_CD)
      return toast("아직 못 마신다 — " + (POTION_CD - (world.time - potionAt)).toFixed(1) + "초");
    if (p.hp >= p.maxHp) return toast("멀쩡하다");
    hero.potions--;
    potionAt = world.time;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.5));
    world.floaters.push({ x: p.x, y: p.y - 0.8, text: "회복", t: 0, life: 0.8, foe: true });
    if (global.SFX) global.SFX.play("potion");
    global.SAVE.save(hero);
  }

  /* [E] — 발밑/눈앞의 것에 말을 건다. **한 키로 다 한다.**
   * ⚠ 물건마다 키를 따로 두면 회원이 외워야 할 것이 늘어난다. */
  /* 손잡이 한 칸을 쓴다. **왜 못 썼는지**를 알린다 —
   * ⚠ 아무 일도 안 일어나면 회원은 키가 안 먹는 줄 안다(실시간에서는 특히). */
  function castSlot(i) {
    var id = hero.bar[i];
    if (!id) return toast((i + 1) + "번 칸이 비었다 — K 로 재주를 넣는다");
    var a = aim();
    var no = world.useSkill(id, a.x, a.y, hero.skills);
    if (no) toast(global.SKILLS.byId(id).name + " — " + no);
  }

  function interact() {
    if (world.player.dead) return;
    var dp = world.nearDrop();
    if (dp) {
      var why = world.takeDrop(dp);
      /* ⚠ 못 주웠으면 **왜 못 주웠는지** 말한다. 아무 일도 안 일어나면
       *   회원은 고장으로 느낀다(가방이 찼다는 걸 알 길이 없다). */
      if (why) toast(why);
      else if (panelOpen()) openBag();     /* 창을 열어 둔 채 주우면 바로 보인다 */
      return;
    }
    var pr = world.nearProp();
    if (pr) {
      if (pr.id === "portal") return openPortal();
      if (pr.id === "shop") return openShop();
      if (pr.id === "stash") return openStash();
      if (pr.id === "smith") return openSmith();
      if (pr.id === "craft") return openCraft();
      if (pr.id === "well") {
        var p = world.player;
        if (p.hp >= p.maxHp) return;
        p.hp = p.maxHp;
        if (global.SFX) global.SFX.play("potion");
        return;
      }
      return;
    }
    if (world.onStairs()) { descend(); return; }
    var dr = world.nearDoor();
    if (dr) {
      var res = world.toggleDoor(dr);
      if (!res.ok && res.msg) toast(res.msg);
      return;
    }
  }

  /* 층 선택 창. 캔버스가 아니라 **DOM** 이다 — 글자를 고르는 자리는
   * 브라우저가 이미 잘하는 일이고, 캔버스로 만들면 키보드로 못 고른다. */
  /* ── 테스트 모드 ─────────────────────────────────────
   * 주소에 **?dev=1** 을 붙이면 심연의 문이 1~30층을 다 연다.
   * ⚠ 한 번 켜면 남는다(localStorage). 테스트할 때마다 주소를 고쳐 넣는 건
   *   금방 귀찮아진다 — 끌 때는 ?dev=0.
   * ⚠ 잠금을 **아예 없애지 않는다.** 없애면 "가 본 곳까지" 라는 성장이 통째로
   *   사라지고, 그걸 지키는 검사도 무의미해진다.
   * ⚠ 화면에 **켜져 있다고 적는다.** 안 적으면 나중에 "왜 30층이 다 열려 있지"
   *   를 버그로 오해한다. */
  var DEVKEY = "ABYSS_DEV";
  function devOn() {
    try {
      var q = (global.location.search || "").match(/[?&]dev=([01])/);
      if (q) {
        if (q[1] === "1") localStorage.setItem(DEVKEY, "1");
        else localStorage.removeItem(DEVKEY);
      }
      return localStorage.getItem(DEVKEY) === "1";
    } catch (e) { return false; }     /* 저장소가 막혀 있어도 게임은 돌아야 한다 */
  }

  function openPortal() {
    var box = document.getElementById("panel");
    if (!box) return;
    var dev = devOn();
    var top = dev ? (global.DATA ? global.DATA.MAX_DEPTH : 30) : hero.maxDepth;
    var html = '<h2>심연의 문</h2><p class="sub">' +
      (dev ? '<b>테스트 모드</b> — 1~' + top + '층이 다 열려 있다 (끄려면 주소에 ?dev=0)'
           : '가 본 곳까지 열린다 — 지금 ' + hero.maxDepth + '층') +
      '</p><div class="floors">';
    for (var d = 1; d <= top; d++)
      html += '<button data-depth="' + d + '">' + d + '층</button>';
    html += '</div><p class="sub">Esc 로 닫는다</p>';
    box.innerHTML = html;
    box.className = "panel";
    box.hidden = false;
    box.style.display = "";
    addCloseButton(box);

    var btns = box.querySelectorAll("button[data-depth]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener("click", function () {
        toDepth(Number(this.getAttribute("data-depth")));
      });
    }
    if (btns.length) btns[btns.length - 1].focus();
  }

  /* 짧은 알림. ⚠ 캔버스가 아니라 DOM 이다 — 캔버스에 그리면 창 위에 안 뜬다. */
  var toastT = 0;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.style.opacity = "0"; }, 1600);
  }

  function bindTapUI(el, fn) {
    if (!el) return;
    var lastTap = 0;
    var handler = function (e) {
      var now = Date.now();
      if (now - lastTap < 300) {
        if (e && e.preventDefault) e.preventDefault();
        return;
      }
      lastTap = now;
      if (e && e.preventDefault && e.type === "touchstart") e.preventDefault();
      if (typeof wakeAudio === "function") wakeAudio();
      fn(e);
    };
    el.addEventListener("touchstart", handler, { passive: false });
    el.addEventListener("click", handler);
  }


  function closePanel() {
    var box = document.getElementById("panel");
    if (!box) return;
    /* ⚠ 모양(class)을 되돌린다. 가방(wide)을 한 번 열면 그 뒤 포탈 창까지
     *   계속 넓게 뜬다 — 열 때만 고치고 닫을 때 안 되돌리면 상태가 샌다. */
    box.className = "panel";
    box.hidden = true;
    /* ⚠ hidden 만으로는 안 감춰지는 경우가 있다(다른 규칙이 display 를 주면).
     *   둘 다 건다 — 전에 같은 함정을 여러 번 밟았다. */
    box.style.display = "none";
    box.innerHTML = "";
  }

  function addCloseButton(box) {
    if (!box) return;
    var btn = document.createElement("button");
    btn.className = "panel-close";
    btn.innerHTML = "✕ 닫기";
    btn.title = "창 닫기 (Esc)";
    var doClose = function (e) {
      if (e) e.preventDefault();
      wakeAudio();
      closePanel();
    };
    btn.addEventListener("touchstart", doClose, { passive: false });
    btn.addEventListener("click", doClose);
    /* 닫기 버튼을 패널 맨 위에 삽입 (내용 겹침 방지) */
    box.insertBefore(btn, box.firstChild);

    /* 패널 바깥 클릭 시 닫기 — 한 번만 등록.
     *
     * ⚠ **패널 위에 뜨는 창은 "바깥" 이 아니다.** 물건 창(#itemModal)과
     *   우클릭 차림표(#itemCtx)는 `body` 에 붙는다 — `box.contains()` 로 보면
     *   바깥으로 잡혀서, 물건 창에서 「닫기」를 누르면 **가방까지 같이 닫혔다.**
     *   그 둘 안에서 난 클릭은 건너뛴다.
     * ⚠ 새 창을 `body` 에 붙일 때마다 여기 이름을 더해야 한다. 안 더하면
     *   같은 증상이 조용히 되살아난다. */
    var OVER_PANEL = "#itemModal, #itemCtx";
    var _outsideClose = function(e) {
      if (e.target && e.target.closest && e.target.closest(OVER_PANEL)) return;
      if (!box.hidden && !box.contains(e.target)) {
        closePanel();
        document.removeEventListener("mousedown", _outsideClose, true);
        document.removeEventListener("touchstart", _outsideClose, true);
      }
    };
    /* nextTick 으로 등록: 지금 클릭이 패널 여는 클릭이라 즉시 닫히는 것을 막는다 */
    setTimeout(function() {
      document.addEventListener("mousedown", _outsideClose, true);
      document.addEventListener("touchstart", _outsideClose, true);
    }, 50);
  }
  /* ── 가방과 장착 ───────────────────────────────────────
   * ⚠ 수치는 **world.gear** 를 읽는다. 여기서 다시 더하면 두 벌이 되어
   *   "표시는 +30 인데 실제로는 +24" 가 된다(items.js 의 totals 가 유일한 합산). */
  var STAT_NAME = {
    dmg: "피해", hp: "체력", armor: "방어", spdPct: "이동",
    apsPct: "공격속도", critPct: "치명타", critDmgPct: "치명타 피해",
    lifeOnHit: "타격 회복", goldPct: "금화", xpPct: "경험치"
  };
  var PCT = { spdPct: 1, apsPct: 1, critPct: 1, critDmgPct: 1, goldPct: 1, xpPct: 1 };

  function statLine(k, v) {
    if (!v) return "";
    return (v > 0 ? "+" : "") + v + (PCT[k] ? "%" : "") + " " + (STAT_NAME[k] || k);
  }
  function statsOf(it) {
    return statsList(it).join(" · ");
  }
  /* 능력치를 **줄 단위로** 돌려준다.
   * ⚠ `statsOf` 는 한 줄로 이어 붙인다 — 좁은 칸에서는 말줄임으로 잘린다.
   *   물건 창처럼 다 보여야 하는 곳은 이걸 쓴다. */
  function statsList(it) {
    var parts = [], k;
    for (k in it.s) { var t = statLine(k, it.s[k]); if (t) parts.push(t); }
    return parts;
  }
  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function getItemSpriteName(it) {
    if (!it) return null;
    var id = it.base || it.id || "";
    var slot = it.slot || "";
    if (slot === "weapon") {
      if (id === "dagger" || id === "w_dagger" || id === "shadowdagger") return "dagger";
      if (id === "sword" || id === "w_sword" || id === "excalibur") return "sword";
      if (id === "axe" || id === "w_axe" || id === "dragonslayer") return "axe";
      if (id === "spear" || id === "w_spear") return "spear";
      if (id === "staff" || id === "w_staff" || id === "arcanestaff") return "staff";
      if (id === "bow" || id === "w_bow" || id === "celestialbow") return "bow";
      if (id === "mace" || id === "w_fist") return "w_fist";
      return "sword";
    }
    if (slot === "head") {
      if (id === "crown_kings") return "i_crown";
      if (id === "hood" || id === "shadow_hood") return "i_hood";
      if (id === "helm" || id === "dragon_helm") return "i_helm";
      return "i_helm";
    }
    if (slot === "body") {
      if (id === "robe" || id === "arcane_robe") return "i_robe";
      if (id === "mail" || id === "tunic" || id === "plate" || id === "shadow_coat") return "armor";
      return "armor";
    }
    if (slot === "hands") return "i_gloves";
    if (slot === "feet") return "i_boots";
    if (slot === "ring") return "i_ring";
    if (slot === "amulet") return "i_amulet";
    if (id === "potion") return "potion";
    if (id === "scroll") return "scroll";
    if (it.sprite && global.SPRITES && global.SPRITES.has(it.sprite)) return it.sprite;
    return "sword";
  }

  function getItemIconHtml(it) {
    if (!it) return '';
    var sName = getItemSpriteName(it);
    if (!sName || !global.SPRITES || !global.SPRITES.has(sName)) return '⚔️';
    var canvas = global.SPRITES.bake(sName);
    if (!canvas) return '⚔️';
    return '<img src="' + canvas.toDataURL() + '" class="item-sprite-img" alt="" />';
  }

  function itemHTML(it, action, idx, wearable) {
    var ti = global.ITEMS.tierOf(it.tier);
    var imgHtml = getItemIconHtml(it);
    return '<button class="itm" data-' + action + '="' + idx + '"' +
      (wearable === false ? ' data-locked="1"' : '') + '>' +
      '<div class="itm-icon-box">' + imgHtml + '</div>' +
      '<div class="itm-info-box">' +
      '<span class="nm" style="color:' + ti.color + '">' + esc(it.name) + '</span>' +
      '<span class="mt">' + global.ITEMS.SLOT_NAME[it.slot] + ' · Lv.' + it.req +
      (wearable === false ? ' <b class="no">레벨 부족</b>' : '') + '</span>' +
      '<span class="st">' + esc(statsOf(it)) + '</span>' +
      (it.note ? '<span class="nt">' + esc(it.note) + '</span>' : '') +
      '</div></button>';
  }

  function formatItemStats(it) {
    if (!it) return '<div>선택된 아이템이 없습니다.</div>';
    var res = [];
    var st = it.s || it.stats || {};
    var order = ["dmg", "hp", "armor", "apsPct", "critPct", "critDmgPct", "spdPct", "lifeOnHit", "goldPct", "xpPct"];
    for (var i = 0; i < order.length; i++) {
      var k = order[i];
      if (st[k]) {
        var line = statLine(k, st[k]);
        if (line) res.push('<div class="stat-row">• ' + line + '</div>');
      }
    }
    for (var k2 in st) {
      if (order.indexOf(k2) === -1 && st[k2]) {
        var line2 = statLine(k2, st[k2]);
        if (line2) res.push('<div class="stat-row">• ' + line2 + '</div>');
      }
    }
    if (it.note) {
      res.push('<div class="stat-note">※ ' + esc(it.note) + '</div>');
    }
    if (it.set) {
      var setObj = global.ITEMS.SETS ? global.ITEMS.SETS.filter(function(s){ return s.id === it.set; })[0] : null;
      if (setObj) {
        res.push('<div class="stat-set"><b>[ ' + esc(setObj.name) + ' 세트 ]</b></div>');
        for (var si = 0; si < setObj.bonus.length; si++) {
          res.push('<div class="stat-set-bonus">(' + setObj.bonus[si].at + '세트) ' + esc(setObj.bonus[si].text) + '</div>');
        }
      }
    }
    return res.join('') || '<div class="stat-row">• 기본 장비</div>';
  }

  function sortBag() {
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero);
    if (!bag || bag.length <= 1) return toast("정렬할 아이템이 부족합니다.");

    var TIER_ORDER = { set: 5, relic: 4, rare: 3, magic: 2, common: 1 };
    var SLOT_ORDER = { weapon: 1, head: 2, body: 3, hands: 4, feet: 5, ring: 6, amulet: 7 };

    hero.bag.sort(function(pA, pB) {
      var a = I.rebuild(pA), b = I.rebuild(pB);
      if (!a) return 1; if (!b) return -1;

      var tA = TIER_ORDER[a.tier] || 0;
      var tB = TIER_ORDER[b.tier] || 0;
      if (tA !== tB) return tB - tA;

      var sA = SLOT_ORDER[a.slot] || 99;
      var sB = SLOT_ORDER[b.slot] || 99;
      if (sA !== sB) return sA - sB;

      var rA = a.req || 0, rB = b.req || 0;
      if (rA !== rB) return rB - rA;

      var eA = a.enh || 0, eB = b.enh || 0;
      return eB - eA;
    });

    S.save(hero);
    if (global.SFX) global.SFX.play("pickup");
    toast("⚡ 가방 아이템이 등급 및 종류별로 자동 정렬되었습니다!");
    openBag();
  }

  var currentBagTab = "equip";
  /* 가방 거르기·정렬·고르기.
   * ⚠ 고른 것은 **칸 번호**로 들고 있는다. 분해하면 번호가 밀리므로
   *   지울 때는 **큰 번호부터** 지운다(안 그러면 엉뚱한 것이 날아간다). */
  var bagFilterSlot = "all";
  var bagFilterTier = "all";
  var bagSort = "tier";
  var bagSel = {};

  function openBag(forceTab) {
    if (forceTab) currentBagTab = forceTab;
    var box = document.getElementById("panel");
    if (!box) return;
    if (!hero.mats) hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };
    box.dataset.type = "bag";
    var I = global.ITEMS, S = global.SAVE;
    var eq = S.liveEquip(hero), bag = S.liveBag(hero);
    var t = world.gear || I.totals(eq);

    var html = '<div class="inv-header"><h2>⚔️ 가방 및 보관함</h2>' +
      '<div class="inv-header-btns">' +
      '<div class="bag-tab-row">' +
      '<button id="btnBagTabEquip" class="bag-tab-btn' + (currentBagTab === "equip" ? " active" : "") + '">⚔️ 장비 가방</button>' +
      '<button id="btnBagTabMats" class="bag-tab-btn' + (currentBagTab === "mats" ? " active" : "") + '">🔮 재료 가방</button>' +
      '</div>' +
      (currentBagTab === "equip" ? '<div class="bag-action-row">' +
        '<button id="btnSortBag" class="btn-sort-bag">⚡ 자동 정렬</button>' +
        '<button id="btnTestItems" class="btn-test-items">🎁 테스트 장비 획득</button></div>' : '') +
      '</div></div>';
    
    if (currentBagTab === "mats") {
      var m = hero.mats;
      html += '<div class="mats-tab-container">' +
        '<div class="mat-card-item">' +
        '<div class="mat-card-ico">✨</div>' +
        '<div class="mat-card-info">' +
        '<div class="mat-card-title">영혼의 가루 <span class="mat-card-qty">' + (m.m_dust || 0) + '개</span></div>' +
        '<div class="mat-card-desc">장비를 분해하거나 몬스터를 잡을 때 획득하는 기초 가루. 연금술 및 제작의 기본 재료입니다.</div>' +
        '</div></div>' +

        '<div class="mat-card-item">' +
        '<div class="mat-card-ico">💎</div>' +
        '<div class="mat-card-info">' +
        '<div class="mat-card-title">마력 결정 <span class="mat-card-qty">' + (m.m_crystal || 0) + '개</span></div>' +
        '<div class="mat-card-desc">마력이 응축된 정교한 결정체. 고급 유물/세트 제작 재료로 쓰입니다.</div>' +
        '</div></div>' +

        '<div class="mat-card-item">' +
        '<div class="mat-card-ico">🔮</div>' +
        '<div class="mat-card-info">' +
        '<div class="mat-card-title">심연의 정수 <span class="mat-card-qty">' + (m.m_essence || 0) + '개</span></div>' +
        '<div class="mat-card-desc">던전 보스 몬스터에게서만 드롭되는 귀한 정수. 신화 및 세트 제작의 핵심입니다.</div>' +
        '</div></div>' +

        '<div class="mat-card-item">' +
        '<div class="mat-card-ico">🛡️</div>' +
        '<div class="mat-card-info">' +
        '<div class="mat-card-title">용의 비늘 <span class="mat-card-qty">' + (m.m_scale || 0) + '개</span></div>' +
        '<div class="mat-card-desc">고층 몬스터나 강력한 보스가 드롭하는 비늘. 최상급 제작에 쓰입니다.</div>' +
        '</div></div>' +
        '</div>';
    } else {
      html += '<div class="inv-body-layout">';
      
      // Grids column: Equipment Rack & Bag Grid & Summary
      html += '<div class="inv-grids-col">';
      
      // Equipment Rack
      html += '<div class="inv-sec eq-section">';
      html += '<div class="sec-title"><span>착용 장비</span><span class="sub-cnt">7 슬롯</span></div>';
      html += '<div class="eq-rack-grid">';
      var slotMeta = [
        { sl: "head", label: "투구", ico: "🧢" },
        { sl: "body", label: "갑옷", ico: "🥋" },
        { sl: "weapon", label: "무기", ico: "⚔️" },
        { sl: "hands", label: "장갑", ico: "🥊" },
        { sl: "feet", label: "신발", ico: "👞" },
        { sl: "ring", label: "반지", ico: "💍" },
        { sl: "amulet", label: "목걸이", ico: "📿" }
      ];
      for (var i = 0; i < slotMeta.length; i++) {
        var m = slotMeta[i], sl = m.sl, it = eq[sl];
        var ti = it ? I.tierOf(it.tier) : null;
        var tierCol = ti ? ti.color : '#3a3a50';
        var enhBadge = (it && it.enh) ? '<span class="enh-badge">+' + it.enh + '</span>' : '';
        var itemImg = it ? getItemIconHtml(it) : '<span class="slot-ph-ico">' + m.ico + '</span>';
        
        html += '<div class="arpg-slot eq-slot' + (it ? ' filled tier-' + (it.tier || 'common') : ' empty') + '" style="border-color:' + tierCol + '" data-eq-slot="' + sl + '" title="' + (it ? esc(it.name) : m.label + ' (비어있음)') + '">';
        html += '<div class="slot-bg-label">' + m.label + '</div>';
        html += itemImg;
        html += enhBadge;
        html += '</div>';
      }
      html += '</div></div>';

      // Bag Grid (20 compact slots: 5x4)
      html += '<div class="inv-sec bag-section">';
      html += '<div class="sec-title"><span>가방</span><span class="sub-cnt">' + bag.length + ' / ' + S.BAG + '</span></div>';

      /* ── 거르기 · 정렬 ─────────────────────────────────
       * ⚠ **거르는 것은 보여 주기만** 바꾼다. 가방 순서는 안 건드린다 —
       *   거를 때마다 실제로 지우거나 섞으면 되돌릴 수가 없다.
       * ⚠ 칸 번호(data-bag-idx)는 **진짜 번호**를 쓴다. 걸러서 보이는
       *   순서로 매기면 장착·분해가 엉뚱한 것을 집는다. */
      var SLOT_TABS = [["all", "전체"], ["weapon", "무기"], ["head", "투구"],
                       ["body", "갑옷"], ["hands", "장갑"], ["feet", "신발"],
                       ["ring", "반지"], ["amulet", "목걸이"]];
      var TIER_TABS = [["all", "전체"], ["common", "일반"], ["magic", "마법"],
                       ["rare", "희귀"], ["relic", "유물"]];
      var SORT_TABS = [["tier", "등급순"], ["slot", "종류순"], ["level", "레벨순"]];

      html += '<div class="bag-filters">';
      html += '<div class="frow"><span class="flab">종류</span>';
      for (var ft = 0; ft < SLOT_TABS.length; ft++) {
        html += '<button class="fchip' + (bagFilterSlot === SLOT_TABS[ft][0] ? " on" : "") +
          '" data-fslot="' + SLOT_TABS[ft][0] + '">' + SLOT_TABS[ft][1] + '</button>';
      }
      html += '</div><div class="frow"><span class="flab">등급</span>';
      for (var gt = 0; gt < TIER_TABS.length; gt++) {
        var tc = gt ? I.tierOf(TIER_TABS[gt][0]) : null;
        html += '<button class="fchip' + (bagFilterTier === TIER_TABS[gt][0] ? " on" : "") + '"' +
          (tc ? ' style="color:' + tc.color + '"' : '') +
          ' data-ftier="' + TIER_TABS[gt][0] + '">' + TIER_TABS[gt][1] + '</button>';
      }
      html += '</div><div class="frow"><span class="flab">정렬</span>';
      for (var st2 = 0; st2 < SORT_TABS.length; st2++) {
        html += '<button class="fchip' + (bagSort === SORT_TABS[st2][0] ? " on" : "") +
          '" data-fsort="' + SORT_TABS[st2][0] + '">' + SORT_TABS[st2][1] + '</button>';
      }
      html += '</div></div>';

      /* 보이는 것 — 진짜 번호를 달고 다닌다 */
      var shown = [];
      for (var bi = 0; bi < bag.length; bi++) {
        var b2 = bag[bi];
        if (!b2) continue;
        if (bagFilterSlot !== "all" && b2.slot !== bagFilterSlot) continue;
        if (bagFilterTier !== "all" && b2.tier !== bagFilterTier) continue;
        shown.push({ i: bi, it: b2 });
      }
      var TORD = { relic: 4, rare: 3, magic: 2, common: 1 };
      var SORD = { weapon: 1, head: 2, body: 3, hands: 4, feet: 5, ring: 6, amulet: 7 };
      shown.sort(function (x, y) {
        if (bagSort === "level") return (y.it.req || 0) - (x.it.req || 0);
        if (bagSort === "slot") {
          var d = (SORD[x.it.slot] || 99) - (SORD[y.it.slot] || 99);
          if (d) return d;
        }
        var t2 = (TORD[y.it.tier] || 0) - (TORD[x.it.tier] || 0);
        if (t2) return t2;
        return (y.it.req || 0) - (x.it.req || 0);
      });

      /* 고른 것 — 세트도 센다. 막지 않으니 숫자도 그대로다 */
      var selCount = 0;
      for (var sc = 0; sc < bag.length; sc++) if (bagSel[sc] && bag[sc]) selCount++;

      html += '<div class="bag-seltools">' +
        '<button class="fchip" id="btnSelAll">전체 선택</button>' +
        '<button class="fchip" id="btnSelNone">선택 해제</button>' +
        '<button class="fchip danger" id="btnSalvageSel"' + (selCount ? '' : ' disabled') + '>' +
        '분해하기' + (selCount ? ' (' + selCount + '개)' : '') + '</button>' +
        '<span class="selnote">' + shown.length + '개 보임' +
        (shown.length !== bag.length ? ' / 전체 ' + bag.length : '') + '</span>' +
        '</div>';

      html += '<div class="arpg-bag-grid">';
      for (var v = 0; v < shown.length; v++) {
        var idx = shown[v].i, bit = shown[v].it;
        var bTi = I.tierOf(bit.tier);
        var bTierCol = bTi ? bTi.color : '#b8b2a4';
        var canEq = I.canEquip(bit, hero.level);
        var bEnhBadge = bit.enh ? '<span class="enh-badge">+' + bit.enh + '</span>' : '';
        var lockBadge = !canEq ? '<span class="lock-badge">🔒</span>' : '';
        html += '<div class="arpg-slot bag-slot filled tier-' + (bit.tier || 'common') +
          (!canEq ? ' req-fail' : '') + (bagSel[idx] ? ' sel' : '') +
          '" style="border-color:' + bTierCol + '" data-bag-idx="' + idx +
          '" title="' + esc(bit.name) + ' · Lv.' + (bit.req || 1) + '">';
        /* ⚠ 고르기 칸을 따로 둔다. "고르기 모드" 를 만들면 지금 어느 모드인지
         *   늘 헷갈린다 — 칸은 누르면 열리고, 네모를 누르면 골라진다. */
        html += '<span class="sel-box" data-sel="' + idx + '">' +
                (bagSel[idx] ? '✔' : '') + '</span>';
        html += getItemIconHtml(bit);
        html += bEnhBadge;
        html += lockBadge;
        html += '<span class="lv-badge">' + (bit.req || 1) + '</span>';
        html += '</div>';
      }
      for (var e2 = shown.length; e2 < S.BAG; e2++) {
        html += '<div class="arpg-slot bag-slot empty"><div class="empty-dot"></div></div>';
      }
      html += '</div></div>';

      // Total Equipment Stats Summary
      html += '<div class="tot-summary"><div class="sec-title"><span>장비 능력치 총합</span></div><div class="tot-grid">';
      var order = ["dmg", "hp", "armor", "apsPct", "critPct", "critDmgPct", "spdPct", "lifeOnHit", "goldPct", "xpPct"];
      for (var o = 0; o < order.length; o++) {
        var line = statLine(order[o], t[order[o]]);
        if (line) html += '<div>' + line + '</div>';
      }
      html += '</div></div>';
      html += '</div>'; // End inv-grids-col
      html += '</div>'; // End inv-body-layout
    }

    html += '<p class="sub">I 또는 Esc 로 닫는다 · 아이템을 누르면 상세 모달 팝업이 열립니다</p>';

    box.innerHTML = html;
    box.hidden = false;
    box.style.display = "";
    box.className = "panel wide";
    addCloseButton(box);

    var btnTabEquip = document.getElementById("btnBagTabEquip");
    var btnTabMats = document.getElementById("btnBagTabMats");
    if (btnTabEquip) bindTapUI(btnTabEquip, function() { openBag("equip"); });
    if (btnTabMats) bindTapUI(btnTabMats, function() { openBag("mats"); });

    if (currentBagTab === "equip") {
      /* Click listener on equipment slots */
      box.querySelectorAll("[data-eq-slot]").forEach(function(el) {
        bindTapUI(el, function() {
          var sl = el.getAttribute("data-eq-slot");
          var it = eq[sl];
          if (it) {
            openItemModal(it, true, sl);
          } else {
            toast(I.SLOT_NAME[sl] + " 슬롯이 비어 있습니다.");
          }
        });
        /* 오른쪽 단추 — 해제 · 분해하기 */
        el.addEventListener("contextmenu", function (ev2) {
          ev2.preventDefault();
          var sl = el.getAttribute("data-eq-slot");
          if (eq[sl]) openCtxMenu(ev2, eq[sl], true, sl);
        });
      });

      /* Click listener on bag slots */
      box.querySelectorAll("[data-bag-idx]").forEach(function(el) {
        bindTapUI(el, function() {
          var bIdx = Number(el.getAttribute("data-bag-idx"));
          var bit = bag[bIdx];
          if (bit) {
            openItemModal(bit, false, bIdx);
          }
        });
        /* 오른쪽 단추 — 장착 · 분해하기 */
        el.addEventListener("contextmenu", function (ev2) {
          ev2.preventDefault();
          var bIdx = Number(el.getAttribute("data-bag-idx"));
          if (bag[bIdx]) openCtxMenu(ev2, bag[bIdx], false, bIdx);
        });
      });

      /* 거르기·정렬 — 누르면 다시 그린다. ⚠ 고른 것은 **유지한다.**
       * 거를 때마다 풀리면 여러 종류를 골라 한 번에 분해할 수가 없다. */
      box.querySelectorAll("[data-fslot]").forEach(function (el) {
        bindTapUI(el, function () { bagFilterSlot = el.getAttribute("data-fslot"); openBag(); });
      });
      box.querySelectorAll("[data-ftier]").forEach(function (el) {
        bindTapUI(el, function () { bagFilterTier = el.getAttribute("data-ftier"); openBag(); });
      });
      box.querySelectorAll("[data-fsort]").forEach(function (el) {
        bindTapUI(el, function () { bagSort = el.getAttribute("data-fsort"); openBag(); });
      });

      /* 네모를 누르면 골라진다. ⚠ 칸 누르기(물건 창)로 **번지지 않게** 막는다 */
      box.querySelectorAll("[data-sel]").forEach(function (el) {
        el.addEventListener("click", function (ev2) {
          ev2.stopPropagation();
          var i2 = Number(el.getAttribute("data-sel"));
          if (bagSel[i2]) delete bagSel[i2]; else bagSel[i2] = true;
          openBag();
        });
      });

      var bSelAll = document.getElementById("btnSelAll");
      if (bSelAll) bindTapUI(bSelAll, function () {
        /* ⚠ **보이는 것만** 고른다. 걸러 놓고 "전체 선택" 을 눌렀는데 안 보이는
         *   것까지 날아가면 그건 사고다. */
        var bag2 = global.SAVE.liveBag(hero);
        for (var i3 = 0; i3 < bag2.length; i3++) {
          var x = bag2[i3];
          if (!x) continue;
          if (bagFilterSlot !== "all" && x.slot !== bagFilterSlot) continue;
          if (bagFilterTier !== "all" && x.tier !== bagFilterTier) continue;
          bagSel[i3] = true;
        }
        openBag();
      });
      var bSelNone = document.getElementById("btnSelNone");
      if (bSelNone) bindTapUI(bSelNone, function () { bagSel = {}; openBag(); });
      var bSalv = document.getElementById("btnSalvageSel");
      if (bSalv) bindTapUI(bSalv, function () { salvageSelected(bSalv); });

      var btnSort = document.getElementById("btnSortBag");
      if (btnSort) {
        bindTapUI(btnSort, function() {
          sortBag();
        });
      }

      var btnTest = document.getElementById("btnTestItems");
      if (btnTest) {
        bindTapUI(btnTest, function() {
          giveTestItems();
          openBag();
        });
      }
    }
  }
  /* 물건 하나를 눌렀을 때 뜨는 창 — 무엇인지 보여 주고 입거나 벗는다.
   *
   * ⚠ 이 함수가 **없었다.** 가방 칸과 장비 칸이 둘 다 이걸 부르는데
   *   정의가 어디에도 없어서, 누르는 순간
   *   `ReferenceError: openItemModal is not defined` 로 터졌다 —
   *   그래서 "장착이 안 된다" 로 보였다. CSS(.item-modal-*)는 이미 있었다.
   * ⚠ 꼴은 rpg.css 가 기대하는 대로 맞춘다. 새로 짜지 않는다 —
   *   .item-modal-overlay > .item-modal-card > .item-modal-close,
   *   단추는 .card-act-row > .btn-card-act.equip / .unequip / .cancel.
   * ⚠ 창을 **새로 만들어 body 에 붙인다.** #panel 안에 그리면 가방 목록을
   *   덮어써서, 닫았을 때 돌아갈 자리가 사라진다.
   * ⚠ 레벨이 모자라면 입기 단추를 **지우지 않고 막는다.** 없애 버리면
   *   왜 못 입는지 알 수가 없다(.req-warn 이 그 자리를 말해 준다). */
  function openItemModal(it, equipped, where) {
    if (!it) return;
    var I = global.ITEMS;
    var ti = I.tierOf(it.tier);
    var can = I.canEquip(it, hero.level);

    var old = document.getElementById("itemModal");
    if (old) old.remove();

    var ov = document.createElement("div");
    ov.id = "itemModal";
    ov.className = "item-modal-overlay";

    var acts = equipped
      ? '<button class="btn-card-act unequip" data-act="unequip">벗기</button>' +
        '<button class="btn-card-act cancel" data-act="close">닫기</button>'
      : (can
          ? '<button class="btn-card-act equip" data-act="equip">입기</button>' +
            '<button class="btn-card-act cancel" data-act="close">닫기</button>'
          : '<button class="btn-card-act equip" data-act="equip" disabled>입기</button>' +
            '<button class="btn-card-act cancel" data-act="close">닫기</button>');

    ov.innerHTML =
      '<div class="item-modal-card" style="border-color:' + ti.color + '">' +
        '<button class="item-modal-close" data-act="close" aria-label="닫기">×</button>' +
        '<div class="smrow">' +
          '<div class="itm-icon-box" style="border-color:' + ti.color + '">' +
            getItemIconHtml(it) + '</div>' +
          '<div class="itm-info-box">' +
            '<span class="nm" style="color:' + ti.color + '">' + esc(it.name) + '</span>' +
            '<span class="mt">' + I.SLOT_NAME[it.slot] + ' · ' + ti.name +
              ' · Lv.' + I.reqLevel(it) +
              ((it.enh || 0) ? ' · 강화 +' + it.enh : '') + '</span>' +
          '</div>' +
        '</div>' +
        /* ⚠ 능력치는 **한 줄에 하나씩** 편다. 이어 붙이면 좁은 창에서
         *   말줄임으로 잘려 "+43 ..." 처럼 뒤가 안 보인다(실제로 그랬다). */
        '<div class="item-stats">' +
          statsList(it).map(function (t2) {
            return '<span>' + esc(t2) + '</span>';
          }).join("") +
        '</div>' +
        (can ? '' : '<span class="req-warn">Lv.' + I.reqLevel(it) + ' 부터 입을 수 있다</span>') +
        '<div class="card-act-row">' + acts + '</div>' +
      '</div>';

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    /* ⚠ 바깥을 눌러도 닫힌다. 모바일에서 작은 × 만 두면 닫기가 어렵다. */
    ov.addEventListener("click", function (e) {
      if (e.target === ov) close();
    });
    ov.querySelectorAll("[data-act]").forEach(function (b) {
      bindTapUI(b, function () {
        var a = b.getAttribute("data-act");
        if (a === "close") return close();
        if (b.disabled) return;
        close();
        if (a === "equip") equipFromBag(where);
        else if (a === "unequip") unequip(where);
      });
    });
    document.body.appendChild(ov);
  }

  /* 입는다. **자리에 있던 것은 가방으로 돌아간다** —
   * ⚠ 안 돌려주면 바꿔 끼는 순간 전에 쓰던 것이 사라진다(되돌릴 수 없다). */
  function equipFromBag(idx) {
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero);
    var it = bag[idx];
    if (!it) return;
    if (!I.canEquip(it, hero.level)) return toast("Lv." + it.req + " 부터 쓸 수 있다");
    var old = hero.equip[it.slot] || null;
    hero.bag.splice(idx, 1);
    hero.equip[it.slot] = I.pack(it);
    if (old) hero.bag.push(old);
    world.applyHero();
    global.SAVE.save(hero);
    if (global.SFX) global.SFX.play("pickup");
    openBag();
  }

  /* 하나만 분해한다 — 금화와 재료로 바꾼다.
   *
   * ⚠ 값 셈은 일괄 분해(salvageJunk)와 **같은 식**이다. 두 벌로 두면 한쪽만
   *   고쳐져 "일괄로 하면 더 받는" 이상한 일이 생긴다.
   * ⚠ 일괄 분해는 일반·마법만 건드린다. 여기서는 사람이 하나를 **고른** 것이라
   *   희귀·유물·세트까지 전부 받는다. 대신 되돌릴 수 없으니 한 번 더 묻는다.
   * ⚠ **세트를 막지 않는다.** 한때 막아 뒀는데 그건 내가 정할 일이 아니었다 —
   *   무엇을 녹일지는 쓰는 사람이 정한다. 대신 묻기는 한다. */
  var DUST_BY_TIER = { common: 1, magic: 2, rare: 4, relic: 8 };

  function salvageOne(where) {
    var I = global.ITEMS, S = global.SAVE;
    var eqSlot = (typeof where === "string") ? where : null;
    var it = eqSlot ? S.liveEquip(hero)[eqSlot] : S.liveBag(hero)[where];
    if (!it) return;
    if (!hero.mats) hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };

    var gold = Math.max(5, Math.round((it.val || 0) * 0.6));
    var dust = DUST_BY_TIER[it.tier] || 1;
    if (eqSlot) delete hero.equip[eqSlot];
    else hero.bag.splice(where, 1);
    hero.gold += gold;
    hero.mats.m_dust = (hero.mats.m_dust || 0) + dust;
    if (world && world.applyHero) world.applyHero();
    S.save(hero);
    if (global.SFX) global.SFX.play("pickup");
    toast(it.name + " 분해: +" + gold + "금 · 영혼의 가루 +" + dust);
    openBag();
  }

  /* 고른 것을 한 번에 분해한다.
   *
   * ⚠ **큰 번호부터 지운다.** 작은 것부터 지우면 뒤 번호가 밀려 엉뚱한 것이
   *   날아간다. 이건 되돌릴 수 없는 사고다.
   * ⚠ 값 셈은 한 개 분해(salvageOne)와 **같은 식**이다.
   * ⚠ **아무것도 막지 않는다.** 세트도 녹인다 — 무엇을 버릴지는 쓰는 사람이
   *   정한다. 대신 희귀·유물·세트가 섞여 있으면 **한 번 더 묻고**, 몇 개인지
   *   숫자로 보여 준다. "정말?" 만 물으면 무엇을 잃는지 모른 채 누른다. */
  function salvageSelected(btn) {
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero);
    var idxs = [];
    for (var k in bagSel) {
      var i = Number(k);
      if (bag[i]) idxs.push(i);
    }
    if (!idxs.length) return toast("고른 것이 없다");
    idxs.sort(function (a, b) { return b - a; });        /* 큰 번호부터 */

    var precious = 0, sets = 0;
    for (var p = 0; p < idxs.length; p++) {
      var t = bag[idxs[p]].tier;
      if (t === "rare" || t === "relic") precious++;
      if (bag[idxs[p]].set) sets++;
    }
    if ((precious || sets) && btn && btn.getAttribute("data-sure") !== "1") {
      btn.setAttribute("data-sure", "1");
      var what = [];
      if (precious) what.push("희귀·유물 " + precious + "개");
      if (sets) what.push("세트 " + sets + "개");
      btn.textContent = "정말 분해한다 (" + what.join(" · ") + " 포함)";
      return;
    }

    if (!hero.mats) hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };
    var gold = 0, dust = 0;
    for (var q = 0; q < idxs.length; q++) {
      var it = bag[idxs[q]];
      gold += Math.max(5, Math.round((it.val || 0) * 0.6));
      dust += DUST_BY_TIER[it.tier] || 1;
      hero.bag.splice(idxs[q], 1);
    }
    hero.gold += gold;
    hero.mats.m_dust = (hero.mats.m_dust || 0) + dust;
    bagSel = {};
    if (world && world.applyHero) world.applyHero();
    S.save(hero);
    if (global.SFX) global.SFX.play("pickup");
    toast(idxs.length + "개 분해: +" + gold + "금 · 영혼의 가루 +" + dust);
    openBag();
  }

  /* 오른쪽 단추로 여는 작은 차림표 — 장착 / 해제 / 분해하기.
   *
   * ⚠ 브라우저 기본 메뉴를 막는다. 안 막으면 그 위에 겹쳐 뜬다.
   * ⚠ 화면 밖으로 나가지 않게 민다. 오른쪽 끝 칸에서 열면 잘린다.
   * ⚠ 희귀·유물 분해는 **한 번 더 묻는다.** 오른쪽 단추는 잘못 눌리기 쉬운데
   *   분해는 되돌릴 수 없다. 글자가 바뀌고, 다시 눌러야 실행된다. */
  function openCtxMenu(ev2, it, equipped, where) {
    if (!it) return;
    var I = global.ITEMS;
    closeCtxMenu();

    var el = document.createElement("div");
    el.id = "itemCtx";
    el.className = "item-ctx";
    var rows = [];
    if (equipped) {
      rows.push('<button class="ctx-row" data-do="unequip">해제</button>');
    } else if (I.canEquip(it, hero.level)) {
      rows.push('<button class="ctx-row" data-do="equip">장착</button>');
    } else {
      rows.push('<button class="ctx-row" disabled>장착 <b>Lv.' + I.reqLevel(it) + ' 필요</b></button>');
    }
    rows.push('<button class="ctx-row danger" data-do="salvage">분해하기</button>');
    rows.push('<button class="ctx-row" data-do="close">닫기</button>');
    el.innerHTML = '<div class="ctx-head">' + esc(it.name) + '</div>' + rows.join("");
    document.body.appendChild(el);

    var r = el.getBoundingClientRect();
    var x = Math.min(ev2.clientX, window.innerWidth - r.width - 8);
    var y = Math.min(ev2.clientY, window.innerHeight - r.height - 8);
    el.style.left = Math.max(8, x) + "px";
    el.style.top = Math.max(8, y) + "px";

    el.querySelectorAll("[data-do]").forEach(function (b) {
      b.addEventListener("click", function () {
        var d = b.getAttribute("data-do");
        if (d === "close") return closeCtxMenu();
        if (d === "salvage") {
          var hard = (it.tier === "rare" || it.tier === "relic" || !!it.set);
          if (hard && b.getAttribute("data-sure") !== "1") {
            b.setAttribute("data-sure", "1");
            b.textContent = "정말 분해한다 (되돌릴 수 없다)";
            return;
          }
          closeCtxMenu();
          return salvageOne(where);
        }
        closeCtxMenu();
        if (d === "equip") equipFromBag(where);
        else if (d === "unequip") unequip(where);
      });
    });
  }

  function closeCtxMenu() {
    var old = document.getElementById("itemCtx");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }
  /* 바깥을 누르거나 Esc 를 누르면 닫는다 */
  document.addEventListener("mousedown", function (e) {
    var m = document.getElementById("itemCtx");
    if (m && !m.contains(e.target)) closeCtxMenu();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeCtxMenu();
  });

  function unequip(slot) {
    var S = global.SAVE;
    if (!hero.equip[slot]) return;
    if (hero.bag.length >= S.BAG) return toast("가방이 가득 찼다");
    hero.bag.push(hero.equip[slot]);
    delete hero.equip[slot];
    world.applyHero();
    S.save(hero);
    openBag();
  }

  /* ── 상인 ───────────────────────────────────────────────
   * 파는 값은 **산 값의 절반**이다. 같으면 사고팔기를 반복해 돈이 안 줄고,
   * 너무 낮으면 아무도 안 판다.
   * ⚠ 되사기(buyback)를 둔다. 실수로 판 것을 못 되찾으면 그 순간 게임을 끈다. */
  var SELL_RATE = 0.5;
  var POTION_PRICE = 40;
  var buyback = [];                    /* 이번 방문에 판 것 — 마을을 나가면 잊는다 */

  function priceSell(it) { return Math.max(1, Math.round(it.val * SELL_RATE)); }

  function openShop() {
    var box = document.getElementById("panel");
    if (!box) return;
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero);
    var html = '<h2>떠돌이 상인</h2><p class="sub">금화 ' + hero.gold +
      ' · 물약 ' + hero.potions + '</p><div class="cols">';

    html += '<div class="col"><h3>산다</h3>' +
      '<button class="itm" data-buy="potion">' +
      '<div class="itm-icon-box">' + (global.SPRITES && global.SPRITES.has("potion") ? '<img src="' + global.SPRITES.bake("potion").toDataURL() + '" class="item-sprite-img" alt="" />' : '🧪') + '</div>' +
      '<div class="itm-info-box">' +
      '<span class="nm">회복 물약</span>' +
      '<span class="mt">' + POTION_PRICE + '금 · 체력 절반을 채운다</span></div></button>' +
      '<p class="sub">Q 로 마신다 · 3초에 한 번</p></div>';

    html += '<div class="col"><h3>판다 <span class="mt">값의 절반</span></h3>';
    if (!bag.length) html += '<p class="sub">가방이 비었다.</p>';
    for (var b = 0; b < bag.length; b++) {
      var ti = I.tierOf(bag[b].tier);
      var imgHtml = getItemIconHtml(bag[b]);
      html += '<button class="itm" data-sell="' + b + '">' +
        '<div class="itm-icon-box" style="border-color:' + ti.color + '">' + imgHtml + '</div>' +
        '<div class="itm-info-box">' +
        '<span class="nm" style="color:' + ti.color + '">' + esc(bag[b].name) + '</span>' +
        '<span class="mt">' + I.SLOT_NAME[bag[b].slot] + ' · Lv.' + bag[b].req +
        ' → <b>' + priceSell(bag[b]) + '금</b></span>' +
        '<span class="st">' + esc(statsOf(bag[b])) + '</span></div></button>';
    }
    if (bag.length > 1) {
      html += '<div style="display:flex; flex-direction:column; gap:6px; margin-top:8px;">' +
        '<button class="itm" data-selljunk="common"><span class="nm">⚪ 일반 등급 일괄 판매</span>' +
        '<span class="mt">희귀·유물·세트는 안 판다</span></button>' +
        '<button class="itm" data-selljunk="magic"><span class="nm">🔵 일반/마법 등급 일괄 판매</span>' +
        '<span class="mt">희귀·유물·세트는 안 판다</span></button>' +
        '</div>';
    }
    html += '</div>';

    /* 되사기 — **실수로 판 것을 되찾는 자리.** 없으면 한 번의 오조작이 영구 손실이다. */
    html += '<div class="col"><h3>되산다 <span class="mt">판 값 그대로</span></h3>';
    if (!buyback.length) html += '<p class="sub">이번에 판 것이 없다.</p>';
    for (var k = 0; k < buyback.length; k++) {
      var bk = I.rebuild(buyback[k].p), tk = I.tierOf(buyback[k].p ? buyback[k].p.tier : 'common');
      var bImgHtml = getItemIconHtml(bk);
      html += '<button class="itm" data-buyback="' + k + '">' +
        '<div class="itm-icon-box" style="border-color:' + tk.color + '">' + bImgHtml + '</div>' +
        '<div class="itm-info-box">' +
        '<span class="nm" style="color:' + tk.color + '">' + esc(bk.name) + '</span>' +
        '<span class="mt">' + buyback[k].price + '금에 되산다</span></div></button>';
    }
    html += '</div></div><p class="sub">Esc 로 닫는다</p>';

    box.innerHTML = html;
    box.className = "panel wide";
    box.hidden = false; box.style.display = "";
    addCloseButton(box);
    wire(box, "buy", function () { buyPotion(); });
    wire(box, "sell", function (v) { sellOne(Number(v)); });
    wire(box, "selljunk", function (v) { sellJunk(v); });
    wire(box, "buyback", function (v) { rebuy(Number(v)); });
  }

  function smithRow(it, key) {
    var I = global.ITEMS, ti = I.tierOf(it.tier);
    var full = (it.enh || 0) >= I.ENH_MAX;
    var ch = Math.round(I.enhChance(it.enh || 0) * 100);
    var ec = I.enhCost(it), rc = I.reforgeCost(it);
    var set = it.set, common = ti.affixes[1] <= 0;
    var imgHtml = getItemIconHtml(it);
    return '<div class="smrow">' +
      '<div class="itm-icon-box" style="border-color:' + ti.color + '">' + imgHtml + '</div>' +
      '<div class="itm-info-box">' +
      '<span class="nm" style="color:' + ti.color + '">' + esc(it.name) + '</span>' +
      '<span class="mt">' + I.SLOT_NAME[it.slot] + ' · ' + ti.name +
        ' · 강화 +' + (it.enh || 0) + '/' + I.ENH_MAX + '</span>' +
      '<span class="st">' + esc(statsOf(it)) + '</span></div>' +
      '<span class="sact">' +
        (full
          ? '<b class="no">강화 끝</b>'
          : '<button class="sbtn" data-enh="' + key + '">강화 ' + ec + '금' +
            (ch < 100 ? ' <b>' + ch + '%</b>' : '') + '</button>') +
        (common ? '<b class="no">재련할 접사 없음</b>'
         : set ? '<b class="no">세트는 재련 안 함</b>'
         : '<button class="sbtn" data-ref="' + key + '">재련 ' + rc + '금</button>') +
      '</span></div>';
  }

  function openSmith() {
    var box = document.getElementById("panel");
    if (!box) return;
    var I = global.ITEMS, S = global.SAVE;
    var eq = S.liveEquip(hero), bag = S.liveBag(hero);
    var per = Math.round(I.ENH_PER * 100);
    var html = '<h2>대장장이</h2><p class="sub">금화 ' + hero.gold +
      ' · 강화 한 단계마다 그 물건의 <b>좋은 수치가 모두 +' + per + '%</b>' +
      '(+' + I.ENH_MAX + ' 이면 +' + (per * I.ENH_MAX) + '%) · ' +
      '<b>실패해도 물건은 그대로다</b> — 금화만 잃는다</p><div class="cols">';

    html += '<div class="col"><h3>입은 것</h3>';
    var any = 0;
    for (var i = 0; i < I.SLOTS.length; i++) {
      var sl = I.SLOTS[i];
      if (!eq[sl]) continue;
      any++; html += smithRow(eq[sl], "eq:" + sl);
    }
    if (!any) html += '<p class="sub">입은 것이 없다.</p>';
    html += '</div><div class="col"><h3>가방 <button id="btnSalvageJunk" style="float:right; font-size:11px; padding:3px 8px; background:#4a3525; border:1px solid #d9a441; color:#ffd24a; border-radius:4px; cursor:pointer;">♻️ 일반/마법 일괄 분해</button></h3>';
    if (!bag.length) html += '<p class="sub">가방이 비었다.</p>';
    for (var b = 0; b < bag.length; b++) html += smithRow(bag[b], "bag:" + b);
    html += '</div></div><p class="sub">Esc 로 닫는다</p>';

    box.innerHTML = html;
    box.className = "panel wide";
    box.hidden = false; box.style.display = "";
    addCloseButton(box);
    wire(box, "enh", function (k) { doSmith(k, "enh"); });
    wire(box, "ref", function (k) { doSmith(k, "ref"); });

    var salvageBtn = box.querySelector("#btnSalvageJunk");
    if (salvageBtn) {
      bindTapUI(salvageBtn, function() {
        salvageJunk();
      });
    }
  }

  /* 팩을 가리키는 자리를 돌려준다. **객체를 그대로 고쳐야** 저장에 남는다 —
   * 사본을 고치면 화면만 바뀌고 다음 불러오기에 되돌아간다. */
  function packAt(key) {
    var pr = String(key).split(":");
    if (pr[0] === "eq") return hero.equip[pr[1]] || null;
    if (pr[0] === "bag") return hero.bag[Number(pr[1])] || null;
    return null;
  }

  function doSmith(key, what) {
    var I = global.ITEMS;
    var p = packAt(key);
    if (!p) return toast("그 물건이 없다");
    var it = I.rebuild(p);
    if (!it) return toast("알 수 없는 물건이다");
    var cost = (what === "enh") ? I.enhCost(it) : I.reforgeCost(it);
    if (hero.gold < cost) return toast("금화가 " + (cost - hero.gold) + " 모자라다");

    var r = (what === "enh") ? I.enhance(p) : I.reforge(p);
    /* ⚠ **거절당했으면 금화를 안 받는다.** 먼저 깎고 나중에 물으면
     *   "+10 인데 눌렀더니 돈만 사라졌다" 가 된다. */
    if (r.err) return toast(r.err);
    hero.gold -= cost;

    if (what === "enh") {
      if (r.ok) {
        toast(r.item.name + " 완성");
        if (global.SFX) global.SFX.play("pickup");
      } else {
        /* ⚠ 실패도 **분명히** 말한다. 아무 말이 없으면 눌린 줄 모른다. */
        toast("강화 실패 — 물건은 그대로다 (" + Math.round(r.chance * 100) + "%)");
        if (global.SFX) global.SFX.play("hurt");
      }
    } else {
      toast("재련했다 — " + (statsOf(r.item) || "접사 없음"));
      if (global.SFX) global.SFX.play("pickup");
    }
    world.applyHero();
    global.SAVE.save(hero);
    openSmith();
  }

  function wire(box, attr, fn) {
    box.querySelectorAll("[data-" + attr + "]").forEach(function (el) {
      el.addEventListener("click", function () { fn(this.getAttribute("data-" + attr)); });
    });
  }

  function buyPotion() {
    if (hero.gold < POTION_PRICE) return toast("금화가 모자라다");
    if (hero.potions >= global.SAVE.FIELDS.potions.max) return toast("더 못 든다");
    hero.gold -= POTION_PRICE;
    hero.potions++;
    if (global.SFX) global.SFX.play("gold");
    global.SAVE.save(hero);
    openShop();
  }

  function sellOne(idx) {
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero);
    var it = bag[idx];
    if (!it) return;
    var price = priceSell(it);
    hero.gold += price;
    /* ⚠ 판 물건을 **버리지 말고** 되사기 목록에 둔다. 실수로 판 것을 못 되찾으면
     *   그 순간 게임을 끈다. 마을을 나가면 잊는다(무한 보관함이 되면 안 된다). */
    buyback.unshift({ p: hero.bag[idx], price: price });
    if (buyback.length > 8) buyback.pop();
    hero.bag.splice(idx, 1);
    if (global.SFX) global.SFX.play("gold");
    S.save(hero);
    openShop();
  }

  function sellJunk(tierMax) {
    tierMax = tierMax || "common";
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero), got = 0, sold = 0;
    var allowed = ["common"];
    if (tierMax === "magic") allowed.push("magic");

    for (var i = bag.length - 1; i >= 0; i--) {
      if (allowed.indexOf(bag[i].tier) < 0 || bag[i].set) continue;
      var price = priceSell(bag[i]);
      got += price; sold++;
      buyback.unshift({ p: hero.bag[i], price: price });
      hero.bag.splice(i, 1);
    }
    if (buyback.length > 8) buyback.length = 8;
    if (!sold) return toast("조건에 해당하는 팔 등급 아이템이 없다");
    hero.gold += got;
    if (global.SFX) global.SFX.play("gold");
    S.save(hero);
    toast(sold + "개 아이템을 " + got + "금에 일괄 팔았다");
    openShop();
  }

  function salvageJunk() {
    var I = global.ITEMS, S = global.SAVE;
    if (!hero.mats) hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };
    var bag = S.liveBag(hero), gotGold = 0, gotDust = 0, count = 0;
    for (var i = bag.length - 1; i >= 0; i--) {
      if ((bag[i].tier === "common" || bag[i].tier === "magic") && !bag[i].set) {
        var val = Math.max(5, Math.round(bag[i].val * 0.6));
        gotGold += val;
        gotDust += (bag[i].tier === "magic" ? 2 : 1);
        count++;
        hero.bag.splice(i, 1);
      }
    }
    if (!count) return toast("분해할 일반/마법 등급 아이템이 없다");
    hero.gold += gotGold;
    hero.mats.m_dust = (hero.mats.m_dust || 0) + gotDust;
    if (global.SFX) global.SFX.play("pickup");
    S.save(hero);
    toast(count + "개 아이템 분해: +" + gotGold + "금, ✨영혼의 가루 +" + gotDust + " 획득!");
    openSmith();
  }

  /* ── 테스트 장비 지급 ─────────────────────────────────── */
  function giveTestItems() {
    var I = global.ITEMS, S = global.SAVE, D = global.DUNGEON;
    if (!I || !D) return toast("아이템 모듈이 없습니다.");
    var rng = D.makeRng(Date.now() & 0x7fffffff);
    var count = 0;
    var slots = ["weapon", "head", "body", "hands", "feet", "ring", "amulet"];
    /* ⚠ `bases[bases.length - 1]` 로 **늘 목록의 마지막 하나**만 줬다.
     *   무기가 일곱 종(단검·장검·전투도끼·장창·철퇴·지팡이·활)인데 활만 나왔다.
     *   시험 장비인데 한 종류만 나오면 무기별 차이를 아예 못 본다.
     * ⚠ **무기를 먼저 다 준다.** 가방이 24칸이라 전부(7+6+3+2+2+2+2=24)는
     *   빠듯하다 — 뒤에서 잘리더라도 무기는 온전해야 한다.
     * ⚠ 자리가 없으면 조용히 멈추지 않고 몇 개를 줬는지 말한다. */
    for (var i = 0; i < slots.length; i++) {
      var sl = slots[i];
      var bases = I.BASES[sl];
      if (!bases || !bases.length) continue;
      for (var bi = 0; bi < bases.length; bi++) {
        if (hero.bag.length >= S.BAG) break;
        var item = I.roll(rng, { slot: sl, base: bases[bi].id, tier: "relic", ilvl: 15 });
        if (!item) continue;
        hero.bag.push(I.pack(item));
        count++;
      }
      if (hero.bag.length >= S.BAG) break;
    }
    if (!count) return toast("가방이 가득 찼습니다.");
    hero.potions = Math.min(99, (hero.potions || 0) + 5);
    hero.gold += 5000;
    /* ⚠ **레벨도 같이 올린다.** 주는 것이 ilvl 15 유물이라 Lv.1 로는 하나도
     *   못 낀다 — 가방만 가득 차고 시험이 안 된다. 실측으로 일곱 개 전부
     *   "Lv.x 부터 입을 수 있다" 로 막혔다.
     * ⚠ 내리지는 않는다(Math.max). 이미 더 높은 사람의 레벨을 깎으면 안 된다. */
    var before = hero.level;
    hero.level = Math.max(hero.level || 1, 15);
    if (world && world.applyHero) world.applyHero();
    S.save(hero);
    if (global.SFX) global.SFX.play("pickup");
    toast("🎁 테스트 장비 " + count + "개 + 물약 5개 + 금화 5000" +
          (hero.level > before ? " · Lv." + hero.level + " 로 올림" : "") + "!");
  }

  /* ── 연금술사 / 제작 ─────────────────────────────────── */
  var CRAFT_RECIPES = [
    {
      id: "craft_dragon_helm",
      name: "용비늘 면갑 투구",
      slot: "head",
      base: "dragon_helm",
      tier: "relic",
      ilvl: 15,
      gold: 500,
      mats: { m_dust: 10, m_crystal: 5, m_scale: 3 },
      note: "방어력 +16, 체력 +60 최고 등급 면갑"
    },
    {
      id: "craft_archmage_hat",
      name: "대마법사의 깃털모",
      slot: "head",
      base: "archmage_hat",
      tier: "relic",
      ilvl: 15,
      gold: 500,
      mats: { m_dust: 10, m_crystal: 5, m_essence: 2 },
      note: "방어력 +8, 공격속도 +12% 마법사 모자"
    },
    {
      id: "craft_crown_kings",
      name: "국왕의 면갑 크라운",
      slot: "head",
      base: "crown_kings",
      tier: "relic",
      ilvl: 15,
      gold: 800,
      mats: { m_dust: 15, m_crystal: 8, m_essence: 3 },
      note: "방어력 +12, 체력 +45 명품 왕관"
    },
    {
      id: "craft_set_pilgrim_robe",
      name: "순례자의 긴 옷",
      slot: "body",
      base: "robe",
      tier: "relic",
      ilvl: 15,
      gold: 750,
      mats: { m_dust: 15, m_crystal: 8, m_essence: 2 },
      note: "심연의 순례자 세트 갑옷 (3세트: 이속+10%, 공속+8%)"
    },
    {
      id: "craft_set_pilgrim_pendant",
      name: "순례자의 펜던트",
      slot: "amulet",
      base: "pendant",
      tier: "relic",
      ilvl: 15,
      gold: 750,
      mats: { m_dust: 15, m_crystal: 8, m_scale: 4 },
      note: "심연의 순례자 세트 목걸이 (5세트: 치명+10%, 체력+40)"
    }
  ];

  function openCraft() {
    var box = document.getElementById("panel");
    if (!box) return;
    if (!hero.mats) hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };
    var m = hero.mats;
    var I = global.ITEMS;

    var html = '<h2>연금술사 (장비 제작)</h2>' +
      '<p class="sub">몬스터 처치 및 장비 분해로 얻은 재료로 <b>최상위 유물/세트 장비</b>를 제작합니다</p>' +
      '<div class="mats-bar">' +
      '<span class="mat-badge">✨ 영혼의 가루: <b>' + (m.m_dust||0) + '</b></span>' +
      '<span class="mat-badge">💎 마력 결정: <b>' + (m.m_crystal||0) + '</b></span>' +
      '<span class="mat-badge">🔮 심연의 정수: <b>' + (m.m_essence||0) + '</b></span>' +
      '<span class="mat-badge">🛡️ 용의 비늘: <b>' + (m.m_scale||0) + '</b></span>' +
      '<span class="mat-badge gold">💰 금화: <b>' + hero.gold + '</b></span>' +
      '</div>' +
      '<div class="craft-recipes-list">';

    for (var i = 0; i < CRAFT_RECIPES.length; i++) {
      var r = CRAFT_RECIPES[i];
      var ti = I.tierOf(r.tier);
      var canGold = hero.gold >= r.gold;
      var canDust = (m.m_dust||0) >= (r.mats.m_dust||0);
      var canCrystal = (m.m_crystal||0) >= (r.mats.m_crystal||0);
      var canEssence = (m.m_essence||0) >= (r.mats.m_essence||0);
      var canScale = (m.m_scale||0) >= (r.mats.m_scale||0);
      var allMats = canGold && canDust && canCrystal && canEssence && canScale;

      var reqText = [];
      if (r.mats.m_dust) reqText.push('<span class="' + (canDust ? 'ok' : 'no') + '">✨가루 ' + (m.m_dust||0) + '/' + r.mats.m_dust + '</span>');
      if (r.mats.m_crystal) reqText.push('<span class="' + (canCrystal ? 'ok' : 'no') + '">💎결정 ' + (m.m_crystal||0) + '/' + r.mats.m_crystal + '</span>');
      if (r.mats.m_essence) reqText.push('<span class="' + (canEssence ? 'ok' : 'no') + '">🔮정수 ' + (m.m_essence||0) + '/' + r.mats.m_essence + '</span>');
      if (r.mats.m_scale) reqText.push('<span class="' + (canScale ? 'ok' : 'no') + '">🛡️비늘 ' + (m.m_scale||0) + '/' + r.mats.m_scale + '</span>');
      reqText.push('<span class="' + (canGold ? 'ok' : 'no') + '">💰' + r.gold + '금</span>');

      html += '<div class="craft-row">' +
        '<div class="itm-info-box">' +
        '<span class="nm" style="color:' + ti.color + '">' + esc(r.name) + ' (' + ti.name + ')</span>' +
        '<span class="mt">' + I.SLOT_NAME[r.slot] + ' · Lv.' + r.ilvl + ' · ' + esc(r.note) + '</span>' +
        '<div class="craft-reqs">' + reqText.join(' · ') + '</div>' +
        '</div>' +
        '<button class="sbtn craft-btn' + (allMats ? '' : ' disabled') + '" data-craft="' + i + '">' +
        (allMats ? '🔨 제작하기' : '재료 부족') + '</button>' +
        '</div>';
    }

    html += '</div><p class="sub">Esc 로 닫는다</p>';

    box.innerHTML = html;
    box.className = "panel wide";
    box.hidden = false; box.style.display = "";
    addCloseButton(box);

    wire(box, "craft", function(v) { doCraft(Number(v)); });
  }

  function doCraft(idx) {
    var r = CRAFT_RECIPES[idx];
    if (!r) return;
    var S = global.SAVE, I = global.ITEMS, D = global.DUNGEON;
    if (!hero.mats) hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };
    var m = hero.mats;

    if (hero.gold < r.gold) return toast("금화가 모자랍니다.");
    if (hero.bag.length >= S.BAG) return toast("가방이 가득 찼습니다.");
    if (r.mats.m_dust && (m.m_dust||0) < r.mats.m_dust) return toast("영혼의 가루가 부족합니다.");
    if (r.mats.m_crystal && (m.m_crystal||0) < r.mats.m_crystal) return toast("마력 결정이 부족합니다.");
    if (r.mats.m_essence && (m.m_essence||0) < r.mats.m_essence) return toast("심연의 정수가 부족합니다.");
    if (r.mats.m_scale && (m.m_scale||0) < r.mats.m_scale) return toast("용의 비늘이 부족합니다.");

    hero.gold -= r.gold;
    if (r.mats.m_dust) m.m_dust -= r.mats.m_dust;
    if (r.mats.m_crystal) m.m_crystal -= r.mats.m_crystal;
    if (r.mats.m_essence) m.m_essence -= r.mats.m_essence;
    if (r.mats.m_scale) m.m_scale -= r.mats.m_scale;

    var rng = D.makeRng(Date.now() & 0x7fffffff);
    var newItem = I.roll(rng, { slot: r.slot, base: r.base, tier: r.tier, ilvl: r.ilvl });
    hero.bag.push(I.pack(newItem));

    if (global.SFX) global.SFX.play("pickup");
    S.save(hero);
    toast("✨ [" + newItem.name + "] 제작에 성공했습니다!");
    openCraft();
  }

  function rebuy(k) {
    var S = global.SAVE, e = buyback[k];
    if (!e) return;
    if (hero.gold < e.price) return toast("금화가 모자라다");
    if (hero.bag.length >= S.BAG) return toast("가방이 가득 찼다");
    hero.gold -= e.price;
    hero.bag.push(e.p);
    buyback.splice(k, 1);
    S.save(hero);
    openShop();
  }

  /* ── 창고 ───────────────────────────────────────────────
   * ⚠ 창고는 **마을에서만** 열린다. 던전에서 열리면 가방 크기가 뜻을 잃는다
   *   (가방이 차면 마을에 다녀오게 만드는 것이 그 숫자의 목적이다). */
  function openStash() {
    var box = document.getElementById("panel");
    if (!box) return;
    var I = global.ITEMS, S = global.SAVE;
    var bag = S.liveBag(hero), st = S.liveStash(hero);
    var html = '<h2>창고</h2><p class="sub">여기 둔 것은 죽어도 남는다</p><div class="cols">';

    html += '<div class="col"><h3>가방 <span class="mt">' + bag.length + ' / ' + S.BAG +
            '</span></h3>';
    if (!bag.length) html += '<p class="sub">비었다.</p>';
    for (var b = 0; b < bag.length; b++) html += stashRow(bag[b], "put", b, "넣기 →");
    html += '</div>';

    html += '<div class="col"><h3>창고 <span class="mt">' + st.length + ' / ' + S.STASH +
            '</span></h3>';
    if (!st.length) html += '<p class="sub">비었다.</p>';
    for (var k = 0; k < st.length; k++) html += stashRow(st[k], "get", k, "← 꺼내기");
    html += '</div></div><p class="sub">Esc 로 닫는다</p>';

    box.innerHTML = html;
    box.className = "panel wide";
    box.hidden = false; box.style.display = "";
    addCloseButton(box);
    wire(box, "put", function (v) { moveItem(hero.bag, hero.stash, Number(v), S.STASH, "창고가 가득 찼다"); });
    wire(box, "get", function (v) { moveItem(hero.stash, hero.bag, Number(v), S.BAG, "가방이 가득 찼다"); });
  }

  function stashRow(it, attr, idx, verb) {
    var ti = global.ITEMS.tierOf(it.tier);
    return '<button class="itm" data-' + attr + '="' + idx + '">' +
      '<span class="nm" style="color:' + ti.color + '">' + esc(it.name) + '</span>' +
      '<span class="mt">' + global.ITEMS.SLOT_NAME[it.slot] + ' · Lv.' + it.req +
      ' · ' + verb + '</span>' +
      '<span class="st">' + esc(statsOf(it)) + '</span></button>';
  }

  function moveItem(from, to, idx, cap, full) {
    if (!from[idx]) return;
    if (to.length >= cap) return toast(full);
    to.push(from[idx]);
    from.splice(idx, 1);
    global.SAVE.save(hero);
    openStash();
  }

  /* ── 재주책(K) ───────────────────────────────────────
   * 레벨업으로 받은 점수로 **시너지 하나**를 고른다. 스킬마다 하나뿐이다 —
   * 셋 다 켤 수 있으면 고를 이유가 없고, 그럼 빌드가 사라진다.
   * ⚠ 되돌리기(초기화)를 둔다. 캐릭터가 영구히 남는 게임에서 잘못 찍은 것을
   *   못 되돌리면 그 캐릭터를 버려야 한다. */
  function openBook() {
    var box = document.getElementById("panel");
    if (!box) return;
    var SK = global.SKILLS;
    var html = '<h2>스킬북</h2><p class="sub">남은 점수 <b>' + hero.points +
      '</b> · 스킬 슬롯 1·2·3·4 (◀ ▶ 버튼 또는 좌우 스크롤)</p>' +
      '<div class="skill-tabs">' +
      '<button id="stabActive" class="stab-btn active">⚡ 액티브 스킬</button>' +
      '<button id="stabPassive" class="stab-btn">🛡️ 패시브 / 버프</button>' +
      '</div>' +
      '<div class="cols-scroll-wrap">' +
      '<button class="scroll-arrow left" id="btnSkillPrev" title="이전 스킬">◀</button>' +
      '<div class="cols skill-cols" id="skillColsWrap">';

    var mine = global.CLASSES ? global.CLASSES.skills(hero.cls) : [];

    for (var i = 0; i < mine.length; i++) {
      var sId = mine[i];
      /* ⚠ `SK.by` 가 아니라 **`SK.byId`** 다. skills.js 는 by 를 안 내보낸다.
       *   그래서 스킬북이 첫 반복에서 터졌고, 창을 보이게 하는 줄에 아예
       *   닿지 못했다 — 눌러도 **아무 일도 안 일어나는** 것으로 보였다. */
      var def = SK.byId(sId);
      if (!def) continue;

      var barAt = (hero.bar || []).indexOf(def.id);
      var pts = (hero.skills[def.id] || []).length;
      var isPassive = (def.type === "passive" || def.kind === "buff");
      var stype = isPassive ? "passive" : "active";

      /* ⚠ `SK.calc` 도 없다. `SK.resolve(id, 가진것)` 이다 — 인자도 다르다.
       *   이름만 바꾸면 def 를 id 자리에 넣게 되어 조용히 null 이 된다. */
      var r = SK.resolve(def.id, hero.skills);

      html += '<div class="col skill" data-type="' + stype + '">' +
        '<div class="head"><canvas width="34" height="34" data-ico="' + def.icon + '"></canvas>' +
        '<div><h3>' + esc(def.name) + '</h3><p class="tag">' +
        (isPassive ? '지속/버프 스킬' : ('재사용 ' + def.cd + '초 · 기력 ' + def.stam)) +
        '</p></div></div>' +
        '<p class="desc">' + esc(def.text) + '</p>' +
        '<div class="sub-stat">단계 ' + pts + ' / ' + def.syn.length +
        (r && r.mult ? ' · 위력 ' + r.mult.toFixed(1) + '배' : '') + '</div>';

      for (var j = 0; j < def.syn.length; j++) {
        var sy = def.syn[j];
        var got = (hero.skills[def.id] || []).indexOf(sy.id) >= 0;
        var locked = !got && ((hero.skills[def.id] || []).length > 0 || hero.points < 1);
        html += '<button class="itm syn' + (got ? " got" : "") + '"' +
          (locked ? ' data-locked="1"' : '') +
          ' data-syn="' + def.id + ':' + sy.id + '">' +
          '<span class="nm">' + (got ? "✔ " : "") + esc(sy.name) + '</span>' +
          '<span class="st">' + esc(sy.text) + '</span></button>';
      }

      if (!isPassive) {
        html += '<div class="bar-pick">';
        for (var b = 0; b < 4; b++)
          html += '<button class="slot' + (barAt === b ? " on" : "") +
            '" data-bar="' + def.id + ':' + b + '">' + (b + 1) + '</button>';
        html += '</div>';
      } else {
        html += '<div class="bar-pick passive-tag"><span class="mt">자동 적용 지속 효과</span></div>';
      }
      html += '</div>';
    }
    html += '</div>' +
      '<button class="scroll-arrow right" id="btnSkillNext" title="다음 스킬">▶</button>' +
      '</div>';

    html += '<p class="sub" style="margin-top:8px;"><button class="itm reset" data-reset="1">' +
      '<span class="nm">전부 되돌리기</span>' +
      '<span class="mt">점수를 돌려받는다 — 잘못 찍어도 캐릭터를 버리지 않게</span>' +
      '</button></p>';
    html += '<p class="sub">K 또는 Esc 로 닫는다</p>';

    box.innerHTML = html;
    box.className = "panel wide";
    box.hidden = false; box.style.display = "";
    addCloseButton(box);

    var filterSkills = function(type) {
      box.querySelectorAll(".col.skill").forEach(function(el) {
        if (el.getAttribute("data-type") === type) {
          el.style.display = "";
        } else {
          el.style.display = "none";
        }
      });
    };

    var stabA = document.getElementById("stabActive");
    var stabP = document.getElementById("stabPassive");
    if (stabA && stabP) {
      stabA.addEventListener("click", function() {
        stabA.classList.add("active");
        stabP.classList.remove("active");
        filterSkills("active");
      });
      stabP.addEventListener("click", function() {
        stabP.classList.add("active");
        stabA.classList.remove("active");
        filterSkills("passive");
      });
      filterSkills("active");
    }

    var wrap = document.getElementById("skillColsWrap");
    var btnP = document.getElementById("btnSkillPrev");
    var btnN = document.getElementById("btnSkillNext");
    if (wrap && btnP && btnN) {
      btnP.addEventListener("click", function () { wrap.scrollBy({ left: -260, behavior: "smooth" }); });
      btnN.addEventListener("click", function () { wrap.scrollBy({ left: 260, behavior: "smooth" }); });
    }

    box.querySelectorAll("canvas[data-ico]").forEach(function (cv) {
      paintIcon(cv, cv.getAttribute("data-ico"), 34);
    });
    wire(box, "syn", function (v) { takeSyn(v); });
    wire(box, "bar", function (v) { setBar(v); });
    wire(box, "reset", function () { resetSkills(); });
  }
  function takeSyn(v) {
    var p = v.split(":"), id = p[0], sy = p[1];
    var have = hero.skills[id] || [];
    if (have.indexOf(sy) >= 0) return;
    if (have.length) return toast("이 재주는 이미 하나를 골랐다 — 되돌리기로 바꾼다");
    if (hero.points < 1) return toast("점수가 없다 — 레벨을 올린다");
    hero.points--;
    hero.skills[id] = [sy];
    if (global.SFX) global.SFX.play("level");
    global.SAVE.save(hero);
    openBook();
  }

  function setBar(v) {
    var p = v.split(":"), id = p[0], i = Number(p[1]);
    /* ⚠ 같은 스킬이 두 칸에 있으면 하나가 죽은 칸이 된다 — 옮긴다 */
    var was = hero.bar.indexOf(id);
    if (was === i) { hero.bar[i] = null; }
    else {
      if (was >= 0) hero.bar[was] = null;
      hero.bar[i] = id;
    }
    global.SAVE.save(hero);
    openBook();
  }

  function resetSkills() {
    var back = 0;
    for (var k in hero.skills) back += (hero.skills[k] || []).length;
    if (!back) return toast("되돌릴 것이 없다");
    hero.points += back;
    hero.skills = {};
    global.SAVE.save(hero);
    toast("점수 " + back + "개를 돌려받았다");
    openBook();
  }

  /* 화면 아래 스킬 줄 — **쿨다운이 보여야** 언제 쓸지 안다.
   * ⚠ 매 프레임 innerHTML 을 다시 만들지 말 것(초당 60번이면 눈에 띄게 끊긴다).
   *   칸은 한 번만 만들고 **채움만** 고친다. */
  /* 스프라이트 하나를 캔버스에 그린다.
   * ⚠ **한 번만** 그린다. 매 프레임 다시 그리면 손잡이 네 칸 × 60fps = 초당 240번이다.
   * ⚠ 도트는 흐리면 안 된다(imageSmoothingEnabled = false). */
  function paintIcon(cv, name, px) {
    if (!cv || !global.SPRITES) return;
    var img = global.SPRITES.bake(name);
    if (!img) return;
    cv.width = px; cv.height = px;
    var g = cv.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, px, px);
    g.drawImage(img, 0, 0, px, px);
  }

  var barEls = null;
  function buildBar() {
    var el = document.getElementById("skillbar");
    if (!el) return;
    el.innerHTML = "";
    barEls = [];
    for (var i = 0; i < 4; i++) {
      var d = document.createElement("div");
      d.className = "sk";
      /* ⚠ 아이콘이 **덮개(.cool) 밑**에 와야 쿨다운이 아이콘을 덮는다.
       *   순서를 바꾸면 덮개가 아이콘에 가려 남은 시간이 안 읽힌다. */
      d.innerHTML = '<canvas class="ico"></canvas>' +
                    '<i class="cool"></i><b class="key">' + (i + 1) +
                    '</b><span class="nm"></span><span class="cd"></span>';
      el.appendChild(d);
      barEls.push({ root: d, cool: d.querySelector(".cool"),
                    ico: d.querySelector(".ico"), painted: null,
                    nm: d.querySelector(".nm"), cd: d.querySelector(".cd") });
    }
  }
  function drawBar() {
    if (!barEls) buildBar();
    if (!barEls) return;
    var SK = global.SKILLS;
    for (var i = 0; i < 4; i++) {
      var id = hero.bar[i], e = barEls[i];
      if (!id) {
        e.root.className = "sk empty";
        e.nm.textContent = "—"; e.cd.textContent = "";
        e.cool.style.height = "0%";
        e.painted = null;
        continue;
      }
      var def = SK.byId(id), r = SK.resolve(id, hero.skills);
      /* ⚠ **바뀌었을 때만** 다시 굽는다(위 주석 참조). */
      if (e.painted !== def.icon) { paintIcon(e.ico, def.icon, 40); e.painted = def.icon; }
      var left = SK.cdLeft(world, id, hero.skills);
      var lowStam = world.player.stam < r.stam;
      e.root.className = "sk" + (left > 0 ? " cooling" : "") + (lowStam ? " nostam" : "");
      e.nm.textContent = def.name;
      e.cd.textContent = left > 0 ? left.toFixed(1) : "";
      e.cool.style.height = left > 0 ? Math.round(left / r.cd * 100) + "%" : "0%";
    }

    /* 모바일 우측 액션 패드 스킬 버튼 동기화 */
    for (var j = 0; j < 4; j++) {
      var mid = hero.bar[j];
      var mbtn = document.getElementById("btnSkill" + (j + 1));
      if (!mbtn) continue;
      if (!mid) {
        mbtn.style.opacity = "0.35";
        var mcdEmpty = mbtn.querySelector(".cd"); if (mcdEmpty) mcdEmpty.textContent = "";
        var mcoolEmpty = mbtn.querySelector(".cool"); if (mcoolEmpty) mcoolEmpty.style.height = "0%";
        continue;
      }
      var mdef = SK.byId(mid), mr = SK.resolve(mid, hero.skills);
      var mico = mbtn.querySelector(".act-ico");
      if (mbtn._painted !== mdef.icon && mico) { paintIcon(mico, mdef.icon, 30); mbtn._painted = mdef.icon; }
      var mleft = SK.cdLeft(world, mid, hero.skills);
      mbtn.style.opacity = "1";
      mbtn.classList.toggle("cooling", mleft > 0);
      var mcd = mbtn.querySelector(".cd");
      if (mcd) mcd.textContent = mleft > 0 ? mleft.toFixed(1) : "";
      var mcool = mbtn.querySelector(".cool");
      if (mcool) mcool.style.height = mleft > 0 ? Math.round(mleft / mr.cd * 100) + "%" : "0%";
    }

    /* 상단 메뉴 물약 개수 갱신 및 귀환 버튼 상태 동기화 */
    var potEl = document.getElementById("potNum");
    if (potEl) potEl.textContent = hero.potions || 0;
    var mRec = document.getElementById("btnRecall");
    var tRec = document.getElementById("btnTouchRecall");
    if (world) {
      var inTown = world.inTown;
      var isRecall = world.recall;
      [mRec, tRec].forEach(function (el) {
        if (!el) return;
        if (inTown) {
          el.style.opacity = "0.45";
          el.classList.remove("highlight");
        } else if (isRecall) {
          el.style.opacity = "1";
          el.classList.add("highlight");
        } else {
          el.style.opacity = "1";
          el.classList.remove("highlight");
        }
      });
    }

    /* 구슬 — **체력은 왼쪽, 기력은 오른쪽.** 아래에서 차오른다.
     * ⚠ 숫자만 두면 전투 중에 못 읽는다. 차오르는 높이가 먼저 읽히고
     *   숫자는 확인용이다. */
    var p2 = world.player;
    fillOrb("orb-hp", "hpNum", p2.hp, p2.maxHp);
    fillOrb("orb-st", "stNum", p2.stam, p2.stamMax || global.SKILLS.STAM_MAX);
  }

  var orbEls = {};
  function fillOrb(cls, numId, val, max) {
    var e = orbEls[cls];
    if (!e) {
      var root = document.querySelector("." + cls);
      if (!root) return;
      e = orbEls[cls] = { fill: root.querySelector(".fill"),
                          num: document.getElementById(numId), root: root };
    }
    var f = Math.max(0, Math.min(1, max ? val / max : 0));
    e.fill.style.height = (f * 100).toFixed(1) + "%";
    e.num.textContent = Math.round(val);
    /* ⚠ 위험할 때는 **눈에 띄어야** 한다. 색만 바꾸면 흘긋 봐서는 모른다 */
    e.root.classList.toggle("low", f < 0.3);
  }

  /* ── 캐릭터 만들기 ─────────────────────────────────────
   * 처음 켜면 여기부터다. ⚠ 직업을 못 고르게 두면 도트 셋과 저장 검증이
   *   있으나 마나다(실제로 그랬다 — 전사 하나로만 30층을 도는 게임이었다).
   * ⚠ **무엇이 다른지 숫자로 보여 준다.** "빠르다/단단하다" 만 적으면 고를
   *   근거가 없어 아무거나 누르고, 그러면 고른 뜻이 없다. */
  function openCreate() {
    var box = document.getElementById("panel");
    if (!box) return;
    var CL = global.CLASSES, SK = global.SKILLS;
    var html = '<h2>직업 선택 및 캐릭터 변경</h2>' +
      '<p class="sub">직업마다 <b>따로 저장</b>된다 — 바꿔도 하던 것은 그대로 남고, 돌아오면 이어서 한다. 창고는 공용이다.</p>' +
      '<div class="cols-scroll-wrap">' +
      '<button class="scroll-arrow left" id="btnClsPrev" title="이전 직업">◀</button>' +
      '<div class="cols cls-cols" id="clsColsWrap">';
    /* 어느 직업에 무엇이 있는지 **먼저 보여 준다.** 안 보이면 잃을까 봐 못 누른다 */
    var saved = (global.SAVE && global.SAVE.slots) ? global.SAVE.slots() : {};
    for (var i = 0; i < CL.LIST.length; i++) {
      var c = CL.LIST[i];
      var isCurrent = hero && hero.cls === c.id;
      var sv = saved[c.id];
      html += '<div class="col cls' + (isCurrent ? ' current' : '') + '">';
      html += '<canvas class="face" data-ico="' + esc(c.sprite) + '"></canvas>';
      html += '<h3>' + esc(c.name) + ' <span class="mt">' + esc(c.tag) + '</span>' +
        (isCurrent ? ' <b style="font-size:11px; color:#ffd24a;">[현재 직업]</b>' : '') + '</h3>';
      html += '<div class="cls-save' + (sv ? '' : ' none') + '">' +
        (sv ? '저장됨 · <b>Lv.' + sv.level + '</b> · 최고 ' + sv.maxDepth + '층 · ' +
              sv.gold.toLocaleString() + '금'
            : '아직 없음 · 누르면 새로 시작') + '</div>';
      html += '<p class="sub">' + esc(c.text) + '</p>';
      html += '<div class="tot">' +
        '<div>체력 ' + c.hp + ' (레벨마다 +' + c.hpPer + ')</div>' +
        '<div>이동 ' + c.spd.toFixed(1) + '칸/초</div>' +
        '<div>방어 +' + c.armor + ' · 치명타 +' + c.critPct + '%</div>' +
        '<div>기력 ' + c.stam + ' (초당 +' + c.stamRegen + ')</div>' +
        '<div class="hr"></div>' +
        '<div>잘 쓰는 무기 <b>' + esc(c.likesText) + '</b> <span class="mt">피해 +' +
          CL.ADEPT_BONUS + '%</span></div>' +
        '</div>';
      html += '<div class="clsk">';
      for (var j = 0; j < c.skills.length; j++) {
        var sk = SK.byId(c.skills[j]);
        html += '<div class="one"><canvas class="ico" data-ico="' + esc(sk.icon) +
          '"></canvas><b>' + esc(sk.name) + '</b><span>' + esc(sk.text) + '</span></div>';
      }
      for (var k = 0; k < CL.SHARED.length; k++) {
        var sh = SK.byId(CL.SHARED[k]);
        html += '<div class="one shared"><canvas class="ico" data-ico="' + esc(sh.icon) +
          '"></canvas><b>' + esc(sh.name) + '</b><span>공용</span></div>';
      }
      html += '</div>';
      html += '<button class="pick" data-cls="' + esc(c.id) + '">' +
        (isCurrent ? '이 직업으로 계속하기'
         : sv ? esc(c.name) + ' Lv.' + sv.level + ' 로 이어서'
              : esc(c.name) + '(으)로 새로 시작') + '</button>';
      html += '</div>';
    }
    html += '</div>' +
      '<button class="scroll-arrow right" id="btnClsNext" title="다음 직업">▶</button>' +
      '</div>';
    box.innerHTML = html;
    box.className = "panel wide";
    box.hidden = false; box.style.display = "";
    addCloseButton(box);

    var cwrap = document.getElementById("clsColsWrap");
    var cbtnP = document.getElementById("btnClsPrev");
    var cbtnN = document.getElementById("btnClsNext");
    if (cwrap && cbtnP && cbtnN) {
      cbtnP.addEventListener("click", function () { cwrap.scrollBy({ left: -260, behavior: "smooth" }); });
      cbtnN.addEventListener("click", function () { cwrap.scrollBy({ left: 260, behavior: "smooth" }); });
    }

    box.querySelectorAll("canvas[data-ico]").forEach(function (cv) {
      paintIcon(cv, cv.getAttribute("data-ico"),
        cv.className.indexOf("face") >= 0 ? 64 : 26);
    });
    wire(box, "cls", function (v) { createHero(v); });
  }

  /* 직업을 고른다 — 이미 키운 직업이면 **이어서 한다.**
   *
   * ⚠ 예전에는 고를 때마다 `S.blank(cls)` 로 새로 만들었다. 저장 칸이 하나라
   *   그 위에 덮여서, 전사로 키운 레벨·가방·장비가 통째로 날아갔다.
   *   바꿔 보려고 눌렀다가 잃는 것은 사고다.
   * ⚠ 바꾸기 **전에 쓰던 것을 먼저 저장한다.** 안 하면 방금까지 한 것이
   *   저장 칸에 안 들어간 채 사라진다.
   * ⚠ 창고(stash)는 공용이다 — 옮겨 준다. 직업마다 따로 두면 전사가 넣은
   *   것을 도적이 못 꺼낸다.
   * ⚠ 같은 직업을 다시 고르면 **아무것도 안 한다.** 거기서 새로 만들면
   *   "바꾼 것도 아닌데 초기화" 가 된다. */
  function createHero(cls) {
    var CL = global.CLASSES, I = global.ITEMS, S = global.SAVE, D = global.DUNGEON;
    var c = CL.byId(cls);
    var prevStash = hero ? (hero.stash || []) : [];

    if (hero && hero.cls === cls) {
      closePanel();
      toast(c.name + " 그대로 이어서 합니다.");
      return;
    }
    if (hero && hero.cls) S.save(hero);        /* 쓰던 것을 제 칸에 넣는다 */

    var got = S.loadSlot ? S.loadSlot(cls) : null;
    if (got) {
      got.stash = prevStash;                   /* 창고는 공용 */
      hero = S.sanitize(got);
      S.save(hero);
      closePanel();
      toast(c.name + " Lv." + hero.level + " 로 돌아왔습니다. (이어서 합니다)");
      start({ depth: 0 });
      return;
    }

    var fresh = S.blank(cls);
    fresh.stash = prevStash;
    var rng = D.makeRng(Date.now() & 0x7fffffff);
    for (var slot in c.start)
      fresh.equip[slot] = I.pack(I.roll(rng, { ilvl: 1, slot: slot,
                                               base: c.start[slot], tier: "common" }));
    hero = S.sanitize(fresh);      /* 손잡이·시너지를 직업에 맞춰 정리시킨다 */
    S.save(hero);
    closePanel();
    toast(c.name + "(으)로 새로 시작합니다!");
    start({ depth: 0 });
  }

  function panelOpen() {
    var box = document.getElementById("panel");
    return !!box && !box.hidden;
  }

  /* ── 상세 정보 팝업 ──────────────────────────────────── */
  function openInfo() {
    var box = document.getElementById("panel");
    if (!box) return;
    var p = world.player;
    var alive = 0;
    for (var i = 0; i < world.ents.length; i++)
      if (!world.ents[i].dead && world.ents[i].team !== 0 && world.ents[i].kind !== "dummy") alive++;
    var need = global.SAVE.needFor(hero.level);
    var place = world.inTown ? "마을 (0층)" : world.depth + "층 (심연의 던전)";
    var xpPct = need ? Math.min(100, Math.round((hero.xp || 0) / need * 100)) : 0;

    var html = '<h2>캐릭터 정보</h2><div class="sub">현재 탐험 및 보유 상태</div>' +
      '<div class="cols" style="flex-direction:column; gap:8px;">' +
        '<div class="col" style="width:100%; font-size:13px; line-height:1.95; word-break:break-word;">' +
          '<div>• 직업 / 레벨: <b style="color:#ffd24a;">' + (world.cls ? world.cls.name : "방랑자") + ' (Lv.' + hero.level + ')</b></div>' +
          '<div>• 현재 위치: <b>' + place + '</b></div>' +
          '<div>• 보유 금화: <b style="color:#ffe9a8;">' + hero.gold + ' GOLD</b></div>' +
          '<div>• 보유 물약: <b style="color:#9fd29a;">' + hero.potions + '개</b></div>' +
          '<div>• 체력 / 기력: <b style="color:#ff6a52;">' + Math.round(p.hp) + '/' + p.maxHp + '</b> · <b style="color:#6fb3d2;">' + Math.round(p.stam) + '/' + (p.stamMax || 100) + '</b></div>' +
          '<div>• 던전 남은 적: ' + (alive > 0 ? '<b style="color:#ff6a52;">' + alive + '마리</b>' : '<b style="color:#9fd29a;">없음 (안전)</b>') + '</div>' +
          '<div>• 경험치: <b>' + (hero.xp || 0) + ' / ' + need + ' (' + xpPct + '%)</b></div>' +
          '<div>• 최고 도달 층: <b>' + hero.maxDepth + '층</b></div>' +
        '</div>' +
      '</div><p class="sub" style="margin-top:10px;">Esc 또는 ✕ 닫기 버튼으로 닫는다</p>';

    box.innerHTML = html;
    box.className = "panel";
    box.hidden = false;
    box.style.display = "";
    addCloseButton(box);
  }

  function diag() {
    var el = document.getElementById("diag");
    if (!el) return;
    var p = world.player;
    var alive = 0;
    for (var i = 0; i < world.ents.length; i++)
      if (!world.ents[i].dead && world.ents[i].team !== 0 && world.ents[i].kind !== "dummy") alive++;
    var need = global.SAVE.needFor(hero.level);
    var place = world.inTown ? "마을" : world.depth + "층";
    el.innerHTML =
      '<div class="d-badge" title="상세 정보 보기 (클릭)"><span class="d-cls">' + (world.cls ? world.cls.name : "방랑자") + ' <b>Lv.' + hero.level + '</b></span></div>' +
      '<div class="d-info">' +
        '<span>' + place + '</span>' +
        '<span>금화 <b>' + hero.gold + '</b></span>' +
        '<span>물약 <b>' + hero.potions + '</b></span>' +
        (alive > 0 ? '<span class="d-foe">적 <b>' + alive + '</b></span>' : '') +
      '</div>' +
      '<div class="d-fps">' + fps.v + 'fps</div>';
  }

  function start(opt) {
    if (raf) cancelAnimationFrame(raf);
    opt = opt || {};
    opt.hero = hero;                 /* **같은 객체**를 넘긴다(사본 아님) */
    opt.sprite = hero.cls;
    world = new W.World(opt);
    /* ⚠ 마을(0층)은 도달 기록이 아니다. 그리고 상한(30)을 넘기지 않는다 —
     *   SAVE 가 어차피 자르지만, 자르는 곳이 하나뿐이면 여기서 조용히 어긋난다. */
    if (!world.inTown && world.depth > hero.maxDepth)
      hero.maxDepth = Math.min(global.SAVE.FIELDS.maxDepth.max, world.depth);
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

  /* 상단 퀵 메뉴바 이벤트 등록 (가방·재주책·직업선택·물약·귀환) */
  function setupTopMenu() {
    var bBag = document.getElementById("btnBag");
    var bSkills = document.getElementById("btnSkills");
    var bClass = document.getElementById("btnClass");
    var bPot = document.getElementById("btnPotion");
    var bRec = document.getElementById("btnRecall");
    var elDiag = document.getElementById("diag");

    var bHamb = document.getElementById("btnHamb");
    var drop = document.getElementById("mobileDropdown");
    var mTest = document.getElementById("mBtnTest");
    var mStat = document.getElementById("mBtnStat");
    var mBag = document.getElementById("mBtnBag");
    var mSkill = document.getElementById("mBtnSkills") || document.getElementById("mBtnSkill");
    var mJob = document.getElementById("mBtnClass") || document.getElementById("mBtnJob");
    var mPot = document.getElementById("mBtnPotion");

    var bindTap = function (el, fn) {
      if (!el) return;
      var lastTap = 0;
      var handler = function (e) {
        var now = Date.now();
        if (now - lastTap < 350) {
          if (e && e.preventDefault) e.preventDefault();
          return;
        }
        lastTap = now;
        if (e && e.preventDefault && e.type === "touchstart") e.preventDefault();
        wakeAudio();
        fn(e);
      };
      el.addEventListener("touchstart", handler, { passive: false });
      el.addEventListener("click", handler);
    };

    var toggleDrop = function() {
      if (drop) {
        drop.style.display = "";
        drop.classList.toggle("open");
      }
    };
    var closeDrop = function() {
      if (drop) drop.classList.remove("open");
    };

    bindTap(bHamb, function() {
      toggleDrop();
    });

    bindTap(mTest, function() {
      closeDrop();
      giveTestItems();
      openBag();
    });

    bindTap(elDiag, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openInfo();
    });

    bindTap(mStat, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openInfo();
    });

    bindTap(bBag, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openBag();
    });
    bindTap(mBag, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openBag();
    });

    bindTap(bSkills, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openBook();
    });
    bindTap(mSkill, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openBook();
    });

    bindTap(bClass, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openCreate();
    });
    bindTap(mJob, function() {
      closeDrop();
      if (panelOpen()) closePanel(); else openCreate();
    });

    bindTap(bPot, function() {
      closeDrop();
      drink();
    });
    bindTap(mPot, function() {
      closeDrop();
      drink();
    });

    bindTap(bRec, function() {
      closeDrop();
      if (panelOpen()) closePanel();
      if (!world || world.inTown) {
        toast("마을에서는 귀환할 수 없다 (이미 마을)");
        return;
      }
      world.recallStart();
    });
  }
  /* 모바일 가상 조이스틱 & 우측 액션 패드 터치 이벤트 */
  function setupTouchControls(canvas) {
    var vstick = document.getElementById("vstick");
    var vknob = vstick ? vstick.querySelector(".vstick-knob") : null;
    var btnAtk = document.getElementById("btnTouchAtk");
    var btnE = document.getElementById("btnTouchInteract");

    /* 1) 좌측 가상 조이스틱 */
    canvas.addEventListener("touchstart", function (e) {
      wakeAudio();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.55 && stickTouchId === null) {
          stickTouchId = t.identifier;
          stickStartX = t.clientX;
          stickStartY = t.clientY;
          if (vstick) {
            vstick.style.left = stickStartX + "px";
            vstick.style.top = stickStartY + "px";
            vstick.style.display = "block";
            if (vknob) vknob.style.transform = "translate(0, 0)";
          }
          touchMove.x = 0; touchMove.y = 0;
        } else if (stickTouchId !== null && t.clientX >= window.innerWidth * 0.55) {
          /* 오른쪽 캔버스 터치 시 조준 & 공격 */
          mouse.cx = t.clientX; mouse.cy = t.clientY; mouse.has = true;
          mouse.down = true;
        }
      }
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("touchmove", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === stickTouchId) {
          var dx = t.clientX - stickStartX;
          var dy = t.clientY - stickStartY;
          var dist = Math.hypot(dx, dy);
          var maxR = 40;
          var clampR = Math.min(dist, maxR);
          var nx = dist > 1e-3 ? (dx / dist) : 0;
          var ny = dist > 1e-3 ? (dy / dist) : 0;
          if (vknob) vknob.style.transform = "translate(" + (nx * clampR) + "px," + (ny * clampR) + "px)";
          var power = clampR / maxR;
          touchMove.x = nx * power;
          touchMove.y = ny * power;
          if (world && world.player) {
            var tlen = Math.hypot(touchMove.x, touchMove.y);
            if (tlen > 0.05) {
              world.player.dirX = touchMove.x / tlen;
              world.player.dirY = touchMove.y / tlen;
              if (Math.abs(touchMove.x) > 0.05) {
                world.player.face = touchMove.x > 0 ? 1 : -1;
              }
            }
          }
        } else {
          mouse.cx = t.clientX; mouse.cy = t.clientY; mouse.has = true;
        }
      }
      e.preventDefault();
    }, { passive: false });

    function onTouchEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === stickTouchId) {
          stickTouchId = null;
          touchMove.x = 0; touchMove.y = 0;
          if (vstick) vstick.style.display = "none";
        }
      }
      if (e.touches.length === 0) {
        mouse.down = false;
        touchAttacking = false;
      }
    }
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    global.addEventListener("touchend", onTouchEnd);
    global.addEventListener("touchcancel", onTouchEnd);

    /* 2) 우측 액션 패드 (공격, 스킬, 상호작용) */
    if (btnAtk) {
      btnAtk.addEventListener("touchstart", function (e) {
        wakeAudio();
        touchAttacking = true;
        e.preventDefault();
      }, { passive: false });
      btnAtk.addEventListener("touchend", function (e) {
        touchAttacking = false;
        e.preventDefault();
      }, { passive: false });
      btnAtk.addEventListener("mousedown", function (e) {
        wakeAudio();
        touchAttacking = true;
      });
      global.addEventListener("mouseup", function () {
        touchAttacking = false;
      });
    }

    if (btnE) {
      btnE.addEventListener("touchstart", function (e) {
        wakeAudio();
        interact();
        e.preventDefault();
      }, { passive: false });
      btnE.addEventListener("click", function (e) {
        wakeAudio();
        interact();
      });
    }

    var btnTouchRec = document.getElementById("btnTouchRecall");
    if (btnTouchRec) {
      var doTouchRecall = function (e) {
        if (e) e.preventDefault();
        wakeAudio();
        if (panelOpen()) closePanel();
        if (!world || world.inTown) {
          toast("마을에서는 귀환할 수 없다 (이미 마을)");
          return;
        }
        world.recallStart();
      };
      btnTouchRec.addEventListener("touchstart", doTouchRecall, { passive: false });
      btnTouchRec.addEventListener("click", doTouchRecall);
    }

    /* 1~4 스킬 버튼 */
    for (var s = 1; s <= 4; s++) {
      (function (slotIndex) {
        var sb = document.getElementById("btnSkill" + (slotIndex + 1));
        if (sb) {
          sb.addEventListener("touchstart", function (e) {
            wakeAudio();
            castSlot(slotIndex);
            e.preventDefault();
          }, { passive: false });
          sb.addEventListener("click", function (e) {
            wakeAudio();
            castSlot(slotIndex);
          });
        }
      })(s - 1);
    }
  }

  function boot() {
    var canvas = document.getElementById("view");
    view = new V.View(canvas);

    /* ⚠ 캐릭터를 **가장 먼저** 불러온다. 세계보다 먼저 있어야 한다 —
     *   세계가 만들어질 때 체력·레벨을 여기서 읽는다. */
    var loaded = global.SAVE.load();
    hero = loaded.save;
    if (loaded.broken) console.warn("저장이 깨져 새로 시작한다(옛 것은 :broken 에 치워 뒀다)");
    if (loaded.blocked) console.warn("이 브라우저는 저장을 막았다 — 저장 없이 돈다");
    /* **마을에서 시작한다.** 게임을 켜면 안전한 곳에 서 있어야 한다 —
     * 열자마자 몬스터에 둘러싸이면 조작을 배울 틈이 없다. */
    start({ depth: 0 });
    /* 저장이 없으면(=처음 켠 사람) **직업부터 고른다.**
     * ⚠ 세계를 먼저 만든 뒤에 연다 — 창 뒤에 마을이 보여야 "게임이 켜졌구나"
     *   를 안다(빈 화면에 창만 뜨면 로딩 중으로 느낀다). */
    if (loaded.fresh) openCreate();

    global.addEventListener("resize", function () { view.resize(); });
    global.addEventListener("keydown", function (e) {
      wakeAudio();
      if (e.code === "Escape") { closePanel(); return; }
      /* ⚠ **연 키로 닫히게** 한다. I 로 열고 Esc 로만 닫히면 매번 손이 멀리 간다. */
      if (e.code === "KeyI" && panelOpen()) { closePanel(); return; }
      if (e.code === "KeyK" && panelOpen()) { closePanel(); return; }
      /* ⚠ 창 잠금은 **무엇보다 먼저**다. 아래에 두면 이동 키가 이미 처리된
       *   뒤라 층을 고르는 동안 주인공이 그대로 걸어간다(실측 2.24칸 이동).
       *   ⚠ 게다가 keys[] 에 눌림이 남아 창을 닫은 뒤에도 혼자 걸어간다. */
      if (panelOpen()) return;
      if (MOVE[e.code]) { keys[e.code] = 1; e.preventDefault(); }
      /* 움직이면 귀환이 끊긴다 — 걸으면서 도망칠 수 없게.
       * ⚠ 규칙(world)도 자리로 판정하지만, 키를 누른 그 순간 끊어야
       *   "눌렀는데 아직 도는" 한 프레임이 안 생긴다. */
      if (MOVE[e.code] && world.recall) world.recallStop("움직임");
      if (e.code === "KeyE") { interact(); e.preventDefault(); return; }
      if (e.code === "KeyI") { openBag(); e.preventDefault(); return; }
      if (e.code === "KeyQ") { drink(); e.preventDefault(); return; }
      if (e.code === "KeyK") { openBook(); e.preventDefault(); return; }
      /* QWER 이 아니라 **1234** 다 — Q 는 물약이고, WASD 가 이동이라
       * Q·W·E·R 은 이미 넷 중 셋이 다른 일을 한다(전에 그렇게 배선했다가
       * W 를 누르면 걸으면서 스킬이 나갔다). 숫자 줄이 비어 있다. */
      var slot = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 }[e.code];
      if (slot !== undefined) { castSlot(slot); e.preventDefault(); return; }
      if (e.code === "KeyT") { world.recallStart(); return; }
      if (e.code === "KeyR" && !world.inTown) start({ depth: world.depth });
      /* 스페이스로도 친다 — 마우스에 손이 없어도 때릴 수 있어야 한다 */
      if (e.code === "Space") { var a = aim(); world.swing(a.x, a.y); e.preventDefault(); }
    });
    global.addEventListener("keyup", function (e) { keys[e.code] = 0; });

    canvas.addEventListener("mousemove", function (e) {
      mouse.cx = e.clientX; mouse.cy = e.clientY; mouse.has = true;
      if (view && world) {
        var wpos = view.toWorld(e.clientX, e.clientY);
        var targetFoe = false, targetProp = false;
        for (var ei = 0; ei < world.ents.length; ei++) {
          var ent = world.ents[ei];
          if (ent.dead || ent === world.player) continue;
          if (ent.team !== 0 || ent.kind === "dummy") {
            if (Math.hypot(wpos.x - ent.x, wpos.y - ent.y) < ent.r + 0.35) {
              targetFoe = true; break;
            }
          }
        }
        if (!targetFoe && world.props) {
          for (var pi = 0; pi < world.props.length; pi++) {
            var pr = world.props[pi];
            if (Math.hypot(wpos.x - pr.x, wpos.y - pr.y) < (pr.def.reach || 1.5)) {
              targetProp = true; break;
            }
          }
        }
        if (targetFoe) {
          canvas.classList.add("cursor-attack");
          canvas.classList.remove("cursor-interact");
        } else if (targetProp) {
          canvas.classList.add("cursor-interact");
          canvas.classList.remove("cursor-attack");
        } else {
          canvas.classList.remove("cursor-attack", "cursor-interact");
        }
      }
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
    /* 창을 닫거나 탭을 감출 때 한 번 더 쓴다 — 자동 저장 사이에 닫으면 최대
     * 5초를 잃는다. ⚠ beforeunload 만 믿지 말 것: 모바일 브라우저는 안 부르는
     * 경우가 있다. visibilitychange 를 함께 건다. */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") global.SAVE.save(hero);
    });
    /* 상단 통합 메뉴바 및 모바일 가상 조이스틱/액션 패드 바인딩 */
    setupTopMenu();
    setupTouchControls(canvas);

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
    global.__hero = function () { return hero; };
    global.__town = toTown;
    global.__bag = openBag;
    global.__book = openBook;
    global.__create = openCreate;
    global.__pick = createHero;
    global.__cast = castSlot;
    global.__syn = takeSyn;
    global.__setbar = setBar;
    global.__resetsk = resetSkills;
    global.__shop = openShop;
    global.__stash = openStash;
    global.__dev = function (on) {
      try {
        if (on === undefined) return devOn();
        if (on) localStorage.setItem(DEVKEY, "1"); else localStorage.removeItem(DEVKEY);
      } catch (e) { /* 막혀 있으면 그만 */ }
      return devOn();
    };
    global.__smith = openSmith;
    global.__craft = openCraft;
    global.__buyback = function () { return buyback.length; };
    global.__drink = drink;
    global.__equip = equipFromBag;
    global.__unequip = unequip;
    global.__drops = function () { return world.drops.slice(); };
    global.__gear = function () { return world.gear; };
    global.__depth = toDepth;
    global.__act = interact;
    global.__descend = descend;
    global.__panel = function () {
      var b = document.getElementById("panel");
      return { open: panelOpen(), floors: b ? b.querySelectorAll("button[data-depth]").length : 0 };
    };
    global.__near = function () {
      var pr = world.nearProp();
      return pr ? pr.id : (world.onStairs() ? "stairs" : (world.nearDoor() ? "door" : null));
    };
    global.__save = function () { return global.SAVE.save(hero); };
    global.__reload = function () {
      hero = global.SAVE.load().save;
      start({ depth: 1 });
      return hero;
    };
    global.__peek = function () {
      var p = world.player;
      var foes = world.ents.filter(function (e) { return e.team !== 0 && !e.dead && e.kind !== "dummy"; });
      return { x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, dead: p.dead,
               steps: world.steps, time: world.time, fps: fps.v,
               foes: foes.length, atk: !!p.atk, rest: p.atkRest,
               depth: world.depth,
               level: hero.level, xp: hero.xp, gold: hero.gold,
               maxDepth: hero.maxDepth, deaths: hero.deaths,
               inTown: world.inTown, props: world.props.length,
               recall: world.recall ? world.recallLeft() : null,
               onStairs: !!world.onStairs(),
               drops: world.drops.length, bag: hero.bag.length,
               equipped: Object.keys(hero.equip).length, potions: hero.potions,
               dmg: world.player.swing ? world.player.swing.dmg : null,
               aps: world.player.swing ? world.player.swing.aps : null,
               def: world.player.def, critPct: world.player.critPct,
               stam: Math.round(world.player.stam), points: hero.points,
               bar: hero.bar.slice(), casting: world.player.cast ? world.player.cast.id : null,
               dashing: !!world.player.dash, fields: world.fields.length,
               buffs: world.buffs.length,
               cls: hero.cls, adept: !!world.player.adept,
               ranged: !!(world.player.swing && world.player.swing.ranged),
               reach: world.player.swing ? world.player.swing.reach : null,
               spd: +world.player.spd.toFixed(2), stamMax: world.player.stamMax,
               shots: world.shots.length };
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
