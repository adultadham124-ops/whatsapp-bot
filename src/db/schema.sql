-- ============================================
-- Drop tables if re-running migration
-- ============================================
DROP TABLE IF EXISTS goal_milestones CASCADE;
DROP TABLE IF EXISTS goals CASCADE;
DROP TABLE IF EXISTS bills CASCADE;
DROP TABLE IF EXISTS sleep_log CASCADE;
DROP TABLE IF EXISTS water_intake CASCADE;
DROP TABLE IF EXISTS medications CASCADE;
DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS daily_context CASCADE;
DROP TABLE IF EXISTS reminders CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- users
-- ============================================
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  timezone    TEXT NOT NULL DEFAULT 'UTC',
  water_target INT NOT NULL DEFAULT 2000,
  sleep_target_hours DECIMAL(3,1) NOT NULL DEFAULT 8.0
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
-- reminders (generalized for all entity types)
-- ============================================
CREATE TABLE reminders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,  -- 'task', 'medication', 'bill'
  entity_id   UUID NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remind_at   TIMESTAMPTZ NOT NULL,
  sent        BOOLEAN NOT NULL DEFAULT false,
  recurring   TEXT,  -- NULL, 'daily', 'weekly', 'monthly', 'yearly'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- transactions (income / expense)
-- ============================================
CREATE TYPE transaction_type AS ENUM ('income', 'expense');

CREATE TABLE transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        transaction_type NOT NULL,
  category    TEXT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  description TEXT,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE budgets (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category  TEXT NOT NULL,
  amount    DECIMAL(12,2) NOT NULL,
  month     INT NOT NULL,
  year      INT NOT NULL,
  UNIQUE (user_id, category, month, year)
);

-- ============================================
-- medications
-- ============================================
CREATE TABLE medications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  dosage      TEXT,
  times       JSONB NOT NULL,  -- ["08:00", "20:00"]
  start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date    DATE,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- water intake
-- ============================================
CREATE TABLE water_intake (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_ml INT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- sleep log
-- ============================================
CREATE TABLE sleep_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  bedtime   TIMESTAMPTZ NOT NULL,
  wake_time TIMESTAMPTZ,
  quality   INT CHECK (quality >= 1 AND quality <= 5),
  notes     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- bills / subscriptions
-- ============================================
CREATE TYPE bill_frequency AS ENUM ('monthly', 'quarterly', 'yearly', 'one_time');
CREATE TYPE bill_status AS ENUM ('pending', 'paid', 'overdue');

CREATE TABLE bills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  due_date    DATE NOT NULL,
  frequency   bill_frequency NOT NULL DEFAULT 'monthly',
  category    TEXT,
  status      bill_status NOT NULL DEFAULT 'pending',
  auto_paid   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- goals (monthly / yearly)
-- ============================================
CREATE TYPE goal_type AS ENUM ('monthly', 'yearly', 'custom');
CREATE TYPE goal_status AS ENUM ('in_progress', 'completed', 'abandoned');

CREATE TABLE goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  type        goal_type NOT NULL DEFAULT 'monthly',
  target_date DATE NOT NULL,
  status      goal_status NOT NULL DEFAULT 'in_progress',
  progress    INT NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goal_milestones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id   UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  done      BOOLEAN NOT NULL DEFAULT false
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
CREATE INDEX idx_reminders_user   ON reminders (user_id, sent) WHERE sent = false;
CREATE INDEX idx_reminders_at     ON reminders (remind_at);
CREATE INDEX idx_transactions_user_date ON transactions (user_id, date);
CREATE INDEX idx_budgets_user     ON budgets (user_id, month, year);
CREATE INDEX idx_medications_user ON medications (user_id);
CREATE INDEX idx_water_user_date  ON water_intake (user_id, date);
CREATE INDEX idx_sleep_user_date  ON sleep_log (user_id, date);
CREATE INDEX idx_bills_user       ON bills (user_id, status);
CREATE INDEX idx_goals_user       ON goals (user_id, status);
CREATE INDEX idx_daily_context_user_date ON daily_context (user_id, date);
CREATE INDEX idx_conversations_user_id ON conversations (user_id);
CREATE INDEX idx_conversations_created_at ON conversations (user_id, created_at);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_intake  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_own ON users FOR ALL USING (id = auth.uid());
CREATE POLICY tasks_own ON tasks FOR ALL USING (user_id = auth.uid());
CREATE POLICY reminders_own ON reminders FOR ALL USING (user_id = auth.uid());
CREATE POLICY transactions_own ON transactions FOR ALL USING (user_id = auth.uid());
CREATE POLICY budgets_own ON budgets FOR ALL USING (user_id = auth.uid());
CREATE POLICY medications_own ON medications FOR ALL USING (user_id = auth.uid());
CREATE POLICY water_own ON water_intake FOR ALL USING (user_id = auth.uid());
CREATE POLICY sleep_own ON sleep_log FOR ALL USING (user_id = auth.uid());
CREATE POLICY bills_own ON bills FOR ALL USING (user_id = auth.uid());
CREATE POLICY goals_own ON goals FOR ALL USING (user_id = auth.uid());
CREATE POLICY milestones_own ON goal_milestones FOR ALL USING (
  goal_id IN (SELECT id FROM goals WHERE user_id = auth.uid())
);
CREATE POLICY daily_context_own ON daily_context FOR ALL USING (user_id = auth.uid());
CREATE POLICY conversations_own ON conversations FOR ALL USING (user_id = auth.uid());
