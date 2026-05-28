-- Idempotent migration for usage monitoring tables.
-- Mirrors lib/db/src/schema/{usage-events,provider-pricing,provider-allocations,admin-alerts,usage-spike-dismissals,usage-spike-notifications}.ts

CREATE TABLE IF NOT EXISTS usage_events (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  call_id integer,
  user_id text,
  workspace_id text,
  service text NOT NULL,
  provider text NOT NULL,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  audio_seconds integer NOT NULL DEFAULT 0,
  characters integer NOT NULL DEFAULT 0,
  latency_ms integer,
  estimated_cost_micros bigint NOT NULL DEFAULT 0,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at);
CREATE INDEX IF NOT EXISTS usage_events_service_idx ON usage_events (service, provider, model);
CREATE INDEX IF NOT EXISTS usage_events_user_idx ON usage_events (user_id);
CREATE INDEX IF NOT EXISTS usage_events_workspace_idx ON usage_events (workspace_id);
CREATE INDEX IF NOT EXISTS usage_events_call_idx ON usage_events (call_id);
CREATE INDEX IF NOT EXISTS usage_events_success_idx ON usage_events (success);

CREATE TABLE IF NOT EXISTS provider_pricing (
  id serial PRIMARY KEY,
  service text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_token_price_per_million_micros bigint NOT NULL DEFAULT 0,
  output_token_price_per_million_micros bigint NOT NULL DEFAULT 0,
  audio_second_price_micros bigint NOT NULL DEFAULT 0,
  character_price_micros bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_pricing_uniq_idx ON provider_pricing (service, provider, model);

CREATE TABLE IF NOT EXISTS provider_allocations (
  id serial PRIMARY KEY,
  service text NOT NULL,
  provider text NOT NULL,
  workspace_id text,
  allocated_cost_micros bigint NOT NULL DEFAULT 0,
  low_balance_threshold_micros bigint NOT NULL DEFAULT 0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_allocations_uniq_idx ON provider_allocations (service, provider, workspace_id);

CREATE TABLE IF NOT EXISTS admin_alerts (
  id serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  service text,
  provider text,
  model text,
  payload jsonb,
  dedupe_key text NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_dedupe_uniq_idx ON admin_alerts (dedupe_key);
CREATE INDEX IF NOT EXISTS admin_alerts_created_idx ON admin_alerts (created_at);
CREATE INDEX IF NOT EXISTS admin_alerts_ack_idx ON admin_alerts (acknowledged_at);

CREATE TABLE IF NOT EXISTS usage_spike_dismissals (
  clerk_id text NOT NULL,
  dismissed_date date NOT NULL,
  PRIMARY KEY (clerk_id, dismissed_date)
);

CREATE TABLE IF NOT EXISTS usage_spike_notifications (
  clerk_id text NOT NULL,
  notified_date date NOT NULL,
  PRIMARY KEY (clerk_id, notified_date)
);
