import { and, eq, ne } from "drizzle-orm";
import { db, agentsTable, phoneNumbersTable } from "@workspace/db";
import { PhoneAlreadyAssignedError, refuseSilentPhoneMove } from "./voice-number-assign-policy.js";

export { PhoneAlreadyAssignedError, refuseSilentPhoneMove };

export async function attachVoiceNumberToAgent(opts: {
  phoneNumberId: number;
  agentId: number;
  numberOwnerUserId: string;
  allowReassign: boolean;
}): Promise<{ number: string; previousAgentId: number | null }> {
  const [phone] = await db
    .select({
      id: phoneNumbersTable.id,
      number: phoneNumbersTable.number,
      agentId: phoneNumbersTable.agentId,
      service: phoneNumbersTable.service,
    })
    .from(phoneNumbersTable)
    .where(and(
      eq(phoneNumbersTable.id, opts.phoneNumberId),
      eq(phoneNumbersTable.userId, opts.numberOwnerUserId),
    ))
    .limit(1);

  if (!phone) {
    throw new Error("Phone number not found");
  }
  if (phone.service === "whatsapp") {
    throw new Error("This is a WhatsApp number — it can't take voice agents.");
  }
  if (refuseSilentPhoneMove(phone.agentId, opts.agentId, opts.allowReassign)) {
    throw new PhoneAlreadyAssignedError(phone.number, phone.agentId!);
  }

  const previousAgentId = phone.agentId ?? null;

  await db.update(phoneNumbersTable)
    .set({ agentId: opts.agentId })
    .where(and(
      eq(phoneNumbersTable.id, phone.id),
      eq(phoneNumbersTable.userId, opts.numberOwnerUserId),
    ));

  await db.update(agentsTable)
    .set({ inboundPhoneNumberId: null })
    .where(and(eq(agentsTable.inboundPhoneNumberId, phone.id), ne(agentsTable.id, opts.agentId)));
  await db.update(agentsTable)
    .set({ outboundPhoneNumberId: null })
    .where(and(eq(agentsTable.outboundPhoneNumberId, phone.id), ne(agentsTable.id, opts.agentId)));
  await db.update(agentsTable)
    .set({ inboundPhoneNumberId: phone.id, outboundPhoneNumberId: phone.id, updatedAt: new Date() })
    .where(eq(agentsTable.id, opts.agentId));

  return { number: phone.number, previousAgentId };
}
