CREATE TABLE IF NOT EXISTS "crm_connections" (
  "id"               serial PRIMARY KEY NOT NULL,
  "user_id"          text NOT NULL,
  "provider"         text NOT NULL,
  "account_id"       text NOT NULL,
  "account_name"     text,
  "encrypted_tokens" text NOT NULL,
  "field_mapping"    jsonb DEFAULT '{}'::jsonb,
  "last_sync_at"     timestamp,
  "last_error_at"    timestamp,
  "last_error"       text,
  "created_at"       timestamp DEFAULT now() NOT NULL,
  "updated_at"       timestamp DEFAULT now() NOT NULL
);
