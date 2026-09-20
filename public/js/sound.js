/* 효과음 — WebAudio 로 그 자리에서 합성한다. 음원 파일이 0개다.
 *
 * 도트 게임은 소리가 붙는 순간 체감이 크게 달라진다. 다만 음원 파일을 쓰면
 * 용량·요청·라이선스가 따라붙는다. 짧은 타격음 정도는 파형으로 만드는 편이 낫다.
 *
 * ── 왜 다시 짰는가 ──────────────────────────────────
 * 옛 판은 소리 하나가 **오실레이터 한 개 + 흰 잡음 한 겹**이었고, 모두
 * `destination` 에 바로 꽂혔다. 그래서 셋이 겹치면 진폭이 그냥 더해져 찌그러졌고,
 * 매번 **완전히 똑같은 파형**이라 열 번만 들어도 귀가 지쳤다. 울림이 없어
 * 던전이 아니라 계산기 소리였다.
 *
 * 바꾼 것 넷.
 *   1. **한 줄기로 모은다** — 모든 소리가 master(gain) → compressor →
 *      destination 을 지난다. 여러 개가 겹쳐도 안 찌그러진다.
 *   2. **울림을 준다** — 짧은 임펄스를 만들어 convolver 로 보낸다. 돌방에서
 *      나는 소리가 된다. 파일은 여전히 0개다.
 *   3. **매번 조금씩 다르다** — 음정과 시간을 살짝 흔든다. 같은 소리를
 *      스무 번 들어도 안 지친다.
 *   4. **층을 쌓는다** — 타격은 「때린 순간(잡음) + 몸통(저음) + 꼬리」 처럼
 *      셋을 겹친다. 한 겹짜리는 얇게 들린다.
 *
 * ⚠ **게임 난수(this.rng)를 쓰지 않는다.** 같은 씨앗이 같은 판이어야 한다.
 *   소리의 흔들림은 `Math.random` 으로 만든다 — 규칙에 닿지 않는다.
 * ⚠ 브라우저는 사용자가 한 번 조작하기 전에는 오디오를 재생하지 못한다
 *   (자동재생 차단). 그래서 AudioContext 를 **첫 소리 요청 때** 만든다.
 * ⚠ 소리가 안 나는 환경(차단·미지원)에서도 게임은 그대로 돌아야 한다 —
 *   전부 try 로 감싼다.
 */
