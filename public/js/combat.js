/* 전투 규칙 — **모든 시간은 초다.**
 *
 * 턴제에서는 "한 턴에 한 번 때린다" 였다. 실시간에서는 그 자리를 **공격 주기**가
 * 대신한다. 그래서 수치의 단위가 통째로 바뀐다:
 *
 *   공격속도 aps   초당 몇 번 (1.2 = 0.83초에 한 번)
 *   선딜   windup  휘두르기 시작해서 **판정이 나가기까지**  — 피할 수 있는 시간
 *   후딜   recover 판정 뒤 다음 행동까지                    — 헛치면 벌을 받는 시간
 *   사거리 reach   칸
 *   각도   arc     도(°) — 부채꼴. 360 이면 온 사방
 *
 * ⚠ 선딜이 0 이면 전투가 사라진다. 맞고 나서야 상대가 공격했다는 걸 알게 되고,
 *   피할 방법이 없어 결국 "체력 큰 쪽이 이긴다" 가 된다. **실시간 전투의 재미는
 *   거의 전부 선딜에서 나온다** — 몬스터가 팔을 드는 것을 보고 비키는 것.
 * ⚠ 피해 판정은 **선딜이 끝나는 순간 한 번만** 한다. 매 걸음 판정하면 한 번
 *   휘두르고 붙어 있는 동안 60번 맞는다.
 * ⚠ 각도는 **공격을 시작한 순간의 방향**으로 굳힌다. 판정 시점의 마우스를 보면
 *   휘두르는 도중에 뒤로 돌려 등 뒤를 때릴 수 있다.
 * ⚠ 이 파일이 피해 계산의 **단일 진실원**이다. 화면 쪽에서 숫자를 다시 만들지 말 것.
 */
