CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text,
	"name" text,
	"wallet_balance_cents" integer DEFAULT 0 NOT NULL,
	"free_credits_granted" boolean DEFAULT false NOT NULL,
	"auto_pay_enabled" boolean DEFAULT false NOT NULL,
	"auto_pay_threshold_cents" integer DEFAULT 100 NOT NULL,
	"auto_pay_amount_cents" integer DEFAULT 1000 NOT NULL,
	"password_hash" text,
	"api_key" text,
	"org_key" text,
	"concurrent_limit" integer DEFAULT 2 NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"onboarding_data" jsonb,
	"preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_api_key_unique" UNIQUE("api_key"),
	CONSTRAINT "users_org_key_unique" UNIQUE("org_key")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"razorpay_order_id" text,
	"razorpay_payment_id" text,
	"call_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"keywords" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'text' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"knowledge_base_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer,
	"embedding" vector(768),
	"metadata" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"knowledge_base_id" integer NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"char_count" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"processing_error" text,
	"chunk_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_bases" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"description" text,
	"embedding_model" text DEFAULT 'embedding-001' NOT NULL,
	"chunk_size" integer DEFAULT 512 NOT NULL,
	"chunk_overlap" integer DEFAULT 64 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"agent_type" text DEFAULT 'general',
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"asr_provider" text NOT NULL,
	"asr_model" text,
	"asr_language" text,
	"asr_background_denoising" boolean DEFAULT false,
	"asr_confidence_threshold" real,
	"asr_end_of_turn_confidence" real,
	"asr_end_of_turn_timeout" integer,
	"asr_keyterms" text,
	"asr_smart_endpointing" text DEFAULT 'off',
	"asr_auto_fallback" boolean DEFAULT false,
	"asr_fallback_providers" json,
	"llm_provider" text NOT NULL,
	"llm_model" text,
	"tts_provider" text NOT NULL,
	"tts_voice" text,
	"tts_model" text,
	"telephony_provider" text NOT NULL,
	"system_prompt" text NOT NULL,
	"temperature" real,
	"max_duration" integer,
	"greeting_message" text,
	"end_call_phrases" text,
	"silence_timeout_seconds" integer,
	"language" text,
	"backchanneling_enabled" boolean DEFAULT false,
	"backchanneling_frequency" real,
	"backchannel_phrases" text,
	"webhook_url" text,
	"noise_cancellation_enabled" boolean DEFAULT false,
	"inactivity_message" text,
	"knowledge_base_id" integer,
	"tools" json,
	"agent_config" json,
	"disposition_schema" json,
	"agent_mode" text DEFAULT 'byop',
	"managed_stack" jsonb,
	"use_case" text,
	"lead_source_type" text,
	"lead_source_token" text,
	"lead_fields" json,
	"product_details" text,
	"max_concurrent_calls" integer,
	"monthly_spend_limit_cents" integer,
	"generated_prompt" text,
	"prompt_template_version" integer,
	"wizard_inputs" json,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"successful_calls" integer DEFAULT 0 NOT NULL,
	"avg_duration_seconds" integer,
	"avg_stt_latency_ms" integer,
	"avg_llm_latency_ms" integer,
	"avg_tts_first_chunk_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"agent_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"to_number" text NOT NULL,
	"from_number" text NOT NULL,
	"duration_seconds" integer,
	"transcript" text,
	"recording_url" text,
	"call_summary" text,
	"error_message" text,
	"execution_id" text,
	"metadata" text,
	"stt_latency_ms" integer,
	"llm_latency_ms" integer,
	"tts_first_chunk_ms" integer,
	"cost_cents" integer,
	"disposition_result" json,
	"transfer_type" text,
	"transfer_target" text,
	"amd_result" text,
	"success_evaluation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"provider_type" text NOT NULL,
	"provider_name" text NOT NULL,
	"api_key" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"extra_config" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"description" text NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"number" text NOT NULL,
	"country_code" text NOT NULL,
	"region" text,
	"number_type" text DEFAULT 'local' NOT NULL,
	"vobiz_number_id" text,
	"agent_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"monthly_rate_cents" integer DEFAULT 0 NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routing_rules" jsonb,
	CONSTRAINT "phone_numbers_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"events" text DEFAULT '["call.ended"]' NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caller_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"phone_number" text NOT NULL,
	"name" text,
	"summary" text,
	"call_count" integer DEFAULT 0 NOT NULL,
	"last_called_at" timestamp,
	"last_call_dropped" boolean DEFAULT false NOT NULL,
	"last_call_dropped_at" timestamp,
	"predicted_intent" text,
	"risk_score" real,
	"sentiment_trend" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_callbacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"to_number" text NOT NULL,
	"user_id" text,
	"scheduled_at" timestamp NOT NULL,
	"created_from_call_id" integer,
	"campaign_lead_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"triggered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_daily_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"date" text NOT NULL,
	"leads_imported" integer DEFAULT 0 NOT NULL,
	"connected" integer DEFAULT 0 NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL,
	"transferred" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"callbacks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"lead_source" text DEFAULT 'csv' NOT NULL,
	"scheduled_start_at" timestamp with time zone,
	"scheduled_end_at" timestamp with time zone,
	"total_leads" integer DEFAULT 0 NOT NULL,
	"called_leads" integer DEFAULT 0 NOT NULL,
	"field_mappings" json,
	"call_delay_seconds" integer DEFAULT 5 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"retry_delay_minutes" integer DEFAULT 60 NOT NULL,
	"timezone" text,
	"business_hours_start" integer,
	"business_hours_end" integer,
	"max_daily_calls" integer,
	"duplicate_policy" text DEFAULT 'skip' NOT NULL,
	"lead_source_id" integer,
	"batch_field_mapping" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"batch_id" integer,
	"lead_source_id" integer,
	"phone" text NOT NULL,
	"normalized_phone" text,
	"name" text,
	"email" text,
	"lead_data" json DEFAULT '{}'::json NOT NULL,
	"call_status" text DEFAULT 'pending' NOT NULL,
	"operational_outcome" text DEFAULT 'pending' NOT NULL,
	"disposition" text,
	"call_id" integer,
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"source" text DEFAULT 'webhook' NOT NULL,
	"external_lead_id" text,
	"notes" text,
	"owner_id" text,
	"owner_type" text DEFAULT 'unassigned',
	"lead_score" integer,
	"duplicate_of_lead_id" integer,
	"duplicate_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"agent_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"webhook_token" text NOT NULL,
	"field_mappings" json DEFAULT '{"phone":"phone"}'::json NOT NULL,
	"from_number" text,
	"call_delay_seconds" integer DEFAULT 5 NOT NULL,
	"max_attempts" integer DEFAULT 1 NOT NULL,
	"retry_delay_minutes" integer DEFAULT 60 NOT NULL,
	"total_leads" integer DEFAULT 0 NOT NULL,
	"called_leads" integer DEFAULT 0 NOT NULL,
	"concurrent_call_limit" integer DEFAULT 20 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_webhook_token_unique" UNIQUE("webhook_token")
);
--> statement-breakpoint
CREATE TABLE "call_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"batch_id" integer,
	"call_id" integer,
	"scheduling_booking_id" integer,
	"meeting_time" timestamp with time zone,
	"meeting_link" text,
	"meeting_status" text DEFAULT 'scheduled' NOT NULL,
	"calendar_provider" text,
	"booking_source" text,
	"booked_by" text,
	"notes" text,
	"revenue_value" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_callbacks" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"call_id" integer,
	"callback_at" timestamp with time zone,
	"response_due_by" timestamp with time zone,
	"reason" text,
	"raw_extract" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"batch_id" integer,
	"lead_id" integer NOT NULL,
	"call_id" integer,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"outcome" text,
	"call_summary" text,
	"sentiment" text,
	"detected_intent" text,
	"key_topics" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_retries" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incoming_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"phone" text NOT NULL,
	"normalized_phone" text,
	"campaign_id" integer,
	"batch_id" integer,
	"lead_id" integer,
	"call_id" integer,
	"incoming_call_status" text DEFAULT 'unreviewed' NOT NULL,
	"incoming_call_reason" text,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_interaction_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"latest_summary" text,
	"latest_sentiment" text,
	"latest_intent" text,
	"latest_topics" jsonb DEFAULT '[]'::jsonb,
	"interaction_count" integer DEFAULT 0 NOT NULL,
	"last_contact_at" timestamp with time zone,
	"last_call_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_interaction_summaries_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "lead_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"data" json,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_dnc" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"phone" text NOT NULL,
	"normalized_phone" text NOT NULL,
	"reason" text,
	"source" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_variables" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"variable_name" text NOT NULL,
	"display_label" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"default_value" text,
	"data_type" text DEFAULT 'string' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_health_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"snapshot_time" timestamp with time zone DEFAULT now() NOT NULL,
	"total_leads" integer DEFAULT 0 NOT NULL,
	"valid_leads" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"queued" integer DEFAULT 0 NOT NULL,
	"calling" integer DEFAULT 0 NOT NULL,
	"connected" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"callbacks" integer DEFAULT 0 NOT NULL,
	"incoming_calls" integer DEFAULT 0 NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL,
	"transferred" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"no_pickup" integer DEFAULT 0 NOT NULL,
	"interested" integer DEFAULT 0 NOT NULL,
	"operational_outcome_breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"batch_id" integer NOT NULL,
	"source_id" integer,
	"file_name" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"invalid_rows" integer DEFAULT 0 NOT NULL,
	"duplicate_rows" integer DEFAULT 0 NOT NULL,
	"created_rows" integer DEFAULT 0 NOT NULL,
	"processing_time_ms" integer,
	"error_report" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"campaign_id" integer,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"meta_form_id" text,
	"webhook_id" integer,
	"field_mapping" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to_id" text,
	"assigned_to_type" text DEFAULT 'user',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"batch_id" integer,
	"call_execution_id" integer,
	"transferred_to" text NOT NULL,
	"type" text DEFAULT 'cold' NOT NULL,
	"summary" text,
	"outcome" text,
	"duration_seconds" integer,
	"transfer_time" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_id" integer NOT NULL,
	"date" text NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"start_time" text,
	"end_time" text,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type_id" integer NOT NULL,
	"calendar_id" integer NOT NULL,
	"call_id" integer,
	"user_id" text NOT NULL,
	"attendee_name" text NOT NULL,
	"attendee_email" text NOT NULL,
	"attendee_notes" text,
	"slot_start" timestamp with time zone NOT NULL,
	"slot_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"booked_via" text DEFAULT 'web' NOT NULL,
	"location_type" text DEFAULT 'google_meet' NOT NULL,
	"location_address" text,
	"meet_link" text,
	"google_event_id" text,
	"cancelled_at" timestamp with time zone,
	"rescheduled_from_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"calendar_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_before_mins" integer DEFAULT 0 NOT NULL,
	"buffer_after_mins" integer DEFAULT 0 NOT NULL,
	"confirmation_mode" text DEFAULT 'instant' NOT NULL,
	"max_bookings_per_slot" integer DEFAULT 1 NOT NULL,
	"enable_google_meet" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "google_calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" timestamp with time zone,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"reconnect_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_calendar_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"token_expiry" timestamp with time zone,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_tokens_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "scheduling_calendars" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'My Calendar' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"host_email" text,
	"additional_hosts" text[],
	"google_calendar_connection_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_calendars_agent_id_unique" UNIQUE("agent_id")
);
--> statement-breakpoint
CREATE TABLE "user_google_oauth_config" (
	"user_id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_listed_voices" (
	"id" serial PRIMARY KEY NOT NULL,
	"voice_id" text NOT NULL,
	"voice_name" text NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"gender" text,
	"description" text DEFAULT '' NOT NULL,
	"is_listed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_listed_voices_voice_id_unique" UNIQUE("voice_id")
);
--> statement-breakpoint
CREATE TABLE "usage_spike_dismissals" (
	"clerk_id" text NOT NULL,
	"dismissed_date" date NOT NULL,
	CONSTRAINT "usage_spike_dismissals_clerk_id_dismissed_date_pk" PRIMARY KEY("clerk_id","dismissed_date")
);
--> statement-breakpoint
CREATE TABLE "usage_spike_notifications" (
	"clerk_id" text NOT NULL,
	"notified_date" date NOT NULL,
	CONSTRAINT "usage_spike_notifications_clerk_id_notified_date_pk" PRIMARY KEY("clerk_id","notified_date")
);
--> statement-breakpoint
CREATE TABLE "kyc_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text,
	"session_id" text,
	"event_type" text NOT NULL,
	"event_data" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vobiz_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vobiz_auth_id" text NOT NULL,
	"vobiz_auth_token_encrypted" text NOT NULL,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"verified_data" jsonb,
	"extracted_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vobiz_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "vobiz_kyc_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vobiz_session_id" text NOT NULL,
	"vobiz_account_auth_id" text NOT NULL,
	"flow_type" text DEFAULT 'redirect' NOT NULL,
	"status" text DEFAULT 'link_ready' NOT NULL,
	"widget_url" text,
	"redirect_url" text,
	"webhook_payload" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vobiz_kyc_sessions_vobiz_session_id_unique" UNIQUE("vobiz_session_id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"call_id" integer,
	"user_id" text,
	"workspace_id" text,
	"service" text NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" integer DEFAULT 0 NOT NULL,
	"characters" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"estimated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"success" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "provider_pricing" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_token_price_per_million_micros" bigint DEFAULT 0 NOT NULL,
	"output_token_price_per_million_micros" bigint DEFAULT 0 NOT NULL,
	"audio_second_price_micros" bigint DEFAULT 0 NOT NULL,
	"character_price_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"provider" text NOT NULL,
	"workspace_id" text,
	"allocated_cost_micros" bigint DEFAULT 0 NOT NULL,
	"low_balance_threshold_micros" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"service" text,
	"provider" text,
	"model" text,
	"payload" jsonb,
	"dedupe_key" text NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text
);
--> statement-breakpoint
CREATE TABLE "alert_notification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"alert_id" integer,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"extracted_text" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "meta_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"page_name" text,
	"form_id" text NOT NULL,
	"form_name" text,
	"agent_id" integer,
	"phone_number_id" integer,
	"access_token_encrypted" text NOT NULL,
	"webhook_token" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_integrations_webhook_token_unique" UNIQUE("webhook_token")
);
--> statement-breakpoint
CREATE TABLE "meta_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"integration_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"leadgen_id" text NOT NULL,
	"lead_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phone" text,
	"name" text,
	"email" text,
	"call_status" text DEFAULT 'pending' NOT NULL,
	"call_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"call_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_leads_leadgen_id_unique" UNIQUE("leadgen_id")
);
--> statement-breakpoint
CREATE TABLE "call_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"call_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"transfer_to" text NOT NULL,
	"transfer_name" text,
	"summary" text,
	"status" text DEFAULT 'initiated' NOT NULL,
	"provider_transfer_id" text,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "provider_minute_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"provider_name" text NOT NULL,
	"rate_cents_per_min" integer DEFAULT 0 NOT NULL,
	"label" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verified_phone_destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ambient_sounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"pcm_storage_key" text,
	"mime_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"duration_seconds" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caller_facts" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"phone_number" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"source_call_id" integer,
	"superseded_by_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caller_call_archive" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"phone_number" text NOT NULL,
	"call_id" integer,
	"transcript" text NOT NULL,
	"summary" text,
	"duration_seconds" integer,
	"facts_extracted" boolean DEFAULT false NOT NULL,
	"sentiment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caller_sentences" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"sequence_num" integer NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caller_fact_sentence_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"fact_id" integer NOT NULL,
	"sentence_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "caller_episode_fact_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"fact_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_prints" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" integer NOT NULL,
	"phone_number" text NOT NULL,
	"azure_profile_id" text NOT NULL,
	"enrollment_status" text DEFAULT 'pending' NOT NULL,
	"enrollment_speech_seconds" real DEFAULT 0 NOT NULL,
	"last_identified_at" timestamp,
	"last_confidence_score" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_document_id_kb_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."kb_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD CONSTRAINT "kb_chunks_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD CONSTRAINT "kb_documents_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_knowledge_base_id_knowledge_bases_id_fk" FOREIGN KEY ("knowledge_base_id") REFERENCES "public"."knowledge_bases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_profiles" ADD CONSTRAINT "caller_profiles_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_callbacks" ADD CONSTRAINT "scheduled_callbacks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_callbacks" ADD CONSTRAINT "scheduled_callbacks_created_from_call_id_calls_id_fk" FOREIGN KEY ("created_from_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_callbacks" ADD CONSTRAINT "scheduled_callbacks_campaign_lead_id_campaign_leads_id_fk" FOREIGN KEY ("campaign_lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_daily_metrics" ADD CONSTRAINT "batch_daily_metrics_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_batches" ADD CONSTRAINT "campaign_batches_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "call_bookings_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "call_bookings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "call_bookings_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_bookings" ADD CONSTRAINT "call_bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_callbacks" ADD CONSTRAINT "call_callbacks_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_callbacks" ADD CONSTRAINT "call_callbacks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_callbacks" ADD CONSTRAINT "call_callbacks_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_executions" ADD CONSTRAINT "call_executions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_executions" ADD CONSTRAINT "call_executions_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_executions" ADD CONSTRAINT "call_executions_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_executions" ADD CONSTRAINT "call_executions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_retries" ADD CONSTRAINT "call_retries_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_retries" ADD CONSTRAINT "call_retries_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_calls" ADD CONSTRAINT "incoming_calls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_calls" ADD CONSTRAINT "incoming_calls_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_calls" ADD CONSTRAINT "incoming_calls_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_calls" ADD CONSTRAINT "incoming_calls_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interaction_summaries" ADD CONSTRAINT "lead_interaction_summaries_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_interaction_summaries" ADD CONSTRAINT "lead_interaction_summaries_last_call_id_calls_id_fk" FOREIGN KEY ("last_call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_timeline" ADD CONSTRAINT "lead_timeline_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_timeline" ADD CONSTRAINT "lead_timeline_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_variables" ADD CONSTRAINT "agent_variables_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_health_snapshots" ADD CONSTRAINT "batch_health_snapshots_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_health_snapshots" ADD CONSTRAINT "batch_health_snapshots_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_import_runs" ADD CONSTRAINT "batch_import_runs_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_import_runs" ADD CONSTRAINT "batch_import_runs_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_transfers" ADD CONSTRAINT "lead_transfers_lead_id_campaign_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."campaign_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_transfers" ADD CONSTRAINT "lead_transfers_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_transfers" ADD CONSTRAINT "lead_transfers_batch_id_campaign_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."campaign_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_transfers" ADD CONSTRAINT "lead_transfers_call_execution_id_call_executions_id_fk" FOREIGN KEY ("call_execution_id") REFERENCES "public"."call_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_calendar_id_scheduling_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."scheduling_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_calendar_id_scheduling_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."scheduling_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_calendar_id_scheduling_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."scheduling_calendars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_calendar_id_scheduling_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."scheduling_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_calendars" ADD CONSTRAINT "scheduling_calendars_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_calendars" ADD CONSTRAINT "scheduling_calendars_google_calendar_connection_id_fkey" FOREIGN KEY ("google_calendar_connection_id") REFERENCES "public"."google_calendar_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_audit_logs" ADD CONSTRAINT "kyc_audit_logs_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vobiz_accounts" ADD CONSTRAINT "vobiz_accounts_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vobiz_kyc_sessions" ADD CONSTRAINT "vobiz_kyc_sessions_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_integrations" ADD CONSTRAINT "meta_integrations_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_integrations" ADD CONSTRAINT "meta_integrations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_integrations" ADD CONSTRAINT "meta_integrations_phone_number_id_phone_numbers_id_fk" FOREIGN KEY ("phone_number_id") REFERENCES "public"."phone_numbers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_integration_id_meta_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."meta_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_leads" ADD CONSTRAINT "meta_leads_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transfers" ADD CONSTRAINT "call_transfers_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transfers" ADD CONSTRAINT "call_transfers_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_phone_destinations" ADD CONSTRAINT "verified_phone_destinations_user_id_users_clerk_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("clerk_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_facts" ADD CONSTRAINT "caller_facts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_facts" ADD CONSTRAINT "caller_facts_superseded_by_id_caller_facts_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."caller_facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_call_archive" ADD CONSTRAINT "caller_call_archive_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_sentences" ADD CONSTRAINT "caller_sentences_episode_id_caller_call_archive_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."caller_call_archive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_fact_sentence_links" ADD CONSTRAINT "caller_fact_sentence_links_fact_id_caller_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."caller_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_fact_sentence_links" ADD CONSTRAINT "caller_fact_sentence_links_sentence_id_caller_sentences_id_fk" FOREIGN KEY ("sentence_id") REFERENCES "public"."caller_sentences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_episode_fact_links" ADD CONSTRAINT "caller_episode_fact_links_episode_id_caller_call_archive_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."caller_call_archive"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caller_episode_fact_links" ADD CONSTRAINT "caller_episode_fact_links_fact_id_caller_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."caller_facts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_prints" ADD CONSTRAINT "voice_prints_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "caller_profiles_agent_phone_uidx" ON "caller_profiles" USING btree ("agent_id","phone_number");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_daily_metrics_batch_date_idx" ON "batch_daily_metrics" USING btree ("batch_id","date");--> statement-breakpoint
CREATE INDEX "batch_daily_metrics_batch_idx" ON "batch_daily_metrics" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "campaign_batches_campaign_id_idx" ON "campaign_batches" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_batches_status_idx" ON "campaign_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaign_leads_campaign_id_idx" ON "campaign_leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_batch_id_idx" ON "campaign_leads" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_call_status_idx" ON "campaign_leads" USING btree ("call_status");--> statement-breakpoint
CREATE INDEX "campaign_leads_operational_outcome_idx" ON "campaign_leads" USING btree ("operational_outcome");--> statement-breakpoint
CREATE INDEX "campaign_leads_normalized_phone_idx" ON "campaign_leads" USING btree ("normalized_phone");--> statement-breakpoint
CREATE INDEX "campaign_leads_campaign_status_idx" ON "campaign_leads" USING btree ("campaign_id","call_status");--> statement-breakpoint
CREATE INDEX "call_bookings_lead_id_idx" ON "call_bookings" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "call_bookings_campaign_id_idx" ON "call_bookings" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "call_bookings_batch_id_idx" ON "call_bookings" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "call_bookings_status_idx" ON "call_bookings" USING btree ("meeting_status");--> statement-breakpoint
CREATE INDEX "call_callbacks_lead_id_idx" ON "call_callbacks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "call_callbacks_campaign_id_idx" ON "call_callbacks" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "call_callbacks_status_idx" ON "call_callbacks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "call_callbacks_callback_at_idx" ON "call_callbacks" USING btree ("callback_at");--> statement-breakpoint
CREATE INDEX "call_executions_lead_id_idx" ON "call_executions" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "call_executions_campaign_id_idx" ON "call_executions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "call_executions_call_id_idx" ON "call_executions" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_executions_batch_id_idx" ON "call_executions" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "call_retries_lead_id_idx" ON "call_retries" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "call_retries_status_scheduled_idx" ON "call_retries" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "incoming_calls_user_id_idx" ON "incoming_calls" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "incoming_calls_campaign_id_idx" ON "incoming_calls" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "incoming_calls_lead_id_idx" ON "incoming_calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "incoming_calls_status_idx" ON "incoming_calls" USING btree ("incoming_call_status");--> statement-breakpoint
CREATE INDEX "lead_timeline_lead_id_idx" ON "lead_timeline" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_timeline_campaign_id_idx" ON "lead_timeline" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "lead_timeline_lead_created_idx" ON "lead_timeline" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_dnc_user_id_idx" ON "workspace_dnc" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_dnc_normalized_phone_idx" ON "workspace_dnc" USING btree ("normalized_phone");--> statement-breakpoint
CREATE INDEX "workspace_dnc_user_phone_idx" ON "workspace_dnc" USING btree ("user_id","normalized_phone");--> statement-breakpoint
CREATE INDEX "agent_variables_agent_id_idx" ON "agent_variables" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "batch_health_snapshots_batch_id_idx" ON "batch_health_snapshots" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "batch_health_snapshots_campaign_id_idx" ON "batch_health_snapshots" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "batch_health_snapshots_time_idx" ON "batch_health_snapshots" USING btree ("snapshot_time");--> statement-breakpoint
CREATE INDEX "batch_import_runs_batch_id_idx" ON "batch_import_runs" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "lead_notes_lead_id_idx" ON "lead_notes" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_sources_user_id_idx" ON "lead_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lead_sources_campaign_id_idx" ON "lead_sources" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "lead_tags_lead_id_idx" ON "lead_tags" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_lead_id_idx" ON "lead_tasks" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_tasks_status_idx" ON "lead_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lead_transfers_lead_id_idx" ON "lead_transfers" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_transfers_campaign_id_idx" ON "lead_transfers" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connections_user_email_idx" ON "google_calendar_connections" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX "google_calendar_connections_user_idx" ON "google_calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_audit_logs_user_id_idx" ON "kyc_audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_created_idx" ON "usage_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_events_service_idx" ON "usage_events" USING btree ("service","provider","model");--> statement-breakpoint
CREATE INDEX "usage_events_user_idx" ON "usage_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_idx" ON "usage_events" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_events_call_idx" ON "usage_events" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "usage_events_success_idx" ON "usage_events" USING btree ("success");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_pricing_uniq_idx" ON "provider_pricing" USING btree ("service","provider","model");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_allocations_uniq_idx" ON "provider_allocations" USING btree ("service","provider","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_alerts_dedupe_uniq_idx" ON "admin_alerts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "admin_alerts_created_idx" ON "admin_alerts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_alerts_ack_idx" ON "admin_alerts" USING btree ("acknowledged_at");--> statement-breakpoint
CREATE INDEX "alert_notification_log_created_idx" ON "alert_notification_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_notification_log_channel_idx" ON "alert_notification_log" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "alert_notification_log_status_idx" ON "alert_notification_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "user_api_keys_user_id_idx" ON "user_api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meta_integrations_user_idx" ON "meta_integrations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meta_leads_integration_idx" ON "meta_leads" USING btree ("integration_id");--> statement-breakpoint
CREATE INDEX "meta_leads_user_idx" ON "meta_leads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "call_transfers_call_idx" ON "call_transfers" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_transfers_user_idx" ON "call_transfers" USING btree ("user_id","initiated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_minute_rates_uniq_idx" ON "provider_minute_rates" USING btree ("category","provider_name");--> statement-breakpoint
CREATE UNIQUE INDEX "vpd_user_phone_idx" ON "verified_phone_destinations" USING btree ("user_id","phone_number");--> statement-breakpoint
CREATE INDEX "caller_facts_lookup_idx" ON "caller_facts" USING btree ("agent_id","phone_number");--> statement-breakpoint
CREATE INDEX "caller_facts_key_idx" ON "caller_facts" USING btree ("agent_id","phone_number","key");--> statement-breakpoint
CREATE INDEX "caller_facts_active_idx" ON "caller_facts" USING btree ("agent_id","phone_number","superseded_by_id");--> statement-breakpoint
CREATE INDEX "caller_call_archive_lookup_idx" ON "caller_call_archive" USING btree ("agent_id","phone_number");--> statement-breakpoint
CREATE INDEX "caller_sentences_episode_idx" ON "caller_sentences" USING btree ("episode_id","sequence_num");--> statement-breakpoint
CREATE INDEX "cfs_links_fact_idx" ON "caller_fact_sentence_links" USING btree ("fact_id");--> statement-breakpoint
CREATE INDEX "cfs_links_sentence_idx" ON "caller_fact_sentence_links" USING btree ("sentence_id");--> statement-breakpoint
CREATE INDEX "cef_links_episode_idx" ON "caller_episode_fact_links" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "cef_links_fact_idx" ON "caller_episode_fact_links" USING btree ("fact_id");