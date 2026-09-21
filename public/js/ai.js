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

  /* 근접 추적형 — 첫 몬스터 한 종. 나머지 넷은 뼈대가 선 뒤에 붙인다. */
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

  var BRAIN = { melee: melee };

  function run(world, e, dt) {
    var f = BRAIN[e.brain || "melee"];
    if (f) f(world, e, dt);
  }

  global.AI = { run: run, BRAIN: BRAIN, canSee: canSee, clearLine: clearLine,
                stepToward: stepToward, SIGHT: SIGHT, THINK: THINK };
})(window);
