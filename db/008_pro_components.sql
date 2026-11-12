ALTER TABLE stripe_subscriptions ADD COLUMN grant_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE publications ADD COLUMN pro_content jsonb;
ALTER TABLE publications ADD COLUMN pro_grant uuid;
CREATE TABLE pro_drafts (
  home_id uuid PRIMARY KEY REFERENCES homes(id),
  revision integer NOT NULL DEFAULT 0,
  highlights_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  recommendations_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  content jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE pro_page_history (
  home_id uuid NOT NULL REFERENCES homes(id),
  page_id uuid NOT NULL,
  PRIMARY KEY(home_id,page_id)
);
