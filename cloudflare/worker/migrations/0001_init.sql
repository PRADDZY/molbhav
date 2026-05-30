CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  anchor_price REAL NOT NULL,
  cost_price REAL NOT NULL,
  min_margin REAL NOT NULL,
  target_margin REAL NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  session_token TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  anchor_price REAL NOT NULL,
  reservation_price REAL NOT NULL,
  beta REAL NOT NULL,
  alpha REAL NOT NULL,
  max_rounds INTEGER NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  ttl_seconds INTEGER NOT NULL DEFAULT 300,
  state TEXT NOT NULL,
  current_seller_price REAL NOT NULL DEFAULT 0,
  agreed_price REAL,
  bot_score REAL NOT NULL DEFAULT 0,
  buyer_ip TEXT NOT NULL DEFAULT '',
  offer_history TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS negotiation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_logs_session_id ON negotiation_logs(session_id);

