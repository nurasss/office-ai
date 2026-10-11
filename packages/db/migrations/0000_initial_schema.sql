-- B1. Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- B2. Tables

-- users
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at timestamptz(3) NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq ON users (lower(email));

-- refresh_tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz(3) NOT NULL,
  revoked_at timestamptz(3) NULL,
  user_agent text NULL,
  ip inet NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_expires_at_idx ON refresh_tokens (user_id, expires_at);

-- organizations
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  monthly_budget_usd numeric(14,6) NOT NULL DEFAULT 100.000000,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

-- organization_members
CREATE TABLE IF NOT EXISTS organization_members (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_members_org_id_user_id_uniq ON organization_members (org_id, user_id);
CREATE INDEX IF NOT EXISTS organization_members_user_id_idx ON organization_members (user_id);

-- companies
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text NULL,
  mission text NULL,
  mode text NOT NULL DEFAULT 'copilot' CHECK (mode IN ('assistant', 'copilot', 'autonomous')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  monthly_budget_usd numeric(14,6) NOT NULL DEFAULT 50.000000,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_org_id_slug_uniq ON companies (org_id, slug);
CREATE INDEX IF NOT EXISTS companies_org_id_created_at_id_idx ON companies (org_id, created_at DESC, id DESC);

-- departments
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  parent_department_id uuid NULL REFERENCES departments(id) ON DELETE SET NULL,
  monthly_budget_usd numeric(14,6) NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_company_id_code_uniq ON departments (company_id, code);
CREATE INDEX IF NOT EXISTS departments_org_id_company_id_idx ON departments (org_id, company_id);

-- agents
CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  department_id uuid NULL REFERENCES departments(id) ON DELETE SET NULL,
  manager_agent_id uuid NULL REFERENCES agents(id) ON DELETE SET NULL,
  name text NOT NULL,
  role text NOT NULL,
  title text NOT NULL,
  system_prompt text NOT NULL,
  system_prompt_version integer NOT NULL DEFAULT 1,
  max_autonomy_level smallint NOT NULL DEFAULT 1 CHECK (max_autonomy_level BETWEEN 0 AND 3),
  monthly_budget_usd numeric(14,6) NOT NULL DEFAULT 10.000000,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'retired')),
  avatar_url text NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agents_company_id_name_uniq ON agents (company_id, name);
CREATE INDEX IF NOT EXISTS agents_org_id_company_id_created_at_id_idx ON agents (org_id, company_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS agents_org_id_department_id_idx ON agents (org_id, department_id);

-- secrets
CREATE TABLE IF NOT EXISTS secrets (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id uuid NULL REFERENCES companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  value_encrypted text NOT NULL,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS secrets_org_key_uniq ON secrets (org_id, key) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS secrets_org_company_key_uniq ON secrets (org_id, company_id, key) WHERE company_id IS NOT NULL;

-- audit_logs (append-only)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id uuid NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet NULL,
  user_agent text NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_org_id_created_at_idx ON audit_logs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_org_id_resource_type_resource_id_idx ON audit_logs (org_id, resource_type, resource_id);

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER users_updated_at_trg
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER refresh_tokens_updated_at_trg
  BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER organizations_updated_at_trg
  BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER organization_members_updated_at_trg
  BEFORE UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER companies_updated_at_trg
  BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER departments_updated_at_trg
  BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER agents_updated_at_trg
  BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER secrets_updated_at_trg
  BEFORE UPDATE ON secrets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
