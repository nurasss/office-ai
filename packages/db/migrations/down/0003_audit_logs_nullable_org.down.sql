-- Down Migration 0003: Restore NOT NULL on audit_logs.org_id
-- We must explicitly delete platform-level rows (where org_id IS NULL) before restoring NOT NULL constraint
DELETE FROM audit_logs WHERE org_id IS NULL;
ALTER TABLE audit_logs ALTER COLUMN org_id SET NOT NULL;
