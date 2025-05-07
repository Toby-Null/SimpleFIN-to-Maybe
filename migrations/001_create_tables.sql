-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  id UUID PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  account_type VARCHAR(50) NOT NULL,
  identifier VARCHAR(255),
  display_name VARCHAR(255),
  accountable_type VARCHAR(50),
  maybe_family_id UUID,
  currency VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on accounts identifier
CREATE INDEX IF NOT EXISTS idx_accounts_identifier ON accounts (identifier);

-- Create linkages table
CREATE TABLE IF NOT EXISTS linkages (
  id UUID PRIMARY KEY,
  simplefin_account_id UUID REFERENCES accounts(id),
  maybe_account_id UUID REFERENCES accounts(id),
  last_sync TIMESTAMP,
  sync_status VARCHAR(50) DEFAULT 'initialized',
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create rules table
CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create rule_conditions table
CREATE TABLE IF NOT EXISTS rule_conditions (
  id UUID PRIMARY KEY,
  rule_id UUID REFERENCES rules(id) ON DELETE CASCADE,
  field VARCHAR(50) NOT NULL,
  operator VARCHAR(50) NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create rule_actions table
CREATE TABLE IF NOT EXISTS rule_actions (
  id UUID PRIMARY KEY,
  rule_id UUID REFERENCES rules(id) ON DELETE CASCADE,
  action_type VARCHAR(50) NOT NULL,
  action_value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create categories table (for caching Maybe categories)
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  maybe_id UUID,
  parent_id UUID,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Session storage for Express sessions
CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR(255) NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions (expire);

-- Initial settings
INSERT INTO settings (id, display_name, key, value, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'SimpleFIN Setup Token', 'simplefin_setup_token', NULL, NOW(), NOW()),
  (gen_random_uuid(), 'SimpleFIN Username', 'simplefin_username', NULL, NOW(), NOW()),
  (gen_random_uuid(), 'SimpleFIN Password', 'simplefin_password', NULL, NOW(), NOW()),
  (gen_random_uuid(), 'Maybe PostgreSQL Host', 'maybe_postgres_host', '127.0.0.1', NOW(), NOW()),
  (gen_random_uuid(), 'Maybe PostgreSQL Port', 'maybe_postgres_port', '5432', NOW(), NOW()),
  (gen_random_uuid(), 'Maybe PostgreSQL Database', 'maybe_postgres_db', 'maybe', NOW(), NOW()),
  (gen_random_uuid(), 'Maybe PostgreSQL User', 'maybe_postgres_user', 'maybe', NOW(), NOW()),
  (gen_random_uuid(), 'Maybe PostgreSQL Password', 'maybe_postgres_password', NULL, NOW(), NOW()),
  (gen_random_uuid(), 'Lookback Days', 'lookback_days', '7', NOW(), NOW()),
  (gen_random_uuid(), 'Sync Schedule', 'synchronization_schedule', '0 0,12 * * *', NOW(), NOW()),
  (gen_random_uuid(), 'SimpleFIN Account Count', 'simplefin_account_count', '0', NOW(), NOW()),
  (gen_random_uuid(), 'Maybe Account Count', 'maybe_account_count', '0', NOW(), NOW())
ON CONFLICT (key) DO NOTHING;