import { db, systemPromptTemplatesTable, systemPromptDomainsTable } from "@workspace/db";
import { and, eq, desc, isNull, sql } from "drizzle-orm";

export type SystemTemplateType = "foundation" | "client_details" | "domain";

export const SINGLETON_TYPES: readonly SystemTemplateType[] = ["foundation", "client_details"];

/**
 * A "group" is a versioning + single-active scope:
 *  - foundation      → { type: "foundation" }
 *  - client_details  → { type: "client_details" }
 *  - a domain        → { type: "domain", domainId: N }
 */
export interface TemplateGroup {
  type: SystemTemplateType;
  domainId?: number | null;
}

function groupWhere(group: TemplateGroup) {
  if (group.type === "domain") {
    return and(
      eq(systemPromptTemplatesTable.templateType, "domain"),
      eq(systemPromptTemplatesTable.domainId, group.domainId!),
    );
  }
  return and(
    eq(systemPromptTemplatesTable.templateType, group.type),
    isNull(systemPromptTemplatesTable.domainId),
  );
}

export async function getNextVersion(group: TemplateGroup): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${systemPromptTemplatesTable.version}), 0)` })
    .from(systemPromptTemplatesTable)
    .where(groupWhere(group));
  return Number(row?.max ?? 0) + 1;
}

/** Insert a new version (deactivating any current active row in the same group). */
export async function insertVersion(
  group: TemplateGroup,
  data: { filename: string; mimeType: string; extractedText: string; uploadedBy: string },
) {
  return db.transaction(async (tx) => {
    await tx
      .update(systemPromptTemplatesTable)
      .set({ isActive: false })
      .where(and(groupWhere(group), eq(systemPromptTemplatesTable.isActive, true)));

    const version = await getNextVersion(group);
    const [row] = await tx
      .insert(systemPromptTemplatesTable)
      .values({
        templateType: group.type,
        domainId: group.type === "domain" ? group.domainId! : null,
        version,
        filename: data.filename,
        mimeType: data.mimeType,
        extractedText: data.extractedText,
        uploadedBy: data.uploadedBy,
        isActive: true,
      })
      .returning();
    return row!;
  });
}

/** Activate a specific version within its own group (deactivating its siblings). */
export async function activateVersion(id: number): Promise<void> {
  const [row] = await db
    .select()
    .from(systemPromptTemplatesTable)
    .where(eq(systemPromptTemplatesTable.id, id));
  if (!row) throw new Error("Template version not found");

  const group: TemplateGroup = { type: row.templateType as SystemTemplateType, domainId: row.domainId };
  await db.transaction(async (tx) => {
    await tx
      .update(systemPromptTemplatesTable)
      .set({ isActive: false })
      .where(and(groupWhere(group), eq(systemPromptTemplatesTable.isActive, true)));
    await tx
      .update(systemPromptTemplatesTable)
      .set({ isActive: true })
      .where(eq(systemPromptTemplatesTable.id, id));
  });
}

export interface VersionRow {
  id: number;
  version: number;
  filename: string;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: Date;
  isActive: boolean;
}

async function listGroupVersions(group: TemplateGroup): Promise<VersionRow[]> {
  return db
    .select({
      id: systemPromptTemplatesTable.id,
      version: systemPromptTemplatesTable.version,
      filename: systemPromptTemplatesTable.filename,
      mimeType: systemPromptTemplatesTable.mimeType,
      uploadedBy: systemPromptTemplatesTable.uploadedBy,
      uploadedAt: systemPromptTemplatesTable.uploadedAt,
      isActive: systemPromptTemplatesTable.isActive,
    })
    .from(systemPromptTemplatesTable)
    .where(groupWhere(group))
    .orderBy(desc(systemPromptTemplatesTable.version));
}

export interface DomainGroup {
  id: number;
  name: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  versions: VersionRow[];
  activeVersion: number | null;
}

export interface SingletonGroup {
  versions: VersionRow[];
  activeVersion: number | null;
}

export interface GroupedTemplates {
  foundation: SingletonGroup;
  clientDetails: SingletonGroup;
  domains: DomainGroup[];
}

function activeOf(versions: VersionRow[]): number | null {
  return versions.find((v) => v.isActive)?.version ?? null;
}

/** Full grouped snapshot for the admin page. */
export async function listGroupedTemplates(): Promise<GroupedTemplates> {
  const [foundationVersions, clientVersions, domainRows] = await Promise.all([
    listGroupVersions({ type: "foundation" }),
    listGroupVersions({ type: "client_details" }),
    db.select().from(systemPromptDomainsTable).orderBy(systemPromptDomainsTable.name),
  ]);

  const domains: DomainGroup[] = await Promise.all(
    domainRows.map(async (d) => {
      const versions = await listGroupVersions({ type: "domain", domainId: d.id });
      return {
        id: d.id,
        name: d.name,
        createdBy: d.createdBy,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        versions,
        activeVersion: activeOf(versions),
      };
    }),
  );

  return {
    foundation: { versions: foundationVersions, activeVersion: activeOf(foundationVersions) },
    clientDetails: { versions: clientVersions, activeVersion: activeOf(clientVersions) },
    domains,
  };
}

export async function getVersionDetail(id: number) {
  const [row] = await db
    .select()
    .from(systemPromptTemplatesTable)
    .where(eq(systemPromptTemplatesTable.id, id));
  return row ?? null;
}

// ── Layered generation helpers (dashboard "Generate System Prompt" modal) ─────

/** The currently active row (with extractedText) for a group, or null. */
export async function getActiveLayer(group: TemplateGroup) {
  const [row] = await db
    .select()
    .from(systemPromptTemplatesTable)
    .where(and(groupWhere(group), eq(systemPromptTemplatesTable.isActive, true)))
    .limit(1);
  return row ?? null;
}

export interface SystemPromptLayerStatus {
  available: boolean;
  version: number | null;
}

export interface SystemPromptDomainOption {
  id: number;
  name: string;
  version: number;
}

export interface SystemPromptStore {
  foundation: SystemPromptLayerStatus;
  clientDetails: SystemPromptLayerStatus;
  domains: SystemPromptDomainOption[];
}

/**
 * Snapshot for the dashboard generate modal: whether the Foundation and Client
 * Details layers have an active version, plus the Use-case dropdown options
 * (only domains that have an active version can drive a generation).
 */
export async function getSystemPromptStore(): Promise<SystemPromptStore> {
  const [foundation, clientDetails, domainRows] = await Promise.all([
    getActiveLayer({ type: "foundation" }),
    getActiveLayer({ type: "client_details" }),
    db.select().from(systemPromptDomainsTable).orderBy(systemPromptDomainsTable.name),
  ]);

  const domains: SystemPromptDomainOption[] = [];
  for (const d of domainRows) {
    const active = await getActiveLayer({ type: "domain", domainId: d.id });
    if (active) {
      domains.push({ id: d.id, name: d.name, version: active.version });
    }
  }

  return {
    foundation: { available: !!foundation, version: foundation?.version ?? null },
    clientDetails: { available: !!clientDetails, version: clientDetails?.version ?? null },
    domains,
  };
}

// ── Domain CRUD ──────────────────────────────────────────────────────────────

export async function getDomain(id: number) {
  const [row] = await db
    .select()
    .from(systemPromptDomainsTable)
    .where(eq(systemPromptDomainsTable.id, id));
  return row ?? null;
}

export async function createDomain(name: string, createdBy: string) {
  const [row] = await db
    .insert(systemPromptDomainsTable)
    .values({ name, createdBy })
    .returning();
  return row!;
}

export async function renameDomain(id: number, name: string) {
  const [row] = await db
    .update(systemPromptDomainsTable)
    .set({ name, updatedAt: new Date() })
    .where(eq(systemPromptDomainsTable.id, id))
    .returning();
  return row ?? null;
}

export async function deleteDomain(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(systemPromptTemplatesTable)
      .where(and(eq(systemPromptTemplatesTable.templateType, "domain"), eq(systemPromptTemplatesTable.domainId, id)));
    await tx.delete(systemPromptDomainsTable).where(eq(systemPromptDomainsTable.id, id));
  });
}
