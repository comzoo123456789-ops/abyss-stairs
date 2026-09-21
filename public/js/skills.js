/* 스킬 — **초 단위로 다시 설계했다.**
 *
 * 턴제에서는 "재사용 3턴" 이었다. 그건 시간이 아니라 **행동 횟수**다 — 가만히 서
 * 있으면 영원히 안 돌고, 빨리 움직이면 빨리 돈다. 실시간에서는 그 뜻이 없어진다.
 * 그래서 전부 초로 다시 적었다:
 *
 *   cd       재사용 대기(초)   — 시계가 곧 자원이다
 *   cast     시전(초)          = 선딜. **이 동안 상대가 피할 수 있다**
 *   after    후딜(초)          — 헛쓰면 벌을 받는 시간
 *   dur      지속(초)          — 버프·장판
 *   tick     장판이 몇 초마다 때리는가
 *
 * ⚠ **쿨다운을 화면 타이머로 세지 말 것.** 창을 감췄다 돌아오거나 프레임이 튀면
 *   어긋난다. 규칙 시계(world.time)로만 잰다 — 그래야 60Hz 고정 걸음과 같은 시계다.
 * ⚠ 시전 중에 움직이면 **끊긴다**(이동 스킬은 예외). 안 끊으면 달리면서 쓰는 것이
 *   늘 이득이라 자리를 잡는 재미가 사라진다.
 * ⚠ 위력은 **무기 피해의 배수**로 적는다. 평값으로 적으면 무기를 바꿔도 스킬만
 *   그대로라 후반에 평타보다 약해지고, 결국 아무도 안 쓴다.
 *
 * 각 스킬에는 **시너지 셋**이 붙는다(레벨을 올리며 고른다). 하나를 고르면 그
 * 스킬이 다른 역할이 되어야 한다 — "피해 +10%" 같은 것만 늘어놓으면 고를 이유가 없다.
 */
