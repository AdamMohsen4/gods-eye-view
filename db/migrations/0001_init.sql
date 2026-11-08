CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id text UNIQUE,
  guest_id uuid UNIQUE,
  display_name text NOT NULL,
  country char(2),
  plan text NOT NULL DEFAULT 'free',
  banned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  source text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  captured_at timestamptz NOT NULL,
  event_at timestamptz NOT NULL,
  true_lat double precision NOT NULL,
  true_lon double precision NOT NULL,
  payload jsonb NOT NULL,
  camera_pose jsonb NOT NULL,
  subject jsonb NOT NULL,
  clues jsonb NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS snapshots_type_captured ON snapshots (type, captured_at DESC);

CREATE TABLE IF NOT EXISTS dailies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  number integer NOT NULL,
  snapshot_ids uuid[] NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES snapshots(id),
  mode text NOT NULL,
  daily_date date,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz,
  guess_lat double precision,
  guess_lon double precision,
  guessed_at timestamptz,
  clues_used integer NOT NULL DEFAULT 0,
  distance_km double precision,
  score integer,
  timed_out boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, snapshot_id)
);
CREATE INDEX IF NOT EXISTS rounds_daily ON rounds (daily_date, user_id) WHERE mode = 'daily';
CREATE INDEX IF NOT EXISTS rounds_user_started ON rounds (user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS streaks (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current integer NOT NULL DEFAULT 0,
  best integer NOT NULL DEFAULT 0,
  freeze_available boolean NOT NULL DEFAULT true,
  freeze_week text,
  last_completed date
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_sub_id text UNIQUE,
  status text NOT NULL,
  renews_at timestamptz
);