(function (global) {
  "use strict";

  /* 기본 무기 몸짓. 나중에 스킬이 이 모양을 그대로 쓴다. */
  var SWING = {
    aps: 1.15,
    windup: 0.18,
    recover: 0.24,
    reach: 1.25,
    arc: 100,
    dmg: 6,
    push: 0.35,        /* 맞은 쪽이 밀리는 거리(칸) */
    sfx: "hit"
  };

  function deg2rad(d) { return d * Math.PI / 180; }

  /* 두 방향 사이의 각 차이(라디안, 0~π). 부채꼴 판정의 핵심이다. */
  function angleDiff(a, b) {
    var d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  }

  /* 공격을 시작한다. 이미 휘두르는 중이거나 쉬는 중이면 무시한다 —
   * ⚠ 여기서 막지 않으면 마우스를 연타하는 사람이 공격속도를 무시한다. */
  function begin(e, dirX, dirY, move) {
    if (e.dead) return false;
    if (e.atk) return false;
    if (e.atkRest > 0) return false;
    var len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len < 1e-6) { dirX = e.face; dirY = 0; len = 1; }
    var m = move || e.swing || SWING;
    e.atk = {
      m: m,
      t: 0,
      ang: Math.atan2(dirY / len, dirX / len),
      hit: false
    };
    if (Math.abs(dirX) > 0.05) e.face = dirX > 0 ? 1 : -1;
    return true;
  }

  /* 한 걸음(1/60초) 진행. 판정이 일어나면 맞은 개체 목록을 돌려준다. */
  function tick(world, e, dt) {
    if (e.atkRest > 0) e.atkRest = Math.max(0, e.atkRest - dt);
    var a = e.atk;
    if (!a) return null;
    a.t += dt;
    if (!a.hit && a.t >= a.m.windup) {
      a.hit = true;
      var victims = resolve(world, e, a);
      /* 주기 = 1/aps. 선딜+후딜을 빼고 남은 만큼 쉰다 —
       * ⚠ 주기를 무시하고 선딜+후딜만 쓰면 공격속도 수치가 아무 뜻이 없어진다. */
      var cycle = 1 / a.m.aps;
      e.atkRest = Math.max(a.m.recover, cycle - a.m.windup);
      return victims;
    }
    if (a.t >= a.m.windup + a.m.recover) e.atk = null;
    return null;
  }

  /* 부채꼴 안의 적을 찾아 피해를 준다. */
  function resolve(world, e, a) {
    var hit = [];
    var half = deg2rad(a.m.arc) / 2;
    for (var i = 0; i < world.ents.length; i++) {
      var t = world.ents[i];
      if (t === e || t.dead || t.team === e.team) continue;
      var dx = t.x - e.x, dy = t.y - e.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      /* ⚠ 사거리에 **상대의 몸 반지름을 더한다.** 안 더하면 덩치 큰 적을
       *   눈앞에 두고도 허공을 친다(중심점끼리만 재기 때문이다). */
      if (d > a.m.reach + t.r) continue;
      if (a.m.arc < 359 && d > 1e-6) {
        if (angleDiff(Math.atan2(dy, dx), a.ang) > half) continue;
      }
      damage(world, e, t, a.m.dmg);
      /* ⚠ 맞은 **사람 수만큼** 울리면 여럿을 한 번에 칠 때 소리가 겹쳐 찢어진다.
       *   한 번 휘두름 = 한 번 운다(아래 hit.length 로 낸다).
       * ⚠ 훈련용 허수아비는 넉백되지 않고 자리에 단단히 고정된다. */
      if (a.m.push && d > 1e-6 && t.kind !== "dummy") {
        t.knock = { x: dx / d, y: dy / d, left: a.m.push, spd: 6 };
      }
      hit.push(t);
    }
    if (hit.length && global.SFX) global.SFX.play(hit.length > 1 ? "crit" : "hit");
    return hit;
  }

  function damage(world, from, to, amount, opt) {
    if (to.dead) return 0;
    /* 무적(돌진 시너지). ⚠ **여기 한 곳**에서만 본다 — 장판·부채꼴·평타가
     *   각자 검사하면 하나를 빠뜨려 "무적인데 장판에는 맞는다" 가 된다. */
    if (to.dash && to.dash.iframe) return 0;
    opt = opt || {};
    /* 치명타 — **때리는 쪽의 값**으로 굴린다.
     * ⚠ 방어(armor)는 치명타 **뒤에** 뺀다. 먼저 빼면 방어가 높은 상대에게
     *   치명타가 두 배로 먹혀 "갑옷이 치명타를 키우는" 거꾸로가 된다. */
    var crit = false;
    if (from && from.critPct > 0 && opt.canCrit !== false) {
      /* ⚠ 여기만 Math.random 을 쓴다. 치명타는 **매 타격마다 새로 굴려야** 하고
       *   씨앗을 쓰면 같은 자리에서 같은 결과가 반복돼 도박이 아니게 된다.
       *   던전 생성·전리품과 달리 재현할 이유도 없다(그 둘은 씨앗 난수다). */
      crit = Math.random() * 100 < from.critPct;
    }
    var raw = amount;
    if (crit) raw = raw * (150 + (from.critDmgPct || 0)) / 100;
    /* 방어는 뺄셈이다. ⚠ 그런데 접사가 물건 수준에 따라 커지므로, 막지 않으면
     * 어느 시점부터 **방어 ≥ 상대 피해**가 되어 아무 것도 나를 못 다치게 한다.
     * 한 대의 30% 는 반드시 들어가게 바닥을 둔다 — 곱하기 방어의 "후반 무한" 과
     * 뺄셈 방어의 "어느 순간 무적" 은 같은 병의 양면이다. */
    var n = Math.max(1, Math.round(Math.max(raw * 0.30, raw - (to.def || 0))));
    to.hp -= n;
    to.hurt = 0.18;                 /* 맞은 티(깜빡임) — 초 */

    /* 전투 타격감 피드백: 치명타 시 화면 떨림 및 스파크 파티클 */
    if (crit) {
      if (world.addShake) world.addShake(0.12, 3.5);
      if (world.spawnSparks) world.spawnSparks(to.x, to.y - 0.2, "#ffd34d", 8);
    } else if (world.spawnSparks) {
      world.spawnSparks(to.x, to.y - 0.2, to.team !== 0 ? "#ffe9a8" : "#ff8d7a", 3);
    }

    /* 흡혈 — 때린 **사람 수만큼** 회복된다(광역 무기의 값어치다) */
    if (from && from.lifeOnHit > 0 && from.hp < from.maxHp && !from.dead)
      from.hp = Math.min(from.maxHp, from.hp + from.lifeOnHit);
    world.floaters.push({ x: to.x, y: to.y - 0.6, text: String(n) + (crit ? "!" : ""), t: 0,
                          life: crit ? 0.95 : 0.75, crit: crit, foe: to.team !== 0 });
    if (to.kind === "dummy") {
      to.hp = to.maxHp;
    } else if (to.hp <= 0) {
      to.hp = 0;
      to.dead = true;
      to.deadAt = world.time;
      if (global.SFX) global.SFX.play(to.kind === "player" ? "die" : "kill");
      world.onDeath(to, from);
    }
    return n;
  }

  global.COMBAT = {
    SWING: SWING,
    begin: begin,
    tick: tick,
    damage: damage,
    angleDiff: angleDiff
  };
})(window);
