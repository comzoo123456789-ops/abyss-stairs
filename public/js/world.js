/* 세계 — 실시간 모의. **턴이 없다.**
 *
 * 턴제에서는 "한 번 움직인다" 가 곧 시간의 단위였다. 여기서는 시간이 먼저 있고
 * 모두가 그 위에서 움직인다. 그래서 두 가지가 반드시 필요하다.
 *
 * ① **고정 걸음(fixed timestep).** 화면 주사율은 기기마다 다르다(60·120·144Hz).
 *    흐른 시간을 그대로 규칙에 먹이면 **주사율이 높은 기기가 유리해진다** —
 *    부동소수 오차가 다르게 쌓여 같은 조작이 다른 결과를 낸다. 그래서 규칙은
 *    늘 1/60 초씩만 나아가고, 남은 자투리는 다음 프레임으로 넘긴다.
 * ② **그리기와 규칙의 분리.** 규칙이 60번 도는 동안 화면은 144번 그려질 수 있다.
 *    그 사이를 메우려고 지난 위치와 지금 위치를 섞는다(alpha) — 안 하면
 *    120Hz 화면에서 캐릭터가 눈에 띄게 덜덜거린다.
 *
 * ⚠ 속도는 전부 **초당 칸(tiles/sec)** 이다. 프레임당 몇 픽셀 같은 값을 쓰지 말 것 —
 *   그 순간 주사율이 게임 규칙이 된다.
 * ⚠ 위치는 칸 격자가 아니라 **실수 좌표**다. (12.4, 8.7) 은 12번 칸 안의 어딘가다.
 *   던전 생성기는 정수 격자 그대로 쓴다 — 지형은 여전히 칸이고 몸만 자유롭다.
 */
