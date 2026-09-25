/* 자동장착 — 가방에 있는 것까지 함께 놓고 **가장 센 한 벌**을 찾는다.
 *
 * 일곱 칸을 하나하나 견주는 것이 힘들다는 말에서 나왔다. 그래서 여기서 고르는
 * 것은 물건이 아니라 **그것을 낀 몸**이다(견주기 화면과 같은 생각이다).
 *
 * ⚠ **접사마다 점수를 매기지 않는다.** "공격력 +5 는 3점" 같은 표를 두면
 *   ① 접사를 고칠 때 표가 따로 낡고
 *   ② 곱해지는 값(공격 속도 · 치명타)을 더하기로 셈해 반드시 틀린다.
 *   실측: 물건 값(val)으로 고르면 균형 기준의 참값보다 12% 낮았다.
 *   여기서는 `world.derive()` 가 준 **몸의 수치**로만 견준다. 셈은 한 곳이다.
 *
 * ⚠ **기준은 둘뿐이다(균형 · 공격). 생존 기준을 더하지 말 것.**
 *   열두 판(네 직업 × 씨앗 셋)을 재 보니 생존만 좇아도 생존은 균형보다
 *   **평균 2.1%**(최대 7.2%)밖에 안 늘었다. 열둘 중 다섯은 소수점까지 같았다.
 *   그 2% 를 얻으려고 공격을 **최대 89%** 버린다(도적: 1,466 → 159).
 *   균형 기준이 이미 생존을 거의 끝까지 뽑아낸다 — 따로 둘 값이 없다.
 *
 * ⚠ **금화 · 경험치 기준도 두지 않는다.** 그것은 `잠금`으로 푼다. 금화 반지를
 *   지키고 싶으면 그 칸을 잠그면 된다. 잠금 하나가 금화 · 경험치 · 아끼는
 *   세트 · 겉모습까지 다 덮는데, 기준을 넷으로 늘리면 고를 것만 늘고 그
 *   셋은 여전히 못 덮는다.
 */
