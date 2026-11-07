-- NULL marks legacy drafts whose human edits must be inferred conservatively.
-- New uploads explicitly store [] and subsequent saves record changed field names.
ALTER TABLE documents ADD COLUMN manual_fields_json TEXT;
