import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,                          // allow up to 50 concurrent DB connections
  idleTimeoutMillis: 30_000,        // close idle connections after 30 s
  connectionTimeoutMillis: 5_000,   // fail fast rather than queue indefinitely
  keepAlive: true,                  // send TCP keepalives so Railway doesn't silently kill idle connections
  keepAliveInitialDelayMillis: 10_000,  // start keepalives after 10 s idle
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./identity-merge";
export * from "./caller-identity";
