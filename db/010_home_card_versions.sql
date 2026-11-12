ALTER TABLE drafts DROP CONSTRAINT draft_content_version;
ALTER TABLE drafts ADD CONSTRAINT draft_content_version
  CHECK (jsonb_typeof(content) = 'object' AND content ? 'schemaVersion'
    AND content->'schemaVersion' IN ('1'::jsonb, '2'::jsonb));

ALTER TABLE publications DROP CONSTRAINT publication_content_version;
ALTER TABLE publications ADD CONSTRAINT publication_content_version
  CHECK (jsonb_typeof(content) = 'object' AND content ? 'schemaVersion'
    AND content->'schemaVersion' IN ('1'::jsonb, '2'::jsonb));
