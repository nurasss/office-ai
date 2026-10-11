-- B1. Platform Catalogs

-- models
CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google')),
  model_key text NOT NULL,
  display_name text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('frontier', 'balanced', 'cheap')),
  context_window integer NOT NULL,
  max_output_tokens integer NOT NULL,
  input_price_per_million numeric(14,6) NOT NULL,
  output_price_per_million numeric(14,6) NOT NULL,
  cached_input_price_per_million numeric(14,6) NULL,
  supports_tools boolean NOT NULL DEFAULT true,
  supports_structured_output boolean NOT NULL DEFAULT true,
  supports_streaming boolean NOT NULL DEFAULT true,
  supports_vision boolean NOT NULL DEFAULT false,
  quality_score smallint NOT NULL DEFAULT 50 CHECK (quality_score BETWEEN 0 AND 100),
  avg_latency_ms integer NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS models_provider_model_key_uniq ON models (provider, model_key);

-- tools
CREATE TABLE IF NOT EXISTS tools (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('research', 'development', 'communication', 'data', 'finance', 'system')),
  autonomy_level smallint NOT NULL CHECK (autonomy_level BETWEEN 0 AND 3),
  input_schema jsonb NOT NULL,
  output_schema jsonb NULL,
  required_secret_key text NULL,
  is_read_only boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

-- skills
CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL CHECK (category IN ('engineering', 'marketing', 'finance', 'research', 'operations', 'legal')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);

-- B4. Agent Links

-- agent_models
CREATE TABLE IF NOT EXISTS agent_models (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('preferred', 'fallback')),
  priority smallint NOT NULL DEFAULT 0,
  temperature numeric(3,2) NULL CHECK (temperature BETWEEN 0 AND 2),
  max_output_tokens integer NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_models_agent_id_model_id_uniq ON agent_models (agent_id, model_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_models_one_preferred ON agent_models (agent_id) WHERE role = 'preferred';

-- agent_tools
CREATE TABLE IF NOT EXISTS agent_tools (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES tools(id) ON DELETE RESTRICT,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tools_agent_id_tool_id_uniq ON agent_tools (agent_id, tool_id);
CREATE INDEX IF NOT EXISTS agent_tools_org_id_agent_id_idx ON agent_tools (org_id, agent_id);

-- agent_skills
CREATE TABLE IF NOT EXISTS agent_skills (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES skills(id) ON DELETE RESTRICT,
  level text NOT NULL DEFAULT 'proficient' CHECK (level IN ('basic', 'proficient', 'expert')),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_agent_id_skill_id_uniq ON agent_skills (agent_id, skill_id);

-- Triggers for updated_at
CREATE OR REPLACE TRIGGER models_updated_at_trg
  BEFORE UPDATE ON models FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER tools_updated_at_trg
  BEFORE UPDATE ON tools FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER skills_updated_at_trg
  BEFORE UPDATE ON skills FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER agent_models_updated_at_trg
  BEFORE UPDATE ON agent_models FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER agent_tools_updated_at_trg
  BEFORE UPDATE ON agent_tools FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER agent_skills_updated_at_trg
  BEFORE UPDATE ON agent_skills FOR EACH ROW EXECUTE FUNCTION set_updated_at();
