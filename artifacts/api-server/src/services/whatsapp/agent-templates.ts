/**
 * Per-agent WhatsApp template picks for the native VoBiz channel.
 * Meta/BYO picks live on whatsapp_connections.meta_templates.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  whatsappAgentTemplatesTable,
  type AgentWaTemplates,
  type WaTplChoice,
} from "@workspace/db";
import { resolveMetaTemplate, type MetaTemplateChoice } from "./meta.js";
import type { TemplateHint, TemplateRef } from "./vobiz.js";
import { getTemplateCatalog } from "./vobiz.js";

const SLOT_KEYS = ["default", "call_summary", "booking_confirmed", "callback_scheduled"] as const;

export function normalizeAgentWaTemplates(raw: unknown): AgentWaTemplates {
  if (!raw || typeof raw !== "object") return {};
  const out: AgentWaTemplates = {};
  for (const key of SLOT_KEYS) {
    const v = (raw as Record<string, unknown>)[key];
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    if (typeof o["name"] === "string" && o["name"].trim()
      && typeof o["language"] === "string" && o["language"].trim()) {
      out[key] = {
        name: o["name"].trim(),
        language: o["language"].trim(),
        paramCount: Number.isFinite(Number(o["paramCount"])) ? Math.max(0, Number(o["paramCount"])) : 0,
      };
    }
  }
  return out;
}

export async function loadAgentWaTemplates(
  userId: string,
  agentId: number,
): Promise<AgentWaTemplates> {
  const [row] = await db
    .select({ templates: whatsappAgentTemplatesTable.templates })
    .from(whatsappAgentTemplatesTable)
    .where(and(
      eq(whatsappAgentTemplatesTable.agentId, agentId),
      eq(whatsappAgentTemplatesTable.userId, userId),
    ))
    .limit(1);
  return (row?.templates ?? {}) as AgentWaTemplates;
}

export async function upsertAgentWaTemplates(
  userId: string,
  agentId: number,
  templates: AgentWaTemplates,
): Promise<AgentWaTemplates> {
  const normalized = normalizeAgentWaTemplates(templates);
  const [row] = await db.insert(whatsappAgentTemplatesTable)
    .values({ agentId, userId, templates: normalized, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: whatsappAgentTemplatesTable.agentId,
      set: { templates: normalized, userId, updatedAt: new Date() },
    })
    .returning({ templates: whatsappAgentTemplatesTable.templates });
  return (row?.templates ?? normalized) as AgentWaTemplates;
}

/** True when at least default or one outcome is linked. */
export function hasAgentTemplatePicks(templates: AgentWaTemplates | null | undefined): boolean {
  if (!templates) return false;
  return SLOT_KEYS.some((k) => {
    const v = templates[k];
    return !!(v?.name && v.language);
  });
}

/**
 * Resolve native VoBiz template for an agent: agent picks → platform shared catalog.
 */
export async function resolveNativeTemplateForAgent(
  userId: string,
  agentId: number | null | undefined,
  hint: TemplateHint,
): Promise<TemplateRef> {
  if (agentId != null && Number.isFinite(agentId)) {
    const picks = await loadAgentWaTemplates(userId, agentId);
    const choice = resolveMetaTemplate(
      picks as Record<string, MetaTemplateChoice | undefined>,
      hint,
    );
    if (choice) return { name: choice.name, lang: choice.language };
  }
  const catalog = await getTemplateCatalog();
  return catalog[hint] ?? catalog.call_summary;
}

export function choiceToOptionValue(c: WaTplChoice): string {
  return JSON.stringify({ name: c.name, language: c.language, paramCount: c.paramCount });
}
