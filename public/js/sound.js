/* 효과음 — WebAudio 로 그 자리에서 합성한다. 음원 파일이 0개다.
 *
 * 도트 게임은 소리가 붙는 순간 체감이 크게 달라진다. 다만 음원 파일을 쓰면
 * 용량·요청·라이선스가 따라붙는다. 짧은 타격음 정도는 파형으로 만드는 편이 낫다.
 *
 * ⚠ 브라우저는 사용자가 한 번 조작하기 전에는 오디오를 재생하지 못한다(자동재생 차단).
 *   그래서 AudioContext 를 미리 만들지 않고 **첫 소리 요청 때** 만든다.
 * ⚠ 소리가 안 나는 환경(차단·미지원)에서도 게임은 그대로 돌아야 한다 — 전부 try 로 감싼다.
 */
(function (global) {
  "use strict";

  var ctx = null;
  var on = true;
  var failed = false;

  try {
    var saved = localStorage.getItem("rl_sound");
    if (saved === "0") on = false;
  } catch (e) { /* 저장이 막힌 브라우저 — 이번 판만 기본값으로 */ }

  function ac() {
    if (failed) return null;
    if (ctx) return ctx;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { failed = true; return null; }
      ctx = new AC();
    } catch (e) { failed = true; return null; }
    return ctx;
  }

  /* 한 음. type=파형 · f0→f1 로 미끄러지고 dur 초 동안 줄어든다. */
  function blip(type, f0, f1, dur, vol) {
    if (!on) return;
    var a = ac();
    if (!a) return;
    try {
      if (a.state === "suspended") a.resume();
      var t = a.currentTime;
      var osc = a.createOscillator();
      var g = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);   /* 딸깍 소리를 막는 짧은 상승 */
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(a.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch (e) { /* 재생 실패는 게임을 멈출 이유가 아니다 */ }
  }

  /* 잡음 — 타격·함정처럼 음정이 없는 소리 */
  function noise(dur, vol, cutoff) {
    if (!on) return;
    var a = ac();
    if (!a) return;
    try {
      if (a.state === "suspended") a.resume();
      var n = Math.floor(a.sampleRate * dur);
      var buf = a.createBuffer(1, n, a.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = a.createBufferSource();
      src.buffer = buf;
      var f = a.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cutoff || 1800;
      var g = a.createGain();
      g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(a.destination);
      src.start();
    } catch (e) {}
  }

  var SFX = {
    hit:     function () { noise(0.09, 0.16, 2600); blip("square", 180, 90, 0.07, 0.05); },
    hurt:    function () { noise(0.16, 0.20, 900);  blip("sawtooth", 150, 60, 0.16, 0.08); },
    kill:    function () { blip("square", 320, 90, 0.20, 0.07); noise(0.12, 0.14, 1400); },
    pickup:  function () { blip("triangle", 660, 990, 0.09, 0.07); },
    gold:    function () { blip("triangle", 880, 1320, 0.07, 0.06); blip("triangle", 1320, 1760, 0.09, 0.04); },
    potion:  function () { blip("sine", 440, 880, 0.18, 0.07); },
    bad:     function () { blip("sawtooth", 220, 70, 0.30, 0.09); },
    level:   function () { blip("triangle", 523, 523, 0.10, 0.07);
                           setTimeout(function () { blip("triangle", 659, 659, 0.10, 0.07); }, 95);
                           setTimeout(function () { blip("triangle", 784, 784, 0.18, 0.08); }, 190); },
    stairs:  function () { blip("sine", 300, 150, 0.26, 0.07); },
    ability: function () { blip("square", 520, 1040, 0.13, 0.07); noise(0.10, 0.10, 3000); },
    trap:    function () { noise(0.22, 0.22, 700); blip("sawtooth", 260, 80, 0.22, 0.08); },
    deny:    function () { blip("square", 160, 120, 0.09, 0.05); },
    die:     function () { blip("sawtooth", 260, 50, 0.85, 0.10); },
    win:     function () { [523, 659, 784, 1047].forEach(function (f, i) {
                             setTimeout(function () { blip("triangle", f, f, 0.22, 0.08); }, i * 130); }); }
  };

  global.SFX = {
    play: function (name) { var f = SFX[name]; if (f) f(); },
    isOn: function () { return on; },
    toggle: function () {
      on = !on;
      try { localStorage.setItem("rl_sound", on ? "1" : "0"); } catch (e) {}
      if (on) SFX.pickup();          /* 켠 순간 들려 줘야 켜졌는지 안다 */
      return on;
    }
  };
})(window);
