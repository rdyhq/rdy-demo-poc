-- The bytes of a picture, for a deployment that keeps pictures in the database (LINB_OBJECTS=database).
-- A row is written once. The key is the object key of a row in assets.
CREATE TABLE asset_objects (
  object_key text PRIMARY KEY CHECK (object_key ~ '^[a-f0-9-]{36}\.webp$'),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);
