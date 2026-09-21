/* 몬스터 행동 — 실시간판.
 *
 * 턴제에서는 흐름장(BFS flow field)을 깔고 한 턴에 한 칸씩 내려보냈다. 실시간에서는
 * 그게 안 맞는다 — 한 걸음이 0.07칸이라 칸 단위 길찾기는 너무 거칠고, 매 걸음
 * 흐름장을 다시 까는 것은 너무 비싸다. 그래서 둘로 나눈다.
 *
 *   멀리 있을 때  칸 단위 길찾기로 **다음 목표 칸**만 잡는다(0.4초에 한 번)
 *   가까이 있을 때 목표를 향해 **곧장** 간다(눈에 보이면 길찾기가 필요 없다)
 *
 * ⚠ 길찾기를 매 걸음 돌리지 말 것. 몬스터 20마리 × 60걸음 = 초당 1,200회다.
 * ⚠ 다시 계산하는 시점을 **모두 같은 걸음에 몰지 말 것.** 20마리가 같은 프레임에
 *   길을 찾으면 그 프레임만 뚝 끊긴다(프레임 튐). 개체마다 시작을 흩는다.
 * ⚠ 안 보이면 쫓지 않는다. 벽 너머에서 정확히 따라오면 "치트" 로 느낀다.
 *   대신 **마지막으로 본 자리**까지는 간다 — 그래야 숨어도 긴장이 남는다.
 */
