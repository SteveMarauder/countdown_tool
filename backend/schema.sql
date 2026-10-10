CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL DEFAULT 100000
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES admins(username) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  deadline_ms INTEGER,
  remaining_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('idle','running','paused')),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO event VALUES (1, 'AI HACKATHON', '創意正在發生，讓每一秒都有意義。', 10800000, NULL, 10800000, 'idle', 0, 0);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS login_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
