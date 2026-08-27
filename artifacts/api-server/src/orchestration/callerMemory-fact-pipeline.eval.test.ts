/**
 * Eval harness for the verification-gated caller fact pipeline (design §8).
 *
 * Labeled transcripts → validateFactCandidate / normalize / supersession.
 * Run after every prompt or gate change: precision & recall fail for different reasons.
 */
import { describe, it, expect } from "vitest";
import {
  canonicalizeFactKey,
  normalizeFactValue,
  validateFactCandidate,
  shouldSupersedeFact,
  MIN_FACT_CONFIDENCE,
} from "./callerMemory-durable-facts.js";

interface LabeledCase {
  id: string;
  /** What the pipeline should accept after validation. */
  expected: Array<{ key: string; value: string }>;
  /** Raw LLM-like candidates (may include garbage). */
  candidates: Array<{
    key: string;
    value: string;
    confidence: number;
    sentence_ids: number[];
  }>;
  callerSentenceIds: number[];
  notes?: string;
}

const CASES: LabeledCase[] = [
  {
    id: "direct-chennai",
    notes: "Direct statement — high confidence + citation",
    callerSentenceIds: [10, 11],
    expected: [{ key: "location", value: "Chennai" }, { key: "name", value: "Priya" }],
    candidates: [
      { key: "location", value: "Chennai", confidence: 0.95, sentence_ids: [10] },
      { key: "name", value: "Priya", confidence: 0.95, sentence_ids: [11] },
    ],
  },
  {
    id: "bangalore-alias",
    notes: "City alias must canonicalize to Bengaluru",
    callerSentenceIds: [3],
    expected: [{ key: "location", value: "Bengaluru" }],
    candidates: [
      { key: "city", value: "Bangalore", confidence: 0.9, sentence_ids: [3] },
    ],
  },
  {
    id: "self-correction",
    notes: "Last-stated value wins after dedupe (caller corrects city)",
    callerSentenceIds: [1, 2],
    expected: [{ key: "location", value: "Bengaluru" }],
    candidates: [
      { key: "location", value: "Chennai", confidence: 0.9, sentence_ids: [1] },
      { key: "location", value: "Bangalore", confidence: 0.92, sentence_ids: [2] },
    ],
  },
  {
    id: "agent-attribution-reject",
    notes: "Citing an agent sentence must be rejected",
    callerSentenceIds: [5],
    expected: [],
    candidates: [
      { key: "name", value: "Ravi", confidence: 0.95, sentence_ids: [99] },
    ],
  },
  {
    id: "missing-citation-reject",
    notes: "No sentence_ids → reject",
    callerSentenceIds: [5],
    expected: [],
    candidates: [
      { key: "email", value: "a@b.com", confidence: 0.9, sentence_ids: [] },
    ],
  },
  {
    id: "low-confidence-reject",
    notes: "Below MIN_FACT_CONFIDENCE",
    callerSentenceIds: [7],
    expected: [],
    candidates: [
      { key: "occupation", value: "engineer", confidence: 0.4, sentence_ids: [7] },
    ],
  },
  {
    id: "ephemeral-key-reject",
    notes: "Sales intent must never become a fact",
    callerSentenceIds: [8],
    expected: [],
    candidates: [
      { key: "interested_in", value: "term plan", confidence: 0.99, sentence_ids: [8] },
      { key: "budget", value: "5000", confidence: 0.99, sentence_ids: [8] },
    ],
  },
  {
    id: "product-as-name-reject",
    notes: "Plan/product must not become name",
    callerSentenceIds: [9],
    expected: [],
    candidates: [
      { key: "name", value: "managed plan", confidence: 0.95, sentence_ids: [9] },
    ],
  },
  {
    id: "language-alias",
    notes: "Hindi → hi",
    callerSentenceIds: [12],
    expected: [{ key: "language_pref", value: "hi" }],
    candidates: [
      { key: "language", value: "Hindi", confidence: 0.9, sentence_ids: [12] },
    ],
  },
  {
    id: "children-legacy-key",
    notes: "children_count synonym → family_children_count",
    callerSentenceIds: [15],
    expected: [{ key: "family_children_count", value: "2" }],
    candidates: [
      { key: "kids_count", value: "2", confidence: 0.9, sentence_ids: [15] },
    ],
  },
  {
    id: "ambiguous-two-cities-last-wins",
    notes: "From Chennai but working in Bangalore — last-stated as location",
    callerSentenceIds: [20, 21],
    expected: [{ key: "location", value: "Bengaluru" }],
    candidates: [
      { key: "location", value: "Chennai", confidence: 0.85, sentence_ids: [20] },
      { key: "location", value: "Bangalore", confidence: 0.88, sentence_ids: [21] },
    ],
  },
  {
    id: "existing-product-caller-stated",
    notes: "Named policy the caller said they already hold",
    callerSentenceIds: [30],
    expected: [{ key: "existing_product", value: "Galaxy Marvel" }],
    candidates: [
      { key: "policy_name", value: "Galaxy Marvel", confidence: 0.92, sentence_ids: [30] },
    ],
  },
  {
    id: "agent-pitch-not-a-fact",
    notes: "Agent wellness pitch must not become existing_product",
    callerSentenceIds: [31],
    expected: [],
    candidates: [
      { key: "existing_product", value: "Gala Fit", confidence: 0.99, sentence_ids: [99] },
      { key: "interested_in", value: "wellness add-on", confidence: 0.99, sentence_ids: [31] },
    ],
  },
];

