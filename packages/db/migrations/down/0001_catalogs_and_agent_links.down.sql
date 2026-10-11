-- Drop triggers
DROP TRIGGER IF EXISTS agent_skills_updated_at_trg ON agent_skills;
DROP TRIGGER IF EXISTS agent_tools_updated_at_trg ON agent_tools;
DROP TRIGGER IF EXISTS agent_models_updated_at_trg ON agent_models;
DROP TRIGGER IF EXISTS skills_updated_at_trg ON skills;
DROP TRIGGER IF EXISTS tools_updated_at_trg ON tools;
DROP TRIGGER IF EXISTS models_updated_at_trg ON models;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS agent_skills CASCADE;
DROP TABLE IF EXISTS agent_tools CASCADE;
DROP TABLE IF EXISTS agent_models CASCADE;
DROP TABLE IF EXISTS skills CASCADE;
DROP TABLE IF EXISTS tools CASCADE;
DROP TABLE IF EXISTS models CASCADE;
