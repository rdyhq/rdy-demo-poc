-- A handle is the short public address of a Home. A row is never deleted and never moves to another Home.
CREATE TABLE home_handles (
  handle text PRIMARY KEY CHECK (handle ~ '^[a-z0-9_]{3,25}$'),
  home_id uuid NOT NULL REFERENCES homes(id),
  source text NOT NULL CHECK (source IN ('twitch','operator')),
  twitch_subject text,
  current boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source='twitch')=(twitch_subject IS NOT NULL))
);
CREATE UNIQUE INDEX home_handles_current ON home_handles (home_id) WHERE current;
