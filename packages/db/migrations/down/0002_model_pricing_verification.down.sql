-- Down Migration 0002: Drop model pricing verification columns
ALTER TABLE models
  DROP COLUMN IF EXISTS pricing_source_url,
  DROP COLUMN IF EXISTS pricing_verified_at,
  DROP COLUMN IF EXISTS pricing_verified;