(function (global) {
  "use strict";

  var ctx = null;
  var on = true;
  var failed = false;
  var bus = null;                    /* { master, dry, wet } */

  try {
    var saved = localStorage.getItem("rl_sound");
    if (saved === "0") on = false;
  } catch (e) { /* 저장이 막힌 브라우저 — 이번 판만 기본값으로 */ }

  /* 돌방 울림. 짧게 감쇠하는 잡음을 임펄스로 쓴다.
   *
   * ⚠ 길게 주면 안 된다. 턴제라 소리가 촘촘히 나는데 꼬리가 길면 서로 겹쳐
   *   웅웅거린다. 0.28초면 "돌벽" 으로 들리면서 다음 소리를 안 먹는다.
   * ⚠ **씨앗 난수로 만든다.** 처음엔 `Math.random` 을 썼는데 그러면 방 울림이
   *   띄울 때마다 달라진다 — 같은 던전인데 소리 나는 공간이 바뀐다.
   *   게다가 그 흔들림이 다른 것을 가린다: 음정 흔들림을 끄고 재는 대조군이
   *   **그냥 통과했다.** 울림이 매번 달라서 값이 계속 바뀌었기 때문이다.
   *   방은 고정, 흔들리는 것은 소리 자체뿐이어야 한다. */
  function makeImpulse(a, sec, decay) {
    var n = Math.max(1, Math.floor(a.sampleRate * sec));
    var buf = a.createBuffer(2, n, a.sampleRate);
    var seed = 20260921;
    function rnd() {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed / 4294967296;
    }
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) {
        var t = i / n;
        d[i] = (rnd() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  /* 한 줄기를 세운다. 모든 소리가 여기로 모인다. */
  function makeBus(a) {
    var master = a.createGain();
    /* ⚠ 실측으로 소리 하나의 최대가 0.014~0.205 였다 — 여유가 다섯 배
     *   남아 있었다. 크기를 올리되 **compressor 가 받아 주는 선**까지만
     *   간다. 겹쳤을 때 1.0 을 넘는지는 검사가 따로 잰다. */
    master.gain.value = 1.0;

    /* ⚠ compressor 가 **찌그러짐을 막는 핵심**이다. 예전에는 소리 셋이 겹치면
     *   진폭이 그냥 더해져 1.0 을 넘었다. */
    var comp = a.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;

    var dry = a.createGain();
    dry.gain.value = 1;

    var wet = a.createGain();
    wet.gain.value = 0.22;           /* 울림은 **거들 뿐**이다. 크게 주면 뭉갠다 */
    var conv = a.createConvolver();
    conv.buffer = makeImpulse(a, 0.28, 3.2);

    dry.connect(master);
    wet.connect(conv); conv.connect(master);
    master.connect(comp);
    comp.connect(a.destination);
    return { master: master, dry: dry, wet: wet };
  }

  function ac() {
    if (failed) return null;
    if (ctx) return ctx;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { failed = true; return null; }
      ctx = new AC();
      bus = makeBus(ctx);
    } catch (e) { failed = true; return null; }
    return ctx;
  }

  /* 소리를 만드는 두 벌. 둘 다 **어느 context 에나** 붙을 수 있게 짠다 —
   * 점검기가 OfflineAudioContext 로 렌더해서 진폭을 재기 때문이다. */

  /* 음정이 있는 한 겹.
   *   o.type   파형        o.f0/o.f1  시작·끝 주파수
   *   o.at     시작 시각    o.dur      길이
   *   o.vol    크기        o.cut      저역통과(없으면 안 건다)
   *   o.send   울림으로 보내는 양(0~1)
   * ⚠ 0 으로 시작해 exponentialRamp 를 걸면 안 된다 — 0 은 지수 곡선에
   *   못 들어간다. 0.0001 에서 올린다(딸깍 소리도 같이 막힌다). */
  function tone(a, out, o) {
    var t = (o.at || 0) + a.currentTime * (out.live ? 1 : 0);
    var osc = a.createOscillator();
    var g = a.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    var node = osc;
    if (o.cut) {
      var f = a.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(o.cut, t);
      osc.connect(f); node = f;
    }
    var atk = o.atk || 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    node.connect(g);
    g.connect(out.dry);
    if (o.send) {
      var s = a.createGain();
      s.gain.value = o.send;
      g.connect(s); s.connect(out.wet);
    }
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  /* 음정이 없는 한 겹(때린 순간·바람·쇠).
   *   o.cut 저역통과 · o.peak 대역강조(없으면 안 건다) · o.curve 감쇠 모양 */
  function hiss(a, out, o) {
    var t = (o.at || 0) + a.currentTime * (out.live ? 1 : 0);
    var n = Math.max(1, Math.floor(a.sampleRate * o.dur));
    var buf = a.createBuffer(1, n, a.sampleRate);
    var d = buf.getChannelData(0);
    var curve = o.curve || 1;
    for (var i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, curve);
    }
    var src = a.createBufferSource();
    src.buffer = buf;
    var node = src;
    if (o.peak) {
      var bp = a.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(o.peak, t);
      bp.Q.value = o.q || 1.2;
      node.connect(bp); node = bp;
    }
    if (o.cut) {
      var lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(o.cut, t);
      node.connect(lp); node = lp;
    }
    var g = a.createGain();
    g.gain.setValueAtTime(o.vol, t);
    node.connect(g);
    g.connect(out.dry);
    if (o.send) {
      var s = a.createGain();
      s.gain.value = o.send;
      g.connect(s); s.connect(out.wet);
    }
    src.start(t);
  }

  /* 흔들기 — **소리용 난수다.** 게임 난수를 쓰지 않는다(씨앗이 어긋난다). */
  function wob(amount) { return 1 + (Math.random() * 2 - 1) * amount; }

  /* ══ 소리표 ═══════════════════════════════════════════
   *
   * 한 줄에 한 겹이 아니라 **겹을 쌓는다.** 타격을 예로 들면
   *   때린 순간(짧은 잡음) + 몸통(내려가는 저음) + 쇠 울림(높은 잡음)
   * 셋이 20ms 안에 겹쳐야 "맞았다" 로 들린다. 한 겹은 얇다.
   *
   * ⚠ `deny` 가 **제일 자주 나는 소리다**(부르는 곳 25군데). 거슬리면
   *   게임 전체가 거슬린다. 짧고 낮고 작게 — 귀를 찌르지 않게 둔다.
   */
  var VOICE = {
    /* 때렸다 — 살을 치는 둔탁함 + 쇠 */
    hit: function (a, out) {
      var w = wob(0.06);
      hiss(a, out, { dur: 0.045, vol: 0.78, peak: 2100 * w, q: 0.9, curve: 2.4, send: 0.3 });
      tone(a, out, { type: "triangle", f0: 210 * w, f1: 74, dur: 0.11, vol: 0.572, cut: 1400, send: 0.25 });
      tone(a, out, { type: "square", f0: 900 * w, f1: 420, dur: 0.035, vol: 0.13, at: 0.004 });
    },
    /* 치명타 — 때린 소리에 **금속성 한 겹**을 더 얹는다.
     * ⚠ 예전에는 치명타가 `ability`(스킬 소리)를 냈다. 주문을 외운 것처럼
     *   들려서 무엇이 일어났는지 귀로는 못 갈랐다. */
    crit: function (a, out) {
      var w = wob(0.05);
      hiss(a, out, { dur: 0.05, vol: 0.884, peak: 2800 * w, q: 0.8, curve: 2.2, send: 0.35 });
      tone(a, out, { type: "triangle", f0: 250 * w, f1: 70, dur: 0.16, vol: 0.676, cut: 1600, send: 0.3 });
      tone(a, out, { type: "square", f0: 1560 * w, f1: 980, dur: 0.16, vol: 0.182, at: 0.003, send: 0.4 });
      tone(a, out, { type: "sine", f0: 2340 * w, f1: 1470, dur: 0.22, vol: 0.13, at: 0.003, send: 0.5 });
    },
    /* 맞았다 — 낮고 둔하게. 내 몸에서 나는 소리라 울림을 적게 준다 */
    hurt: function (a, out) {
      var w = wob(0.07);
      hiss(a, out, { dur: 0.13, vol: 0.676, cut: 700, curve: 1.4, send: 0.15 });
      tone(a, out, { type: "sawtooth", f0: 150 * w, f1: 56, dur: 0.20, vol: 0.52, cut: 900, send: 0.15 });
    },
    /* 쓰러뜨렸다 — 무너지는 느낌. 저음이 아래로 길게 빠진다 */
    kill: function (a, out) {
      var w = wob(0.05);
      hiss(a, out, { dur: 0.10, vol: 0.624, cut: 1200, curve: 1.8, send: 0.35 });
      tone(a, out, { type: "triangle", f0: 300 * w, f1: 62, dur: 0.30, vol: 0.52, cut: 1100, send: 0.4 });
      tone(a, out, { type: "sine", f0: 150 * w, f1: 44, dur: 0.38, vol: 0.312, at: 0.02, send: 0.45 });
    },
    /* 주웠다 — 짧고 맑게 두 음. 손에 들어온 느낌 */
    pickup: function (a, out) {
      var w = wob(0.02);
      tone(a, out, { type: "triangle", f0: 720 * w, f1: 720 * w, dur: 0.055, vol: 0.338, send: 0.3 });
      tone(a, out, { type: "triangle", f0: 1080 * w, f1: 1080 * w, dur: 0.085, vol: 0.286, at: 0.052, send: 0.4 });
    },
    /* 금화 — 여러 닢이 부딪는 소리. 짧은 음 셋을 어긋나게 겹친다 */
    gold: function (a, out) {
      /* ⚠ 실측 45ms 로 너무 짧아 "딱" 한 번으로 끝났다. 닢이 여럿 떨어지는
       *   소리는 **어긋나게** 겹쳐야 여러 닢으로 들린다. */
      for (var i = 0; i < 4; i++) {
        var w = wob(0.06);
        tone(a, out, {
          type: "triangle", f0: (1150 + i * 240) * w, f1: (1150 + i * 240) * w,
          dur: 0.09, vol: 0.20 - i * 0.035, at: i * 0.035, send: 0.5
        });
      }
      hiss(a, out, { dur: 0.06, vol: 0.14, peak: 5200, q: 2.5, curve: 2, send: 0.5 });
    },
    /* 물약 — 꿀꺽. 낮은 데서 올라오는 한 음 + 병 소리 */
    potion: function (a, out) {
      var w = wob(0.03);
      tone(a, out, { type: "sine", f0: 300 * w, f1: 760 * w, dur: 0.22, vol: 0.364, send: 0.3 });
      tone(a, out, { type: "sine", f0: 620 * w, f1: 300, dur: 0.10, vol: 0.156, at: 0.14, send: 0.35 });
    },
    /* 나쁜 일 — 아래로 꺼진다 */
    bad: function (a, out) {
      tone(a, out, { type: "sawtooth", f0: 240, f1: 62, dur: 0.34, vol: 0.416, cut: 1200, send: 0.3 });
      hiss(a, out, { dur: 0.16, vol: 0.26, cut: 500, curve: 1.2, send: 0.3 });
    },
    /* 레벨업 — 셋째 음을 길게. setTimeout 대신 **시각을 미리 잡는다**
     * ⚠ setTimeout 으로 이어 붙이면 탭이 바쁠 때 박자가 흐트러진다. */
    level: function (a, out) {
      [[523, 0, 0.10], [659, 0.095, 0.10], [784, 0.19, 0.30]].forEach(function (n) {
        tone(a, out, { type: "triangle", f0: n[0], f1: n[0], dur: n[2], vol: 0.338, at: n[1], send: 0.5 });
        tone(a, out, { type: "sine", f0: n[0] * 2, f1: n[0] * 2, dur: n[2] * 0.7, vol: 0.13, at: n[1], send: 0.6 });
      });
    },
    /* 계단 — 아래로 내려간다. 울림을 크게 줘서 공간이 바뀐 느낌 */
    stairs: function (a, out) {
      tone(a, out, { type: "sine", f0: 340, f1: 120, dur: 0.34, vol: 0.39, send: 0.7 });
      tone(a, out, { type: "triangle", f0: 170, f1: 60, dur: 0.44, vol: 0.234, at: 0.05, send: 0.7 });
      hiss(a, out, { dur: 0.22, vol: 0.156, cut: 900, curve: 1, send: 0.6, at: 0.02 });
    },
    /* 스킬 — 바람이 지나가고 끝에 찍는다 */
    ability: function (a, out) {
      var w = wob(0.04);
      hiss(a, out, { dur: 0.16, vol: 0.416, peak: 1500, q: 0.7, curve: 0.6, send: 0.4 });
      tone(a, out, { type: "square", f0: 420 * w, f1: 1180 * w, dur: 0.14, vol: 0.26, cut: 2600, send: 0.35 });
      tone(a, out, { type: "triangle", f0: 1180 * w, f1: 700, dur: 0.10, vol: 0.208, at: 0.13, send: 0.5 });
    },
    /* 함정 — 쇠가 튀는 딱 소리 + 낮은 울림 */
    trap: function (a, out) {
      hiss(a, out, { dur: 0.03, vol: 0.95, peak: 3400, q: 1.6, curve: 3, send: 0.4 });
      tone(a, out, { type: "sawtooth", f0: 280, f1: 74, dur: 0.26, vol: 0.468, cut: 1100, send: 0.4 });
      hiss(a, out, { dur: 0.20, vol: 0.26, cut: 600, curve: 1.2, at: 0.02, send: 0.4 });
    },
    /* 안 된다 — **제일 자주 나는 소리다**(25군데).
     * ⚠ 짧고 낮고 작게. 옛 판은 square 160Hz 라 귀를 찔렀고, 하루에 수백 번
     *   들으면 그 소리 하나로 게임이 싫어진다. 울림도 거의 안 준다 — 울리면
     *   길게 남아 다음 조작과 겹친다. */
    deny: function (a, out) {
      /* 실측 0.014 는 사실상 안 들렸다. 0.09 언저리가 "짧게 툭" 이다 */
      tone(a, out, { type: "sine", f0: 190, f1: 150, dur: 0.06, vol: 0.20, cut: 800, send: 0.05 });
      tone(a, out, { type: "sine", f0: 150, f1: 130, dur: 0.05, vol: 0.10, at: 0.05, cut: 700, send: 0.05 });
    },
    /* 죽었다 — 길게 꺼진다 */
    die: function (a, out) {
      tone(a, out, { type: "sawtooth", f0: 240, f1: 42, dur: 0.9, vol: 0.468, cut: 1000, send: 0.6 });
      tone(a, out, { type: "sine", f0: 120, f1: 32, dur: 1.2, vol: 0.312, at: 0.1, send: 0.7 });
      hiss(a, out, { dur: 0.5, vol: 0.182, cut: 420, curve: 0.8, at: 0.05, send: 0.6 });
    },
    /* 이겼다 — 올라가는 네 음 */
    win: function (a, out) {
      [523, 659, 784, 1047].forEach(function (f, i) {
        tone(a, out, { type: "triangle", f0: f, f1: f, dur: 0.30, vol: 0.364, at: i * 0.13, send: 0.6 });
        tone(a, out, { type: "sine", f0: f * 2, f1: f * 2, dur: 0.22, vol: 0.13, at: i * 0.13, send: 0.7 });
      });
    }
  };

  /* 옛 이름 — 어디선가 이 이름으로 부르면 조용히 아무 일도 안 일어난다.
   * ⚠ `sfx("levelup")` 이 실제로 그랬다(제단에서 부른다). 표에는 `level`
   *   뿐이라 **제단 소리가 안 났다.** 부르는 쪽을 고치고, 여기에도 남겨 둔다. */
  VOICE.levelup = VOICE.level;

  function play(name) {
    if (!on) return false;
    var a = ac();
    if (!a) return false;
    var v = VOICE[name];
    if (!v) return false;
    try {
      if (a.state === "suspended") a.resume();
      v(a, { dry: bus.dry, wet: bus.wet, live: true });
      return true;
    } catch (e) { return false; }   /* 재생 실패는 게임을 멈출 이유가 아니다 */
  }

  global.SFX = {
    play: function (name) { return play(name); },
    names: function () { return Object.keys(VOICE); },
    isOn: function () { return on; },
    toggle: function () {
      on = !on;
      try { localStorage.setItem("rl_sound", on ? "1" : "0"); } catch (e) {}
      if (on) play("pickup");        /* 켠 순간 들려 줘야 켜졌는지 안다 */
      return on;
    },
    /* 점검기 창구 — 소리를 **틀지 않고 렌더해서** 잰다.
     *
     * ⚠ 귀로 "괜찮네" 는 근거가 아니다. 찌그러짐(1.0 을 넘는가)·크기·길이는
     *   숫자로 나온다. OfflineAudioContext 는 실제 재생 없이 그 숫자를 준다.
     * ⚠ 여기서 만드는 줄기는 재생용과 **같은 makeBus** 다. 두 벌로 만들면
     *   재는 것과 들리는 것이 달라진다. */
    render: function (name, seconds) {
      return new Promise(function (done, fail) {
        /* 이름을 쉼표로 여럿 주면 **한꺼번에** 울린다 — 겹쳤을 때 찌그러지는지
         * 재려면 이게 필요하다. 실제로 싸움 중에는 셋넷이 같이 난다. */
        var many = String(name).split(",");
        var vs = [];
        for (var mi = 0; mi < many.length; mi++) {
          if (!VOICE[many[mi]]) { fail(new Error("그런 소리가 없다: " + many[mi])); return; }
          vs.push(VOICE[many[mi]]);
        }
        var v = function (a, out) { for (var k = 0; k < vs.length; k++) vs[k](a, out); };
        var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (!OAC) { fail(new Error("OfflineAudioContext 가 없다")); return; }
        var sec = seconds || 2;
        var a = new OAC(2, Math.ceil(44100 * sec), 44100);
        var b = makeBus(a);
        v(a, { dry: b.dry, wet: b.wet, live: false });
        a.startRendering().then(function (buf) {
          var peak = 0, sum = 0, n = 0, lastLoud = 0, zc = 0;
          for (var c = 0; c < buf.numberOfChannels; c++) {
            var d = buf.getChannelData(c);
            var prev = 0;
            for (var i = 0; i < d.length; i++) {
              var x = Math.abs(d[i]);
              if (x > peak) peak = x;
              if (x > 0.002 && i > lastLoud) lastLoud = i;
              sum += d[i] * d[i]; n++;
              /* 영점 교차 — **음정이 바뀌면 여기가 바뀐다.** 크기(실효값)는
               * 음정이 흔들려도 거의 그대로라 변화를 못 잡는다. */
              if (x > 0.0008) {
                if (prev < 0 && d[i] > 0) zc++;
                else if (prev > 0 && d[i] < 0) zc++;
                prev = d[i];
              }
            }
          }
          done({
            peak: Math.round(peak * 1000) / 1000,
            rms: Math.round(Math.sqrt(sum / Math.max(1, n)) * 1000) / 1000,
            ms: Math.round(lastLoud / buf.sampleRate * 1000),
            zc: zc
          });
        }, fail);
      });
    }
  };
})(window);
