-- Migration: add all new feature tables (idempotent, handles failed runs)

-- 1) Clean up any stale temporary table
DROP TABLE IF EXISTS reminders_new CASCADE;

-- 2) Check if reminders already migrated (has entity_type column)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reminders' AND column_name = 'entity_type'
  ) THEN
    -- Create new reminders table
    CREATE TABLE reminders_new (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type TEXT NOT NULL,
      entity_id   UUID NOT NULL,
      user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remind_at   TIMESTAMPTZ NOT NULL,
      sent        BOOLEAN NOT NULL DEFAULT false,
      recurring   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Migrate data
    INSERT INTO reminders_new (id, entity_type, entity_id, user_id, remind_at, sent)
    SELECT r.id, 'task', r.task_id, t.user_id, r.remind_at, r.sent
    FROM reminders r
    JOIN tasks t ON t.id = r.task_id;

    DROP TABLE reminders CASCADE;
    ALTER TABLE reminders_new RENAME TO reminders;
  END IF;
END $$;

-- 3) Add columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_target INT NOT NULL DEFAULT 2000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sleep_target_hours DECIMAL(3,1) NOT NULL DEFAULT 8.0;

-- 4) Create new tables
DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('income', 'expense');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        transaction_type NOT NULL,
  category    TEXT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  description TEXT,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budgets (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category  TEXT NOT NULL,
  amount    DECIMAL(12,2) NOT NULL,
  month     INT NOT NULL,
  year      INT NOT NULL,
  UNIQUE (user_id, category, month, year)
);

CREATE TABLE IF NOT EXISTS medications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  dosage      TEXT,
  times       JSONB NOT NULL,
  start_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date    DATE,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS water_intake (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_ml INT NOT NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sleep_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  bedtime   TIMESTAMPTZ NOT NULL,
  wake_time TIMESTAMPTZ,
  quality   INT CHECK (quality >= 1 AND quality <= 5),
  notes     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE bill_frequency AS ENUM ('monthly', 'quarterly', 'yearly', 'one_time');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE bill_status AS ENUM ('pending', 'paid', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS bills (
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

DO $$ BEGIN
  CREATE TYPE goal_type AS ENUM ('monthly', 'yearly', 'custom');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE goal_status AS ENUM ('in_progress', 'completed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS goals (
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

CREATE TABLE IF NOT EXISTS goal_milestones (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id   UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  done      BOOLEAN NOT NULL DEFAULT false
);

-- 5) user_profile for storing user info
CREATE TABLE IF NOT EXISTS user_profile (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

-- 6) Indexes
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders (user_id, sent) WHERE sent = false;
CREATE INDEX IF NOT EXISTS idx_reminders_at ON reminders (remind_at);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions (user_id, date);
CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets (user_id, month, year);
CREATE INDEX IF NOT EXISTS idx_medications_user ON medications (user_id);
CREATE INDEX IF NOT EXISTS idx_water_user_date ON water_intake (user_id, date);
CREATE INDEX IF NOT EXISTS idx_sleep_user_date ON sleep_log (user_id, date);
CREATE INDEX IF NOT EXISTS idx_bills_user ON bills (user_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_user ON goals (user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_profile_user ON user_profile (user_id);

-- 7) RLS
ALTER TABLE reminders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE medications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_intake  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reminders_own ON reminders;
DROP POLICY IF EXISTS transactions_own ON transactions;
DROP POLICY IF EXISTS budgets_own ON budgets;
DROP POLICY IF EXISTS medications_own ON medications;
DROP POLICY IF EXISTS water_own ON water_intake;
DROP POLICY IF EXISTS sleep_own ON sleep_log;
DROP POLICY IF EXISTS bills_own ON bills;
DROP POLICY IF EXISTS goals_own ON goals;
DROP POLICY IF EXISTS milestones_own ON goal_milestones;
DROP POLICY IF EXISTS user_profile_own ON user_profile;

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
CREATE POLICY user_profile_own ON user_profile FOR ALL USING (user_id = auth.uid());
