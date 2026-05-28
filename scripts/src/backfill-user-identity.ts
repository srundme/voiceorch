import { createClerkClient } from "@clerk/backend";
import { db, usersTable } from "@workspace/db";
import { eq, isNull, or } from "drizzle-orm";

async function main() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    console.error("CLERK_SECRET_KEY env var is required");
    process.exit(1);
  }
  const clerk = createClerkClient({ secretKey });

  const rows = await db
    .select({ clerkId: usersTable.clerkId, email: usersTable.email, name: usersTable.name })
    .from(usersTable)
    .where(or(isNull(usersTable.email), isNull(usersTable.name)));

  console.log(`Found ${rows.length} users to backfill`);
  let ok = 0;
  let fail = 0;
  const batchSize = 5;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await Promise.all(batch.map(async (row) => {
      try {
        const u = await clerk.users.getUser(row.clerkId);
        const primaryId = u.primaryEmailAddressId;
        const primary = u.emailAddresses?.find((e) => e.id === primaryId) ?? u.emailAddresses?.[0];
        const email = primary?.emailAddress ?? null;
        const fullName = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
        const name = fullName || u.username || null;
        await db
          .update(usersTable)
          .set({
            email: row.email ?? email,
            name: row.name ?? name,
          })
          .where(eq(usersTable.clerkId, row.clerkId));
        ok++;
      } catch (err) {
        fail++;
        console.error(`Failed for ${row.clerkId}:`, (err as Error)?.message ?? err);
      }
    }));
    console.log(`Progress: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }

  console.log(`Done. Updated: ${ok}, Failed: ${fail}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
