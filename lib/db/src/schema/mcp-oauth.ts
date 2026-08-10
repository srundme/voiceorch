import { pgTable, serial, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Dynamically registered OAuth clients (Claude custom connectors, etc.). */
export const mcpOauthClientsTable = pgTable(
  "mcp_oauth_clients",
  {
    id:           serial("id").primaryKey(),
    clientId:     text("client_id").notNull(),
    clientSecret: text("client_secret"),
    clientName:   text("client_name"),
    redirectUris: text("redirect_uris").notNull(), // JSON string array
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mcp_oauth_clients_client_id_uidx").on(t.clientId)],
);

/** Short-lived authorization codes (PKCE). */
export const mcpOauthCodesTable = pgTable(
  "mcp_oauth_codes",
  {
    id:                serial("id").primaryKey(),
    codeHash:          text("code_hash").notNull(),
    clientId:          text("client_id").notNull(),
    userId:            text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    redirectUri:       text("redirect_uri").notNull(),
    codeChallenge:     text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    apiKeyCiphertext:  text("api_key_ciphertext").notNull(),
    expiresAt:         timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt:            timestamp("used_at", { withTimezone: true }),
    createdAt:         timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_oauth_codes_code_hash_uidx").on(t.codeHash),
    index("mcp_oauth_codes_client_id_idx").on(t.clientId),
  ],
);

/** Opaque MCP access tokens (mcp_at_…). */
export const mcpOauthTokensTable = pgTable(
  "mcp_oauth_tokens",
  {
    id:               serial("id").primaryKey(),
    tokenHash:        text("token_hash").notNull(),
    clientId:         text("client_id").notNull(),
    userId:           text("user_id").notNull().references(() => usersTable.clerkId, { onDelete: "cascade" }),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    expiresAt:        timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt:        timestamp("revoked_at", { withTimezone: true }),
    createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_oauth_tokens_token_hash_uidx").on(t.tokenHash),
    index("mcp_oauth_tokens_user_id_idx").on(t.userId),
  ],
);

export type McpOauthClient = typeof mcpOauthClientsTable.$inferSelect;
export type McpOauthCode = typeof mcpOauthCodesTable.$inferSelect;
export type McpOauthToken = typeof mcpOauthTokensTable.$inferSelect;
