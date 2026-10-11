-- Drop triggers
DROP TRIGGER IF EXISTS secrets_updated_at_trg ON secrets;
DROP TRIGGER IF EXISTS agents_updated_at_trg ON agents;
DROP TRIGGER IF EXISTS departments_updated_at_trg ON departments;
DROP TRIGGER IF EXISTS companies_updated_at_trg ON companies;
DROP TRIGGER IF EXISTS organization_members_updated_at_trg ON organization_members;
DROP TRIGGER IF EXISTS organizations_updated_at_trg ON organizations;
DROP TRIGGER IF EXISTS refresh_tokens_updated_at_trg ON refresh_tokens;
DROP TRIGGER IF EXISTS users_updated_at_trg ON users;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS secrets CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP TABLE IF EXISTS companies CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop function
DROP FUNCTION IF EXISTS set_updated_at();
