/* Worker 진입 — 정적 파일은 그대로 내주고 `/api/*` 만 우리가 받는다.
 *
 * ⚠ **서버는 사본이지 진실원이 아니다.** 게임은 지금처럼 localStorage 로
 *   돈다. 로그인하면 그 위에 올리고 내릴 뿐이라, 로그인 안 한 사람과
 *   서버가 죽은 날에도 게임이 그대로 돈다. 이 순서를 뒤집지 말 것.
 * ⚠ `/api/` 가 아닌 모든 것은 **한 줄에서** 자산으로 넘긴다. 문마다 따로
 *   판단하면 새 파일을 더할 때 빠뜨린다.
 */
import {
  newId, hashPw, sameHash, normLogin, badLogin, badPw,
  locked, noteFail, clearFail, makeSession, cookieOf, killCookie, who
} from "./auth.js";

const JSONH = { "content-type": "application/json; charset=utf-8" };

function ok(body, extra) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...JSONH, ...(extra || {}) } });
}
function bad(status, code, extra) {
  return new Response(JSON.stringify({ error: code }), { status, headers: { ...JSONH, ...(extra || {}) } });
}

async function readJson(req, limit) {
  const t = await req.text();
  if (t.length > (limit || 200000)) return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

function ipOf(req) {
  return req.headers.get("CF-Connecting-IP") || "0.0.0.0";
}

/* 저장 한 벌에서 **서버가 아는 만큼만** 뽑는다.
 * ⚠ 게임 규칙을 서버에서 다시 검사하지 않는다. 그러려면 규칙을 두 벌 적어야
 *   하고, 두 벌은 반드시 어긋난다. 서버는 크기와 모양만 본다. */
function peek(d) {
  if (!d || typeof d !== "object") return null;
  const cls = String(d.cls || "");
  if (!/^[a-z]{3,16}$/.test(cls)) return null;
  return {
    cls,
    level: Math.max(1, Math.min(9999, Number(d.level) || 1)),
    maxDepth: Math.max(1, Math.min(9999, Number(d.maxDepth) || 1)),
    gold: Math.max(0, Math.min(1e12, Number(d.gold) || 0))
  };
}

/* 어느 쪽이 더 나아갔나 — 층 · 레벨 · 금화 차례로 본다.
 * ⚠ 시각(updated_at)으로 고르지 않는다. 다른 기기에서 잠깐 새로 시작한 것이
 *   **더 최근**이라 키워 둔 것을 덮는다. 그 사고를 이미 한 번 겪었다. */
function further(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.maxDepth !== b.maxDepth) return a.maxDepth > b.maxDepth ? a : b;
  if (a.level !== b.level) return a.level > b.level ? a : b;
  return (a.gold || 0) >= (b.gold || 0) ? a : b;
}

const LOG_KEEP = 10;

