-- Remove the candidate intake / recruiter feature.

DROP INDEX IF EXISTS "candidate_intakes_user_id_idx";
DROP INDEX IF EXISTS "candidate_intakes_agent_id_idx";
DROP INDEX IF EXISTS "candidate_intakes_call_id_idx";
DROP INDEX IF EXISTS "candidate_intakes_status_idx";
DROP TABLE IF EXISTS "candidate_intakes";

-- Strip intake / job-match tools from saved agents. Non-array values and
-- entries without a type are left untouched.
UPDATE "agents"
SET "tools" = (
  SELECT COALESCE(json_agg(t), '[]'::json)
  FROM json_array_elements("agents"."tools") AS t
  WHERE COALESCE(t->>'type', '') NOT IN ('intake_write', 'intake_disposition', 'intake_submit', 'match_jobs')
)
WHERE CASE
  WHEN json_typeof("tools") = 'array' THEN EXISTS (
    SELECT 1
    FROM json_array_elements("agents"."tools") AS t
    WHERE t->>'type' IN ('intake_write', 'intake_disposition', 'intake_submit', 'match_jobs')
  )
  ELSE false
END;
