-- Migration 0002: Model pricing verification columns
ALTER TABLE models
  ADD COLUMN IF NOT EXISTS pricing_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pricing_verified_at timestamptz(3) NULL,
  ADD COLUMN IF NOT EXISTS pricing_source_url text NULL;
