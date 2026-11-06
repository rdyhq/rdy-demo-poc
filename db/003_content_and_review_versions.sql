UPDATE drafts SET content = jsonb_set(content, '{schemaVersion}', '1');
UPDATE publications SET content = jsonb_set(content, '{schemaVersion}', '1');
ALTER TABLE drafts ADD CONSTRAINT draft_content_version
  CHECK (jsonb_typeof(content) = 'object' AND content ? 'schemaVersion' AND content->'schemaVersion' = '1'::jsonb);
ALTER TABLE publications ADD CONSTRAINT publication_content_version
  CHECK (jsonb_typeof(content) = 'object' AND content ? 'schemaVersion' AND content->'schemaVersion' = '1'::jsonb);

ALTER TABLE visibility_holds ADD COLUMN publication_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE case_audit ADD COLUMN publication_epoch integer;
UPDATE visibility_holds SET reviewed_publication_id = NULL, reviewed_at = NULL WHERE released_at IS NULL;
