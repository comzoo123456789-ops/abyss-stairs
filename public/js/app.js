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

    fps.t += dt; fps.n++;
    if (fps.t >= 0.5) { fps.v = Math.round(fps.n / fps.t); fps.t = 0; fps.n = 0; diag(); }
  }

  /* 마우스가 가리키는 **월드 좌표**. 아직 움직인 적이 없으면 바라보는 쪽으로. */
  function aim() {
    var p = world.player;
    if (!mouse.has) return { x: p.x + p.face, y: p.y };
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
    d = Math.max(1, Math.min(hero.maxDepth, Math.floor(d) || 1));
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
  function hud() {
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
      /* ⚠ 전리품을 **먼저** 본다. 포탈 위에 떨어진 물건을 못 줍는 일이 없게. */
      if (dp) {
        var ti = global.ITEMS.tierOf(dp.item.tier);
        txt = "[E] " + dp.item.name + " (" + ti.name + " · " +
              global.ITEMS.SLOT_NAME[dp.item.slot] + " · Lv." + dp.item.req + ")";
      }
      else if (pr) txt = "[E] " + pr.def.label + " — " + pr.def.verb;
      else if (world.onStairs()) txt = "[E] 계단 — 더 깊이 내려간다 (" + (world.depth + 1) + "층)";
      else if (!world.inTown) txt = "[T] 마을로 귀환 (2초간 가만히)";
    }
    el.textContent = txt;
    el.style.visibility = txt ? "visible" : "hidden";
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
      if (pr.id === "well") {
        var p = world.player;
        if (p.hp >= p.maxHp) return;
        p.hp = p.maxHp;
        if (global.SFX) global.SFX.play("potion");
        return;
      }
      return;
    }
    if (world.onStairs()) descend();
  }

  /* 층 선택 창. 캔버스가 아니라 **DOM** 이다 — 글자를 고르는 자리는
   * 브라우저가 이미 잘하는 일이고, 캔버스로 만들면 키보드로 못 고른다. */
  function openPortal() {
    var box = document.getElementById("panel");
    if (!box) return;
    var html = '<h2>심연의 문</h2><p class="sub">가 본 곳까지 열린다 — 지금 ' +
      hero.maxDepth + '층</p><div class="floors">';
    for (var d = 1; d <= hero.maxDepth; d++)
      html += '<button data-depth="' + d + '">' + d + '층</button>';
    html += '</div><p class="sub">Esc 로 닫는다</p>';
    box.innerHTML = html;
    box.className = "panel";
    box.hidden = false;
    box.style.display = "";
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
    var parts = [], k;
    for (k in it.s) { var t = statLine(k, it.s[k]); if (t) parts.push(t); }
    return parts.join(" · ");
  }
  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function itemHTML(it, action, idx, wearable) {
    var ti = global.ITEMS.tierOf(it.tier);
    return '<button class="itm" data-' + action + '="' + idx + '"' +
      (wearable === false ? ' data-locked="1"' : '') + '>' +
      '<span class="nm" style="color:' + ti.color + '">' + esc(it.name) + '</span>' +
      '<span class="mt">' + global.ITEMS.SLOT_NAME[it.slot] + ' · Lv.' + it.req +
      (wearable === false ? ' <b class="no">레벨 부족</b>' : '') + '</span>' +
      '<span class="st">' + esc(statsOf(it)) + '</span>' +
      (it.note ? '<span class="nt">' + esc(it.note) + '</span>' : '') +
      '</button>';
  }

  function openBag() {
    var box = document.getElementById("panel");
    if (!box) return;
    var I = global.ITEMS, S = global.SAVE;
    var eq = S.liveEquip(hero), bag = S.liveBag(hero);
    var t = world.gear || I.totals(eq);

    var html = '<h2>장비와 가방</h2><div class="cols">';

    html += '<div class="col"><h3>입은 것</h3>';
    for (var i = 0; i < I.SLOTS.length; i++) {
      var sl = I.SLOTS[i], it = eq[sl];
      html += it
        ? itemHTML(it, "off", sl)
        : '<div class="itm empty"><span class="nm">' + I.SLOT_NAME[sl] + '</span>' +
          '<span class="mt">비어 있다</span></div>';
    }
    html += '</div>';

    html += '<div class="col"><h3>가방 <span class="mt">' + bag.length + ' / ' + S.BAG + '</span></h3>';
    if (!bag.length) html += '<p class="sub">아직 아무것도 없다.</p>';
    for (var b = 0; b < bag.length; b++)
      html += itemHTML(bag[b], "on", b, I.canEquip(bag[b], hero.level));
    html += '</div>';

    /* 합계 — 세트 보너스까지 한 자리에 */
    html += '<div class="col"><h3>지금 내 수치</h3><div class="tot">';
    var order = ["dmg", "hp", "armor", "apsPct", "critPct", "critDmgPct",
                 "spdPct", "lifeOnHit", "goldPct", "xpPct"];
    for (var o = 0; o < order.length; o++) {
      var line = statLine(order[o], t[order[o]]);
      if (line) html += '<div>' + line + '</div>';
    }
    var p = world.player;
    html += '<div class="hr"></div>';
    html += '<div>체력 ' + p.hp + ' / ' + p.maxHp + '</div>';
    html += '<div>한 대 ' + (p.swing ? p.swing.dmg : global.COMBAT.SWING.dmg) +
            ' · 초당 ' + (p.swing ? p.swing.aps : global.COMBAT.SWING.aps).toFixed(2) + '회</div>';
    html += '<div>사거리 ' + (p.swing ? p.swing.reach : global.COMBAT.SWING.reach).toFixed(2) + '칸</div>';
    html += '</div>';
    for (var si2 = 0; si2 < (t._sets || []).length; si2++) {
      var st = t._sets[si2];
      html += '<div class="set"><b>' + esc(st.name) + '</b> ' + st.have + '/' + st.of;
      for (var bo = 0; bo < st.on.length; bo++)
        html += '<div class="on">' + st.on[bo].at + '피스 · ' + esc(st.on[bo].text) + '</div>';
      html += '</div>';
    }
    html += '</div></div><p class="sub">I 또는 Esc 로 닫는다 · 눌러서 입거나 벗는다</p>';

    box.innerHTML = html;
    box.hidden = false;
    box.style.display = "";
    box.className = "panel wide";

    box.querySelectorAll("[data-on]").forEach(function (el) {
      el.addEventListener("click", function () { equipFromBag(Number(this.getAttribute("data-on"))); });
    });
    box.querySelectorAll("[data-off]").forEach(function (el) {
      el.addEventListener("click", function () { unequip(this.getAttribute("data-off")); });
    });
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

  function panelOpen() {
    var box = document.getElementById("panel");
    return !!box && !box.hidden;
  }

  function diag() {
    var el = document.getElementById("diag");
    if (!el) return;
    var p = world.player;
    var alive = 0;
    for (var i = 0; i < world.ents.length; i++)
      if (!world.ents[i].dead && world.ents[i].team !== 0) alive++;
    var need = global.SAVE.needFor(hero.level);
    el.textContent =
      "Lv." + hero.level + " " + hero.xp + "/" + need + "xp" +
      " · 체력 " + p.hp + "/" + p.maxHp +
      " · 금화 " + hero.gold + " · 물약 " + hero.potions +
      " · " + (world.inTown ? "마을" : world.depth + "층") +
      "(최고 " + hero.maxDepth + ")" +
      " · 적 " + alive +
      " · " + fps.v + "fps" +
      (p.dead ? " · 쓰러졌다…" : "");
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

    global.addEventListener("resize", function () { view.resize(); });
    global.addEventListener("keydown", function (e) {
      wakeAudio();
      if (e.code === "Escape") { closePanel(); return; }
      /* ⚠ **연 키로 닫히게** 한다. I 로 열고 Esc 로만 닫히면 매번 손이 멀리 간다. */
      if (e.code === "KeyI" && panelOpen()) { closePanel(); return; }
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
      if (e.code === "KeyT") { world.recallStart(); return; }
      if (e.code === "KeyR" && !world.inTown) start({ depth: world.depth });
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
    /* 창을 닫거나 탭을 감출 때 한 번 더 쓴다 — 자동 저장 사이에 닫으면 최대
     * 5초를 잃는다. ⚠ beforeunload 만 믿지 말 것: 모바일 브라우저는 안 부르는
     * 경우가 있다. visibilitychange 를 함께 건다. */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") global.SAVE.save(hero);
    });
    global.addEventListener("beforeunload", function () { global.SAVE.save(hero); });

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
      return pr ? pr.id : (world.onStairs() ? "stairs" : null);
    };
    global.__save = function () { return global.SAVE.save(hero); };
    global.__reload = function () {
      hero = global.SAVE.load().save;
      start({ depth: 1 });
      return hero;
    };
    global.__peek = function () {
      var p = world.player;
      var foes = world.ents.filter(function (e) { return e.team !== 0 && !e.dead; });
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
               def: world.player.def, critPct: world.player.critPct };
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