(function (global) {
  "use strict";

  var C = global.COMBAT;
  var W = global.WORLD;

  var THINK = 0.4;          /* 길을 다시 잡는 주기(초) */
  var SIGHT = 9.5;          /* 이 안에서 보이면 쫓는다(칸) */
  var FORGET = 4.0;         /* 마지막으로 본 자리를 이만큼 붙든다(초) */

  function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

  function canSee(world, e, t) {
    if (dist(e, t) > SIGHT) return false;
    var lv = world.level;
    var tx = Math.floor(e.x), ty = Math.floor(e.y);
    if (tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h) return false;
    /* 주인공 시야(FOV)를 되쓴다 — 서로 보이는 관계는 대칭이라 이게 맞고 공짜다.
     * ⚠ 몬스터마다 그림자 던지기를 새로 돌리면 초당 수천 번이 된다. */
    return !!lv.visible[ty * lv.w + tx];
  }

  /* 벽을 사이에 두지 않고 곧장 갈 수 있는가 — 굵은 선으로 훑는다.
   * ⚠ 점만 찍어 훑으면 **대각으로 벽 모서리를 스쳐** 통과 판정이 난다.
   *   몸 반지름만큼 넓게 본다. */
  function clearLine(world, e, tx, ty) {
    var dx = tx - e.x, dy = ty - e.y;
    var d = Math.hypot(dx, dy);
    if (d < 1e-6) return true;
    var n = Math.ceil(d / 0.25);
    for (var i = 1; i <= n; i++) {
      var x = e.x + dx * i / n, y = e.y + dy * i / n;
      if (!W.boxFree(world.level, x, y, e.r)) return false;
    }
    return true;
  }

  /* 칸 단위 길찾기(BFS). 보이지 않을 때만 쓴다. */
  function stepToward(world, e, gx, gy) {
    var lv = world.level;
    var sx = Math.floor(e.x), sy = Math.floor(e.y);
    var tx = Math.floor(gx), ty = Math.floor(gy);
    if (sx === tx && sy === ty) return { x: gx, y: gy };
    var w = lv.w, h = lv.h;
    var prev = new Int32Array(w * h).fill(-1);
    var q = [sy * w + sx];
    prev[sy * w + sx] = sy * w + sx;
    var goal = ty * w + tx, found = false;
    var N = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    /* ⚠ 상한을 둔다. 길이 막힌 자리에서 지도 전체를 훑으면 몬스터 하나가
     *   한 프레임을 다 먹는다. */
    var budget = 2600;
    while (q.length && budget-- > 0) {
      var cur = q.shift();
      if (cur === goal) { found = true; break; }
      var cx = cur % w, cy = (cur / w) | 0;
      for (var i = 0; i < 8; i++) {
        var nx = cx + N[i][0], ny = cy + N[i][1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        var id = ny * w + nx;
        if (prev[id] !== -1) continue;
        if (lv.tiles[id] === global.DUNGEON.WALL) continue;
        /* 대각은 두 옆이 다 뚫려야 간다 — 아니면 벽 모서리를 뚫고 지나간다 */
        if (N[i][0] && N[i][1]) {
          if (lv.tiles[cy * w + nx] === global.DUNGEON.WALL) continue;
          if (lv.tiles[ny * w + cx] === global.DUNGEON.WALL) continue;
        }
        prev[id] = cur;
        q.push(id);
      }
    }
    if (!found) return null;
    var node = goal;
    while (prev[node] !== -1 && prev[node] !== (sy * w + sx) && prev[node] !== node)
      node = prev[node];
    return { x: (node % w) + 0.5, y: ((node / w) | 0) + 0.5 };
  }

  /* ── 공통 ──────────────────────────────────────────────
   * 몬스터의 시전은 **사람의 것과 같은 모양**이다(e.cast). 두 벌로 두면
   * "몬스터 시전만 안 끊긴다" 같은 어긋남이 생긴다. */
  function beginCast(world, e, secs, what, tx, ty) {
    e.cast = { sk: { cast: secs, kind: what }, t: 0, what: what,
               x: tx, y: ty, x0: e.x, y0: e.y };
  }

  /* 시전 시계. 사람은 SKILLS.tick 이 돌리지만 몬스터는 여기서 돈다.
   * ⚠ 몬스터 시전은 **움직여도 안 끊긴다.** 끊으면 밀려날 때마다 아무것도
   *   못 하게 되어 원거리 몬스터가 허수아비가 된다(사람은 제 발로 움직인 것이라 다르다). */
  function tickCast(world, e, dt) {
    var c = e.cast;
    if (!c) return null;
    c.t += dt;
    if (c.t < c.sk.cast) return null;
    e.cast = null;
    return c;
  }

  /* 상대에게서 물러선다 — 벽에 몰리면 옆으로 샌다.
   * ⚠ 곧장 뒤로만 가게 두면 벽 앞에서 **제자리걸음**을 한다(사수가 붙잡혀 죽는다). */
  function backAway(world, e, tx, ty) {
    var dx = e.x - tx, dy = e.y - ty;
    var d = Math.hypot(dx, dy) || 1;
    var nx = dx / d, ny = dy / d;
    if (W.boxFree(world.level, e.x + nx * 0.6, e.y + ny * 0.6, e.r)) {
      e.mx = nx; e.my = ny; return;
    }
    /* 막혔으면 옆으로(수직 방향 둘 중 뚫린 쪽) */
    var sx = -ny, sy = nx;
    if (!W.boxFree(world.level, e.x + sx * 0.6, e.y + sy * 0.6, e.r)) { sx = ny; sy = -nx; }
    e.mx = sx; e.my = sy;
  }

  /* 사수 — **거리를 둔다.** 붙으면 물러서고, 멀면 다가가고, 알맞으면 쏜다.
   * ⚠ 이것이 근접과 다른 점의 전부다. 같은 자리에서 쏘기만 하면 그냥 원거리
   *   허수아비라 회원이 걸어가서 패면 끝난다. */
  function archer(world, e, dt) {
    var p = world.player;
    if (p.dead) { e.mx = 0; e.my = 0; return; }
    var shot = e.mob.shot;
    var d = dist(e, p);
    var see = canSee(world, e, p) && clearLine(world, e, p.x, p.y);

    var done = tickCast(world, e, dt);
    if (done) {
      /* 쏜다 — **시전이 끝난 순간의 자리**가 아니라 **시작할 때 겨눈 자리**로.
       * ⚠ 끝난 순간을 따라가면 피할 수가 없다(유도탄이 된다). */
      var ddx = done.x - e.x, ddy = done.y - e.y;
      var dl = Math.hypot(ddx, ddy) || 1;
      world.shots.push({ id: ++world._shotId, x: e.x, y: e.y,
        vx: ddx / dl * shot.speed, vy: ddy / dl * shot.speed,
        dmg: e.dmgOut, from: e, team: e.team, life: shot.range / shot.speed + 0.3, r: 0.22 });
      if (global.SFX) global.SFX.play("ability");
      e.shotAt = world.time;
    }
    if (e.cast) { e.mx = 0; e.my = 0; return; }

    if (!see) {
      /* 안 보이면 다가간다(마지막으로 본 자리로) */
      melee(world, e, dt);
      return;
    }
    e.lastX = p.x; e.lastY = p.y; e.memory = FORGET;

    var ready = (world.time - (e.shotAt || -99)) >= shot.cd;
    if (d > shot.range) { chase(world, e, p.x, p.y); return; }
    if (d < shot.keep * 0.75) { backAway(world, e, p.x, p.y); return; }
    e.mx = 0; e.my = 0;
    if (ready) beginCast(world, e, shot.cast, "shot", p.x, p.y);
  }

  /* 술사 — 발밑에 장판을 깐다. **맞으러 오지 않는다.** */
  function mage(world, e, dt) {
    var p = world.player;
    if (p.dead) { e.mx = 0; e.my = 0; return; }
    var fd = e.mob.field;
    var d = dist(e, p);
    var see = canSee(world, e, p) && clearLine(world, e, p.x, p.y);

    var done = tickCast(world, e, dt);
    if (done) {
      world.fields.push({ id: ++world._fieldId, x: done.x, y: done.y, r: fd.r,
        until: world.time + fd.dur, next: world.time, tick: fd.tick,
        dmg: e.dmgOut, from: e });
      e.fieldAt = world.time;
      if (global.SFX) global.SFX.play("trap");
    }
    if (e.cast) { e.mx = 0; e.my = 0; return; }

    if (!see) { melee(world, e, dt); return; }
    e.lastX = p.x; e.lastY = p.y; e.memory = FORGET;

    var ready = (world.time - (e.fieldAt || -99)) >= fd.cd;
    if (d > fd.range) { chase(world, e, p.x, p.y); return; }
    if (d < 2.6) { backAway(world, e, p.x, p.y); return; }
    e.mx = 0; e.my = 0;
    /* 사람이 **서 있는 곳**에 깐다 — 피할 시간이 시전 시간이다 */
    if (ready) beginCast(world, e, fd.cast, "field", p.x, p.y);
  }

  /* 치유사 — 다친 동료를 고친다. **먼저 잡지 않으면 끝이 안 난다.**
   * ⚠ 사람에게서는 도망친다. 안 그러면 그냥 약한 잡몹이라 존재 이유가 없다. */
  function healer(world, e, dt) {
    var p = world.player;
    var hl = e.mob.heal;

    var done = tickCast(world, e, dt);
    if (done && done.target && !done.target.dead) {
      var t = done.target;
      t.hp = Math.min(t.maxHp, t.hp + hl.amount);
      world.floaters.push({ x: t.x, y: t.y - 0.9, text: "+" + hl.amount,
                            t: 0, life: 0.8, foe: false, heal: true });
      e.healAt = world.time;
      if (global.SFX) global.SFX.play("potion");
    }
    if (e.cast) { e.mx = 0; e.my = 0; return; }

    /* 가장 많이 다친 동료 */
    var best = null, worst = 1;
    for (var i = 0; i < world.ents.length; i++) {
      var a = world.ents[i];
      if (a === e || a.dead || a.team !== e.team) continue;
      if (a.hp >= a.maxHp) continue;
      if (dist(e, a) > hl.range) continue;
      var frac = a.hp / a.maxHp;
      if (frac < worst) { worst = frac; best = a; }
    }
    var ready = (world.time - (e.healAt || -99)) >= hl.cd;
    if (best && ready) {
      var c = { sk: { cast: hl.cast, kind: "heal" }, t: 0, what: "heal",
                x: best.x, y: best.y, x0: e.x, y0: e.y, target: best };
      e.cast = c;
      e.mx = 0; e.my = 0;
      return;
    }
    /* 사람이 가까우면 물러선다 */
    if (!p.dead && dist(e, p) < hl.flee && canSee(world, e, p)) {
      backAway(world, e, p.x, p.y);
      return;
    }
    /* 다친 동료 쪽으로 붙는다(사거리 밖이면) */
    if (best) { chase(world, e, best.x, best.y); return; }
    e.mx = 0; e.my = 0;
  }

  /* 파괴자 — 내 버프를 걷어낸다. **버프를 아껴 쓰게 만드는 것**이 존재 이유다. */
  function breaker(world, e, dt) {
    var p = world.player;
    if (p.dead) { e.mx = 0; e.my = 0; return; }
    var st = e.mob.strip;

    var done = tickCast(world, e, dt);
    if (done && world.buffs.length) {
      world.buffs.length = 0;
      world.refreshBuffs();
      world.floaters.push({ x: p.x, y: p.y - 1.1, text: "버프 사라짐",
                            t: 0, life: 1.0, foe: false });
      if (global.SFX) global.SFX.play("bad");
      e.stripAt = world.time;
    } else if (done) {
      e.stripAt = world.time;
    }
    if (e.cast) { e.mx = 0; e.my = 0; return; }

    var see = canSee(world, e, p) && clearLine(world, e, p.x, p.y);
    var ready = (world.time - (e.stripAt || -99)) >= st.cd;
    /* **버프가 있을 때만** 걷으러 시전한다 — 없는데 시전하면 그냥 멍청해 보인다 */
    if (see && ready && world.buffs.length && dist(e, p) <= st.range) {
      beginCast(world, e, st.cast, "strip", p.x, p.y);
      e.mx = 0; e.my = 0;
      return;
    }
    melee(world, e, dt);
  }

  /* 목표로 붙는다 — melee 의 이동 부분만 떼어 쓴다 */
  function chase(world, e, gx, gy) {
    var aim;
    if (clearLine(world, e, gx, gy)) aim = { x: gx, y: gy };
    else {
      if (e.think <= 0 || !e.goal) { e.goal = stepToward(world, e, gx, gy); e.think = THINK; }
      aim = e.goal;
    }
    if (!aim) { e.mx = 0; e.my = 0; return; }
    var ax = aim.x - e.x, ay = aim.y - e.y;
    var al = Math.hypot(ax, ay);
    if (al < 1e-6) { e.mx = 0; e.my = 0; return; }
    e.mx = ax / al; e.my = ay / al;
  }

  /* 근접 추적형 */
  function melee(world, e, dt) {
    var p = world.player;
    if (p.dead) { e.mx = 0; e.my = 0; return; }

    e.think -= dt;
    var see = canSee(world, e, p);
    if (see) { e.lastX = p.x; e.lastY = p.y; e.memory = FORGET; }
    else if (e.memory > 0) e.memory -= dt;

    if (!see && e.memory <= 0) { e.mx = 0; e.my = 0; e.goal = null; return; }

    var gx = see ? p.x : e.lastX, gy = see ? p.y : e.lastY;
    var d = Math.hypot(gx - e.x, gy - e.y);

    /* 붙었으면 때린다. 휘두르는 동안은 발을 거의 멈춘다 —
     * ⚠ 안 멈추면 선딜 중에 상대를 지나쳐 등 뒤를 친다(피할 수가 없다). */
    var reach = (e.swing ? e.swing.reach : 1.1) + p.r;
    if (see && d <= reach) {
      C.begin(e, p.x - e.x, p.y - e.y);
    }
    if (e.atk) { e.mx = 0; e.my = 0; return; }

    /* 사거리 바로 안쪽에 서서 기다린다 — 겹쳐 서면 서로 밀려 덜덜거린다 */
    if (see && d <= reach * 0.85) { e.mx = 0; e.my = 0; return; }

    var aim;
    if (see && clearLine(world, e, gx, gy)) aim = { x: gx, y: gy };
    else {
      if (e.think <= 0 || !e.goal) {
        e.goal = stepToward(world, e, gx, gy);
        e.think = THINK;
      }
      aim = e.goal;
    }
    if (!aim) { e.mx = 0; e.my = 0; return; }
    var ax = aim.x - e.x, ay = aim.y - e.y;
    var al = Math.hypot(ax, ay);
    if (al < 1e-6) { e.mx = 0; e.my = 0; return; }
    e.mx = ax / al; e.my = ay / al;
  }

  var BRAIN = { melee: melee, archer: archer, mage: mage,
                healer: healer, breaker: breaker };

  function run(world, e, dt) {
    var f = BRAIN[e.brain || "melee"];
    if (f) f(world, e, dt);
  }

  /* 날아가는 것들. **여기 한 곳**에서만 옮기고 판정한다.
   * ⚠ 한 걸음에 반 칸 넘게 날면 얇은 벽과 사람을 **뚫고 지나간다** — 쪼갠다. */
  function tickShots(world, dt) {
    for (var i = world.shots.length - 1; i >= 0; i--) {
      var s = world.shots[i];
      s.life -= dt;
      if (s.life <= 0) { world.shots.splice(i, 1); continue; }
      var far = Math.hypot(s.vx, s.vy) * dt;
      var steps = far > 0.35 ? Math.ceil(far / 0.35) : 1;
      var gone = false;
      for (var k = 0; k < steps && !gone; k++) {
        s.x += s.vx * dt / steps;
        s.y += s.vy * dt / steps;
        if (!W.boxFree(world.level, s.x, s.y, s.r)) { gone = true; break; }
        for (var j = 0; j < world.ents.length; j++) {
          var e = world.ents[j];
          if (e.dead || e.team === s.team) continue;
          if (Math.hypot(e.x - s.x, e.y - s.y) > e.r + s.r) continue;
          /* ⚠ **같은 것을 두 번 때리지 않는다.** 관통하는 것은 상대를 지나가는
           *   동안 여러 걸음을 그 안에서 보내므로, 표시를 안 남기면 한 명에게
           *   수십 번 들어간다(관통이 아니라 즉사기가 된다). */
          if (s.hitSet && s.hitSet[e.uid]) continue;
          /* ⚠ 치명타·흡혈이 **원거리에도 걸려야** 한다. damage() 한 곳을 쓰므로
           *   저절로 걸린다 — 여기서 따로 계산하면 "활은 치명타가 안 뜬다" 가 된다. */
          global.COMBAT.damage(world, s.from, e, s.dmg);
          if (s.hitSet) s.hitSet[e.uid] = 1;
          var left = (s.pierce || 1) - 1;
          s.pierce = left;
          if (left <= 0) { gone = true; }
          break;
        }
      }
      if (gone) world.shots.splice(i, 1);
    }
  }

  global.AI = { run: run, BRAIN: BRAIN, canSee: canSee, clearLine: clearLine,
                stepToward: stepToward, tickShots: tickShots,
                SIGHT: SIGHT, THINK: THINK };
})(window);
