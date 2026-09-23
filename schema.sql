-- 심연의 계단(ARPG) — 계정과 저장.
--
-- 왜 서버에 두는가: 이 게임은 여태 localStorage 하나였다. 브라우저 데이터를
-- 지우거나 기기를 옮기면 키운 것이 사라지고, 되돌릴 자리가 없었다.
--
-- ⚠ **서버가 진실원이 아니다.** 게임은 지금처럼 localStorage 로 돈다.
--   서버는 **사본**이고, 로그인했을 때만 올리고 내린다. 그래야 로그인
--   안 한 사람과 서버가 죽은 날에도 게임이 그대로 돈다.
-- ⚠ 비밀번호는 **평문으로 두지 않는다.** PBKDF2 10만회 SHA-256 + 계정마다
--   다른 소금. 옆 저장소(membership-builder)에서 이미 굳힌 방식과 같다.

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,           -- newId() 24자
  login       TEXT NOT NULL,              -- 아이디(소문자로 눕혀 저장)
  pw_hash     TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_login ON players(login);

-- 직업마다 한 줄. 사람이 직업을 넷 키우면 넉 줄이다.
CREATE TABLE IF NOT EXISTS saves (
  player_id   TEXT NOT NULL,
  cls         TEXT NOT NULL,
  data        TEXT NOT NULL,              -- save.js 가 만든 그대로의 JSON
  level       INTEGER NOT NULL DEFAULT 1,
  max_depth   INTEGER NOT NULL DEFAULT 1,
  gold        INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, cls)
);

-- ⚠ **덮어쓰기 전의 것을 남긴다.** 2026-09-23 에 직업 목록 하나를 빠뜨려
--   키워 둔 전사 저장을 통째로 날렸다. 원인은 고쳤지만 저장을 덮어쓰는
--   길은 앞으로도 있다 — 되돌릴 자리가 하나도 없던 것이 진짜 문제였다.
-- ⚠ 무한히 쌓지 않는다. 직업마다 최근 열 줄만 남기고 지운다.
CREATE TABLE IF NOT EXISTS save_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   TEXT NOT NULL,
  cls         TEXT NOT NULL,
  data        TEXT NOT NULL,
  level       INTEGER NOT NULL DEFAULT 1,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_who ON save_log(player_id, cls, at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

-- 틀린 비밀번호를 센다. 안 세면 아이디 하나를 밤새 두드린다.
CREATE TABLE IF NOT EXISTS auth_fail (
  k           TEXT NOT NULL,              -- ip 또는 login
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fail ON auth_fail(k, at);