function runCase(c: LabeledCase): Array<{ key: string; value: string }> {
  const callerSet = new Set(c.callerSentenceIds);
  const accepted: Array<{ key: string; value: string; confidence: number }> = [];
  for (const cand of c.candidates) {
    const result = validateFactCandidate({
      key: cand.key,
      value: cand.value,
      confidence: cand.confidence,
      sentenceIds: cand.sentence_ids,
      callerSentenceIds: callerSet,
      requireCitation: true,
    });
    if (result.ok && result.fact) {
      accepted.push({
        key: result.fact.key,
        value: result.fact.value,
        confidence: result.fact.confidence,
      });
    }
  }
  // Last-stated wins (same as production dedupe)
  const byKey = new Map<string, { key: string; value: string }>();
  for (const f of accepted) byKey.set(f.key, { key: f.key, value: f.value });
  return [...byKey.values()];
}

describe("caller fact pipeline eval harness", () => {
  it("tracks precision and recall across labeled cases", () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const failures: string[] = [];

    for (const c of CASES) {
      const got = runCase(c);
      const gotSet = new Set(got.map((g) => `${g.key}=${g.value}`));
      const expSet = new Set(c.expected.map((e) => `${e.key}=${e.value}`));

      for (const g of gotSet) {
        if (expSet.has(g)) tp++;
        else {
          fp++;
          failures.push(`${c.id}: false positive ${g}`);
        }
      }
      for (const e of expSet) {
        if (!gotSet.has(e)) {
          fn++;
          failures.push(`${c.id}: missed ${e}`);
        }
      }
    }

    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 1 : tp / (tp + fn);

    // Log metrics for humans; fail hard on any miss so regressions are loud.
    // eslint-disable-next-line no-console
    console.log(`fact-pipeline eval: precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} tp=${tp} fp=${fp} fn=${fn}`);

    expect(failures, failures.join("\n")).toEqual([]);
    expect(precision).toBe(1);
    expect(recall).toBe(1);
  });

  it("normalizers canonicalize cities and languages", () => {
    expect(normalizeFactValue("location", "BLR")).toBe("Bengaluru");
    expect(normalizeFactValue("location", "madras")).toBe("Chennai");
    expect(normalizeFactValue("language_pref", "Tamil")).toBe("ta");
    expect(normalizeFactValue("email", "Foo@Bar.COM")).toBe("foo@bar.com");
    expect(normalizeFactValue("name", "mr. karthi")).toBe("Karthi");
    expect(canonicalizeFactKey("kids_count")).toBe("family_children_count");
  });

  it("confidence-gated supersession (design §5)", () => {
    expect(shouldSupersedeFact({
      currentValue: "Chennai",
      currentConfidence: 0.95,
      newValue: "Chennai",
      newConfidence: 0.9,
    })).toBe("noop");

    expect(shouldSupersedeFact({
      currentValue: "Chennai",
      currentConfidence: 0.95,
      newValue: "Bengaluru",
      newConfidence: 0.5,
    })).toBe("discard");

    expect(shouldSupersedeFact({
      currentValue: "Chennai",
      currentConfidence: 0.95,
      newValue: "Bengaluru",
      newConfidence: 0.85, // >= HIGH_CONFIDENCE_OVERRIDE
    })).toBe("supersede");

    expect(shouldSupersedeFact({
      currentValue: "Chennai",
      currentConfidence: 0.7,
      newValue: "Bengaluru",
      newConfidence: 0.75,
    })).toBe("supersede");

    expect(MIN_FACT_CONFIDENCE).toBe(0.6);
  });
});
