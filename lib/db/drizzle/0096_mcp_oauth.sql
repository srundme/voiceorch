-- MCP OAuth for hosted remote MCP (Claude custom connectors)
CREATE TABLE IF NOT EXISTS "mcp_oauth_clients" (
  "id" serial PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "client_secret" text,
  "client_name" text,
  "redirect_uris" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_clients_client_id_uidx"
  ON "mcp_oauth_clients" ("client_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_oauth_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("clerk_id") ON DELETE cascade,
  "redirect_uri" text NOT NULL,
  "code_challenge" text NOT NULL,
  "code_challenge_method" text DEFAULT 'S256' NOT NULL,
  "api_key_ciphertext" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_codes_code_hash_uidx"
  ON "mcp_oauth_codes" ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_codes_client_id_idx"
  ON "mcp_oauth_codes" ("client_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_oauth_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("clerk_id") ON DELETE cascade,
  "api_key_ciphertext" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mcp_oauth_tokens_token_hash_uidx"
  ON "mcp_oauth_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_oauth_tokens_user_id_idx"
  ON "mcp_oauth_tokens" ("user_id");
