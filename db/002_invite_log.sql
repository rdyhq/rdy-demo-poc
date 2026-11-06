CREATE TABLE invite_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invite_id uuid NOT NULL REFERENCES invites(id),
  operator_id uuid NOT NULL REFERENCES operators(id),
  pilot_alias text NOT NULL,
  action text NOT NULL CHECK (action IN ('issued','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
