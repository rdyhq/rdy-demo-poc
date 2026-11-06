ALTER TABLE sessions ADD COLUMN mailbox_proved_at timestamptz;
CREATE TABLE twitch_identities (
  subject text PRIMARY KEY,
  creator_id uuid NOT NULL UNIQUE REFERENCES creators(id),
  login text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE twitch_attempts (
  state_hash text PRIMARY KEY,
  nonce text NOT NULL,
  intent text NOT NULL CHECK(intent IN ('sign-in','link')),
  session_hash text,
  expires_at timestamptz NOT NULL
);
CREATE TABLE twitch_pending (
  browser_hash text PRIMARY KEY,
  subject text NOT NULL,
  login text,
  expires_at timestamptz NOT NULL
);
CREATE TABLE twitch_sessions (
  session_hash text PRIMARY KEY REFERENCES sessions(digest) ON DELETE CASCADE,
  subject text NOT NULL REFERENCES twitch_identities(subject) ON DELETE CASCADE,
  token_box text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
