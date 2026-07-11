-- ============================================
-- Drop tables if re-running migration
-- ============================================
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS daily_context CASCADE;
DROP TABLE IF EXISTS reminders CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- users
-- ============================================
CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  timezone   TEXT NOT NULL DEFAULT 'UTC'
);

-- ============================================
-- tasks
-- ============================================
CREATE TYPE task_status AS ENUM ('pending', 'done', 'snoozed');

CREATE TABLE tasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  due_at     TIMESTAMPTZ,
  status     task_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- reminders
-- ============================================
CREATE TABLE reminders (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  remind_at TIMESTAMPTZ NOT NULL,
  sent      BOOLEAN NOT NULL DEFAULT false
);

-- ============================================
-- daily_context
-- ============================================
CREATE TABLE daily_context (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  calendar_events  JSONB,
  expenses_summary JSONB,
  notes            TEXT,
  UNIQUE (user_id, date)
);

-- ============================================
-- conversations
-- ============================================
CREATE TYPE message_role AS ENUM ('user', 'assistant');

CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    TEXT NOT NULL,
  role       message_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_tasks_user_id    ON tasks (user_id);
CREATE INDEX idx_tasks_status     ON tasks (status);
CREATE INDEX idx_reminders_sent   ON reminders (sent) WHERE sent = false;
CREATE INDEX idx_reminders_task_id ON reminders (task_id);
CREATE INDEX idx_daily_context_user_date ON daily_context (user_id, date);
CREATE INDEX idx_conversations_user_id ON conversations (user_id);
CREATE INDEX idx_conversations_created_at ON conversations (user_id, created_at);

-- ============================================
-- Row Level Security
-- ============================================
-- Enable RLS on all tables
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Users: each user can read/update their own row
CREATE POLICY users_own ON users
  FOR ALL
  USING (id = auth.uid());

-- Tasks: each user sees only their tasks
CREATE POLICY tasks_own ON tasks
  FOR ALL
  USING (user_id = auth.uid());

-- Reminders: via task ownership
CREATE POLICY reminders_own ON reminders
  FOR ALL
  USING (
    task_id IN (SELECT id FROM tasks WHERE user_id = auth.uid())
  );

-- Daily context: each user sees only their own
CREATE POLICY daily_context_own ON daily_context
  FOR ALL
  USING (user_id = auth.uid());

-- Conversations: each user sees only their own
CREATE POLICY conversations_own ON conversations
  FOR ALL
  USING (user_id = auth.uid());
