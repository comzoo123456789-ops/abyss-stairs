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

  /* ══════════════════════════════════════════════════════
     배경음 — 구역마다 다른 울림
     ══════════════════════════════════════════════════════

     구역마다 ① 바탕음(지속음) ② 드문드문 떨어지는 음 ③ 음계 가 다르다.
     내려갈수록 낮아지고 느려진다 — 숫자가 아니라 **귀로** 깊이가 느껴져야 한다.

     ⚠ 음계는 전부 **단조 계열**이다. 장조를 섞으면 그 층만 갑자기 밝아져
       "지하 10층" 이 아니라 마을처럼 들린다.
     ⚠ 크기는 효과음보다 **한참 아래**다(0.06~0.12). 배경음이 타격음을 덮으면
       무슨 일이 났는지 못 듣는다 — 그건 정보를 잃는 것이다. */

  /* ⚠ 크기는 **실측으로 정했다.** 처음 값(0.070~0.085)은 배경음 최대 진폭이
   *   0.19~0.24 로, 효과음 최대(0.13~0.55 · 중간값 0.23)와 **같은 수준**이었다.
   *   배경음이 타격음을 덮으면 무슨 일이 났는지 못 듣는다 — 그건 정보를 잃는 것이다.
   *   3분의 1 남짓으로 내렸다. 올리지 말 것(music-check 가 견준다). */
  var ZONE_MUSIC = {
    /* office  관리소 아래 — 아직 사람 손이 닿은 곳. 조금 따뜻하고 규칙적이다 */
    office:  { root: 110.00, scale: [0, 3, 5, 7, 10], drone: "sine",
               voice: "triangle", every: [3.4, 6.0], vol: 0.030, cut: 900, det: 4 },
    /* flood   물이 든 계단실 — 물방울처럼 높고 짧게 떨어진다 */
    flood:   { root: 98.00,  scale: [0, 2, 3, 7, 8],  drone: "sine",
               voice: "sine", every: [2.2, 4.6], vol: 0.028, cut: 1500, det: 7 },
    /* library 이름의 도서관 — 종이 넘기는 방. 음이 길게 끌린다 */
    library: { root: 87.31,  scale: [0, 2, 3, 5, 10], drone: "triangle",
               voice: "triangle", every: [4.0, 7.5], vol: 0.027, cut: 780, det: 5 },
    /* bones   뼈 무덤 — 메마르다. 반음이 섞여 불안하다 */
    bones:   { root: 82.41,  scale: [0, 1, 5, 6, 8],  drone: "sawtooth",
               voice: "square", every: [3.0, 6.5], vol: 0.025, cut: 620, det: 9 },
    /* lord    군주의 방 — 벽이 숨을 쉰다. 아주 낮고 아주 느리다 */
    lord:    { root: 69.30,  scale: [0, 1, 4, 6, 11], drone: "sawtooth",
               voice: "triangle", every: [4.5, 9.0], vol: 0.026, cut: 480, det: 12 }
  };

  var mus = null;      /* { zone, drone:[], lfo, gain, timer, next } */
  var musicOn = true;

  try {
    var savedM = localStorage.getItem("rl_music");
    if (savedM === "0") musicOn = false;
  } catch (e) { /* 저장이 막힌 브라우저 */ }

  function musicStop(fade) {
    if (!mus) return;
    var a = ctx, m = mus;
    mus = null;
    if (m.timer) clearInterval(m.timer);
    try {
      var t = a.currentTime;
      m.gain.gain.cancelScheduledValues(t);
      m.gain.gain.setValueAtTime(Math.max(0.0001, m.gain.gain.value), t);
      m.gain.gain.exponentialRampToValueAtTime(0.0001, t + (fade || 0.8));
      /* ⚠ 지속음을 **반드시 멈춘다.** 안 멈추면 층을 옮길 때마다 하나씩 쌓여
       *   10층쯤에서 다섯 겹이 울린다(소리는 작아도 CPU 는 계속 쓴다). */
      for (var i = 0; i < m.osc.length; i++) {
        try { m.osc[i].stop(t + (fade || 0.8) + 0.05); } catch (e) {}
      }
    } catch (e) {}
  }

  /* 한 음을 예약한다 — 뜯는 소리처럼 짧게 올라갔다 길게 사라진다 */
  function musicNote(a, dest, freq, at, dur, type, vol, cut) {
    var osc = a.createOscillator();
    var g = a.createGain();
    var lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cut;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(lp); lp.connect(g); g.connect(dest);
    osc.start(at);
    osc.stop(at + dur + 0.1);
  }

  /* 다음 몇 초치를 채운다. **느린 타이머**가 부른다 — 프레임마다 만들지 않는다. */
  function musicFill() {
    if (!mus || !ctx) return;
    var a = ctx, m = mus, cfg = m.cfg;
    var horizon = a.currentTime + 2.5;
    var guard = 0;
    while (m.next < horizon && guard++ < 12) {
      var deg = cfg.scale[Math.floor(Math.random() * cfg.scale.length)];
      /* 한 옥타브 위나 두 옥타브 위 — 바탕음과 안 겹치게 */
      var oct = Math.random() < 0.65 ? 4 : 8;
      var f = cfg.root * oct * Math.pow(2, deg / 12);
      var dur = 1.6 + Math.random() * 2.2;
      musicNote(a, m.gain, f, m.next, dur, cfg.voice, cfg.vol * 0.9, cfg.cut * 2.2);
      /* 가끔 5도 아래를 겹쳐 준다 — 두 음이 겹치면 방이 넓어진다 */
      if (Math.random() < 0.3) {
        musicNote(a, m.gain, f * 0.6674, m.next + 0.12, dur * 0.8,
                  cfg.voice, cfg.vol * 0.55, cfg.cut * 1.8);
      }
      m.next += cfg.every[0] + Math.random() * (cfg.every[1] - cfg.every[0]);
    }
  }

  /* 구역 음악을 시작한다. 이미 그 구역이면 아무 것도 안 한다. */
  function musicStart(zoneId) {
    if (!musicOn || !on) return false;
    var cfg = ZONE_MUSIC[zoneId];
    if (!cfg) return false;
    if (mus && mus.zone === zoneId) return true;     /* 같은 구역 — 그대로 둔다 */
    var a = ac();
    if (!a || !bus) return false;
    musicStop(0.9);
    try {
      if (a.state === "suspended") a.resume();
      var g = a.createGain();
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(1, a.currentTime + 1.6);   /* 스며들 듯 들어온다 */
      /* ⚠ 배경음도 **같은 줄기**를 탄다(dry+wet). 따로 destination 에 꽂으면
       *   compressor 를 안 거쳐 효과음과 합쳐질 때 찌그러진다. */
      g.connect(bus.dry);
      var w = a.createGain();
      w.gain.value = 0.5;
      g.connect(w); w.connect(bus.wet);

      /* 바탕음 — 살짝 어긋난 둘을 겹쳐 두께를 낸다 */
      var osc = [];
      var lp = a.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = cfg.cut;
      lp.connect(g);
      for (var i = 0; i < 2; i++) {
        var o = a.createOscillator();
        o.type = cfg.drone;
        o.frequency.value = cfg.root * (i === 0 ? 1 : 2);
        o.detune.value = (i === 0 ? -1 : 1) * cfg.det;
        var og = a.createGain();
        og.gain.value = i === 0 ? cfg.vol : cfg.vol * 0.45;
        o.connect(og); og.connect(lp);
        o.start();
        osc.push(o);
      }
      /* 아주 느린 숨 — 걸러내는 높이를 흔든다. 고정이면 "삐" 소리처럼 들린다 */
      var lfo = a.createOscillator();
      var lg = a.createGain();
      lfo.frequency.value = 0.05 + Math.random() * 0.04;
      lg.gain.value = cfg.cut * 0.35;
      lfo.connect(lg); lg.connect(lp.frequency);
      lfo.start();
      osc.push(lfo);

      mus = { zone: zoneId, cfg: cfg, gain: g, osc: osc, next: a.currentTime + 1.2, timer: 0 };
      musicFill();
      mus.timer = setInterval(musicFill, 500);
      return true;
    } catch (e) { return false; }
  }

  global.MUSIC = {
    /* 층이 바뀔 때 부른다. 같은 구역이면 아무 일도 안 일어난다. */
    zone: function (zoneId) { return musicStart(zoneId); },
    stop: function () { musicStop(0.6); },
    isOn: function () { return musicOn; },
    setOn: function (v) {
      musicOn = !!v;
      try { localStorage.setItem("rl_music", musicOn ? "1" : "0"); } catch (e) {}
      if (!musicOn) musicStop(0.5);
      return musicOn;
    },
    zones: function () { return Object.keys(ZONE_MUSIC); },
    /* 점검기 창구 — **틀지 않고 렌더해서** 잰다(효과음의 render 와 같은 뜻).
     * ⚠ 귀로 "괜찮네" 는 근거가 아니다. 구역마다 정말 다른지·찌그러지지 않는지·
     *   효과음을 덮지 않는지는 숫자로 나온다. */
    render: function (zoneId, seconds) {
      return new Promise(function (done, fail) {
        var cfg = ZONE_MUSIC[zoneId];
        if (!cfg) { fail(new Error("그런 구역이 없다: " + zoneId)); return; }
        var OAC = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (!OAC) { fail(new Error("OfflineAudioContext 가 없다")); return; }
        var sec = seconds || 6;
        var a = new OAC(2, Math.ceil(44100 * sec), 44100);
        var b = makeBus(a);
        var g = a.createGain();
        g.gain.value = 1;
        g.connect(b.dry);
        var lp = a.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = cfg.cut; lp.connect(g);
        for (var i = 0; i < 2; i++) {
          var o = a.createOscillator();
          o.type = cfg.drone;
          o.frequency.value = cfg.root * (i === 0 ? 1 : 2);
          o.detune.value = (i === 0 ? -1 : 1) * cfg.det;
          var og = a.createGain();
          og.gain.value = i === 0 ? cfg.vol : cfg.vol * 0.45;
          o.connect(og); og.connect(lp);
          o.start(0);
        }
        /* 음을 고르게 깔아 둔다 — 재는 것이므로 난수를 안 쓴다(매번 같은 값이어야 비교가 된다) */
        var t = 0.4, k = 0;
        while (t < sec - 0.5) {
          var deg = cfg.scale[k % cfg.scale.length];
          var f = cfg.root * 4 * Math.pow(2, deg / 12);
          musicNote(a, g, f, t, 1.8, cfg.voice, cfg.vol * 0.9, cfg.cut * 2.2);
          t += cfg.every[0]; k++;
        }
        a.startRendering().then(function (buf) {
          var peak = 0, sum = 0, n = 0, zc = 0;
          for (var c = 0; c < buf.numberOfChannels; c++) {
            var d = buf.getChannelData(c), prev = 0;
            for (var i2 = 0; i2 < d.length; i2++) {
              var x = Math.abs(d[i2]);
              if (x > peak) peak = x;
              sum += d[i2] * d[i2]; n++;
              if (x > 0.0008) {
                if (prev < 0 && d[i2] > 0) zc++;
                else if (prev > 0 && d[i2] < 0) zc++;
                prev = d[i2];
              }
            }
          }
          done({
            peak: Math.round(peak * 1000) / 1000,
            rms: Math.round(Math.sqrt(sum / Math.max(1, n)) * 10000) / 10000,
            zc: zc, root: cfg.root
          });
        }, fail);
      });
    }
  };

  global.SFX = {
    play: function (name) { return play(name); },
    names: function () { return Object.keys(VOICE); },
    isOn: function () { return on; },
    toggle: function () {
      on = !on;
      try { localStorage.setItem("rl_sound", on ? "1" : "0"); } catch (e) {}
      /* ⚠ 「소리 끔」인데 음악이 계속 나면 고장으로 느낀다 — 함께 멈춘다.
       *   다시 켤 때 음악을 되살리는 것은 부르는 쪽 몫이다(지금 구역을 알아야 한다). */
      if (!on && global.MUSIC) global.MUSIC.stop();
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