async function putSave(db, pid, row, raw) {
  const now = Date.now();
  const st = [];
  /* ⚠ 덮어쓰기 **전의 것**을 이력에 남긴다. 되돌릴 자리가 없던 것이
   *   여태 사고의 진짜 원인이었다. */
  const old = await db.prepare(
    "SELECT data, level FROM saves WHERE player_id = ? AND cls = ?"
  ).bind(pid, row.cls).first();
  if (old) {
    st.push(db.prepare(
      "INSERT INTO save_log (player_id, cls, data, level, at) VALUES (?, ?, ?, ?, ?)"
    ).bind(pid, row.cls, old.data, old.level, now));
    st.push(db.prepare(
      "DELETE FROM save_log WHERE player_id = ? AND cls = ? AND id NOT IN" +
      " (SELECT id FROM save_log WHERE player_id = ? AND cls = ? ORDER BY at DESC LIMIT ?)"
    ).bind(pid, row.cls, pid, row.cls, LOG_KEEP));
  }
  st.push(db.prepare(
    "INSERT INTO saves (player_id, cls, data, level, max_depth, gold, updated_at)" +
    " VALUES (?, ?, ?, ?, ?, ?, ?)" +
    " ON CONFLICT(player_id, cls) DO UPDATE SET" +
    " data = excluded.data, level = excluded.level, max_depth = excluded.max_depth," +
    " gold = excluded.gold, updated_at = excluded.updated_at"
  ).bind(pid, row.cls, raw, row.level, row.maxDepth, row.gold, now));
  await db.batch(st);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);

    const db = env.DB;
    if (!db) return bad(500, "no_db");

    try {
      /* ── 지금 누구인가 ── */
      if (p === "/api/me" && req.method === "GET") {
        const u = await who(db, req);
        if (!u) return ok({ login: null });
        const rs = await db.prepare(
          "SELECT cls, level, max_depth AS maxDepth, gold, updated_at AS at" +
          " FROM saves WHERE player_id = ? ORDER BY level DESC"
        ).bind(u.id).all();
        return ok({ login: u.login, saves: rs.results || [] });
      }

      /* ── 계정 만들기 ── */
      if (p === "/api/signup" && req.method === "POST") {
        const b = await readJson(req);
        if (!b) return bad(400, "bad_body");
        const login = normLogin(b.login);
        const e1 = badLogin(login); if (e1) return bad(400, e1);
        const e2 = badPw(b.pw); if (e2) return bad(400, e2);

        const dup = await db.prepare("SELECT id FROM players WHERE login = ?").bind(login).first();
        if (dup) return bad(409, "이미 있는 아이디입니다");

        const id = newId(24), salt = newId(16);
        const hash = await hashPw(b.pw, salt);
        const now = Date.now();
        await db.prepare(
          "INSERT INTO players (id, login, pw_hash, pw_salt, created_at, last_at)" +
          " VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(id, login, hash, salt, now, now).run();
        const token = await makeSession(db, id);
        return ok({ login }, { "Set-Cookie": cookieOf(token) });
      }

      /* ── 로그인 ── */
      if (p === "/api/login" && req.method === "POST") {
        const b = await readJson(req);
        if (!b) return bad(400, "bad_body");
        const login = normLogin(b.login);
        const keys = [ipOf(req), "u:" + login];
        if (await locked(db, keys)) return bad(429, "잠시 뒤에 다시 시도해 주십시오");

        const row = await db.prepare(
          "SELECT id, pw_hash, pw_salt FROM players WHERE login = ?"
        ).bind(login).first();
        /* ⚠ 계정이 없어도 **해시를 한 번 돌린다.** 안 그러면 응답이 빨리
         *   돌아와 "그 아이디는 없다" 가 시간으로 새어 나간다. */
        const salt = row ? row.pw_salt : "no-such-account-salt";
        const hash = await hashPw(String(b.pw || ""), salt);
        if (!row || !sameHash(hash, row.pw_hash)) {
          await noteFail(db, keys);
          return bad(401, "아이디나 비밀번호가 맞지 않습니다");
        }
        await clearFail(db, keys);
        await db.prepare("UPDATE players SET last_at = ? WHERE id = ?")
          .bind(Date.now(), row.id).run();
        const token = await makeSession(db, row.id);
        return ok({ login }, { "Set-Cookie": cookieOf(token) });
      }

      /* ── 나가기 ── */
      if (p === "/api/logout" && req.method === "POST") {
        const u = await who(db, req);
        /* ⚠ 서버에서 세션을 **지운다.** 쿠키만 지우면 그 토큰이 계속 통해
         *   잃어버린 기기에 로그인이 그대로 남는다. */
        if (u) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(u.token).run();
        return ok({ ok: true }, { "Set-Cookie": killCookie() });
      }

      /* ── 올리기 ── 직업 한 벌씩. 여러 벌이면 배열로 */
      if (p === "/api/save" && req.method === "POST") {
        const u = await who(db, req);
        if (!u) return bad(401, "login_required");
        const b = await readJson(req);
        if (!b) return bad(400, "bad_body");
        const list = Array.isArray(b.saves) ? b.saves : [b.save];
        if (!list.length || list.length > 12) return bad(400, "bad_body");

        const done = [];
        for (const one of list) {
          const d = one && (one.d || one);
          const row = peek(d);
          if (!row) continue;
          const raw = JSON.stringify(one);
          if (raw.length > 60000) continue;      /* 한 벌이 이보다 클 이유가 없다 */
          /* ⚠ **뒤로 가는 저장은 막는다.** 다른 기기에서 새로 시작한 빈 것이
           *   키워 둔 것을 덮는 사고가 이 게임에서 이미 한 번 났다.
           *   이력에는 남으니 정말 되돌리고 싶으면 꺼낼 수 있다. */
          const cur = await db.prepare(
            "SELECT level, max_depth AS maxDepth, gold FROM saves WHERE player_id = ? AND cls = ?"
          ).bind(u.id, row.cls).first();
          if (cur && further(cur, row) === cur && (cur.level !== row.level || cur.maxDepth !== row.maxDepth)) {
            done.push({ cls: row.cls, skipped: "behind", have: cur });
            continue;
          }
          await putSave(db, u.id, row, raw);
          done.push({ cls: row.cls, level: row.level });
        }
        return ok({ saved: done });
      }

      /* ── 내려받기 ── */
      if (p === "/api/load" && req.method === "GET") {
        const u = await who(db, req);
        if (!u) return bad(401, "login_required");
        const rs = await db.prepare(
          "SELECT cls, data, level, max_depth AS maxDepth, gold, updated_at AS at" +
          " FROM saves WHERE player_id = ?"
        ).bind(u.id).all();
        return ok({ saves: rs.results || [] });
      }

      /* ── 이력 ── 되돌릴 자리 */
      if (p === "/api/history" && req.method === "GET") {
        const u = await who(db, req);
        if (!u) return bad(401, "login_required");
        const cls = url.searchParams.get("cls") || "";
        const rs = await db.prepare(
          "SELECT id, cls, data, level, at FROM save_log" +
          " WHERE player_id = ? AND (? = '' OR cls = ?) ORDER BY at DESC LIMIT 40"
        ).bind(u.id, cls, cls).all();
        return ok({ log: rs.results || [] });
      }

      return bad(404, "no_route");
    } catch (e) {
      /* ⚠ 속사정을 밖으로 내보내지 않는다. 표 이름과 열 이름이 그대로 새면
       *   다음 공격이 훨씬 쉬워진다. 로그에는 남는다(observability). */
      console.error("api", p, e && e.message);
      return bad(500, "server_error");
    }
  }
};
