export type TaxonomyMap = Record<string, string[]>;

export interface DomainField {
  key: string;
  type: "string" | "number" | "boolean";
  /** Human label for prompts / UI (optional for older configs). */
  label?: string;
  enum?: string[];
}

export interface TenantRule {
  when: string;
  value?: unknown;
  primary: string;
  sub: string;
  confidence: number;
}

export interface DispositionConfig {
  agentId: number;
  taxonomy: TaxonomyMap;
  domainFields: DomainField[];
  rules: TenantRule[];
  dispositionLlm?: string;
}

export interface CallEvent {
  type: string;
  [key: string]: unknown;
}

export interface PrefilterResult {
  primary: string;
  sub: string;
  confidence: number;
  rule: string;
}

export interface DispositionResult {
  primary: string;
  sub: string;
  confidence: number;
  evidence: string;
  summary: string;
  flags: string[];
  needsReview: boolean;
  domainFields?: Record<string, unknown>;
  error?: string;
}
