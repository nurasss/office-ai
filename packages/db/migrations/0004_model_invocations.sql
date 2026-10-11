CREATE TABLE IF NOT EXISTS model_invocations (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  company_id uuid NULL REFERENCES companies(id) ON DELETE SET NULL,
  agent_id uuid NULL REFERENCES agents(id) ON DELETE SET NULL,
  provider text NOT NULL,
  model_key text NOT NULL,
  model_id uuid NULL REFERENCES models(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  attempt smallint NOT NULL DEFAULT 1,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cached_input_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
  latency_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  stop_reason text NULL,
  error_kind text NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_invocations_org_created_idx ON model_invocations (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_invocations_org_agent_created_idx ON model_invocations (org_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS model_invocations_org_model_key_idx ON model_invocations (org_id, model_key);
