CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  alias TEXT,
  password_hash TEXT,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending', 'active')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  role TEXT NOT NULL CHECK (role IN ('principal', 'suplente', 'admin')),
  base_role TEXT NOT NULL DEFAULT 'principal'
    CHECK (base_role IN ('principal', 'suplente')),
  ranking_position INTEGER,
  balance NUMERIC(12, 2) NOT NULL DEFAULT 0,
  photo_url TEXT,
  strong_points TEXT NOT NULL DEFAULT '',
  weak_points TEXT NOT NULL DEFAULT '',
  preferred_position TEXT NOT NULL DEFAULT '',
  other_details TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS matches (
  id BIGSERIAL PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  match_date TEXT,
  match_time TEXT NOT NULL DEFAULT '20:00',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'played', 'cancelled')),
  draft_state TEXT NOT NULL DEFAULT '{}',
  team_a TEXT NOT NULL DEFAULT '[]',
  team_b TEXT NOT NULL DEFAULT '[]',
  pitch_price NUMERIC(12, 2),
  result TEXT CHECK (result IN ('A', 'B', 'draw') OR result IS NULL)
);

CREATE TABLE IF NOT EXISTS convocations (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('principal', 'suplente', 'no_va')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  invited_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  concept TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  match_id BIGINT REFERENCES matches(id),
  transaction_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (transaction_type IN ('manual', 'match_charge', 'adjustment')),
  adjustment_of BIGINT REFERENCES transactions(id),
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('posted', 'adjusted', 'refunded')),
  adjusted_by BIGINT REFERENCES users(id),
  adjusted_at TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_campaigns (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('opening', 'friday_reminder')),
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed')),
  delivered_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  UNIQUE (match_id, type)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS match_finances (
  match_id BIGINT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  pitch_cost NUMERIC(12, 2) NOT NULL,
  fee_per_player NUMERIC(12, 2) NOT NULL,
  participants INTEGER NOT NULL,
  total_collected NUMERIC(12, 2) NOT NULL,
  pot_added NUMERIC(12, 2) NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS match_points (
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('win', 'draw', 'loss')),
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS standing_adjustments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  admin_id BIGINT NOT NULL REFERENCES users(id),
  points_delta INTEGER NOT NULL,
  matches_played_delta INTEGER NOT NULL,
  wins_delta INTEGER NOT NULL,
  draws_delta INTEGER NOT NULL,
  losses_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS balance_alert_campaigns (
  match_id BIGINT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed')),
  delivered_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_standing_adjustments_user
  ON standing_adjustments(user_id, id);
CREATE INDEX IF NOT EXISTS idx_matches_match_date
  ON matches(match_date, status);
CREATE INDEX IF NOT EXISTS idx_transactions_match
  ON transactions(match_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_adjustment
  ON transactions(adjustment_of, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_alias_unique
  ON users(LOWER(alias)) WHERE alias IS NOT NULL;
