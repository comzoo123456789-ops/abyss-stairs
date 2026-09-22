/* 주행 봇 — 밸런스를 재려고 **실시간 게임을 대신 플레이한다.**
 *
 * ⚠ 이 파일은 public/ 밖에 있다 — 게임과 함께 배포되지 않는다. 검사 도구가
 *   글자로 읽어 페이지에 주입한다.
 *
 * 턴제에서는 "이번 턴에 넷 중 뭘 할까" 였다. 실시간에서는 움직이고 · 조준하고 ·
 * 선딜을 보고 피하고 · 물약 때를 고르고 · 도망칠지를 **동시에** 정해야 한다.
 *
 * ⚠⚠ **봇의 밸런스는 봇의 밸런스지 사람의 밸런스가 아니다.**
 *   프레임 단위로 완벽히 피하는 봇에게는 이 게임이 너무 쉽고, 못 피하는 봇에게는
 *   너무 어렵다 — 같은 게임인데 봇을 어떻게 만드느냐로 결론이 **정반대**로 나온다.
 *   그래서 두 가지를 못 박는다:
 *     ① **반응 시간**(기본 0.22초) — 그 사이에는 방금 정한 것을 계속한다.
 *        사람은 화면을 보고 손이 움직이기까지 0.2초쯤 걸린다.
 *     ② **조준 오차**(기본 8°) — 사람은 마우스를 정확히 겨누지 못한다.
 *   이 둘을 0 으로 두면 초인 봇이 되고, 그 수치로 밸런스를 잡으면 사람에게는
 *   불가능한 게임이 된다. 바꿀 때는 **왜 바꾸는지**를 함께 적을 것.
 *
 * ⚠ 봇은 규칙(world)만 만진다. 화면·입력을 거치지 않는다 — 그래야 화면을 안 그리고
 *   실시간의 수백 배로 돌릴 수 있다(실측 약 600배).
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    react: 0.22,      /* 생각을 다시 하는 주기(초) — 사람 반응 시간 */
    aimErr: 8,        /* 조준 오차(도) */
    potAt: 0.40,      /* 체력이 이 아래면 물약 */
    fleeAt: 0.22,     /* 이 아래면 붙지 않고 물러선다 */
    skill: true,      /* 스킬을 쓰는가 */
    dodge: true       /* 예고를 보고 피하는가 */
  };

  function rngFrom(seed) {
    var s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  function Bot(world, opt) {
    opt = opt || {};
    this.w = world;
    this.o = {};
    for (var k in DEFAULTS) this.o[k] = (opt[k] === undefined) ? DEFAULTS[k] : opt[k];
    this.rng = rngFrom(opt.seed || 12345);
    this.think = 0;                  /* 다음에 생각할 때까지 남은 초 */
    this.held = null;                /* 붙들고 있는 목표 */
    this.unreachable = {};           /* 길이 막혀 포기한 것 */
    this.stuck = 0;                  /* 목표를 바꾸지 않고 흐른 시간 */
    this.lastD = 1e9;
    this.plan = { mx: 0, my: 0, ax: 0, ay: 0, swing: false, skill: null,
                  drink: false, take: null };
    /* ⚠ 포기 목록은 **그 판 동안만**이다. 세계마다 새 봇을 만드니 저절로 비워진다. */
    /* 못 줍겠다고 판단한 전리품. **빈 배열로 시작해야** 한다 —
     * 없으면 loot() 에서 undefined.indexOf 로 죽는다(조용히 안 죽고 판이 통째로
     * 멈추는 쪽이 더 나쁘다). */
    this.skip = [];
    this.stats = {
      time: 0, kills: 0, taken: 0, dealt: 0, potions: 0,
      swings: 0, skills: 0, dodges: 0, deaths: 0, picked: 0, gaveup: 0,
      hpLow: 1                        /* 가장 위험했던 순간(체력 비율) */
    };
    this._lastHp = world.player.hp;
  }

  /* 노릴 적 하나.
   *
   * ⚠ **가장 가까운 것을 매번 새로 고르면 안 된다.** 거의 같은 거리에 둘이 있으면
   *   0.22초마다 목표가 뒤바뀌어 그 사이를 오간다 — 실측: 전사가 300초 동안
   *   2,069칸을 걷고 **세 번** 휘둘렀다. 한 번 고른 것을 죽거나 멀어질 때까지 붙든다.
   * ⚠ **못 닿는 적은 건너뛴다.** 길이 막힌 자리의 적을 노리면 영영 걸어만 다닌다.
   * ⚠ 벽 너머 적도 노릴 수는 있다(다가가면 되니까). 다만 **쏘는 판단**은 따로 본다. */
  Bot.prototype.target = function () {
    var w = this.w, p = w.player;
    /* 붙들고 있던 것이 아직 쓸 만하면 그대로 */
    var t = this.held;
    if (t && !t.dead && t.team !== p.team) {
      var hd = Math.hypot(t.x - p.x, t.y - p.y);
      if (hd < 16) return { e: t, d: hd };
    }
    var best = null, bd = 1e9;
    for (var i = 0; i < w.ents.length; i++) {
      var e = w.ents[i];
      if (e.dead || e.team === p.team) continue;
      if (this.unreachable[e.uid]) continue;
      var d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    /* ⚠ 목표가 바뀌면 **거리 기록을 되돌린다.** 안 되돌리면 옛 목표까지의
     *   짧은 거리가 남아 새(먼) 목표가 곧바로 "가까워지지 않는다" 로 읽히고,
     *   6초 뒤 포기된다 — 그렇게 **적을 차례로 다 포기**했다(실측: 휘두름
     *   353번 → 9번, 전원 실패). 포기는 목표마다 따로 세야 한다. */
    if (best !== this.held) { this.stuck = 0; this.lastD = 1e9; }
    this.held = best;
    return best ? { e: best, d: bd } : null;
  };
  /* 옛 이름 — 다른 검사가 쓸 수 있으니 남겨 둔다 */
  Bot.prototype.nearest = function () { return this.target(); };

  /* **지금 나에게 오고 있는 것**이 있는가. 있으면 피할 방향을 돌려준다.
   * ⚠ 이것이 봇이 "실시간을 플레이한다" 고 말할 수 있는 유일한 근거다.
   *   이게 없으면 그냥 서서 맞는 허수아비라, 그 수치로 밸런스를 잡으면
   *   게임이 실제보다 훨씬 어려운 것으로 나온다. */
  Bot.prototype.threat = function () {
    var w = this.w, p = w.player;

    /* ① 밟고 선 장판 — 가장 급하다(계속 맞는다) */
    for (var f = 0; f < w.fields.length; f++) {
      var fl = w.fields[f];
      if (fl.from && fl.from.team === p.team) continue;
      var fd = Math.hypot(fl.x - p.x, fl.y - p.y);
      if (fd > fl.r + p.r) continue;
      return { why: "field", x: p.x - fl.x, y: p.y - fl.y, urgent: true };
    }

    /* ② 날아오는 것 — 옆으로 비킨다(뒤로 가면 못 피한다) */
    for (var s = 0; s < w.shots.length; s++) {
      var sh = w.shots[s];
      if (sh.team === p.team) continue;
      var rx = p.x - sh.x, ry = p.y - sh.y;
      var sl = Math.hypot(sh.vx, sh.vy) || 1;
      var ux = sh.vx / sl, uy = sh.vy / sl;
      var along = rx * ux + ry * uy;
      if (along < 0 || along > 6) continue;              /* 뒤로 갔거나 너무 멀다 */
      var side = Math.abs(rx * -uy + ry * ux);
      if (side > 1.0) continue;                          /* 빗나간다 */
      return { why: "shot", x: -uy, y: ux, urgent: true };
    }

    /* ③ 휘두르려는 적의 부채꼴 안 — 선딜이 남아 있을 때만 피할 값어치가 있다 */
    for (var i = 0; i < w.ents.length; i++) {
      var e = w.ents[i];
      if (e.dead || e.team === p.team) continue;
      if (!e.atk || e.atk.hit) continue;
      var left = e.atk.m.windup - e.atk.t;
      if (left <= 0.03) continue;                        /* 이미 늦었다 */
      var dx = p.x - e.x, dy = p.y - e.y;
      var d = Math.hypot(dx, dy);
      if (d > e.atk.m.reach + p.r + 0.4) continue;
      var half = e.atk.m.arc * Math.PI / 360;
      if (e.atk.m.arc < 359) {
        var diff = Math.abs(Math.atan2(dy, dx) - e.atk.ang) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff > half) continue;
      }
      return { why: "swing", x: dx / (d || 1), y: dy / (d || 1), urgent: left < 0.25 };
    }

    /* ④ 깔리려는 장판(술사가 시전 중) */
    for (var c = 0; c < w.ents.length; c++) {
      var ce = w.ents[c];
      if (ce.dead || ce.team === p.team || !ce.cast) continue;
      if (ce.cast.what !== "field" || !ce.mob || !ce.mob.field) continue;
      var cd = Math.hypot(ce.cast.x - p.x, ce.cast.y - p.y);
      if (cd > ce.mob.field.r + p.r) continue;
      return { why: "incoming", x: p.x - ce.cast.x, y: p.y - ce.cast.y, urgent: false };
    }
    return null;
  };

  /* 조준 — **일부러 빗나가게** 한다. 사람은 마우스를 정확히 겨누지 못한다. */
  Bot.prototype.aimAt = function (e) {
    var p = this.w.player;
    var a = Math.atan2(e.y - p.y, e.x - p.x);
    a += (this.rng() - 0.5) * 2 * (this.o.aimErr * Math.PI / 180);
    var r = Math.max(1.5, Math.hypot(e.x - p.x, e.y - p.y));
    return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
  };

  /* 주울 만한 것이 가까이 있는가. ⚠ 너무 멀면 쫓아가느라 판이 늘어진다. */
  /* 못 줍겠다고 판단한 전리품 — 다시 쳐다보지 않는다.
   * ⚠ 없으면 같은 것에 영원히 매달린다(실측으로 겪었다). */
  Bot.prototype.skipDrop = function () {
    var w = this.w, p = w.player;
    var best = null, bd = 1e9;
    for (var i = 0; i < w.drops.length; i++) {
      var d = w.drops[i];
      if (!d.item || this.skip.indexOf(d) >= 0) continue;
      var dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd < bd) { bd = dd; best = d; }
    }
    if (best) { this.skip.push(best); this.stats.gaveup++; }
  };

  Bot.prototype.loot = function () {
    var w = this.w, p = w.player;
    if (!this.hero || !global.SAVE) return null;
    if (this.hero.bag.length >= global.SAVE.BAG) return null;
    var best = null, bd = 1e9;
    for (var i = 0; i < w.drops.length; i++) {
      var d = w.drops[i];
      if (!d.item || this.skip.indexOf(d) >= 0) continue;
      var dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd > 12) continue;
      if (dd < bd) { bd = dd; best = d; }
    }
    return best ? { drop: best, d: bd } : null;
  };

  /* 계단이 어디인가 — 다 잡으면 내려간다 */
  Bot.prototype.stairs = function () {
    var lv = this.w.level;
    return lv.downAt || lv.deepAt || null;
  };

  /* 생각한다. **반응 시간마다 한 번만** 부른다. */
  Bot.prototype.decide = function () {
    var w = this.w, p = w.player, o = this.o;
    var pl = this.plan;
    /* ⚠ goto 도 **매 결정마다 지운다.** 안 지우면 전리품으로 가다 적이
     *   다가와 다른 일을 하기로 해도 step() 의 도착 판정이 계속 발을 묶는다. */
    pl.swing = false; pl.skill = null; pl.drink = false; pl.take = null; pl.goto = null;
    pl.mx = 0; pl.my = 0;

    if (p.dead) return;

    /* 물약 — 체력이 낮고, 있고, 쿨다운이 돌았으면 */
    if (p.hp / p.maxHp < o.potAt && this.hero && this.hero.potions > 0) {
      pl.drink = true;
    }

    var t = o.dodge ? this.threat() : null;
    var near = this.nearest();

    /* 피하기가 최우선 — 급한 것이면 공격을 접는다 */
    if (t) {
      var tl = Math.hypot(t.x, t.y) || 1;
      pl.mx = t.x / tl; pl.my = t.y / tl;
      this.stats.dodges++;
      if (t.urgent) return;             /* 급하면 발만 쓴다 */
    }

    /* 전리품을 줍는다.
     * ⚠ 이걸 빠뜨렸더니 경력 모의의 캐릭터가 **영원히 맨몸**이었고, 12층에서
     *   막혀 죽음 365회가 나왔다 — 게임이 아니라 봇이 못 하는 것이었다.
     *   사람은 떨어진 것을 줍는다. 안 주우면 재는 것이 게임이 아니다.
     * ⚠ 가까운 적이 있으면 줍지 않는다 — 전투 중에 바닥을 보는 사람은 없다. */
    var loot = (!near || near.d > 5.5) ? this.loot() : null;
    if (loot) {
      /* ⚠ 거리 판정을 **여기서만** 하면 안 된다. 생각은 0.22초마다인데 빠른
       *   캐릭터는 그 사이 1.1칸 넘게 움직여 **결정 시점마다 늘 반경 밖**이다 —
       *   지나치고 되돌아오기를 영원히 반복한다(실측: 270초 동안 하나도 못 줍고
       *   남은 적 10마리를 방치. 장비가 좋을수록 빨라 더 심했다).
       *   목표만 남기고 **도착 판정과 줍기는 step() 이 매 걸음** 한다. */
      pl.goto = { x: loot.drop.x, y: loot.drop.y, at: this.w.time };
      this.walkTo(loot.drop.x, loot.drop.y);
      return;
    }

    if (!near) {
      /* 다 잡았다 — 계단으로 */
      var st = this.stairs();
      if (st) this.walkTo(st.x + 0.5, st.y + 0.5);
      return;
    }

    var e = near.e, d = near.d;
    var aim = this.aimAt(e);
    pl.ax = aim.x; pl.ay = aim.y;


    /* 체력이 바닥이면 붙지 않는다 */
    if (p.hp / p.maxHp < o.fleeAt) {
      var fx = p.x - e.x, fy = p.y - e.y, fl2 = Math.hypot(fx, fy) || 1;
      pl.mx = fx / fl2; pl.my = fy / fl2;
      return;
    }

    /* 스킬 — 쓸 수 있고 사거리 안이면 쓴다.
     * ⚠ 아무거나 쓰지 않는다. 사거리 밖에서 쓰면 쿨다운만 버린다. */
    if (o.skill && this.hero) {
      for (var i = 0; i < 4; i++) {
        var id = this.hero.bar[i];
        if (!id) continue;
        var sk = global.SKILLS.resolve(id, this.hero.skills);
        if (global.SKILLS.why(w, id, this.hero.skills)) continue;
        var ok = (sk.kind === "buff") ||
                 (sk.kind === "dash" && d > 2.5) ||
                 (sk.reach !== undefined && d <= sk.reach + e.r + 0.3) ||
                 (sk.kind === "field" && d <= (sk.range || 5));
        if (!ok) continue;
        pl.skill = id;
        return;
      }
    }

    /* 붙어서 때린다 */
    var reach = (p.swing ? p.swing.reach : 1.25) + e.r;
    /* ⚠ **원거리는 시야가 뚫려야 쏜다.** 안 보면 벽 너머 적에게 서서 허공에
     *   쏘아 댄다 — 실측: 마법사·도적이 15칸만 걷고 **353번** 휘둘렀다.
     *   근접은 사거리가 짧아 저절로 붙으므로 이 문제가 없다. */
    var ranged = !!(p.swing && p.swing.ranged);
    /* ⚠ **최대 사거리에서 싸우려 들지 말 것.** 지팡이 7.5칸에서 멈추면 던전
     *   복도에서는 시야가 거의 안 뚫려 걷기만 하다 판이 끝난다(실측: 마법사가
     *   1,180칸을 걷고 12번 쏘았다). 사람은 **쏠 수 있는 거리**까지 붙는다.
     *   4.5칸이면 방 안에서도 복도에서도 대개 뚫린다. */
    var want = ranged ? Math.min(reach * 0.85, 4.5) : reach * 0.85;
    var seen = !ranged || global.AI.clearLine(w, p, e.x, e.y);
    if (d > want || !seen) {
      /* **다가가는데 가까워지지 않으면** 그 적은 포기한다 — 길이 막힌 자리의
       * 적 하나 때문에 판이 통째로 날아가는 것을 막는다(전사가 2,069칸을 걷고
       * 세 번 휘두른 이유).
       * ⚠ **걸어갈 때만** 센다. 공격 판단보다 앞에서 세면, 사거리 안에서
       *   가만히 쏘는 동안에도 "가까워지지 않는다" 로 읽혀 **잡고 있던 적을
       *   포기한다**(마법사가 6칸에서 쏘면 거리가 안 변한다). 실측: 경력당
       *   죽음 0.4 → 9.8회 · 30층을 Lv+10 에도 못 깸.
       * ⚠ 피하는 중에도 세지 않는다 — 비키는 동안 거리가 안 주는 것은 정상이다. */
      if (!t) {
        if (d < this.lastD - 0.2) { this.stuck = 0; this.lastD = d; }
        else {
          this.stuck += this.o.react;
          if (this.stuck > 8 && d > 2.5) {
            this.unreachable[e.uid] = 1;
            this.held = null; this.stuck = 0; this.lastD = 1e9;
            return;
          }
        }
      }
      this.walkTo(e.x, e.y);
    } else {
      /* 때리고 있으면 막힌 게 아니다 */
      this.stuck = 0; this.lastD = d;
      pl.swing = true;
      /* 너무 붙으면 살짝 뒤로 — 겹쳐 서면 서로 밀려 조준이 흔들린다 */
      if (d < reach * 0.45) {
        var bx = p.x - e.x, by = p.y - e.y, bl = Math.hypot(bx, by) || 1;
        pl.mx = bx / bl * 0.5; pl.my = by / bl * 0.5;
      }
    }
  };

  /* 목표로 걷는다 — 보이면 곧장, 아니면 길찾기 */
  Bot.prototype.walkTo = function (gx, gy) {
    var w = this.w, p = w.player, pl = this.plan;
    var aim = { x: gx, y: gy };
    if (!global.AI.clearLine(w, p, gx, gy)) {
      var step = global.AI.stepToward(w, p, gx, gy);
      if (step) aim = step;
    }
    var dx = aim.x - p.x, dy = aim.y - p.y;
    var l = Math.hypot(dx, dy);
    if (l < 1e-6) { pl.mx = 0; pl.my = 0; return; }
    pl.mx = dx / l; pl.my = dy / l;
  };

  /* 한 걸음(1/60초). 생각은 반응 시간마다, 손은 매 걸음. */
  Bot.prototype.step = function (dt) {
    var w = this.w, p = w.player;
    var before = p.hp;
    var foesBefore = 0, i;
    for (i = 0; i < w.ents.length; i++)
      if (!w.ents[i].dead && w.ents[i].team !== p.team) foesBefore++;

    this.think -= dt;
    if (this.think <= 0) { this.think = this.o.react; this.decide(); }

    var pl = this.plan;
    /* 전리품으로 가는 중이면 **매 걸음** 도착을 확인한다. 반경은 사람과 같은
     * 것(world.nearDrop)을 쓴다 — 넓게 잡아 주우면 봇이 사람보다 유리해져
     * 측정이 거짓이 된다. */
    if (pl.goto) {
      var nd = w.nearDrop();
      if (nd) { pl.take = nd; pl.goto = null; pl.mx = 0; pl.my = 0; }
      else {
        var gd = Math.hypot(pl.goto.x - p.x, pl.goto.y - p.y);
        /* 코앞이면 멈춘다 — 안 멈추면 지나친다 */
        if (gd < 0.30) { pl.mx = 0; pl.my = 0; }
        /* ⚠ 안전장치: 한 전리품에 4초를 넘기면 **포기한다.** 원인이 무엇이든
         *   전리품 하나가 판 하나를 통째로 삼키는 일이 다시 없어야 한다. */
        else if (w.time - pl.goto.at > 4) { pl.goto = null; this.skipDrop(nd); }
      }
    }
    p.mx = pl.mx; p.my = pl.my;

    if (pl.drink && this.drink) { if (this.drink()) this.stats.potions++; pl.drink = false; }
    if (pl.take) { if (!w.takeDrop(pl.take)) this.stats.picked++; pl.take = null; }
    if (pl.skill) {
      if (!w.useSkill(pl.skill, pl.ax, pl.ay, this.hero.skills)) this.stats.skills++;
      pl.skill = null;
    } else if (pl.swing) {
      if (w.swing(pl.ax, pl.ay)) this.stats.swings++;
    }

    w.advance(dt);

    /* 재기 */
    this.stats.time += dt;
    if (p.hp < before) this.stats.taken += before - p.hp;
    var frac = p.hp / p.maxHp;
    if (frac < this.stats.hpLow) this.stats.hpLow = frac;
    var foesAfter = 0;
    for (i = 0; i < w.ents.length; i++)
      if (!w.ents[i].dead && w.ents[i].team !== p.team) foesAfter++;
    if (foesAfter < foesBefore) this.stats.kills += foesBefore - foesAfter;
    if (p.dead) this.stats.deaths = 1;
  };

  global.BOT = {
    Bot: Bot, DEFAULTS: DEFAULTS,
    make: function (world, opt) { return new Bot(world, opt); }
  };
})(window);
