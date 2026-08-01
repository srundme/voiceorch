-- One-time migration: fragment-coalesce listening hold platform default 500 → 250ms.
-- Rewrites only agents still storing the old default verbatim; values users set
-- to anything else (including re-setting 500 later via the dashboard) are kept.
UPDATE agents
SET agent_config = jsonb_set(agent_config::jsonb, '{fragmentCoalesceListeningMs}', '250')::json
WHERE (agent_config ->> 'fragmentCoalesceListeningMs')::numeric = 500;