(function (global) {
  "use strict";

  /* ⚠ **로드 시점에 붙잡지 말 것.** skills.js 가 combat.js 보다 먼저 실리면
   *   C 가 undefined 로 굳어 스킬이 통째로 죽는다 — 오류는 쓸 때야 나므로
   *   "스킬이 안 나간다" 로만 보인다(실측으로 그렇게 당했다).
   *   쓸 때 읽으면 순서에 안 기댄다. */
  function C_() { return global.COMBAT; }

  /* 자원. 마나가 아니라 **기력**이다 — 초당 차오르고, 쿨다운과 함께 두 겹으로
   * 막는다. 쿨다운만 두면 스킬을 돌아가며 쉬지 않고 쓴다. */
  var STAM_MAX = 100;
  var STAM_REGEN = 12;         /* 초당 */

  /* ── 스킬 표 ─────────────────────────────────────────────
   * kind 가 쓰는 방식을 정한다:
   *   swing  부채꼴 한 번(무기처럼)
   *   nova   제자리 사방
   *   dash   가리키는 쪽으로 밀고 나가며 스치는 것을 벤다
   *   field  바닥에 장판을 깐다
   *   buff   자기에게 건다
   */
  var SKILLS = [
    { id: "cleave", name: "베어넘기기", kind: "swing", icon: "s_cleave",
      cd: 4.0, cast: 0.25, after: 0.20, stam: 18,
      mult: 1.9, reach: 1.9, arc: 170, push: 0.6,
      text: "앞을 넓게 벤다",
      syn: [
        { id: "wide",  name: "더 넓게", text: "부채꼴 170° → 260°", s: { arc: 90 } },
        { id: "quick", name: "빠르게",  text: "재사용 4.0 → 2.6초", s: { cd: -1.4 } },
        { id: "heavy", name: "무겁게",  text: "위력 1.9 → 2.8배 · 시전 +0.15초",
          s: { mult: 0.9, cast: 0.15 } }
      ] },

    { id: "dash", name: "돌진", kind: "dash", icon: "s_dash",
      cd: 6.0, cast: 0.0, after: 0.18, stam: 22,
      mult: 1.2, dist: 4.2, speed: 22, reach: 0.9,
      text: "앞으로 뚫고 나가며 스치는 것을 벤다",
      syn: [
        { id: "far",   name: "더 멀리", text: "거리 4.2 → 6.5칸", s: { dist: 2.3 } },
        { id: "guard", name: "무적",    text: "돌진 중 피해를 안 받는다", s: { iframe: 1 } },
        { id: "chase", name: "연속",    text: "적을 맞히면 재사용이 2초 줄어든다", s: { refund: 2 } }
      ] },

    { id: "nova", name: "충격파", kind: "nova", icon: "s_nova",
      cd: 8.0, cast: 0.40, after: 0.25, stam: 30,
      mult: 1.5, reach: 3.2, push: 1.4,
      text: "사방으로 밀어낸다",
      syn: [
        { id: "big",   name: "더 크게", text: "반경 3.2 → 4.4칸", s: { reach: 1.2 } },
        { id: "slow",  name: "둔화",    text: "맞은 것이 3초간 40% 느려진다", s: { slow: 3 } },
        { id: "quick", name: "빠르게",  text: "시전 0.40 → 0.15초", s: { cast: -0.25 } }
      ] },

    { id: "burn", name: "불바다", kind: "field", icon: "s_burn",
      cd: 12.0, cast: 0.35, after: 0.25, stam: 34,
      mult: 0.45, reach: 2.4, dur: 6.0, tick: 0.6, range: 5.0,
      text: "가리킨 곳을 6초간 태운다",
      syn: [
        { id: "long",  name: "오래",    text: "지속 6 → 10초", s: { dur: 4 } },
        { id: "dense", name: "촘촘히",  text: "0.6 → 0.35초마다 태운다", s: { tick: -0.25 } },
        { id: "wide",  name: "넓게",    text: "반경 2.4 → 3.4칸", s: { reach: 1.0 } }
      ] },

    /* ── 전사 전용 ── */
    { id: "whirl", name: "회전베기", kind: "nova", icon: "s_whirl",
      cd: 7.0, cast: 0.30, after: 0.30, stam: 26,
      mult: 1.6, reach: 2.2, push: 0.5,
      text: "제자리에서 사방을 쓸어 벤다",
      syn: [
        { id: "big",   name: "더 넓게", text: "반경 2.2 → 3.0칸", s: { reach: 0.8 } },
        { id: "twice", name: "두 번",   text: "위력 1.6 → 2.6배 · 시전 +0.2초",
          s: { mult: 1.0, cast: 0.2 } },
        { id: "hold",  name: "버티기",  text: "쓴 뒤 3초간 방어 +6", s: { guard: 6 } }
      ] },

    /* ── 도적 전용 ──
     * ⚠ 급소찌르기는 **뒤에서 찔러야** 값어치가 있다. 앞에서도 같은 피해면
     *   "그냥 센 평타" 라 도적이 붙었다 빠질 이유가 없어진다. */
    { id: "backstab", name: "급소찌르기", kind: "swing", icon: "s_backstab",
      cd: 5.0, cast: 0.12, after: 0.18, stam: 20,
      mult: 2.2, reach: 1.3, arc: 60, push: 0.2, behind: 2.0,
      text: "한 명을 깊이 찌른다 — 등 뒤면 두 배",
      syn: [
        { id: "deep",  name: "더 깊이", text: "위력 2.2 → 3.2배", s: { mult: 1.0 } },
        { id: "quick", name: "빠르게",  text: "재사용 5.0 → 3.0초", s: { cd: -2.0 } },
        { id: "bleed", name: "출혈",    text: "맞은 것이 4초간 계속 아프다", s: { bleed: 4 } }
      ] },

    { id: "venom", name: "독날", kind: "buff", icon: "s_venom",
      cd: 14.0, cast: 0.0, after: 0.10, stam: 28,
      dur: 8.0, apsPct: 15, lifeOnHit: 3, dmgPct: 20,
      text: "8초간 공격속도 +15% · 피해 +20% · 때릴 때마다 회복",
      syn: [
        { id: "long",  name: "오래",   text: "지속 8 → 13초", s: { dur: 5 } },
        { id: "thick", name: "짙게",   text: "타격 회복 3 → 8", s: { lifeOnHit: 5 } },
        { id: "swift", name: "날래게", text: "공격속도 +15% → +35%", s: { apsPct: 20 } }
      ] },

    /* ── 공용 ── */
    { id: "ward", name: "결의", kind: "buff", icon: "s_ward",
      cd: 16.0, cast: 0.0, after: 0.10, stam: 25,
      dur: 6.0, armor: 8, apsPct: 25,
      text: "6초간 방어 +8 · 공격속도 +25%",
      syn: [
        { id: "long",  name: "오래",    text: "지속 6 → 10초", s: { dur: 4 } },
        { id: "heal",  name: "회복",    text: "걸 때 체력 25% 를 채운다", s: { heal: 25 } },
        { id: "rage",  name: "분노",    text: "방어 대신 피해 +35%", s: { armor: -8, dmgPct: 35 } }
      ] }
  ];

  function byId(id) {
    for (var i = 0; i < SKILLS.length; i++) if (SKILLS[i].id === id) return SKILLS[i];
    return null;
  }

  /* 고른 시너지를 얹은 **실제 수치**. ⚠ 여기가 유일한 합산 자리다 —
   * 화면이 따로 더하면 "설명은 2.8배인데 실제로는 1.9배" 가 된다. */
  function resolve(id, taken) {
    var sk = byId(id);
    if (!sk) return null;
    var out = {};
    for (var k in sk) if (k !== "syn") out[k] = sk[k];
    out.syn = [];
    var list = (taken && taken[id]) || [];
    for (var i = 0; i < sk.syn.length; i++) {
      var sy = sk.syn[i];
      if (list.indexOf(sy.id) < 0) continue;
      out.syn.push(sy.id);
      for (var s in sy.s) out[s] = (out[s] || 0) + sy.s[s];
    }
    /* 안전 한도 — 시너지를 다 모아도 말이 되게 */
    out.cd = Math.max(0.5, out.cd);
    out.cast = Math.max(0, out.cast);
    if (out.tick !== undefined) out.tick = Math.max(0.1, out.tick);
    return out;
  }

  /* 쓸 수 있는가. **왜 못 쓰는지**를 돌려준다 — 아무 일도 안 일어나면 고장으로 느낀다. */
  function why(world, id, taken, cls) {
    var p = world.player;
    if (p.dead) return "쓰러졌다";
    var sk = resolve(id, taken);
    if (!sk) return "없는 재주";
    /* ⚠ 직업이 못 쓰는 재주는 **애초에 손잡이에 안 들어가지만**, 저장을 손으로
     *   고치면 들어올 수 있다. 여기서 한 번 더 막는다(관문은 한 곳에 걸면 샌다). */
    if (cls && global.CLASSES && !global.CLASSES.canUse(cls, id))
      return "이 직업은 못 쓴다";
    var left = cdLeft(world, id, taken);
    if (left > 0) return left.toFixed(1) + "초 남았다";
    if (p.stam < sk.stam) return "기력이 모자라다";
    if (p.cast) return "쓰는 중";
    return null;
  }

  function cdLeft(world, id, taken) {
    var sk = resolve(id, taken);
    var at = world.cds ? world.cds[id] : undefined;
    /* ⚠ **`!at` 로 보면 안 된다.** 세계가 막 시작했을 때 world.time 은 0 이고,
     *   그때 쓴 스킬은 cds[id] === 0 이라 falsy 다 — 그러면 "쿨다운이 없다" 로
     *   읽혀 **첫 스킬은 무한 연타가 된다**(실측: 4초짜리를 0.6초 뒤에 또 썼다).
     *   화면을 새로 열 때마다 되살아나는 종류라 눈으로는 거의 못 잡는다. */
    if (at === undefined || at === null) return 0;
    /* ⚠ 규칙 시계로만 잰다. Date.now 를 쓰면 창을 감췄다 돌아올 때 어긋난다. */
    return Math.max(0, sk.cd - (world.time - at));
  }

  /* ── 쓰기 ───────────────────────────────────────────────
   * ⚠ 규칙이 나는 자리는 **여기 하나**다. app.js 가 효과를 따로 만들면
   *   화면과 규칙이 갈린다. app.js 는 use() 를 부르기만 한다. */
  function use(world, id, aimX, aimY, taken, cls) {
    var no = why(world, id, taken, cls);
    if (no) return no;
    var sk = resolve(id, taken);
    var p = world.player;
    var dx = aimX - p.x, dy = aimY - p.y;
    var len = Math.hypot(dx, dy) || 1;
    var ang = Math.atan2(dy / len, dx / len);

    p.stam -= sk.stam;
    world.cds[id] = world.time;
    if (Math.abs(dx) > 0.05) p.face = dx > 0 ? 1 : -1;

    /* 시전이 있으면 **그 동안은 아직 아무 일도 안 일어난다** — 상대가 피할 시간이다.
     * ⚠ 시전을 건너뛰고 바로 터뜨리면 실시간 전투가 "먼저 누른 쪽이 이긴다" 가 된다. */
    p.cast = { id: id, sk: sk, t: 0, ang: ang, x: aimX, y: aimY,
               x0: p.x, y0: p.y, done: false };
    if (global.SFX) global.SFX.play("ability");
    return null;
  }

  /* 무기 한 대의 피해. 스킬 위력은 **이것의 배수**다 —
   * 평값으로 두면 무기를 바꿔도 스킬만 그대로라 후반에 평타보다 약해진다. */
  function baseDmg(world) {
    var p = world.player;
    return (p.swing && p.swing.dmg) ? p.swing.dmg : C_().SWING.dmg;
  }

  function fire(world, cast) {
    var p = world.player, sk = cast.sk;
    var dmg = Math.max(1, Math.round(baseDmg(world) * (sk.mult || 0)));

    if (sk.kind === "swing" || sk.kind === "nova") {
      /* COMBAT 의 부채꼴을 그대로 쓴다 — 판정 규칙을 두 벌로 두지 않는다.
       * ⚠ aps 를 크게 줘서 **평타 주기를 안 먹게** 한다(스킬은 자기 쿨다운으로 잰다). */
      p.atk = null; p.atkRest = 0;
      C_().begin(p, Math.cos(cast.ang), Math.sin(cast.ang), {
        aps: 99, windup: 0, recover: sk.after, reach: sk.reach,
        arc: sk.kind === "nova" ? 360 : sk.arc, dmg: dmg, push: sk.push || 0
      });
      /* windup 0 이라 다음 걸음에 바로 판정된다 */
      var hits = C_().tick(world, p, 0);
      if (hits && sk.slow) markSlow(world, hits, sk.slow);
      /* 등 뒤 배수 — **맞은 쪽이 나를 등지고 있었나.**
       * ⚠ 내 방향이 아니라 **상대의 방향**을 본다. 내 방향으로 재면 옆에서
       *   찔러도 늘 등 뒤가 되어 조건이 없는 것과 같다. */
      if (hits && sk.behind) {
        for (var bi = 0; bi < hits.length; bi++) {
          var t2 = hits[bi];
          var away = (t2.x - p.x) * t2.face;
          if (away > 0) C_().damage(world, p, t2, dmg * (sk.behind - 1), { canCrit: false });
        }
      }
      if (hits && sk.bleed) {
        for (var bj = 0; bj < hits.length; bj++)
          world.bleeds.push({ who: hits[bj], until: world.time + sk.bleed,
                              next: world.time + 0.5, dmg: Math.max(1, Math.round(dmg * 0.12)),
                              from: p });
      }
      /* 쓴 뒤 잠깐 단단해진다(회전베기 시너지) */
      if (sk.guard) world.buffs.push({ until: world.time + 3, armor: sk.guard,
                                       apsPct: 0, dmgPct: 0, id: cast.id });
      if (sk.guard) world.refreshBuffs();
      p.atkRest = sk.after;
    } else if (sk.kind === "dash") {
      p.dash = { dx: Math.cos(cast.ang), dy: Math.sin(cast.ang),
                 left: sk.dist, spd: sk.speed, dmg: dmg, reach: sk.reach,
                 iframe: !!sk.iframe, hit: {}, id: cast.id, refund: sk.refund || 0 };
    } else if (sk.kind === "field") {
      /* ⚠ 닿는 거리를 **제한한다.** 없으면 화면 끝 몬스터를 안전하게 태운다. */
      var d = Math.hypot(cast.x - cast.x0, cast.y - cast.y0);
      var fx = cast.x, fy = cast.y;
      if (d > sk.range) {
        fx = cast.x0 + (cast.x - cast.x0) / d * sk.range;
        fy = cast.y0 + (cast.y - cast.y0) / d * sk.range;
      }
      world.fields.push({ id: ++world._fieldId, x: fx, y: fy, r: sk.reach,
                          until: world.time + sk.dur, next: world.time,
                          tick: sk.tick, dmg: dmg, from: p });
    } else if (sk.kind === "buff") {
      world.buffs.push({ until: world.time + sk.dur, armor: sk.armor || 0,
                         apsPct: sk.apsPct || 0, dmgPct: sk.dmgPct || 0, id: cast.id });
      if (sk.heal) p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * sk.heal / 100));
      world.refreshBuffs();
    }
  }

  function markSlow(world, list, secs) {
    for (var i = 0; i < list.length; i++) {
      list[i].slowUntil = world.time + secs;
      list[i].slowPct = 40;
    }
  }

  /* 한 걸음. world.step 이 부른다. */
  function tick(world, dt) {
    var p = world.player;
    /* ⚠ 상한·회복은 **직업마다 다르다**(classes.js). 여기 상수를 쓰면
     *   마법사의 넉넉한 기력이 조용히 사라진다. */
    var smax = p.stamMax || STAM_MAX;
    var sreg = p.stamRegen || STAM_REGEN;
    if (p.stam === undefined) p.stam = smax;
    /* 기력은 늘 차오른다 — 쿨다운과 **두 겹**으로 막아야 스킬을 쉬지 않고 돌리지 못한다 */
    p.stam = Math.min(smax, p.stam + sreg * dt);

    /* 시전 */
    var c = p.cast;
    if (c) {
      c.t += dt;
      /* ⚠ 움직이면 끊긴다(이동 스킬은 예외). 안 끊으면 달리면서 쓰는 것이 늘
       *   이득이라 자리를 잡는 재미가 사라진다. */
      if (c.sk.kind !== "dash" && c.sk.cast > 0 &&
          Math.hypot(p.x - c.x0, p.y - c.y0) > 0.3) {
        p.cast = null;
        world.castBroke = c.id;
      } else if (c.t >= c.sk.cast) {
        p.cast = null;
        fire(world, c);
      }
    }

    /* 돌진 */
    var ds = p.dash;
    if (ds) {
      var step = Math.min(ds.left, ds.spd * dt);
      global.WORLD.moveBy(world.level, p, ds.dx * step, ds.dy * step);
      ds.left -= step;
      for (var i = 0; i < world.ents.length; i++) {
        var e = world.ents[i];
        if (e === p || e.dead || e.team === p.team || ds.hit[e.uid]) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) > ds.reach + e.r) continue;
        ds.hit[e.uid] = 1;
        C_().damage(world, p, e, ds.dmg);
        /* 맞히면 재사용이 줄어든다 — 연속으로 파고드는 빌드가 성립한다 */
        if (ds.refund && world.cds[ds.id] !== undefined)
          world.cds[ds.id] -= ds.refund;
      }
      if (ds.left <= 1e-4) p.dash = null;
    }

    /* 장판 */
    for (var f = world.fields.length - 1; f >= 0; f--) {
      var fl = world.fields[f];
      if (world.time >= fl.until) { world.fields.splice(f, 1); continue; }
      if (world.time < fl.next) continue;
      fl.next = world.time + fl.tick;
      for (var k = 0; k < world.ents.length; k++) {
        var t = world.ents[k];
        if (t.dead || t.team === fl.from.team) continue;
        if (Math.hypot(t.x - fl.x, t.y - fl.y) > fl.r + t.r) continue;
        C_().damage(world, fl.from, t, fl.dmg, { canCrit: false });
      }
    }

    /* 출혈 — 시간이 지나며 계속 아프다.
     * ⚠ 죽은 것·사라진 것을 붙들고 있으면 목록이 끝없이 길어진다. 함께 걷어낸다. */
    for (var bl = world.bleeds.length - 1; bl >= 0; bl--) {
      var bd = world.bleeds[bl];
      if (bd.who.dead || world.time >= bd.until) { world.bleeds.splice(bl, 1); continue; }
      if (world.time < bd.next) continue;
      bd.next = world.time + 0.5;
      C_().damage(world, bd.from, bd.who, bd.dmg, { canCrit: false });
    }

    /* 버프 만료 */
    var changed = false;
    for (var b = world.buffs.length - 1; b >= 0; b--)
      if (world.time >= world.buffs[b].until) { world.buffs.splice(b, 1); changed = true; }
    if (changed) world.refreshBuffs();
  }

  global.SKILLS = {
    STAM_MAX: STAM_MAX, STAM_REGEN: STAM_REGEN,
    LIST: SKILLS, byId: byId, resolve: resolve, why: why, cdLeft: cdLeft,
    use: use, tick: tick,
    /* 표가 스스로 어긋나지 않았는가 — 켤 때 한 번 본다 */
    audit: function () {
      var bad = [], seen = {};
      for (var i = 0; i < SKILLS.length; i++) {
        var s = SKILLS[i];
        if (seen[s.id]) bad.push("스킬 id 가 겹친다: " + s.id);
        seen[s.id] = 1;
        if (!s.syn || s.syn.length !== 3) bad.push(s.id + " 의 시너지가 3개가 아니다");
        var sy = {};
        for (var j = 0; j < (s.syn || []).length; j++) {
          if (sy[s.syn[j].id]) bad.push(s.id + " 의 시너지 id 가 겹친다: " + s.syn[j].id);
          sy[s.syn[j].id] = 1;
        }
        if (!(s.cd > 0)) bad.push(s.id + " 에 재사용 대기가 없다");
        /* ⚠ 시전이 0 인 스킬은 **피할 수 없다.** 즉발로 둘 수 있는 것은
         *   자기에게 거는 것(buff)과 이동(dash)뿐이다. */
        if (s.cast === 0 && s.kind !== "buff" && s.kind !== "dash")
          bad.push(s.id + " 이 시전 0 인데 남을 때린다 — 피할 방법이 없다");
        if (s.kind !== "buff" && !(s.mult > 0)) bad.push(s.id + " 에 위력(배수)이 없다");
        /* ⚠ 아이콘이 없으면 손잡이가 빈 칸으로 보인다 — 이름만 있고 그림이 없는 재주 */
        if (!s.icon) bad.push(s.id + " 에 아이콘이 없다");
      }
      return bad;
    }
  };
})(window);
