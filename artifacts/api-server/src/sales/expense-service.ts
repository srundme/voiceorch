import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { salesExpensesTable, type SalesExpense } from "@workspace/db/schema";
import { notFound, writeAudit, type SalesActor, type SalesDb } from "./db.js";
import type { CreateExpenseInput, UpdateExpenseInput } from "./schemas.js";

async function loadExpense(db: SalesDb, id: number): Promise<SalesExpense> {
  const [e] = await db.select().from(salesExpensesTable).where(eq(salesExpensesTable.id, id));
  if (!e) throw notFound("Expense");
  return e;
}

export async function listExpenses(db: SalesDb, q: { from?: string; to?: string; category?: string; demo: boolean }) {
  const conds: SQL[] = [eq(salesExpensesTable.isDemo, q.demo)];
  if (q.from) conds.push(gte(salesExpensesTable.date, q.from));
  if (q.to) conds.push(lte(salesExpensesTable.date, q.to));
  if (q.category) conds.push(eq(salesExpensesTable.category, q.category));
  const items = await db.select().from(salesExpensesTable).where(and(...conds)).orderBy(desc(salesExpensesTable.date), desc(salesExpensesTable.id)).limit(1000);
  return { items, totalPaise: items.reduce((n, e) => n + e.amountPaise, 0) };
}

export async function createExpense(db: SalesDb, actor: SalesActor, input: CreateExpenseInput, isDemo = false) {
  const [created] = await db
    .insert(salesExpensesTable)
    .values({
      date: input.date,
      category: input.category,
      isAcquisition: input.isAcquisition ?? false,
      source: input.source ?? null,
      sourceCampaign: input.sourceCampaign ?? null,
      amountPaise: input.amountPaise,
      description: input.description ?? null,
      isDemo,
      createdBy: actor.id > 0 ? actor.id : null,
    })
    .returning();
  await writeAudit(db, { actorUserId: actor.id > 0 ? actor.id : null, entity: "sales_expense", entityId: created!.id, action: "created", after: created });
  return created!;
}

export async function updateExpense(db: SalesDb, actor: SalesActor, id: number, input: UpdateExpenseInput) {
  const before = await loadExpense(db, id);
  const [updated] = await db.update(salesExpensesTable).set(input).where(eq(salesExpensesTable.id, id)).returning();
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_expense", entityId: id, action: "updated", before, after: updated });
  return updated!;
}

export async function deleteExpense(db: SalesDb, actor: SalesActor, id: number) {
  const before = await loadExpense(db, id);
  await db.delete(salesExpensesTable).where(eq(salesExpensesTable.id, id));
  await writeAudit(db, { actorUserId: actor.id, entity: "sales_expense", entityId: id, action: "deleted", before });
}