(function (global) {
  "use strict";

  var D = global.DUNGEON;

  var SIM_HZ = 60;
  var SIM_DT = 1 / SIM_HZ;
  /* 창을 오래 감춰 두면 흐른 시간이 몇 초씩 쌓인다. 그걸 한 프레임에 다 따라잡으려
   * 들면 수백 걸음을 돌다가 더 늦어지고, 그 사이 또 시간이 흘러 영영 못 따라잡는다
   * (죽음의 나선). 한 프레임에 밟을 수 있는 걸음 수를 막고 나머지는 **버린다**. */
  var MAX_STEPS = 5;
  var EPS = 1e-4;
  /* 벽에 파고들지 않을 만큼만 띄운다. 너무 크면 문틀에 어깨가 걸린다. */
  var BODY = 0.34;
  var FOV_R = 9;

  /* ── 지형 ──────────────────────────────────────────────── */

  function solid(lv, tx, ty) {
    /* 바깥은 벽으로 친다 — 안 그러면 지도 밖으로 걸어 나간다 */
    if (tx < 0 || ty < 0 || tx >= lv.w || ty >= lv.h) return true;
    var t = lv.tiles[ty * lv.w + tx];
    return t === D.WALL || t === D.DOOR;
  }

  /* 몸을 (x,y) 에 두었을 때 벽에 겹치는가.
   * ⚠ 몸을 원이 아니라 **네모**로 본다. 칸 격자에서는 이쪽이 모서리에 안 끼고
   *   결과를 예측하기 쉽다(원으로 두면 대각 모서리에서 미끄러져 빠져나간다).
   * ⚠ x+r 이 딱 정수일 때 floor 가 한 칸 더 집는다 — EPS 로 당겨 준다. */
  function boxFree(lv, x, y, r) {
    var x0 = Math.floor(x - r + EPS), x1 = Math.floor(x + r - EPS);
    var y0 = Math.floor(y - r + EPS), y1 = Math.floor(y + r - EPS);
    for (var ty = y0; ty <= y1; ty++)
      for (var tx = x0; tx <= x1; tx++)
        if (solid(lv, tx, ty)) return false;
    return true;
  }

  /* 한 축씩 따로 옮긴다. 이것이 **벽을 타고 미끄러지는 느낌**의 정체다 —
   * 두 축을 한꺼번에 판정하면 벽에 비스듬히 부딪힌 순간 그 자리에 멈춰 선다.
   * ⚠ 막혔을 때 그냥 안 움직이면 벽과 몸 사이에 최대 한 걸음치 틈이 남아
   *   벽을 따라 걸을 때 덜덜거린다. 벽면에 **딱 붙여** 준다.
   * ⚠ 붙일 때 반드시 원래 자리 쪽으로 clamp 할 것 — 안 하면 막힌 판정이
   *   거꾸로 몸을 벽 **안으로** 밀어 넣는 경우가 생긴다. */
  function slide(lv, e, dx, dy) {
    var hit = 0;
    if (dx) {
      var nx = e.x + dx;
      if (boxFree(lv, nx, e.y, e.r)) e.x = nx;
      else {
        hit |= 1;
        if (dx > 0) e.x = Math.max(e.x, Math.floor(nx + e.r) - e.r - EPS);
        else        e.x = Math.min(e.x, Math.floor(nx - e.r) + 1 + e.r + EPS);
      }
    }
    if (dy) {
      var ny = e.y + dy;
      if (boxFree(lv, e.x, ny, e.r)) e.y = ny;
      else {
        hit |= 2;
        if (dy > 0) e.y = Math.max(e.y, Math.floor(ny + e.r) - e.r - EPS);
        else        e.y = Math.min(e.y, Math.floor(ny - e.r) + 1 + e.r + EPS);
      }
    }
    return hit;
  }

  /* 한 걸음에 반 칸 넘게 움직이면 얇은 벽을 **뚫고 지나간다**(터널링).
   * 지금 속도로는 안 나지만, 나중에 돌진 스킬이 붙으면 반드시 난다 —
   * 그때 원인을 못 찾는 대신 지금 쪼개 둔다. */
  function moveBy(lv, e, dx, dy) {
    var far = Math.max(Math.abs(dx), Math.abs(dy));
    var n = far > 0.4 ? Math.ceil(far / 0.4) : 1;
    var hit = 0;
    for (var i = 0; i < n; i++) hit |= slide(lv, e, dx / n, dy / n);
    return hit;
  }

  /* ── 개체 ──────────────────────────────────────────────── */

  var UID = 0;

  function Entity(o) {
    this.x = o.x; this.y = o.y;
    this.px = o.x; this.py = o.y;      /* 지난 걸음의 자리 — 그리기가 그 사이를 메운다 */
    this.r = o.r === undefined ? BODY : o.r;
    this.spd = o.spd === undefined ? 4.2 : o.spd;   /* 초당 칸 */
    this.face = o.face === undefined ? 1 : o.face;  /* -1 왼쪽 · 1 오른쪽 */
    this.dirX = o.dirX === undefined ? (this.face || 1) : o.dirX; /* 360도 이동·바라보기 조준 방향 X (-1~1) */
    this.dirY = o.dirY === undefined ? 0 : o.dirY;                /* 360도 이동·바라보기 조준 방향 Y (-1~1) */
    this.sprite = o.sprite || "warrior";
    this.kind = o.kind || "mob";
    this.walked = 0;                   /* 걸은 거리(칸) — 걷는 그림을 고를 때 쓴다 */
    this.mx = 0; this.my = 0;          /* 이번 걸음에 가려는 방향(정규화) */

    /* 싸움 */
    this.team = o.team === undefined ? 1 : o.team;   /* 0 우리 편 · 1 적 */
    this.maxHp = o.hp === undefined ? 30 : o.hp;
    this.hp = this.maxHp;
    this.def = o.def || 0;
    this.swing = o.swing || null;      /* 없으면 COMBAT.SWING 을 쓴다 */
    this.atk = null;                   /* 휘두르는 중인 몸짓 */
    this.atkRest = 0;                  /* 다음 공격까지 남은 초 */
    this.hurt = 0;                     /* 맞은 티가 남은 초 */
    this.knock = null;                 /* 밀려나는 중 */
    this.dead = false;
    this.brain = o.brain || null;      /* null 이면 사람이 움직인다 */
    this.think = 0; this.memory = 0; this.goal = null;
    this.lastX = 0; this.lastY = 0;
    this.name = o.name || "";
    this.xp = o.xp || 0;               /* 잡으면 주는 경험치 */
    /* 치명타·흡혈 — 장비에서 온다(몬스터는 0). **이름이 늘 있어야** 한다:
     * undefined 로 두면 화면 쪽 오타와 구별이 안 된다. */
    this.critPct = o.critPct || 0;
    this.critDmgPct = o.critDmgPct || 0;
    this.lifeOnHit = o.lifeOnHit || 0;
    this.gold = o.gold || 0;
    /* 개체마다 고정된 각도. 완전히 포개졌을 때 **어느 쪽으로 흩어질지**를 정한다.
     * ⚠ Math.random 을 쓰지 말 것 — 같은 판을 다시 돌렸을 때 결과가 달라진다.
     *   황금각(2.39996rad)으로 돌리면 몇 마리든 고르게 벌어진다. */
    this.immovable = !!o.immovable;
    this.startX = o.startX !== undefined ? o.startX : o.x;
    this.startY = o.startY !== undefined ? o.startY : o.y;
    this.uid = ++UID;
    this.jitter = this.uid * 2.399963;
  }

  /* ── 세계 ──────────────────────────────────────────────── */

  function World(opt) {
    opt = opt || {};
    /* 캐릭터는 세계보다 오래 산다 — 세계는 층마다 새로 만들어지지만 이건 이어진다.
     * ⚠ 여기에 **사본**을 두지 말 것. 층을 옮길 때마다 경험치가 되감긴다.
     *   바깥(app.js)이 쥔 바로 그 객체를 가리켜야 한다. */
    this.hero = opt.hero || (global.SAVE ? global.SAVE.blank() : null);
    var seed = opt.seed === undefined ? (Date.now() & 0x7fffffff) : opt.seed;
    this.seed = seed;
    /* **0층이 마을이다.** 따로 플래그를 두지 않는다 — 두 곳(깊이와 플래그)이
     * 되면 반드시 어긋나 "마을인데 몬스터가 나온다" 가 된다. */
    this.depth = opt.depth === undefined ? 1 : opt.depth;
    this.inTown = this.depth === 0;
    this.props = [];
    var startAt = null, t = null;
    this.decor = [];
    this.fzone = null;                 /* 칸마다 바닥 구역 번호(마을 전용) */
    this.zone = null;
    this.zones = null;                 /* 그 번호가 가리키는 팔레트 목록 */
    if (this.inTown) {
      t = global.TOWN.build();
      this.level = t.level;
      this.props = t.props;
      /* 마을은 **자기 색과 길**을 함께 들고 온다. 화면이 구역 표(DATA)를
       * 뒤지지 않게 — 마을은 던전 구역이 아니다. */
      this.decor = t.decor;
      this.fzone = t.fzone;
      this.zone = t.zone;
      this.zones = t.zones;
      startAt = t.start;
    } else {
      this.level = D.generate(opt.w || 56, opt.h || 40, this.depth, seed);
    }
    this.ents = [];
    this.floaters = [];     /* 떠오르는 피해 숫자 — 규칙이 만들고 화면이 지운다 */
    this.drops = [];        /* 바닥에 떨어진 것 */
    this._dropId = 0;
    this.boss = null;       /* 이 층의 보스(있으면) */
    this.gear = null;       /* 입은 것의 합 — applyHero 가 채운다 */
    this.equipped = {};
    /* 스킬 — **시계는 world.time 하나뿐이다.** Date.now 를 쓰면 창을 감췄다
     * 돌아올 때 쿨다운이 통째로 어긋난다. */
    this.cds = {};
    this.shots = [];        /* 날아가는 것 */
    this._shotId = 0;
    this.fields = [];
    this.buffs = [];
    this.bleeds = [];       /* 출혈 — 시간이 지나며 계속 아프다 */
    this._fieldId = 0;
    this.castBroke = null;
    this.log = [];          /* 무슨 일이 있었나(검사가 읽는다) */
    this.time = 0;          /* 세계가 흐른 초 — 스킬 재사용도 전부 이 값이 기준이다 */
    this.hitFreeze = 0;     /* 가이더스 스타일 히트 프리즈 (타격 순간 0.04초 프레임 멈춤) */
    this.steps = 0;
    this._acc = 0;
    this._fovAt = null;
    /* 귀환(마을로 돌아가기) — 밖에서 읽으므로 **없을 때도 이름이 있어야** 한다.
     * undefined 로 두면 화면 쪽에서 typo 한 이름과 구별이 안 된다. */
    this.recall = null;
    this.recallDone = false;
    this.recallBroke = "";

    /* 전투 타격감 & 시각 피드백 (Juice FX) */
    this.shake = 0;
    this.shakeMag = 0;
    this.sparks = [];       /* 타격 스파크 파티클 */
    this.orbs = [];         /* 처치 시 생성되는 경험치/영혼 및 금화 흡수 구슬 */
    this.debris = [];       /* 바닥에 남는 타격 잔해/핏자국 */

    var s = this.level.upAt || { x: 2, y: 2 };
    var sx = startAt ? startAt.x : s.x + 0.5;
    var sy = startAt ? startAt.y : s.y + 0.5;
    this.player = new Entity({
      x: sx, y: sy, kind: "player", sprite: opt.sprite || "warrior",
      team: 0, hp: 50, name: "주인공"
    });
    this.ents.push(this.player);
    this.applyHero();
    /* 들어올 때 체력을 이어받는다 — 마을에서만 다 찬다(샘에서든, 죽어서 돌아왔든).
     * ⚠ 층을 옮길 때마다 다 채우면 계단이 곧 회복이 되어 던전이 안 위험해진다. */
    if (this.inTown) {
      this.player.hp = this.player.maxHp;
      if (t && t.dummies) {
        for (var di = 0; di < t.dummies.length; di++) {
          var dm = t.dummies[di];
          this.ents.push(new Entity({
            x: dm.x, y: dm.y, startX: dm.x, startY: dm.y,
            kind: "dummy", sprite: "t_dummy",
            team: 1, hp: 999999, maxHp: 999999, name: "훈련용 허수아비",
            spd: 0, r: 0.35, def: 0, immovable: true
          }));
        }
      }
    } else if (opt.hp !== undefined) {
      this.player.hp = Math.max(1, Math.min(this.player.maxHp, opt.hp));
    }
    this.refreshFov();
    /* ⚠ 마릿수를 여기서 정하지 않는다 — DATA.countAt 이 정한다.
     *   두 곳이 되면 표를 고쳐도 안 바뀐다. */
    if (!this.inTown && opt.mobs !== 0) this.spawn(opt.mobs);
  }

  /* 몬스터를 뿌린다.
   * ⚠ 주인공 근처에 놓지 말 것 — 들어서자마자 맞으면 조작을 배울 틈이 없다. */
  /* 표에서 하나 뽑는다(가중치) */
  function pickMob(rng, pool) {
    var total = 0, i;
    for (i = 0; i < pool.length; i++) total += pool[i].w;
    var r = rng() * total;
    for (i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  }

  /* 표의 한 줄 → 살아 있는 개체.
   * ⚠ 층 배수는 **DATA.statsAt 한 곳**에서만 곱한다. 여기서 또 곱하면 두 배가
   *   되고, 그건 눈으로 절대 못 잡는다(30층 몬스터가 조용히 두 배 세진다). */
  function makeMob(def, depth, x, y, isBoss) {
    var DT = global.DATA;
    var st = isBoss
      ? { hp: def.hp, dmg: def.dmg, xp: def.xp, gold: def.gold }   /* 보스는 표 그대로 */
      : DT.statsAt(def, depth);
    var sw = def.swing ? {
      aps: def.swing.aps, windup: def.swing.windup, recover: def.swing.recover,
      reach: def.swing.reach, arc: def.swing.arc, push: def.swing.push, dmg: st.dmg
    } : null;
    var e = new Entity({
      x: x, y: y, sprite: def.sprite || def.id, team: 1,
      brain: def.brain, hp: st.hp, spd: def.spd, name: def.name,
      xp: st.xp, gold: st.gold, r: def.r, swing: sw
    });
    /* 표를 개체에 붙여 둔다 — 행동(AI)이 자기 수치를 여기서 읽는다.
     * ⚠ 이름을 **mob** 으로 둔다. `def` 는 이미 **방어력**이다 — 거기에 객체를
     *   넣으면 damage() 의 `amount - to.def` 가 NaN 이 되어 **아무도 안 죽는다.**
     *   짧고 흔한 이름을 두 뜻으로 쓰면 반드시 이렇게 부딪힌다.
     * ⚠ 사본을 뜨지 말 것. 표를 고쳤을 때 이미 나온 몬스터만 옛 값으로 남는다. */
    e.mob = def;
    e.dmgOut = st.dmg;
    e.boss = !!isBoss;
    return e;
  }

  World.prototype.spawn = function (count) {
    var DT = global.DATA;
    if (!DT) return 0;
    var depth = this.depth;
    var rng = D.makeRng(this.seed ^ 0x5bf03635);
    var lv = this.level, placed = 0, guard = 0;
    var pool = DT.poolAt(depth);
    if (count === undefined) count = DT.countAt(depth);

    /* 보스가 먼저다 — **가장 먼 방**에 세운다. 들어서는 자리에 두면
     * 문을 여는 순간 끝나고, 준비할 틈이 없다. */
    var boss = DT.bossAt(depth);
    if (boss && count > 0) {
      var far = null, fd = -1;
      for (var ri = 0; ri < lv.rooms.length; ri++) {
        var rr = lv.rooms[ri];
        var cx = rr.x + rr.w / 2, cy = rr.y + rr.h / 2;
        var dd = Math.hypot(cx - this.player.x, cy - this.player.y);
        if (dd > fd) { fd = dd; far = rr; }
      }
      if (far) {
        var bx = Math.floor(far.x + far.w / 2) + 0.5;
        var by = Math.floor(far.y + far.h / 2) + 0.5;
        if (boxFree(lv, bx, by, boss.def.r || 0.34)) {
          var bdef = {};
          for (var bk in boss.def) bdef[bk] = boss.def[bk];
          bdef.id = boss.id; bdef.sprite = boss.id;
          this.boss = makeMob(bdef, depth, bx, by, true);
          this.ents.push(this.boss);
        }
      }
    }

    while (placed < count && guard++ < count * 60) {
      var r = lv.rooms[Math.floor(rng() * lv.rooms.length)];
      if (!r) break;
      var x = r.x + Math.floor(rng() * r.w) + 0.5;
      var y = r.y + Math.floor(rng() * r.h) + 0.5;
      if (Math.hypot(x - this.player.x, y - this.player.y) < 9) continue;
      var def = pickMob(rng, pool);
      if (!boxFree(lv, x, y, def.r || 0.34)) continue;
      this.ents.push(makeMob(def, depth, x, y, false));
      placed++;
    }
    return placed;
  };

  /* 누가 죽었다. */
  /* ── 소환 ───────────────────────────────────────────────
   * 사령술사·무덤지기가 해골을 부른다.
   *
   * ⚠ **경험치와 금화를 0 으로 둔다.** 안 그러면 술사 하나를 놔두고 무한히
   *   불러내 잡는 것이 이 게임 최고의 사냥터가 된다 — 레벨도 돈도 다 거기서
   *   나온다. (몬스터끼리 싸움에 보상을 안 주는 것과 같은 이유다.)
   * ⚠ 벽 안에 놓지 않는다. 자리를 못 찾으면 **안 부른다** — 빈손으로 돌아가는
   *   편이 벽에 박힌 몬스터보다 낫다. 그건 판을 못 깨게 만든다.
   * ⚠ 겹쳐 놓지 않는다. 같은 자리에 둘을 놓으면 서로 밀어내며 떨린다
   *   (겹친 개체를 흩는 jitter 가 있지만 애초에 안 겹치는 편이 낫다). */
  World.prototype.summon = function (defId, x, y, owner) {
    var DT = global.DATA;
    if (!DT) return null;
    var def = null;
    for (var i = 0; i < DT.MOBS.length; i++)
      if (DT.MOBS[i].id === defId) { def = DT.MOBS[i]; break; }
    if (!def) return null;
    var r = def.r === undefined ? BODY : def.r;
    /* 술사 주변을 황금각으로 돌며 빈 자리를 찾는다 — 한쪽으로 뭉치지 않는다 */
    for (var k = 0; k < 12; k++) {
      var a = k * 2.399963;
      var rr = 1.0 + k * 0.16;
      var sx = x + Math.cos(a) * rr, sy = y + Math.sin(a) * rr;
      if (!boxFree(this.level, sx, sy, r)) continue;
      var taken = false;
      for (var j = 0; j < this.ents.length; j++) {
        var o = this.ents[j];
        if (o.dead) continue;
        if (Math.hypot(o.x - sx, o.y - sy) < r + o.r) { taken = true; break; }
      }
      if (taken) continue;
      var e = makeMob(def, this.depth, sx, sy, false);
      e.xp = 0; e.gold = 0;              /* 무한 사냥터가 되지 않게 */
      e.summoned = true;
      e.owner = owner || null;
      e.bornAt = this.time;              /* 나타나는 티 — 화면이 이걸 읽는다 */
      this.ents.push(e);
      return e;
    }
    return null;
  };

  /* 화면 흔들림(Screen Shake) — 치명타나 보스 처치 등 큰 충격에 발동 */
  World.prototype.addShake = function (time, mag) {
    this.shake = Math.max(this.shake, time || 0.12);
    this.shakeMag = Math.max(this.shakeMag, mag || 3.5);
  };

  /* 타격 스파크 파티클 — 피격 지점에서 튀는 파티클 */
  World.prototype.spawnSparks = function (x, y, color, count) {
    count = count || 5;
    for (var i = 0; i < count; i++) {
      if (this.sparks.length >= 60) this.sparks.shift();
      var ang = Math.random() * Math.PI * 2;
      var spd = 1.2 + Math.random() * 3.2;
      this.sparks.push({
        x: x, y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        color: color || "#ffd34d",
        t: 0,
        life: 0.18 + Math.random() * 0.14
      });
    }
  };

  /* 영혼/경험치/금화 흡수 구슬 */
  World.prototype.spawnOrbs = function (x, y, kind, count) {
    count = count || 3;
    for (var i = 0; i < count; i++) {
      if (this.orbs.length >= 40) this.orbs.shift();
      var ang = Math.random() * Math.PI * 2;
      var dist = 0.35 + Math.random() * 0.65;
      this.orbs.push({
        x: x, y: y,
        vx: Math.cos(ang) * dist * 3.2,
        vy: Math.sin(ang) * dist * 3.2,
        burst: 0.14 + Math.random() * 0.08, /* 0.14초간 사방으로 튄 뒤 플레이어에게 유도 */
        kind: kind || "xp",                  /* "xp" (푸른 영혼) 또는 "gold" (금빛) */
        spd: 1.8,
        t: 0,
        life: 1.8
      });
    }
  };

  World.prototype.onDeath = function (who, by) {
    this.log.push({ t: this.time, what: "death", who: who.name || who.sprite });
    /* 소환자가 죽으면 **부른 것도 함께 무너진다.**
     * ⚠ 이게 "먼저 술사를 잡아라" 를 가르치는 유일한 자리다. 남겨 두면 술사를
     *   먼저 잡을 이유가 없고, 부른 것이 바닥에 쌓여 판이 안 끝난다.
     * ⚠ dead 를 직접 찍는다 — onDeath 를 다시 부르면 보상이 돌고 재귀가 된다. */
    for (var si = 0; si < this.ents.length; si++) {
      var mn = this.ents[si];
      if (mn.summoned && mn.owner === who && !mn.dead) {
        mn.dead = true; mn.deadAt = this.time; mn.hp = 0;
      }
    }

    /* 바닥 잔해 (Debris) — 쓰러진 몬스터의 핏자국/흔적 */
    if (who !== this.player) {
      if (this.debris.length >= 40) this.debris.shift();
      this.debris.push({
        x: who.x, y: who.y,
        color: who.boss ? "#52141a" : "#3d1419",
        t: 0,
        life: 8.0,
        dots: [
          { dx: 0, dy: 0, r: who.boss ? 3.8 : 2.5 },
          { dx: (Math.random() - 0.5) * 0.32, dy: (Math.random() - 0.5) * 0.32, r: 1.8 },
          { dx: (Math.random() - 0.5) * 0.44, dy: (Math.random() - 0.5) * 0.44, r: 1.4 }
        ]
      });
    }

    if (who === this.player) { this.playerDeadAt = this.time; return; }
    /* ⚠ 보상은 **주인공이 잡았을 때만.** 안 걸면 몬스터끼리 싸움 붙였을 때나
     *   함정에 죽었을 때도 경험치가 들어온다(무한 파밍 통로다). */
    if (!this.hero || by !== this.player) return;
    /* ⚠ **부른 것에는 보상이 없다.** 경험치도 전리품도. 위의 xp=0 만으로는
     *   전리품(dropFrom)이 그대로 나와 여전히 무한 사냥터가 된다. */
    if (who.summoned) return;
    var S = global.SAVE;
    if (!S) return;
    /* 경험치 보너스는 **여기서 한 번만** 곱한다 */
    var xpMult = 1 + ((this.gear && this.gear.xpPct) || 0) / 100;
    var ups = S.gainXp(this.hero, Math.round(who.xp * xpMult));
    this.dropFrom(who);
    if (who.xp) {
      this.spawnOrbs(who.x, who.y, "xp", 4);
      this.floaters.push({ x: who.x, y: who.y - 1.1, text: "+" + Math.round(who.xp * xpMult) + "xp",
                           t: 0, life: 1.0, foe: true });
    }
    if (who.gold) {
      this.spawnOrbs(who.x, who.y, "gold", 3);
    }
    /* 제작 재료 드롭 */
    if (!this.hero.mats) this.hero.mats = { m_dust: 0, m_crystal: 0, m_essence: 0, m_scale: 0 };
    if (who.boss) {
      this.hero.mats.m_essence = (this.hero.mats.m_essence || 0) + 2;
      this.hero.mats.m_crystal = (this.hero.mats.m_crystal || 0) + 2;
      this.hero.mats.m_scale = (this.hero.mats.m_scale || 0) + 2;
      this.hero.mats.m_dust = (this.hero.mats.m_dust || 0) + 5;
      this.floaters.push({ x: who.x, y: who.y - 1.6, text: "🔮 심연의 정수 +2 획득!", t: 0, life: 1.5, foe: false });
    } else {
      var rMat = Math.random();
      if (rMat < 0.35) {
        this.hero.mats.m_dust = (this.hero.mats.m_dust || 0) + 1;
      } else if (rMat < 0.50) {
        this.hero.mats.m_crystal = (this.hero.mats.m_crystal || 0) + 1;
      } else if (rMat < 0.60 && this.depth >= 10) {
        this.hero.mats.m_scale = (this.hero.mats.m_scale || 0) + 1;
      }
    }
    if (who.boss) {
      this.addShake(0.35, 6);
      this.log.push({ t: this.time, what: "boss", who: who.name });
      if (global.SFX) global.SFX.play("win");
    }
    if (ups > 0) {
      this.log.push({ t: this.time, what: "levelup", level: this.hero.level });
      /* **레벨업은 재주 점수를 준다.** 턴제 시절의 3지선다를 대신하는 자리다 —
       * 캐릭터가 영구히 남는 게임에서는 매번 뽑기보다 쌓아 가는 쪽이 맞다. */
      this.hero.points += ups;
      if (global.SFX) global.SFX.play("level");
      /* 레벨이 오르면 **그 자리에서 체력이 늘고 다 찬다.** 실시간에서는 숨 돌릴
       * 틈이 없으므로 이게 유일한 회복 순간이다(물약이 붙기 전까지). */
      this.applyHero();
      this.player.hp = this.player.maxHp;
    }
  };

  /* 캐릭터 수치 → 몸. 레벨이 오르거나 불러온 직후에 부른다.
   * ⚠ 이 계산이 **한 곳**이어야 한다. 화면에 쓰는 값과 실제 몸이 갈리면
   *   "체력이 100인데 3대 맞고 죽는다" 가 된다. */
  World.prototype.applyHero = function () {
    if (!this.hero) return;
    var p = this.player, h = this.hero;
    var lv = h.level;
    var I = global.ITEMS, S = global.SAVE;
    /* 입은 것을 **여기서 한 번만** 합친다. 화면이 따로 더하면
     * "표시는 +30 인데 실제로는 +24" 가 된다. */
    var eq = (I && S) ? S.liveEquip(h) : {};
    var t = I ? I.totals(eq) : { dmg:0, hp:0, armor:0, spdPct:0, apsPct:0,
                                 critPct:0, critDmgPct:0, lifeOnHit:0, goldPct:0, xpPct:0 };
    this.gear = t;
    this.equipped = eq;

    /* 직업 — 수치가 **여기 한 곳**에서만 들어온다(classes.js 의 표).
     * ⚠ 화면 쪽에서 다시 더하면 "표시는 60인데 실제는 50" 이 된다. */
    var CL = global.CLASSES;
    var cls = CL ? CL.byId(h.cls) : null;
    this.cls = cls;

    var was = p.maxHp;
    p.maxHp = (cls ? cls.hp + (lv - 1) * cls.hpPer : 50 + (lv - 1) * 12) + (t.hp || 0);
    /* ⚠ 늘어난 **차이만큼만** 채운다. 새로 다 채우면 장비를 뺐다 끼는 것만으로
     *   무한 회복이 된다(장비 바꾸기 = 물약). */
    p.hp = Math.max(1, Math.min(p.maxHp, p.hp + (p.maxHp - was)));
    /* 버프가 얹히기 **전의** 값을 따로 둔다. 안 두면 버프가 끝날 때 무엇으로
     * 되돌릴지 몰라 방어가 계속 쌓인다(버프를 걸수록 세지는 고전 버그). */
    p.baseDef = (cls ? cls.armor : 0) + (t.armor || 0);
    var spdBonus = Math.max(-0.25, Math.min(0.35, (t.spdPct || 0) / 100));
    p.spd = (cls ? cls.spd : 4.0) * (1 + spdBonus);
    p.critPct = (cls ? cls.critPct : 0) + (t.critPct || 0);
    p.critDmgPct = t.critDmgPct || 0;
    p.lifeOnHit = t.lifeOnHit || 0;
    /* 무기가 몸짓과 피해를 함께 정한다 — 없으면 맨손(COMBAT.SWING) */
    var sw = I ? I.swingOf(eq, t) : null;
    if (sw) {
      var baseDmg = (eq.weapon && eq.weapon.s && eq.weapon.s.dmg) ? 0 : global.COMBAT.SWING.dmg;
      var raw = baseDmg + (t.dmg || 0);
      /* 무기 적성 — **보너스만** 준다. 안 맞는 무기에 벌을 주면 전리품 절반이
       * 쓰레기가 되어 줍는 재미가 사라진다. */
      p.adept = !!(CL && eq.weapon && CL.adept(h.cls, eq.weapon));
      if (p.adept) raw *= (1 + CL.ADEPT_BONUS / 100);
      p.swing = {
        aps: sw.aps, windup: sw.windup, recover: sw.recover,
        reach: sw.reach, arc: sw.arc, push: sw.push,
        dmg: Math.max(1, Math.round(raw)),
        /* 원거리 무기면 평타가 **날아간다** — 마법사가 다른 거리에서 노는 근거다 */
        ranged: !!(eq.weapon && eq.weapon.ranged),
        shotSpeed: (eq.weapon && eq.weapon.shotSpeed) || 12,
        pierce: (eq.weapon && eq.weapon.pierce) || 1
      };
    }
    p.baseAps = p.swing ? p.swing.aps : null;
    p.baseDmg = p.swing ? p.swing.dmg : null;
    p.stamMax = cls ? cls.stam : (global.SKILLS ? global.SKILLS.STAM_MAX : 100);
    p.stamRegen = cls ? cls.stamRegen : 12;
    if (p.stam === undefined) p.stam = p.stamMax;
    if (p.stam > p.stamMax) p.stam = p.stamMax;
    this.refreshBuffs();
    p.name = h.name;
  };

  /* 걸려 있는 버프를 **기준값 위에 다시 얹는다.**
   * ⚠ 더하고 빼는 식으로 두면 반올림과 순서 때문에 조금씩 어긋나 쌓인다. */
  World.prototype.refreshBuffs = function () {
    var p = this.player;
    if (p.baseDef === undefined) return;
    var armor = 0, aps = 0, dmg = 0;
    for (var i = 0; i < this.buffs.length; i++) {
      armor += this.buffs[i].armor || 0;
      aps += this.buffs[i].apsPct || 0;
      dmg += this.buffs[i].dmgPct || 0;
    }
    p.def = Math.max(0, p.baseDef + armor);
    if (p.swing && p.baseAps !== null) {
      p.swing.aps = p.baseAps * (1 + aps / 100);
      p.swing.dmg = Math.max(1, Math.round(p.baseDmg * (1 + dmg / 100)));
    }
  };

  /* ── 전리품 ─────────────────────────────────────────────
   * ⚠ 굴리기는 **씨앗 난수**다. 같은 판을 다시 돌리면 같은 것이 나와야
   *   "이게 왜 나왔지" 를 두 번 볼 수 있다. */
  World.prototype.dropFrom = function (who) {
    var I = global.ITEMS;
    if (!I) return;
    this._dropSeed = (this._dropSeed || (this.seed ^ 0x2545f491)) >>> 0;
    var rng = D.makeRng(this._dropSeed + who.uid * 2654435761);
    this._dropSeed = (this._dropSeed * 1664525 + 1013904223) >>> 0;

    /* 금화는 **거의 늘** 나온다 — 빈손으로 끝나는 전투가 이어지면 지친다 */
    var mult = 1 + ((this.gear && this.gear.goldPct) || 0) / 100;
    var g = Math.max(1, Math.round(who.gold * mult * (0.7 + rng() * 0.8)));
    this.drops.push({ id: ++this._dropId, x: who.x, y: who.y, gold: g, t: this.time });

    /* 물건은 가끔. ⚠ 너무 자주 나오면 가방이 차서 정리만 하게 된다. */
    if (rng() < 0.22) {
      var it = I.roll(rng, { ilvl: Math.max(1, this.depth) });
      this.drops.push({ id: ++this._dropId, x: who.x + (rng() - 0.5) * 0.8,
                        y: who.y + (rng() - 0.5) * 0.8, item: it, t: this.time });
    }
  };

  /* 발밑의 전리품. 금화는 **닿으면 알아서** 들어오고 물건은 눌러서 줍는다 —
   * ⚠ 물건까지 자동으로 주우면 가방이 쓰레기로 차고, 무엇을 주웠는지 모른다. */
  World.prototype.nearDrop = function () {
    var best = null, bd = 1e9, p = this.player;
    for (var i = 0; i < this.drops.length; i++) {
      var d = this.drops[i];
      if (!d.item) continue;
      var dd = Math.hypot(d.x - p.x, d.y - p.y);
      if (dd > 1.1) continue;
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  };

  World.prototype.takeDrop = function (drop) {
    var S = global.SAVE, I = global.ITEMS;
    if (!drop || !this.hero || !S || !I) return "없다";
    var i = this.drops.indexOf(drop);
    if (i < 0) return "없다";
    if (this.hero.bag.length >= S.BAG) return "가방이 가득 찼다";
    this.hero.bag.push(I.pack(drop.item));
    this.drops.splice(i, 1);
    if (global.SFX) global.SFX.play("pickup");
    this.log.push({ t: this.time, what: "pickup", name: drop.item.name });
    return null;
  };

  /* 사람이 휘두른다. app.js 가 마우스 방향을 준다. */

  World.prototype.refreshFov = function () {
    /* 마을은 안개가 없다 — 집 안에서 길을 잃으면 안 된다 */
    if (this.inTown) { this.level.visible.fill(1); return false; }
    var tx = Math.floor(this.player.x), ty = Math.floor(this.player.y);
    var k = tx + "," + ty;
    if (k === this._fovAt) return false;
    this._fovAt = k;
    D.computeFov(this.level, tx, ty, FOV_R);
    return true;
  };

  /* 규칙 한 걸음. **여기 들어오는 dt 는 언제나 SIM_DT 다.** */
  World.prototype.step = function () {
    var i, e;
    for (i = 0; i < this.ents.length; i++) {
      e = this.ents[i];
      e.px = e.x; e.py = e.y;
    }

    /* ① 생각한다. 사람은 app.js 가 mx/my 를 채워 준다. */
    for (i = 0; i < this.ents.length; i++) {
      e = this.ents[i];
      if (e.dead) continue;
      if (e.brain && global.AI) global.AI.run(this, e, SIM_DT);
    }

    /* ② 공격 시계. 판정은 선딜이 끝나는 걸음에 **한 번만** 일어난다. */
    for (i = 0; i < this.ents.length; i++) {
      e = this.ents[i];
      if (e.dead) continue;
      if (e.hurt > 0) e.hurt = Math.max(0, e.hurt - SIM_DT);
      /* 원거리 평타는 **판정이 아니라 발사**다. 선딜이 끝나는 걸음에 쏜다.
       * ⚠ COMBAT.tick 이 먼저 판정을 돌려 버리면(arc 0 이라 아무도 안 맞지만)
       *   atkRest 를 잡아 주므로 주기는 저절로 맞는다. */
      var wasShot = e.atk && e.atk.shot && !e.atk.hit;
      var shotAng = wasShot ? e.atk.ang : 0;
      var shotDmg = wasShot ? e.atk.m.dmg : 0;
      var fired = false;
      if (global.COMBAT) global.COMBAT.tick(this, e, SIM_DT);
      if (wasShot && (!e.atk || e.atk.hit)) fired = true;
      if (fired && e === this.player) {
        var sm = e.swing;
        this.shots.push({ id: ++this._shotId, x: e.x, y: e.y,
          vx: Math.cos(shotAng) * sm.shotSpeed, vy: Math.sin(shotAng) * sm.shotSpeed,
          dmg: shotDmg, from: e, team: e.team,
          life: sm.reach / sm.shotSpeed, r: 0.22, mine: true,
          pierce: sm.pierce || 1, hitSet: {} });
        if (global.SFX) global.SFX.play("ability");
      }
    }
    if (global.SKILLS) global.SKILLS.tick(this, SIM_DT);
    if (global.AI) global.AI.tickShots(this, SIM_DT);

    /* ③ 움직인다. */
    for (i = 0; i < this.ents.length; i++) {
      e = this.ents[i];
      if (e.dead) continue;

      /* 밀림이 걸음보다 먼저다 — 맞은 순간에는 조작이 잠깐 안 듣는 것이 맞다.
       * ⚠ 밀림을 순간이동으로 처리하면 벽을 뚫는다. 속도로 바꿔 같은 충돌을 태운다. */
      if (e.knock && !e.immovable) {
        var kd = Math.min(e.knock.left, e.knock.spd * SIM_DT);
        moveBy(this.level, e, e.knock.x * kd, e.knock.y * kd);
        e.knock.left -= kd;
        if (e.knock.left <= 1e-4) e.knock = null;
      }

      var mx = e.mx, my = e.my;
      /* 휘두르는 동안은 발이 30% 로 느려진다.
       * ⚠ 완전히 묶으면(root) 조작이 끊긴 것처럼 느끼고, 안 묶으면 선딜이
       *   의미를 잃는다(휘두르며 그대로 돌진). 실시간 전투의 손맛이 여기 있다. */
      var slow = (e.atk || e.atkRest > 0) ? 0.30 : 1;
      /* 시전 중에는 발이 거의 멈춘다 — 그래야 상대가 비킬 값어치가 있다 */
      if (e.cast && e.cast.sk.cast > 0) slow = 0.15;
      /* 둔화 — 충격파의 시너지 */
      if (e.slowUntil && this.time < e.slowUntil) slow *= (1 - (e.slowPct || 0) / 100);
      /* 돌진 중에는 조작으로 움직이지 않는다(돌진이 대신 옮긴다) */
      if (e.dash) slow = 0;
      var len = Math.sqrt(mx * mx + my * my);
      if (len > 1e-6 && !e.immovable) {
        /* ⚠ 대각선을 정규화하지 않으면 **대각이 1.41배 빠르다.** 그러면 모두가
         *   지그재그로만 다닌다(실제로 많은 게임이 이 버그를 달고 나왔다). */
        if (len > 1) { mx /= len; my /= len; }
        e.dirX = mx;
        e.dirY = my;
        var d = e.spd * slow * SIM_DT;
        moveBy(this.level, e, mx * d, my * d);
        var went = Math.abs(e.x - e.px) + Math.abs(e.y - e.py);
        e.walked += went;
        if (Math.abs(mx) > 0.05) e.face = mx > 0 ? 1 : -1;
      }
    }

    /* ④ 서로 겹치지 않게 살짝 밀어낸다.
     * ⚠ 안 하면 몬스터 다섯이 **완전히 같은 자리**에 포개져 한 마리로 보인다.
     *   벽 충돌과 달리 여기는 부드러워야 한다 — 딱 떼어 놓으면 튕긴다.
     * ⚠ 훈련용 허수아비 등 고정 개체(immovable)는 밀리지 않고 상대만 밀어낸다. */
    for (i = 0; i < this.ents.length; i++) {
      var a = this.ents[i];
      if (a.dead) continue;
      for (var j = i + 1; j < this.ents.length; j++) {
        var b = this.ents[j];
        if (b.dead) continue;
        var dx = b.x - a.x, dy = b.y - a.y;
        var want = a.r + b.r;
        var dd = Math.sqrt(dx * dx + dy * dy);
        if (dd >= want) continue;
        var ux, uy;
        if (dd < 1e-6) {
          /* ⚠ **정확히 같은 자리**면 밀어낼 방향이 없다. 전에는 여기서 그냥
           *   빠져나가 여섯 마리가 한 마리처럼 포개진 채 영영 안 떨어졌다
           *   (같은 칸 가운데에 소환되면 실제로 일어난다 — 실측 0.00칸).
           *   개체마다 고정된 각도로 흩는다. */
          ux = Math.cos(b.jitter); uy = Math.sin(b.jitter);
          dd = 1e-6;
        } else {
          ux = dx / dd; uy = dy / dd;
        }
        var pushAmt = (want - dd) * 0.5 * 0.35;   /* 0.35 = 한 번에 다 밀지 않는다 */
        if (a.immovable) {
          moveBy(this.level, b, ux * pushAmt * 2, uy * pushAmt * 2);
        } else if (b.immovable) {
          moveBy(this.level, a, -ux * pushAmt * 2, -uy * pushAmt * 2);
        } else {
          moveBy(this.level, a, -ux * pushAmt, -uy * pushAmt);
          moveBy(this.level, b, ux * pushAmt, uy * pushAmt);
        }
      }
    }

    /* 고정 개체는 원래 좌표(startX, startY)에 쐐기를 박아 둔다 */
    for (i = 0; i < this.ents.length; i++) {
      var fixE = this.ents[i];
      if (fixE.immovable && fixE.startX !== undefined) {
        fixE.x = fixE.startX; fixE.y = fixE.startY;
        fixE.px = fixE.startX; fixE.py = fixE.startY;
      }
    }

    /* ④-b 금화는 **닿으면 들어온다.** 물건은 눌러야 줍는다(무엇을 주웠는지
     *      알아야 하고, 가방이 쓰레기로 차면 안 된다). */
    for (i = this.drops.length - 1; i >= 0; i--) {
      var dr = this.drops[i];
      if (!dr.gold) continue;
      /* 줍는 반경. ⚠ 0.85칸으로 뒀더니 **밀려난 거리(1.8칸)보다 좁아** 보스를
       * 잡고도 금화를 못 주웠다(실측). 근접 사거리만큼 넓힌다 — "때려서 잡았으면
       * 손이 닿는다" 가 자연스럽다. 더 넓히면 안 지나간 방의 것까지 빨려 온다. */
      if (Math.hypot(dr.x - this.player.x, dr.y - this.player.y) > 1.35) continue;
      if (this.hero) this.hero.gold += dr.gold;
      this.floaters.push({ x: dr.x, y: dr.y - 0.5, text: "+" + dr.gold + "금",
                           t: 0, life: 0.8, foe: true });
      if (global.SFX) global.SFX.play("gold");
      this.drops.splice(i, 1);
    }

    /* ⑤ 떠오르는 숫자. */
    for (i = this.floaters.length - 1; i >= 0; i--) {
      var fl = this.floaters[i];
      fl.t += SIM_DT;
      if (fl.t >= fl.life) this.floaters.splice(i, 1);
    }

    /* ⑥ 시체를 치운다 — 남겨 두면 목록이 끝없이 길어져 겹침 검사가 느려진다. */
    for (i = this.ents.length - 1; i >= 0; i--) {
      var z = this.ents[i];
      if (z.dead && z !== this.player && this.time - z.deadAt > 0.9)
        this.ents.splice(i, 1);
    }

    /* ⑦ 화면 셰이크 및 시각 피드백 파티클 갱신 */
    if (this.shake > 0) {
      this.shake -= SIM_DT;
      if (this.shake <= 0) { this.shake = 0; this.shakeMag = 0; }
    }

    /* 타격 스파크 */
    for (i = this.sparks.length - 1; i >= 0; i--) {
      var sp = this.sparks[i];
      sp.t += SIM_DT;
      sp.x += sp.vx * SIM_DT;
      sp.y += sp.vy * SIM_DT;
      if (sp.t >= sp.life) this.sparks.splice(i, 1);
    }

    /* 흡수 구슬 (Orbs) — 플레이어 몸으로 궤적을 그리며 유도 */
    var px = this.player.x, py = this.player.y;
    for (i = this.orbs.length - 1; i >= 0; i--) {
      var ob = this.orbs[i];
      ob.t += SIM_DT;
      if (ob.burst > 0) {
        ob.burst -= SIM_DT;
        ob.x += ob.vx * SIM_DT;
        ob.y += ob.vy * SIM_DT;
        ob.vx *= 0.88;
        ob.vy *= 0.88;
      } else {
        var odx = px - ob.x, ody = py - ob.y;
        var od = Math.hypot(odx, ody);
        if (od < 0.35 || ob.t >= ob.life) {
          /* 플레이어에 닿아 흡수됨 */
          this.spawnSparks(px, py - 0.4, ob.kind === "gold" ? "#ffd700" : "#7ae8ff", 2);
          this.orbs.splice(i, 1);
          continue;
        }
        ob.spd = Math.min(14, ob.spd + 22 * SIM_DT);
        ob.x += (odx / od) * ob.spd * SIM_DT;
        ob.y += (ody / od) * ob.spd * SIM_DT;
      }
    }

    /* 바닥 잔해 (Debris) */
    for (i = this.debris.length - 1; i >= 0; i--) {
      var db = this.debris[i];
      db.t += SIM_DT;
      if (db.t >= db.life) this.debris.splice(i, 1);
    }

    this.tickRecall(SIM_DT);
    var ptx = Math.floor(this.player.x), pty = Math.floor(this.player.y);
    if (this.level.inside(ptx, pty)) {
      this.level.walked[pty * this.level.w + ptx] = 1;
    }
    this.refreshFov();
    this.time += SIM_DT;
    this.steps++;
  };

  /* 지금 말을 걸 수 있는 것. 없으면 null.
   * ⚠ 가장 가까운 **하나만** 돌려준다. 여러 개를 주면 화면이 "무엇을 누를지" 를
   *   못 정해 안내 문구가 깜빡인다. */
  World.prototype.nearProp = function () {
    var best = null, bd = 1e9, p = this.player;
    for (var i = 0; i < this.props.length; i++) {
      var o = this.props[i];
      var d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > o.def.reach) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  /* 근처에 여닫을 수 있는 문이 있는가 (거리 1.45 이내) */
  World.prototype.nearDoor = function () {
    var lv = this.level;
    var p = this.player;
    var tx = Math.floor(p.x), ty = Math.floor(p.y);
    var best = null, bd = 1.45;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var x = tx + dx, y = ty + dy;
        if (!lv.inside(x, y)) continue;
        var t = lv.at(x, y);
        if (t === D.DOOR || t === D.DOOR_OPEN) {
          var dist = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
          if (dist < bd) {
            bd = dist;
            best = { x: x, y: y, open: (t === D.DOOR_OPEN) };
          }
        }
      }
    }
    return best;
  };

  /* 문 열기 / 닫기 */
  World.prototype.toggleDoor = function (door) {
    if (!door) return { ok: false };
    var lv = this.level;
    var idx = lv.idx(door.x, door.y);
    if (door.open) {
      /* 닫으려 할 때: 문틀 사이에 플레이어나 살아있는 몬스터가 서 있으면 못 닫는다 */
      for (var i = 0; i < this.ents.length; i++) {
        var e = this.ents[i];
        if (e.dead) continue;
        if (Math.abs(e.x - (door.x + 0.5)) < 0.55 && Math.abs(e.y - (door.y + 0.5)) < 0.55) {
          return { ok: false, msg: "문 사이에 무언가 있어 닫을 수 없다" };
        }
      }
      lv.tiles[idx] = D.DOOR;
      this.refreshFov();
      if (global.SFX) global.SFX.play("door");
      return { ok: true, state: "closed" };
    } else {
      /* 열기 */
      lv.tiles[idx] = D.DOOR_OPEN;
      this.refreshFov();
      if (global.SFX) global.SFX.play("door");
      return { ok: true, state: "open" };
    }
  };

  /* 밟고 선 칸이 계단인가 — 던전에서 더 내려가는 길이다.
   * ⚠ 밟는 **순간**이 아니라 서 있는 동안 계속 참이다. 눌러서 내려가게 한다
   *   (밟자마자 내려가면 지나가다 실수로 떨어진다). */
  World.prototype.onStairs = function () {
    var lv = this.level;
    var tx = Math.floor(this.player.x), ty = Math.floor(this.player.y);
    var t = lv.at(tx, ty);
    return (t === D.STAIRS || t === D.DEEP) ? t : 0;
  };

  /* 마을로 돌아가기 — **그냥 되면 안 된다.**
   * 언제든 한 번에 빠져나갈 수 있으면 위험이 사라진다(도망 버튼이 된다).
   * 2초 동안 가만히 서 있어야 하고, 맞으면 끊긴다. */
  var RECALL_SEC = 2.0;
  World.prototype.recallStart = function () {
    if (this.inTown || this.player.dead) return false;
    if (this.recall) return true;
    this.recall = { t: 0, x: this.player.x, y: this.player.y, hp: this.player.hp };
    return true;
  };
  World.prototype.recallStop = function (why) {
    if (!this.recall) return;
    this.recall = null;
    this.recallBroke = why || "끊김";
  };
  World.prototype.tickRecall = function (dt) {
    var r = this.recall;
    if (!r) return;
    var p = this.player;
    if (p.dead) return this.recallStop("죽음");
    /* 움직이면 끊긴다 — 걸으면서 도망칠 수 없게 */
    if (Math.hypot(p.x - r.x, p.y - r.y) > 0.25) return this.recallStop("움직임");
    if (p.hp < r.hp) return this.recallStop("피격");
    r.hp = p.hp;
    r.t += dt;
    if (r.t >= RECALL_SEC) { this.recall = null; this.recallDone = true; }
  };
  World.prototype.recallLeft = function () {
    return this.recall ? Math.max(0, RECALL_SEC - this.recall.t) : 0;
  };

  /* 스킬을 쓴다. **왜 못 쓰는지**를 돌려준다 — null 이면 성공. */
  World.prototype.useSkill = function (id, aimX, aimY, taken) {
    if (!global.SKILLS) return "재주가 없다";
    return global.SKILLS.use(this, id, aimX, aimY, taken, this.hero && this.hero.cls);
  };

  /* 사람이 휘두른다. app.js 가 마우스 방향을 준다. */
  World.prototype.swing = function (aimX, aimY) {
    if (!global.COMBAT) return false;
    var p = this.player;
    /* ⚠ 스킬을 쓰는 중에는 평타가 안 나간다. 안 막으면 시전 중에 마우스를
     *   누르고 있는 것만으로 평타가 섞여 나가 시전의 뜻이 없어진다. */
    if (p.cast || p.dash) return false;
    /* 원거리 무기 — 부채꼴이 아니라 **날아가는 것**을 쏜다.
     * ⚠ 같은 begin() 을 쓰되 arc 0 · reach 0 으로 두어 근접 판정이 안 나게 한다.
     *   판정을 두 벌로 만들면 "원거리만 치명타가 안 터진다" 같은 어긋남이 생긴다. */
    if (p.swing && p.swing.ranged) return this.shoot(aimX, aimY);
    return global.COMBAT.begin(p, aimX - p.x, aimY - p.y);
  };

  /* 원거리 평타. 공격 주기는 근접과 **같은 시계**(atkRest)를 쓴다. */
  World.prototype.shoot = function (aimX, aimY) {
    var p = this.player;
    if (p.atk || p.atkRest > 0) return false;
    var m = p.swing;
    var dx = aimX - p.x, dy = aimY - p.y;
    var len = Math.hypot(dx, dy) || 1;
    /* 선딜 동안은 아직 안 나간다 — 근접과 같은 규칙이다 */
    p.atk = { m: { aps: m.aps, windup: m.windup, recover: m.recover,
                   reach: 0, arc: 0, dmg: m.dmg, push: 0 },
              t: 0, ang: Math.atan2(dy / len, dx / len), hit: false, shot: true };
    if (Math.abs(dx) > 0.05) p.face = dx > 0 ? 1 : -1;
    return true;
  };

  /* 실제로 흐른 시간을 받아 규칙을 따라잡고, 그리기가 쓸 보간값을 돌려준다. */
  World.prototype.advance = function (realDt) {
    if (!(realDt > 0)) realDt = 0;
    if (realDt > 0.25) realDt = 0.25;     /* 탭을 오래 감췄다 돌아온 경우 */
    if (this.hitFreeze > 0) {
      this.hitFreeze = Math.max(0, this.hitFreeze - realDt);
      return { steps: 0, alpha: this._acc / SIM_DT };
    }
    this._acc += realDt;
    var n = 0;
    while (this._acc >= SIM_DT && n < MAX_STEPS) {
      this.step();
      this._acc -= SIM_DT;
      n++;
    }
    if (n === MAX_STEPS) this._acc = 0;   /* 못 따라잡은 건 버린다 */
    return { steps: n, alpha: this._acc / SIM_DT };
  };

  global.WORLD = {
    SIM_DT: SIM_DT, SIM_HZ: SIM_HZ, BODY: BODY, FOV_R: FOV_R,
    World: World, Entity: Entity,
    boxFree: boxFree, moveBy: moveBy, solid: solid
  };
})(window);
