DROP TABLE IF EXISTS "call_media";
--> statement-breakpoint
UPDATE "agents"
SET "agent_config" = (agent_config::jsonb - 'agentKind' - 'visionMode' - 'visionEnabled' - 'visionLiveEnabled')::json
WHERE agent_config IS NOT NULL
  AND (agent_config::jsonb ?| array['agentKind','visionMode','visionEnabled','visionLiveEnabled']);
--> statement-breakpoint
UPDATE "agents"
SET "tools" = (
  SELECT COALESCE(json_agg(t), '[]'::json)
  FROM json_array_elements(tools) AS t
  WHERE t->>'type' NOT IN ('analyze_document', 'analyze_image')
)
WHERE tools IS NOT NULL
  AND json_typeof(tools) = 'array'
  AND EXISTS (
    SELECT 1 FROM json_array_elements(tools) AS t
    WHERE t->>'type' IN ('analyze_document', 'analyze_image')
  );
