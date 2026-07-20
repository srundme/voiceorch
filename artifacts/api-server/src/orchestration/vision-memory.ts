/**
 * Vision common-sense + in-call people/visual memory.
 *
 * Fixes the "wife on camera gets called by the caller's name" failure mode:
 *  1. Static rules baked into the system prompt for vision agents
 *  2. A live people map updated from introductions / analyze_image notes
 *  3. Cross-call: family_members durable fact when we learn related people
 */

export type VisionPersonRole =
  | "primary_caller"
  | "spouse"
  | "family"
  | "colleague"
  | "other"
  | "unknown";

export interface VisionPerson {
  /** Display name if known; otherwise a role label like "wife". */
  label: string;
  role: VisionPersonRole;
  /** True when this person is believed to be speaking / on camera now. */
  active?: boolean;
  notes?: string;
}

export interface CallVisionSnapshot {
  people: VisionPerson[];
  visualNotes: string[];
  dirty: boolean;
}

const ROLE_PATTERNS: Array<{ re: RegExp; role: VisionPersonRole; label: string }> = [
  { re: /\b(?:my\s+)?(?:wife|wifie)\b/i, role: "spouse", label: "wife" },
  { re: /\b(?:my\s+)?(?:husband|hubby)\b/i, role: "spouse", label: "husband" },
  { re: /\b(?:my\s+)?(?:spouse|partner)\b/i, role: "spouse", label: "spouse" },
  { re: /\b(?:my\s+)?(?:mother|mom|mummy|amma)\b/i, role: "family", label: "mother" },
  { re: /\b(?:my\s+)?(?:father|dad|daddy|appa)\b/i, role: "family", label: "father" },
  { re: /\b(?:my\s+)?(?:son|daughter|kid|child|children)\b/i, role: "family", label: "child" },
  { re: /\b(?:my\s+)?(?:brother|sister|sibling)\b/i, role: "family", label: "sibling" },
  { re: /\b(?:my\s+)?(?:colleague|coworker|co-worker|boss|manager)\b/i, role: "colleague", label: "colleague" },
  { re: /\b(?:my\s+)?(?:friend)\b/i, role: "other", label: "friend" },
];

/** Static common-sense block for vision-capable agents. */
export function buildVisionCommonSenseBlock(): string {
  return `[VISION COMMON SENSE — NON-NEGOTIABLE]
- The account holder / primary caller name is NOT automatically the person on camera.
- If the caller introduces someone else ("this is my wife/husband/mother/colleague"), that person is a DIFFERENT identity. Do NOT address them with the primary caller's name or Sir/Ma'am tied to the primary caller.
- When a second person appears or speaks, confirm who you are speaking with before using any name. Prefer: "Nice to meet you — may I know your name?" over guessing.
- Multiple faces or a phone handoff ≠ same person. Keep a mental people map: primary caller vs others present.
- Only describe what you actually see or what analyze_image returned. Never invent ID numbers, document fields, or injuries.
- If unsure who is who, ask one short clarifying question — do not keep using the wrong name.`;
}

export function appendVisionCommonSense(basePrompt: string): string {
  if (basePrompt.includes("[VISION COMMON SENSE")) return basePrompt;
  return `${basePrompt}\n\n${buildVisionCommonSenseBlock()}`;
}

/** Pull "Name: X" from the CALLER MEMORY block if present. */
export function extractKnownCallerNameFromPrompt(systemPrompt: string): string | null {
  const m = /=== CALLER MEMORY ===[\s\S]{0,400}?Name:\s*([^\n|]+)/i.exec(systemPrompt);
  if (!m?.[1]) return null;
  const name = m[1].trim();
  if (!name || /^unknown$/i.test(name)) return null;
  return name.slice(0, 80);
}

export class CallVisionMemory {
  private people: VisionPerson[] = [];
  private visualNotes: string[] = [];
  private dirty = false;

  constructor(primaryName?: string | null) {
    if (primaryName?.trim()) {
      this.people.push({
        label: primaryName.trim(),
        role: "primary_caller",
        active: true,
      });
    } else {
      this.people.push({
        label: "primary caller",
        role: "primary_caller",
        active: true,
      });
    }
  }

  /** Seed / refresh primary caller name when latched mid-call. */
  setPrimaryName(name: string): void {
    const cleaned = name.trim().slice(0, 80);
    if (!cleaned) return;
    const primary = this.people.find((p) => p.role === "primary_caller");
    if (primary) {
      if (primary.label !== cleaned) {
        primary.label = cleaned;
        this.dirty = true;
      }
    } else {
      this.people.unshift({ label: cleaned, role: "primary_caller", active: true });
      this.dirty = true;
    }
  }

