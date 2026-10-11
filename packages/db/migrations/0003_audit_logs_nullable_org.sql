-- Migration 0003: Make audit_logs.org_id nullable for platform-level audit events
ALTER TABLE audit_logs ALTER COLUMN org_id DROP NOT NULL;
