CREATE TABLE billing_attempts (
  id uuid PRIMARY KEY,
  creator_id uuid NOT NULL UNIQUE REFERENCES creators(id),
  home_id uuid NOT NULL REFERENCES homes(id),
  publication_id uuid NOT NULL,
  stripe_checkout_id text UNIQUE,
  checkout_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(home_id,publication_id) REFERENCES publications(home_id,id)
);
CREATE TABLE stripe_subscriptions (
  creator_id uuid PRIMARY KEY REFERENCES creators(id),
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL UNIQUE,
  status text NOT NULL,
  access_until timestamptz,
  reconciled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE stripe_events (
  id text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
