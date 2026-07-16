/**
 * Pluggable skill runtime for Agent Tasks.
 * Skills discover/enrich data; the orchestrator decides when to dial.
 */

export interface SkillContext {
  userId: string;
  taskId: number;
  /** Optional abort / timeout signal */
  signal?: AbortSignal;
}

export interface BusinessCandidate {
  name: string;
  phone: string | null;
  address: string | null;
  sourceUrl: string | null;
  placeId: string | null;
  rank: number;
  meta?: Record<string, unknown>;
}

export interface Skill<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  execute(input: TInput, ctx: SkillContext): Promise<TOutput>;
}

const registry = new Map<string, Skill>();

export function registerSkill<TInput, TOutput>(skill: Skill<TInput, TOutput>): void {
  registry.set(skill.id, skill as Skill);
}

export function getSkill(id: string): Skill | undefined {
  return registry.get(id);
}

export function listSkills(): Array<{ id: string; description: string }> {
  return [...registry.values()].map((s) => ({ id: s.id, description: s.description }));
}

export async function runSkill<TInput, TOutput>(
  id: string,
  input: TInput,
  ctx: SkillContext,
): Promise<TOutput> {
  const skill = registry.get(id);
  if (!skill) throw new Error(`Unknown skill: ${id}`);
  return skill.execute(input, ctx) as Promise<TOutput>;
}
