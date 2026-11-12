CREATE TABLE share_preview_consents (
  home_id uuid PRIMARY KEY REFERENCES homes(id) ON DELETE CASCADE,
  selection jsonb NOT NULL,
  fingerprint text NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now()
);