(function (global) {
  "use strict";

  var KEYS = [
    { id: "mix", name: "균형", sub: "공격과 생존을 함께" },
    { id: "atk", name: "공격", sub: "초당 피해만" }
  ];

  /* 몸을 하나의 숫자로. ⚠ 균형은 **기하평균**이다. 더하기로 두면 단위가
   *   다른 둘(초당 피해 ~500 · 실효 체력 ~1,400)을 견주는 꼴이라 늘 큰 쪽만
   *   좇는다. 곱해서 제곱근을 씌우면 **비율**로 견주게 되어, 한쪽이 0 에
   *   가까워지는 한 벌이 저절로 밀려난다. */
  function scoreOf(world, eq, key) {
    var d = world.derive(eq);
    return key === "atk" ? d.dps : Math.sqrt(Math.max(0, d.dps) * Math.max(0, d.ehp));
  }

  function copy(eq) { var o = {}, k; for (k in eq) if (eq[k]) o[k] = eq[k]; return o; }

  /* 되풀이 탐욕 — 한 바퀴 돌아 **아무 칸도 안 바뀔 때까지** 되돈다.
   *
   * ⚠ 한 바퀴만 돌면 안 된다. 칸끼리 서로 값을 바꾸기 때문이다(세트 · 적성 ·
   *   치명타 피해는 무기가 무엇이냐에 따라 값이 달라진다). 실측: 한 바퀴만
   *   돌면 참값보다 12.0 ~ 17.9% 낮았고, 되돌리니 8/8 에서 완전 탐색과
   *   **같은 답**이 0ms 에 나왔다(완전 탐색은 2만~3만 갈래에 16~26ms).
   * ⚠ 되돌이 한도(12)는 안전장치다. 점수가 같은 두 한 벌이 서로를 부르면
   *   영영 도는데, `+1e-9` 문턱이 그것을 막지만 한도까지 둔다. */
  function climb(world, start, bySlot, slots, key) {
    var eq = copy(start), moved = true, laps = 0;
    while (moved && laps < 12) {
      moved = false; laps++;
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        var cur = eq[s] || null;
        var best = cur, bv = scoreOf(world, eq, key);
        /* ⚠ **그 칸을 비우는 것도 후보다.** 세트를 깨는 편이 나을 때가 있다 */
        if (cur) {
          var t0 = copy(eq); delete t0[s];
          var v0 = scoreOf(world, t0, key);
          if (v0 > bv + 1e-9) { bv = v0; best = null; }
        }
        var list = bySlot[s] || [];
        for (var j = 0; j < list.length; j++) {
          if (list[j].it === cur) continue;
          var t = copy(eq); t[s] = list[j].it;
          var v = scoreOf(world, t, key);
          if (v > bv + 1e-9) { bv = v; best = list[j].it; }
        }
        if (best !== cur) {
          if (best) eq[s] = best; else delete eq[s];
          moved = true;
        }
      }
    }
    return { eq: eq, v: scoreOf(world, eq, key), laps: laps };
  }

  /* 한 벌을 짠다. **입히지는 않는다** — 무엇이 달라지는지 돌려줄 뿐이다.
   *
   *   o.eq     지금 낀 것 (슬롯 → 물건)
   *   o.bag    가방 (푼 것)
   *   o.level  지금 레벨
   *   o.locks  { 슬롯: true } — 손대지 않을 칸
   *   o.key    "mix" | "atk"
   */
  function plan(world, o) {
    var I = global.ITEMS;
    o = o || {};
    var key = (o.key === "atk") ? "atk" : "mix";
    var eq = copy(o.eq || {});
    var bag = o.bag || [];
    var level = o.level || 1;
    var locks = o.locks || {};

    var slots = [], locked = [];
    for (var i = 0; i < I.SLOTS.length; i++) {
      if (locks[I.SLOTS[i]]) locked.push(I.SLOTS[i]);
      else slots.push(I.SLOTS[i]);
    }

    /* 후보 — 가방에서 **지금 낄 수 있는 것**만. 잠긴 칸 것은 아예 안 본다.
     * ⚠ 번호(where)를 함께 들고 다닌다. 나중에 가방에서 꺼낼 때 이름으로
     *   찾으면 같은 이름이 둘일 때 엉뚱한 것을 꺼낸다. */
    var bySlot = {}, later = 0, laterReq = 0;
    for (var b = 0; b < bag.length; b++) {
      var it = bag[b];
      if (!it || !it.slot) continue;
      if (locks[it.slot]) continue;
      if (!I.canEquip(it, level)) {
        later++;
        var rq = I.reqLevel(it);
        if (!laterReq || rq < laterReq) laterReq = rq;
        continue;
      }
      if (!bySlot[it.slot]) bySlot[it.slot] = [];
      bySlot[it.slot].push({ it: it, where: b });
    }

    /* 두 자리에서 올라간다.
     * ① 지금 낀 것에서 — 이러면 **결과가 지금보다 나쁠 수 없다**
     * ② 잠긴 칸만 남기고 맨바닥에서 — 지금 낀 것이 서로 발목을 잡는 경우가
     *    있어(세트 둘이 반씩 걸쳐 있을 때) 그 골을 빠져나온다
     * 둘 중 나은 것을 쓴다. derive 한 번이 1μs 남짓이라 두 번 올라도 싸다. */
    var bare = {};
    for (var li = 0; li < locked.length; li++)
      if (eq[locked[li]]) bare[locked[li]] = eq[locked[li]];

    var a = climb(world, eq, bySlot, slots, key);
    var c = climb(world, bare, bySlot, slots, key);
    var best = (c.v > a.v + 1e-9) ? c : a;

    /* 무엇이 달라지는가 */
    var changes = [];
    for (var si = 0; si < slots.length; si++) {
      var s = slots[si];
      var from = eq[s] || null, to = best.eq[s] || null;
      if (from === to) continue;
      var where = -1;
      var list = bySlot[s] || [];
      for (var wi = 0; wi < list.length; wi++) if (list[wi].it === to) { where = list[wi].where; break; }
      changes.push({ slot: s, from: from, to: to, where: where });
    }

    return {
      key: key,
      changes: changes,
      locked: locked,
      later: later, laterReq: laterReq,
      before: world.derive(eq),
      after: world.derive(best.eq),
      eq: best.eq,
      laps: Math.max(a.laps, c.laps),
      fromBare: best === c
    };
  }

  global.AUTOEQ = { KEYS: KEYS, plan: plan, scoreOf: scoreOf, climb: climb };
})(window);
