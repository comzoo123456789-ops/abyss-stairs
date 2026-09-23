/* 계정 — 아이디와 비밀번호, 그리고 세션.
 *
 * ⚠ 비밀번호를 **평문으로 저장하지 않는다.** PBKDF2 10만회 SHA-256 에
 *   계정마다 다른 소금. 옆 저장소에서 이미 굳힌 방식과 같은 값을 쓴다 —
 *   두 곳이 다른 세기를 쓰면 어느 쪽이 약한지 아무도 모른다.
 * ⚠ 세션 토큰은 **HttpOnly 쿠키**다. localStorage 에 두면 화면 스크립트가
 *   읽을 수 있고, 한 번 새면 비밀번호를 바꿔도 그 토큰이 계속 통한다.
 * ⚠ 실패 응답에 **무엇이 틀렸는지 담지 않는다.** "아이디는 맞다" 한 마디면
 *   아이디 사전을 만들 수 있다.
 */

const COOKIE = "as_sid";
const SESSION_DAYS = 90;          /* 게임이다. 자주 끊기면 그게 더 나쁘다 */

/* 옮겨 적기 쉬운 글자만 쓴다 — l·o·0·1 을 뺀다. save.js 의 규칙과 같다. */
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";

export function newId(n) {
  const a = new Uint8Array(n || 24);
  crypto.getRandomValues(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += ALPHA[a[i] % ALPHA.length];
  return s;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return hex(bits);
}

/* ⚠ **한 글자씩 같은 시간에** 견준다. `===` 로 견주면 앞자리부터 틀리는
 *   순간 돌아와, 걸린 시간으로 몇 자까지 맞았는지가 새어 나간다. */
export function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function normLogin(s) {
  return String(s || "").trim().toLowerCase();
}

/* 아이디는 영문 소문자·숫자·밑줄 3~20자.
 * ⚠ 한글을 받지 않는다. 대소문자와 자모 조합 때문에 "같은 아이디" 의 뜻이
 *   흐려지고, 다른 기기에서 옮겨 적기도 어렵다. */
export function badLogin(s) {
  if (!/^[a-z0-9_]{3,20}$/.test(s)) return "아이디는 영문 소문자·숫자·밑줄 3~20자입니다";
  return null;
}

/* ⚠ 여덟 자 아래는 받지 않는다. 게임이라도 비밀번호를 돌려 쓰는 사람이 있고,
 *   그 사람의 다른 곳까지 위험해진다. */
export function badPw(s) {
  if (typeof s !== "string" || s.length < 8) return "비밀번호는 여덟 자 이상이어야 합니다";
  if (s.length > 200) return "비밀번호가 너무 깁니다";
  return null;
}

/* ── 실패 세기 ──────────────────────────────────────────
 * ⚠ **IP 와 아이디를 둘 다** 센다. IP 만 세면 여러 곳에서 한 아이디를
 *   두드리는 것을 못 막고, 아이디만 세면 남의 아이디를 일부러 틀려
 *   그 사람을 잠글 수 있다. */
const FAIL_WINDOW = 10 * 60 * 1000;
const FAIL_MAX = 8;
const LOCK_MS = 15 * 60 * 1000;

export async function locked(db, keys) {
  const now = Date.now();
  for (const k of keys) {
    const r = await db.prepare(
      "SELECT COUNT(*) AS n FROM auth_fail WHERE k = ? AND at > ?"
    ).bind(k, now - FAIL_WINDOW).first();
    if (r && r.n >= FAIL_MAX) return true;
  }
  return false;
}

export async function noteFail(db, keys) {
  const now = Date.now();
  const st = [];
  for (const k of keys)
    st.push(db.prepare("INSERT INTO auth_fail (k, at) VALUES (?, ?)").bind(k, now));
  /* 오래된 것은 치운다 — 안 치우면 표가 끝없이 자란다 */
  st.push(db.prepare("DELETE FROM auth_fail WHERE at < ?").bind(now - LOCK_MS * 4));
  await db.batch(st);
}

export async function clearFail(db, keys) {
  const st = keys.map((k) => db.prepare("DELETE FROM auth_fail WHERE k = ?").bind(k));
  if (st.length) await db.batch(st);
}

/* ── 세션 ──────────────────────────────────────────── */
export async function makeSession(db, playerId) {
  const token = newId(32);
  const now = Date.now();
  const exp = now + SESSION_DAYS * 86400000;
  await db.batch([
    db.prepare("INSERT INTO sessions (token, player_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(token, playerId, now, exp),
    /* 만료된 것은 발급할 때 함께 치운다 — 따로 도는 청소를 두지 않는다 */
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now)
  ]);
  return token;
}

export function cookieOf(token) {
  /* ⚠ `Secure` 를 빼지 말 것. 빼면 평문으로도 쿠키가 오가 중간에서 훔친다.
   * ⚠ `SameSite=Lax` 는 남의 사이트가 우리 API 를 대신 부르는 것을 막는다. */
  return COOKIE + "=" + token +
    "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + (SESSION_DAYS * 86400);
}

export function killCookie() {
  return COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function tokenOf(req) {
  const raw = req.headers.get("Cookie") || "";
  const m = raw.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([A-Za-z0-9]+)"));
  return m ? m[1] : null;
}

/* 지금 누구인가. 모르면 null — **부르는 쪽이 반드시 확인한다.** */
export async function who(db, req) {
  const t = tokenOf(req);
  if (!t) return null;
  const r = await db.prepare(
    "SELECT s.player_id AS id, s.expires_at AS exp, p.login AS login" +
    " FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?"
  ).bind(t).first();
  if (!r) return null;
  if (r.exp < Date.now()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(t).run();
    return null;
  }
  return { id: r.id, login: r.login, token: t };
}
