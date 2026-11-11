CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id text UNIQUE,
  guest_id uuid UNIQUE,
  display_name text NOT NULL,
  country char(2),
  rating integer NOT NULL DEFAULT 1000,
  xp integer NOT NULL DEFAULT 0,
  daily_streak integer NOT NULL DEFAULT 0,
  daily_best integer NOT NULL DEFAULT 0,
  last_daily date,
  banned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'community',
  creator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  published boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  provider text NOT NULL,
  pano_id text NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  heading double precision NOT NULL DEFAULT 0,
  country char(2),
  credit text,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (map_id, provider, pano_id)
);
CREATE INDEX IF NOT EXISTS locations_map_provider ON locations (map_id, provider) WHERE NOT disabled;

CREATE TABLE IF NOT EXISTS challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  map_id uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  settings jsonb NOT NULL,
  location_ids uuid[] NOT NULL,
  creator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  daily_date date UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  mode text NOT NULL,
  challenge_id uuid REFERENCES challenges(id) ON DELETE CASCADE,
  settings jsonb NOT NULL,
  provider text NOT NULL,
  scale_km double precision NOT NULL,
  status text NOT NULL DEFAULT 'active',
  total_score integer NOT NULL DEFAULT 0,
  total_distance_km double precision NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS games_one_per_challenge ON games (user_id, challenge_id) WHERE challenge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS games_user_created ON games (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS games_challenge_score ON games (challenge_id, total_score DESC) WHERE status = 'finished';

CREATE TABLE IF NOT EXISTS game_rounds (
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz,
  guess_lat double precision,
  guess_lon double precision,
  guess_country char(2),
  guessed_at timestamptz,
  distance_km double precision,
  score integer,
  timed_out boolean NOT NULL DEFAULT false,
  PRIMARY KEY (game_id, idx)
);

CREATE TABLE IF NOT EXISTS matches (
  id uuid PRIMARY KEY,
  format text NOT NULL,
  ranked boolean NOT NULL DEFAULT false,
  map_id uuid REFERENCES maps(id) ON DELETE SET NULL,
  settings jsonb NOT NULL,
  winner_id uuid,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS match_players (
  match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total integer NOT NULL DEFAULT 0,
  won boolean NOT NULL DEFAULT false,
  rating_change integer NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, user_id)
)
