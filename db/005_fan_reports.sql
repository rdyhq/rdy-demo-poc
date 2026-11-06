CREATE TABLE fan_reports (
  id uuid PRIMARY KEY,
  home_id uuid NOT NULL REFERENCES homes(id),
  publication_id uuid NOT NULL,
  reason text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES operators(id),
  FOREIGN KEY(home_id,publication_id) REFERENCES publications(home_id,id)
);
CREATE INDEX open_fan_reports ON fan_reports(created_at) WHERE resolved_at IS NULL;
