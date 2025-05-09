-- Check if budgets table exists, if not create it
CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY,
  family_id UUID NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  budgeted_spending DECIMAL(12,4),
  expected_income DECIMAL(12,4),
  currency VARCHAR(10) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Check if budget_categories table exists, if not create it
CREATE TABLE IF NOT EXISTS budget_categories (
  id UUID PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  budgeted_spending DECIMAL(12,4) NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create table to track budget notifications
CREATE TABLE IF NOT EXISTS budget_notifications (
  id UUID PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- Store as first day of month (e.g., 2025-05-01)
  notification_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMP,
  budget_amount DECIMAL(12,4),
  spent_amount DECIMAL(12,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create unique index to prevent duplicate notifications for same budget/category/month
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_notifications_unique 
ON budget_notifications (budget_id, category_id, month);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_budget_notifications_month 
ON budget_notifications (month);

-- Add new notification event type for budget alerts
INSERT INTO notification_events (id, method, event_type, enabled, created_at, updated_at)
SELECT 
  gen_random_uuid(), 
  method, 
  'budget_exceeded', 
  false, 
  NOW(), 
  NOW()
FROM notification_events
WHERE event_type = 'sync_success'
ON CONFLICT DO NOTHING;