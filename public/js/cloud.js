/* 계정 — 아이디와 비밀번호로 저장을 서버에 남긴다.
 *
 * ⚠ **게임은 지금처럼 localStorage 로 돈다.** 여기는 그 위에 얹은 사본이다.
 *   로그인 안 한 사람과 서버가 죽은 날에도 게임이 그대로 돌아야 한다 —
 *   이 순서를 뒤집으면 서버가 느린 날 게임이 멈춘다.
 * ⚠ 저장을 **덮어쓰지 않는다.** 올릴 때도 내릴 때도 **더 나아간 쪽**을 쓴다.
 *   시각으로 고르면 다른 기기에서 잠깐 새로 시작한 것이 더 최근이라
 *   키워 둔 것을 덮는다 — 그 사고를 이미 한 번 겪었다(2026-09-23).
 */
(function (global) {
  "use strict";

  var S = null;                 /* SAVE — 늦게 잡는다(스크립트 차례) */
  var state = { login: null, busy: false, last: 0, note: "" };
  var pushT = null;

  function save() { return S || (S = global.SAVE); }

  async function api(path, opt) {
    var res, body = null;
    try {
      res = await fetch(path, Object.assign({ credentials: "same-origin" }, opt || {}));
      body = await res.json();
    } catch (e) {
      /* ⚠ 서버가 안 되는 것을 **조용히 넘기지 않는다.** 로그인한 줄 알고
       *   계속 놀다가 아무것도 안 올라간 것을 나중에 아는 편이 훨씬 나쁘다. */
      return { ok: false, error: "서버에 닿지 못했습니다" };
    }
    if (!res.ok) return { ok: false, error: (body && body.error) || ("오류 " + res.status) };
    return Object.assign({ ok: true }, body);
  }

  /* 어느 쪽이 더 나아갔나 — 층 · 레벨 · 금화 차례. 서버의 셈과 **같은 식**이다. */
  function further(a, b) {
    if (!a) return b; if (!b) return a;
    if ((a.maxDepth || 1) !== (b.maxDepth || 1)) return (a.maxDepth || 1) > (b.maxDepth || 1) ? a : b;
    if ((a.level || 1) !== (b.level || 1)) return (a.level || 1) > (b.level || 1) ? a : b;
    return (a.gold || 0) >= (b.gold || 0) ? a : b;
  }

  /* 이 기기에 있는 직업 칸 전부를 날것 그대로 모은다.
   * ⚠ 다시 만들지 않는다 — localStorage 에 적힌 문자열을 그대로 올린다.
   *   손으로 다시 지으면 저장 판(version)과 어긋난다. */
  function localSaves() {
    var out = [], ls;
    try { ls = global.localStorage; } catch (e) { return out; }
    if (!ls || !save()) return out;
    var ids = (global.CLASSES && global.CLASSES.LIST)
      ? global.CLASSES.LIST.map(function (c) { return c.id; }) : [];
    for (var i = 0; i < ids.length; i++) {
      var txt = null;
      try { txt = ls.getItem(save().KEY + ":cls:" + ids[i]); } catch (e) {}
      if (!txt) continue;
      try { out.push(JSON.parse(txt)); } catch (e) {}
    }
    return out;
  }

  function putLocal(cls, wrapped) {
    var ls;
    try { ls = global.localStorage; } catch (e) { return false; }
    if (!ls || !save()) return false;
    try { ls.setItem(save().KEY + ":cls:" + cls, JSON.stringify(wrapped)); } catch (e) { return false; }
    return true;
  }

  function peek(w) {
    var d = w && (w.d || w);
    if (!d || !d.cls) return null;
    return { cls: d.cls, level: d.level || 1, maxDepth: d.maxDepth || 1, gold: d.gold || 0 };
  }

  /* ── 올리기 ── 저장할 때마다 부르되 **몰아서** 보낸다 */
  function schedulePush() {
    if (!state.login) return;
    if (pushT) clearTimeout(pushT);
    /* ⚠ 저장은 한 판에 수십 번 일어난다. 그때마다 보내면 D1 쓰기가 터진다. */
    pushT = setTimeout(function () { pushT = null; push(); }, 4000);
  }

  async function push() {
    if (!state.login) return { ok: false, error: "로그인이 필요합니다" };
    var list = localSaves();
    if (!list.length) return { ok: true, saved: [] };
    var r = await api("/api/save", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ saves: list })
    });
    if (r.ok) { state.last = Date.now(); paint(); }
    return r;
  }

  /* ── 내려받기 ── 서버와 이 기기 가운데 **더 나아간 쪽**을 남긴다 */
  async function pull() {
    if (!state.login) return { ok: false, error: "로그인이 필요합니다" };
    var r = await api("/api/load");
    if (!r.ok) return r;
    var took = [], kept = [];
    for (var i = 0; i < (r.saves || []).length; i++) {
      var row = r.saves[i], wrapped;
      try { wrapped = JSON.parse(row.data); } catch (e) { continue; }
      var cloud = peek(wrapped);
      if (!cloud) continue;
      var mine = null;
      var mineList = localSaves();
      for (var j = 0; j < mineList.length; j++) {
        var m = peek(mineList[j]);
        if (m && m.cls === cloud.cls) { mine = m; break; }
      }
      if (!mine || further(cloud, mine) === cloud) {
        if (putLocal(cloud.cls, wrapped)) took.push(cloud.cls + " Lv." + cloud.level);
      } else {
        kept.push(cloud.cls + " Lv." + mine.level);
      }
    }
    /* 이 기기에만 있는 것은 올려 준다 — 합집합이 남아야 한다 */
    await push();
    state.note = (took.length ? "내려받음 " + took.join(" · ") : "내려받을 것 없음") +
                 (kept.length ? " · 이 기기가 더 나아가 둠 " + kept.join(" · ") : "");
    paint();
    return { ok: true, took: took, kept: kept };
  }

  /* ── 화면 ────────────────────────────────────────── */
  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function paint() {
    var b = document.getElementById("btnAcct");
    if (b) {
      var lbl = b.querySelector(".t-lbl");
      if (lbl) lbl.textContent = state.login ? state.login : "계정";
      b.classList.toggle("is-on", !!state.login);
    }
    /* 차림표 항목에도 누구인지 적는다 — 휴대폰에서는 이것이 유일한 표시다 */
    var m = document.getElementById("mBtnAcct");
    if (m) {
      var t = m.querySelector("span:not(.ico)");
      if (t) t.textContent = state.login ? ("계정 · " + state.login) : "계정 · 저장 남기기";
      m.classList.toggle("is-on", !!state.login);
    }
    /* ⚠ **입력칸이 든 곳을 다시 그리면 친 글자가 날아간다.**
     *   `submit()` 이 "보내는 중" 을 적으려고 paint 를 부르는데, 그 한 번에
     *   아이디와 비밀번호가 지워져 **빈 값이 서버로 갔다** — 그래서 아무리
     *   제대로 쳐도 "아이디는 영문 소문자…" 가 떴다(사용자 신고).
     *   다시 그리기 전에 들고 있다가 되돌려 준다. 커서 자리까지. */
    var box = document.getElementById("acctBody");
    if (!box) return;
    var keep = {};
    ["acId", "acPw"].forEach(function (k) {
      var e = document.getElementById(k);
      if (e) keep[k] = { v: e.value, s: e.selectionStart, e: e.selectionEnd,
                         focus: document.activeElement === e };
    });
    box.innerHTML = bodyHtml();
    Object.keys(keep).forEach(function (k) {
      var e = document.getElementById(k);
      if (!e) return;
      e.value = keep[k].v;
      if (keep[k].focus) {
        e.focus();
        try { e.setSelectionRange(keep[k].s, keep[k].e); } catch (x) {}
      }
    });
  }

  function bodyHtml() {
    if (state.login) {
      return '<div class="ac-who">' + esc(state.login) + ' 으로 로그인됨</div>' +
        '<p class="ac-p">저장이 서버에도 남습니다. 다른 기기에서 같은 아이디로 들어오면 이어서 합니다.</p>' +
        (state.note ? '<div class="ac-note">' + esc(state.note) + '</div>' : '') +
        '<div class="ac-row">' +
          '<button class="btn-card-act equip" data-ac="pull">지금 맞추기</button>' +
          '<button class="btn-card-act cancel" data-ac="logout">나가기</button>' +
        '</div>' +
        '<p class="ac-warn">맞추기는 <b>더 나아간 쪽</b>을 남깁니다. 뒤로 가는 저장은 올라가지 않고, ' +
        '덮어쓰기 전의 것은 서버에 열 벌까지 남습니다.</p>';
    }
    return '<div class="ac-tabs">' +
        '<button class="fchip' + (state.mode === "signup" ? "" : " on") + '" data-ac="tab-login">로그인</button>' +
        '<button class="fchip' + (state.mode === "signup" ? " on" : "") + '" data-ac="tab-signup">계정 만들기</button>' +
      '</div>' +
      '<label class="ac-l">아이디<input class="bd-input" id="acId" autocomplete="username" ' +
        'placeholder="영문 소문자·숫자·밑줄 3~20자"></label>' +
      '<label class="ac-l">비밀번호<input class="bd-input" id="acPw" type="password" ' +
        'autocomplete="' + (state.mode === "signup" ? "new-password" : "current-password") + '" ' +
        'placeholder="여덟 자 이상"></label>' +
      (state.note ? '<div class="ac-err">' + esc(state.note) + '</div>' : '') +
      '<div class="ac-row">' +
        '<button class="btn-card-act equip" data-ac="' + (state.mode === "signup" ? "signup" : "login") + '">' +
        (state.mode === "signup" ? "계정 만들기" : "로그인") + '</button>' +
      '</div>' +
      '<p class="ac-warn">로그인하지 않아도 게임은 그대로 됩니다. 계정은 ' +
      '<b>저장을 서버에도 남기기 위한 것</b>입니다.</p>';
  }

  function open() {
    close();
    state.note = "";
    var ov = document.createElement("div");
    ov.id = "acctModal";
    ov.className = "item-modal-overlay";
    ov.innerHTML =
      '<div class="item-modal-card ac-card">' +
        '<button class="item-modal-close" data-ac="close" aria-label="닫기">×</button>' +
        '<div class="ac-head">계정</div>' +
        '<div id="acctBody"></div>' +
      '</div>';
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    ov.addEventListener("click", onClick);
    /* ⚠ 엔터로도 보낸다. 비밀번호 칸에서 엔터를 누르는 것이 기본 손짓이다 */
    ov.addEventListener("keydown", function (e) {
      /* ⚠ 칸에 커서를 둔 채로도 닫혀야 한다. app.js 가 글자 칸에서는 게임
       *   키를 안 먹지만 Esc 만은 넘겨 주므로, 여기서 받아 닫는다. */
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key !== "Enter") return;
      var t = e.target;
      if (t && (t.id === "acId" || t.id === "acPw")) {
        e.preventDefault();
        submit(state.mode === "signup" ? "signup" : "login");
      }
    });
    document.body.appendChild(ov);
    paint();
    var f = document.getElementById("acId");
    if (f) f.focus();
  }

  function close() {
    var old = document.getElementById("acctModal");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function onClick(e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-ac]") : null;
    if (!b) return;
    var a = b.getAttribute("data-ac");
    if (a === "close") return close();
    if (a === "tab-login") { state.mode = "login"; state.note = ""; return paint(); }
    if (a === "tab-signup") { state.mode = "signup"; state.note = ""; return paint(); }
    if (a === "login" || a === "signup") return submit(a);
    if (a === "logout") return doLogout();
    if (a === "pull") return doPull(b);
  }

  function val(id) { var e = document.getElementById(id); return e ? e.value : ""; }

  async function submit(kind) {
    if (state.busy) return;
    /* ⚠ **그리기 전에 읽는다.** paint 가 칸을 다시 만들므로, 뒤에서 읽으면
     *   방금 만들어진 빈 칸을 읽는다. 위의 되살리기와 **둘 다** 있어야 한다 —
     *   하나만으로는 차례가 조금만 바뀌어도 같은 일이 난다. */
    var login = val("acId"), pw = val("acPw");
    state.busy = true; state.note = "보내는 중…"; paint();
    var r = await api("/api/" + kind, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: login, pw: pw })
    });
    state.busy = false;
    if (!r.ok) { state.note = r.error; paint(); return; }
    state.login = r.login;
    state.note = "";
    paint();
    /* 들어오자마자 맞춘다 — 로그인해 놓고 아무 일도 안 일어나면 된 줄 모른다 */
    await doPull();
  }

  async function doLogout() {
    /* ⚠ 나가기 **전에 한 번 올린다.** 안 올리면 이 기기에서 방금 한 것이
     *   서버에 없는 채로 끝난다. */
    await push();
    await api("/api/logout", { method: "POST" });
    state.login = null;
    state.note = "나갔습니다. 이 기기의 저장은 그대로 있습니다.";
    paint();
  }

  async function doPull(btn) {
    if (btn) { btn.disabled = true; btn.textContent = "맞추는 중…"; }
    var r = await pull();
    if (!r.ok) state.note = r.error;
    paint();
  }

  /* ── 붙이기 ──────────────────────────────────────── */
  function boot() {
    var b = document.getElementById("btnAcct");
    if (b) b.addEventListener("click", open);

    /* 햄버거 차림표에서도 연다.
     * ⚠ 680px 아래에서는 위 줄 단추가 통째로 감춰진다 — 여기 없으면
     *   휴대폰에서 계정을 여는 길이 **하나도 없다**(사용자 신고).
     * ⚠ 열기 전에 차림표를 닫는다. 안 닫으면 계정 창 위에 차림표가
     *   그대로 남아 어느 것을 누르는지 알 수 없다.
     * ⚠ `touchstart` 도 받는다. 다른 항목은 app.js 의 bindTap 이 그렇게
     *   걸어 두었는데, 여기만 click 만 걸면 휴대폰에서 한 박자 늦는다. */
    var m = document.getElementById("mBtnAcct");
    if (m) {
      var tapped = 0;
      var onTap = function (e) {
        var now = Date.now();
        if (now - tapped < 350) { if (e && e.preventDefault) e.preventDefault(); return; }
        tapped = now;
        if (e && e.preventDefault && e.type === "touchstart") e.preventDefault();
        var drop = document.getElementById("mobileDropdown");
        if (drop) drop.classList.remove("open");
        open();
      };
      m.addEventListener("touchstart", onTap, { passive: false });
      m.addEventListener("click", onTap);
    }

    /* 저장할 때마다 몰아서 올린다.
     * ⚠ save.js 를 고치지 않고 **감싼다.** 저장을 부르는 곳이 스무 곳이 넘어
     *   거기마다 올리기를 적으면 반드시 빠뜨린다. */
    var SV = save();
    if (SV && !SV.__cloudWrapped) {
      var orig = SV.save;
      SV.save = function (s) { var r = orig.apply(SV, arguments); schedulePush(); return r; };
      SV.__cloudWrapped = true;
    }

    /* 창을 닫을 때 마지막 한 번 — 몰아 보내기가 아직 안 갔을 수 있다.
     * ⚠ keepalive 를 준다. 안 주면 탭이 닫히며 요청이 잘린다. */
    global.addEventListener("pagehide", function () {
      if (!state.login || !pushT) return;
      try {
        navigator.sendBeacon("/api/save",
          new Blob([JSON.stringify({ saves: localSaves() })], { type: "application/json" }));
      } catch (e) { /* 못 보내면 다음에 올라간다 */ }
    });

    api("/api/me").then(function (r) {
      if (r.ok && r.login) { state.login = r.login; paint(); }
      else paint();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.CLOUD = {
    open: open, close: close, push: push, pull: pull,
    state: function () { return { login: state.login, last: state.last, note: state.note }; }
  };
})(window);
