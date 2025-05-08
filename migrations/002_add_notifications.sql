-- Create notification_settings table
CREATE TABLE IF NOT EXISTS notification_settings (
  id UUID PRIMARY KEY,
  method VARCHAR(50) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  settings JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index on notification_settings method
CREATE INDEX IF NOT EXISTS idx_notification_settings_method ON notification_settings (method);

-- Create notification_events table
CREATE TABLE IF NOT EXISTS notification_events (
  id UUID PRIMARY KEY,
  method VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create unique index on notification_events method and event_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_events_method_event ON notification_events (method, event_type);