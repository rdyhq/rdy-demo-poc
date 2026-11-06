CREATE TABLE creators (
  id uuid PRIMARY KEY,
  mailbox text NOT NULL UNIQUE
);
CREATE TABLE operators (
  id uuid PRIMARY KEY,
  mailbox text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE invites (
  id uuid PRIMARY KEY,
  mailbox text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX one_pending_invite ON invites(mailbox)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE homes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL UNIQUE REFERENCES creators(id),
  draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  publication_id uuid
);
CREATE TABLE drafts (
  home_id uuid NOT NULL REFERENCES homes(id),
  revision integer NOT NULL CHECK (revision >= 0),
  content jsonb NOT NULL,
  PRIMARY KEY (home_id, revision)
);
CREATE TABLE publications (
  home_id uuid NOT NULL REFERENCES homes(id),
  id uuid NOT NULL,
  draft_revision integer NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  content jsonb NOT NULL,
  PRIMARY KEY (home_id, id),
  FOREIGN KEY (home_id, draft_revision) REFERENCES drafts(home_id, revision)
);
ALTER TABLE homes
  ADD FOREIGN KEY (id, publication_id) REFERENCES publications(home_id, id),
  ADD FOREIGN KEY (id, draft_revision) REFERENCES drafts(home_id, revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE update_dates (
  home_id uuid NOT NULL REFERENCES homes(id),
  update_id uuid NOT NULL,
  first_published_at timestamptz NOT NULL,
  PRIMARY KEY (home_id, update_id)
);
CREATE TABLE mutation_receipts (
  home_id uuid NOT NULL REFERENCES homes(id),
  operation_id uuid NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (home_id, operation_id)
);
CREATE TABLE mailbox_changes (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL REFERENCES creators(id),
  old_mailbox text NOT NULL,
  new_mailbox text NOT NULL,
  old_proved boolean NOT NULL DEFAULT false,
  new_proved boolean NOT NULL DEFAULT false,
  finished_at timestamptz,
  cancelled_at timestamptz
);
CREATE UNIQUE INDEX one_active_mailbox_change ON mailbox_changes(creator_id)
  WHERE finished_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE access_proofs (
  digest text PRIMARY KEY,
  purpose text NOT NULL CHECK (purpose IN ('login','operator','mailbox-old','mailbox-new')),
  mailbox text NOT NULL,
  creator_id uuid REFERENCES creators(id),
  change_id uuid REFERENCES mailbox_changes(id),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE sessions (
  digest text PRIMARY KEY,
  creator_id uuid REFERENCES creators(id),
  operator_id uuid REFERENCES operators(id),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (num_nonnulls(creator_id, operator_id) = 1)
);
CREATE INDEX sessions_creator ON sessions(creator_id) WHERE revoked_at IS NULL;
CREATE TABLE rate_limits (
  bucket text NOT NULL,
  hour timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (bucket, hour)
);
CREATE TABLE assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES creators(id),
  object_key text NOT NULL UNIQUE,
  state text NOT NULL CHECK (state IN ('pending','ready','rejected')),
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE report_cases (
  id uuid PRIMARY KEY,
  home_id uuid NOT NULL REFERENCES homes(id),
  applier_id uuid NOT NULL REFERENCES operators(id),
  reviewer_id uuid NOT NULL REFERENCES operators(id),
  reason text NOT NULL,
  evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  evidence_until timestamptz NOT NULL DEFAULT now() + interval '30 days',
  evidence_hold_reason text,
  evidence_hold_approver text,
  evidence_deleted_at timestamptz,
  CHECK (applier_id <> reviewer_id)
);
CREATE TABLE visibility_holds (
  case_id uuid PRIMARY KEY REFERENCES report_cases(id),
  home_id uuid NOT NULL REFERENCES homes(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  reviewed_publication_id uuid,
  reviewed_at timestamptz,
  FOREIGN KEY (home_id, reviewed_publication_id) REFERENCES publications(home_id, id)
);
CREATE UNIQUE INDEX one_active_home_hold ON visibility_holds(home_id) WHERE released_at IS NULL;
CREATE TABLE case_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES report_cases(id),
  operator_id uuid NOT NULL REFERENCES operators(id),
  action text NOT NULL,
  reason text,
  operation_id uuid,
  publication_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, operation_id)
);
CREATE TABLE creator_notices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  home_id uuid NOT NULL REFERENCES homes(id),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
