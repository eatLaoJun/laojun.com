PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name         TEXT NOT NULL,
  spec_json    TEXT NOT NULL,
  items_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS layout_variants (
  id           TEXT PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  style        TEXT,
  items_json   TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_sessions (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL DEFAULT 'default',
  active_room_id  TEXT NOT NULL,
  draft_json      TEXT,
  messages_json   TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);