  observeUserSpeech(text: string): boolean {
    const t = text.trim();
    if (!t || t.length < 4) return false;
    let changed = false;

    // "this is my wife, Priya" / "I'm handing the phone to my husband Ravi"
    for (const { re, role, label } of ROLE_PATTERNS) {
      if (!re.test(t)) continue;
      const named = extractIntroducedName(t, label);
      const personLabel = named ?? label;
      if (this.upsertPerson({ label: personLabel, role, notes: `introduced in speech: ${t.slice(0, 120)}` })) {
        changed = true;
      }
      // Introduction implies focus may shift to the other person.
      this.markActive(personLabel);
      changed = true;
      break;
    }

    // Explicit "speaking with X" / "talking to my wife"
    if (/\b(?:speaking|talking)\s+(?:with|to)\s+(?:my\s+)?(\w+)/i.test(t)) {
      const m = /\b(?:speaking|talking)\s+(?:with|to)\s+(?:my\s+)?(\w+)/i.exec(t);
      const who = m?.[1]?.trim();
      if (who && who.length > 1) {
        const roleHit = ROLE_PATTERNS.find((p) => p.re.test(who) || p.label === who.toLowerCase());
        this.upsertPerson({
          label: who,
          role: roleHit?.role ?? "unknown",
        });
        this.markActive(who);
        changed = true;
      }
    }

    if (changed) this.dirty = true;
    return changed;
  }

  /** Record what analyze_image / live vision described. */
  noteVisualFinding(text: string): void {
    const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!cleaned) return;
    if (this.visualNotes[this.visualNotes.length - 1] === cleaned) return;
    this.visualNotes.push(cleaned);
    if (this.visualNotes.length > 8) this.visualNotes.shift();
    this.dirty = true;

    // Soft: if finding mentions wife/husband etc., add person.
    for (const { re, role, label } of ROLE_PATTERNS) {
      if (re.test(cleaned)) {
        this.upsertPerson({ label, role, notes: "seen/mentioned in vision analysis" });
        break;
      }
    }
  }

  consumeDirty(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    return true;
  }

  snapshot(): CallVisionSnapshot {
    return {
      people: this.people.map((p) => ({ ...p })),
      visualNotes: [...this.visualNotes],
      dirty: this.dirty,
    };
  }

  /** Prompt block for the current turn / Live session update. */
  formatPromptBlock(): string | null {
    const others = this.people.filter((p) => p.role !== "primary_caller");
    if (others.length === 0 && this.visualNotes.length === 0) {
      const primary = this.people.find((p) => p.role === "primary_caller");
      if (!primary || primary.label === "primary caller") return null;
    }

    const lines: string[] = ["=== VISION / PEOPLE MEMORY (this call) ==="];
    lines.push("Use this map when addressing people. Wrong-name mistakes are unacceptable.");
    for (const p of this.people) {
      const active = p.active ? " ← currently focus" : "";
      lines.push(`- ${p.role}: ${p.label}${active}${p.notes ? ` (${p.notes})` : ""}`);
    }
    if (this.visualNotes.length > 0) {
      lines.push("Recent visual notes:");
      for (const n of this.visualNotes.slice(-4)) lines.push(`  • ${n}`);
    }
    lines.push(
      "If focus person ≠ primary_caller, do not use the primary caller's name for them.",
    );
    return lines.join("\n");
  }

  /** Value for durable fact family_members (cross-call). */
  toFamilyMembersFact(): string | null {
    const others = this.people.filter((p) => p.role !== "primary_caller" && p.label !== "primary caller");
    if (others.length === 0) return null;
    return others
      .map((p) => (p.role === "unknown" ? p.label : `${p.role.replace(/_/g, " ")}: ${p.label}`))
      .join("; ")
      .slice(0, 240);
  }

  private upsertPerson(person: VisionPerson): boolean {
    const key = person.label.toLowerCase();
    const existing = this.people.find(
      (p) => p.label.toLowerCase() === key || (p.role === person.role && p.role !== "unknown" && p.role !== "other" && p.label.toLowerCase() === person.role),
    );
    // Match by role label like "wife" when no proper name yet
    const byRole = this.people.find(
      (p) => p.role === person.role && p.role !== "primary_caller" && p.role !== "unknown" && p.role !== "other"
        && (p.label.toLowerCase() === person.role || p.label.toLowerCase() === key),
    );
    const target = existing ?? byRole;
    if (target) {
      let changed = false;
      // Upgrade "wife" → "Priya" when we learn a proper name
      if (person.label.length > target.label.length || (/^[A-Z]/.test(person.label) && target.label === person.role)) {
        if (target.label !== person.label) {
          target.label = person.label;
          changed = true;
        }
      }
      if (person.notes && person.notes !== target.notes) {
        target.notes = person.notes;
        changed = true;
      }
      return changed;
    }
    this.people.push({ ...person, active: false });
    return true;
  }

  private markActive(label: string): void {
    const key = label.toLowerCase();
    for (const p of this.people) {
      p.active = p.label.toLowerCase() === key || p.role === label.toLowerCase();
    }
  }
}

/** "this is my wife Priya" / "my wife, Priya" → Priya */
function extractIntroducedName(text: string, roleLabel: string): string | null {
  const escaped = roleLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:this\\s+is|meet|introduce(?:ing)?|hand(?:ing)?\\s+(?:the\\s+)?(?:phone|call)\\s+to)\\s+(?:my\\s+)?${escaped}[,\\s]+([A-Z][a-zA-Z]{1,30})`, "i"),
    new RegExp(`(?:my\\s+)?${escaped}[,\\s]+(?:is\\s+)?([A-Z][a-zA-Z]{1,30})`, "i"),
    new RegExp(`([A-Z][a-zA-Z]{1,30})[,\\s]+(?:my\\s+)?${escaped}`, "i"),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const name = m?.[1]?.trim();
    if (name && !/^(my|the|his|her|our|this|that|here|she|he)$/i.test(name)) {
      return name;
    }
  }
  return null;
}
