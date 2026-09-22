import { describe, it, expect } from "vitest";
import {
  buildKbQuery,
  buildKbQueryConservative,
  canonicalKnowledgeName,
  harvestOfferingNamesFromText,
  isReferentialQuery,
  resolveKbQueryBuilderMode,
  runKbQueryBuilder,
  kbHitOverlap,
  recentKbTurns,
  aliasesFromTitle,
} from "./kb-query-builder.js";

const CONCENTRIX: Parameters<typeof buildKbQuery>[0]["activeEntity"] = {
  type: "job",
  name: "Concentrix Adobe CS",
  attributes: { location: "MTP" },
};

describe("resolveKbQueryBuilderMode", () => {
  it("defaults to on (production)", () => {
    expect(resolveKbQueryBuilderMode({})).toBe("on");
    expect(resolveKbQueryBuilderMode({ KB_QUERY_BUILDER: "shadow" })).toBe("shadow");
    expect(resolveKbQueryBuilderMode({ KB_QUERY_BUILDER: "OFF" })).toBe("off");
    expect(resolveKbQueryBuilderMode({ KB_QUERY_BUILDER: "ON" })).toBe("on");
  });
});

describe("isReferentialQuery", () => {
  const refs = [
    "What about transport?",
    "How much?",
    "For freshers?",
    "What about girls?",
    "Is that included?",
    "How many days?",
    "Where is it?",
    "Can I apply?",
    "What about my wife?",
    "Is that free?",
    "And experience?",
    "And males?",
    "Transport iruka?",
  ];
  for (const u of refs) {
    it(`treats "${u}" as referential`, () => {
      expect(isReferentialQuery(u)).toBe(true);
    });
  }

  it("does not treat a self-contained JD question as referential", () => {
    expect(isReferentialQuery("What is the salary for the Concentrix Adobe CS role in MTP?")).toBe(false);
  });
});

describe("buildKbQuery", () => {
  it("augments transport with active job entity and location", () => {
    const r = buildKbQuery({
      utterance: "What about transport?",
      activeEntity: CONCENTRIX,
    });
    expect(r.searchQuery.toLowerCase()).toContain("concentrix");
    expect(r.searchQuery.toLowerCase()).toContain("adobe");
    expect(r.searchQuery.toLowerCase()).toContain("mtp");
    expect(r.searchQuery.toLowerCase()).toContain("transport");
    expect(r.contextualized).toBe(true);
    expect(r.queryStrategy).toBe("entity_topic_augmented");
    expect(r.searchQuery.length).toBeLessThanOrEqual(320);
  });

  it("uses previous agent turn for experienced CTC follow-up", () => {
    const r = buildKbQuery({
      utterance: "What about experienced?",
      previousAgentTurn: "The fresher CTC is around ₹37,000 to ₹38,000.",
      activeEntity: CONCENTRIX,
    });
    expect(r.searchQuery.toLowerCase()).toMatch(/experienced/);
    expect(r.searchQuery.toLowerCase()).toMatch(/ctc|salary/);
    expect(r.searchQuery.toLowerCase()).toContain("concentrix");
    expect(r.searchQuery).not.toMatch(/37000|38,000/);
  });

  it("resolves gender contrast from previous transport turn", () => {
    const r = buildKbQuery({
      utterance: "And males?",
      previousAgentTurn: "Female candidates receive one-way transport free.",
      activeEntity: CONCENTRIX,
    });
    expect(r.searchQuery.toLowerCase()).toMatch(/male/);
    expect(r.searchQuery.toLowerCase()).toContain("transport");
    expect(r.searchQuery.toLowerCase()).toContain("concentrix");
  });

  it("does not dump caller profile into a transport question", () => {
    const r = buildKbQuery({
      utterance: "What transport do they provide?",
      previousCallerTurn: "I'm a B.Com graduate. I have six months experience. I'm from Chennai. My expected salary is ₹30,000.",
      activeEntity: CONCENTRIX,
    });
    expect(r.searchQuery.toLowerCase()).not.toContain("b.com");
    expect(r.searchQuery.toLowerCase()).not.toContain("30000");
    expect(r.searchQuery.toLowerCase()).not.toContain("six months");
    expect(r.searchQuery.toLowerCase()).toContain("transport");
    expect(r.searchQuery.toLowerCase()).toContain("concentrix");
  });

  it("preserves code-mixed caller words", () => {
    const r = buildKbQuery({
      utterance: "Transport iruka?",
      activeEntity: CONCENTRIX,
    });
    expect(r.searchQuery.toLowerCase()).toContain("transport");
    expect(r.searchQuery.toLowerCase()).toContain("iruka");
    expect(r.searchQuery.toLowerCase()).toContain("concentrix");
  });

  it("leaves a self-contained factual question mostly intact", () => {
    const u = "What is the salary for the Concentrix Adobe CS role in MTP?";
    const r = buildKbQuery({ utterance: u, activeEntity: CONCENTRIX });
    expect(r.contextualized).toBe(false);
    expect(r.queryStrategy).toBe("raw");
    expect(r.searchQuery.toLowerCase()).toContain("salary");
    expect(r.searchQuery.toLowerCase()).toContain("concentrix");
  });

  it("pulls a policy name from the previous agent turn for how much", () => {
    const r = buildKbQuery({
      utterance: "How much for four people?",
      previousAgentTurn: "This is a family floater health insurance policy.",
      knownOfferings: ["Family Floater Health Insurance"],
    });
    expect(r.searchQuery.toLowerCase()).toMatch(/family|floater|insurance|health/);
    expect(r.searchQuery.toLowerCase()).toMatch(/premium|pricing|how/);
    expect(r.searchQuery.toLowerCase()).toContain("four");
    expect(r.entitySource).toBe("kb_alias");
  });

  it("falls back to the raw transcript when there is no context", () => {
    const r = buildKbQuery({ utterance: "Tell me about onboarding documents for the night shift." });
    expect(r.searchQuery.length).toBeGreaterThan(0);
    expect(r.fallbackUsed === true || r.searchQuery.toLowerCase().includes("onboarding") || r.searchQuery.toLowerCase().includes("night")).toBe(true);
  });
});

describe("runKbQueryBuilder", () => {
  it("never throws and records builderMs", () => {
    const r = runKbQueryBuilder({ utterance: "How much?", activeEntity: CONCENTRIX });
    expect(r.searchQuery.length).toBeGreaterThan(0);
    expect(r.builderMs).toBeGreaterThanOrEqual(0);
    expect(r.builderMs).toBeLessThan(50);
    expect(r.rawQuery).toBe("How much?");
  });
});

describe("recentKbTurns", () => {
  it("skips the current user utterance", () => {
    const r = recentKbTurns([
      { role: "assistant", content: "Adobe CS transport is free for women." },
      { role: "user", content: "I am from Chennai" },
      { role: "assistant", content: "Female candidates receive one-way transport free." },
      { role: "user", content: "And males?" },
    ]);
    expect(r.previousAgentTurn).toContain("Female candidates");
    expect(r.previousCallerTurn).toContain("Chennai");
  });
});

describe("sticky context override", () => {
  it("does not contaminate a new Infosys question with Concentrix transport", () => {
    const r = buildKbQuery({
      utterance: "Okay. What is the notice period for Infosys?",
      previousAgentTurn: "Concentrix provides transport for female candidates from MTP.",
      activeEntity: CONCENTRIX,
      activeTopic: "transport",
    });
    const q = r.searchQuery.toLowerCase();
    expect(q).toMatch(/infosys/);
    expect(q).toMatch(/notice/);
    expect(q).not.toMatch(/concentrix/);
    expect(q).not.toMatch(/adobe/);
    expect(q).not.toMatch(/transport/);
    expect(r.activeEntity?.name.toLowerCase()).toMatch(/infosys/);
    expect(r.activeTopic).toBe("notice");
  });

  it("overrides even when the new company is lowercased by STT", () => {
    const r = buildKbQuery({
      utterance: "What is the notice period for infosys?",
      previousAgentTurn: "Concentrix provides transport...",
      activeEntity: CONCENTRIX,
      activeTopic: "transport",
    });
    expect(r.searchQuery.toLowerCase()).toMatch(/infosys/);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/concentrix/);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/transport/);
  });

  it("does not attach the previous job to an unrelated new question", () => {
    const r = buildKbQuery({
      utterance: "Tell me about onboarding documents for the night shift.",
      previousAgentTurn: "Concentrix provides transport for female candidates from MTP.",
      activeEntity: CONCENTRIX,
      activeTopic: "transport",
    });
    expect(r.searchQuery.toLowerCase()).not.toMatch(/concentrix/);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/transport/);
    expect(r.searchQuery.toLowerCase()).toMatch(/onboarding|night|shift|documents/);
  });
});

describe("kbHitOverlap", () => {
  it("reports intersection over the larger list", () => {
    expect(kbHitOverlap([1, 2, 3], [2, 3, 9])).toBe("2/3");
  });
});

describe("referential conversation cases", () => {
  function step(
    utterance: string,
    prevAgent: string,
    state: { entity: typeof CONCENTRIX | null; topic: string | null },
  ) {
    const r = buildKbQuery({
      utterance,
      previousAgentTurn: prevAgent,
      activeEntity: state.entity,
      activeTopic: state.topic,
    });
    if (r.activeEntity) state.entity = r.activeEntity;
    if (r.activeTopic) state.topic = r.activeTopic;
    return r;
  }

  it("resolves salary, experienced, transport, males, where, free, freshers", () => {
    const state = { entity: CONCENTRIX, topic: null as string | null };

    const salary = step("What's the salary?", "This is the Concentrix Adobe CS role in MTP.", state);
    expect(salary.searchQuery.toLowerCase()).toMatch(/concentrix/);
    expect(salary.searchQuery.toLowerCase()).toMatch(/ctc|salary/);

    const exp = step("And experienced?", "The fresher CTC is around ₹37,000 to ₹38,000.", state);
    expect(exp.searchQuery.toLowerCase()).toMatch(/experienced/);
    expect(exp.searchQuery.toLowerCase()).toMatch(/ctc|salary/);
    expect(exp.searchQuery.toLowerCase()).toMatch(/concentrix/);

    const transport = step("What about transport?", "Experienced CTC is higher.", state);
    expect(transport.searchQuery.toLowerCase()).toMatch(/transport/);
    expect(transport.searchQuery.toLowerCase()).toMatch(/concentrix/);

    const males = step("And males?", "Female candidates receive one-way transport free.", state);
    expect(males.searchQuery.toLowerCase()).toMatch(/male/);
    expect(males.searchQuery.toLowerCase()).toMatch(/transport/);

    const where = step("Where?", "Male candidates have a different transport policy.", state);
    expect(where.searchQuery.toLowerCase()).toMatch(/location|where|mtp/);
    expect(where.searchQuery.toLowerCase()).toMatch(/concentrix/);

    const free = step("Is it free?", "The office is in MTP Chennai.", state);
    expect(free.searchQuery.toLowerCase()).toMatch(/free|transport|location/);
    expect(free.searchQuery.toLowerCase()).toMatch(/concentrix/);

    const freshers = step("What about freshers?", "Transport is free for some candidates.", state);
    expect(freshers.searchQuery.toLowerCase()).toMatch(/fresher/);
    expect(freshers.searchQuery.toLowerCase()).toMatch(/concentrix/);
  });
});

const CARE: Parameters<typeof buildKbQuery>[0]["activeEntity"] = {
  type: "policy",
  name: "Care Health",
  source: "kb_alias",
  confidence: 0.96,
};

describe("context hygiene", () => {
  it("never turns agent filler into an entity", () => {
    const r = buildKbQuery({
      utterance: "Yeah yeah, true.",
      previousAgentTurn: "Sure. Give me a couple of minutes.",
      activeEntity: CARE,
      activeTopic: "hospital",
      utteranceClass: "acknowledgement",
      knownOfferings: ["Care Supreme Health Insurance"],
    });
    expect(r.searchQuery).toBe("Yeah yeah, true.");
    expect(r.activeEntity?.name).toBe("Care Health");
    expect(r.candidateEntity).toBeNull();
    expect(r.searchQuery.toLowerCase()).not.toMatch(/couple|minutes|sure tamil|got/);
  });

  it("clears incompatible topic when the caller names a new offering", () => {
    const r = buildKbQuery({
      utterance: "Star Health",
      previousAgentTurn: "Care Supreme premium starts at twelve thousand.",
      activeEntity: CARE,
      activeTopic: "premium",
      knownOfferings: ["Care Supreme Health Insurance", "Star Health"],
    });
    expect(r.entityChanged).toBe(true);
    expect(r.activeEntity?.name.toLowerCase()).toMatch(/star/);
    expect(r.activeTopic).toBeNull();
    expect(r.topicCleared).toBe(true);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/premium|got|couple/);
    expect(r.searchQuery.toLowerCase()).toMatch(/star/);
  });

  it("keeps topic when the new entity turn also names the topic", () => {
    const r = buildKbQuery({
      utterance: "What is Star Health premium?",
      activeEntity: CARE,
      activeTopic: "hospital",
      knownOfferings: ["Care Supreme Health Insurance", "Star Health"],
    });
    expect(r.activeEntity?.name.toLowerCase()).toMatch(/star/);
    expect(r.activeTopic).toBe("premium");
    expect(r.searchQuery.toLowerCase()).toMatch(/star/);
    expect(r.searchQuery.toLowerCase()).toMatch(/premium/);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/hospital/);
  });

  it("decays topic on a non-referential statement", () => {
    const r = buildKbQuery({
      utterance: "Actually I already have insurance.",
      activeEntity: CARE,
      activeTopic: "hospital",
    });
    expect(r.activeTopic).toBeNull();
    expect(r.topicCleared).toBe(true);
    expect(r.activeEntity?.name).toBe("Care Health");
    expect(r.searchQuery.toLowerCase()).not.toMatch(/hospital/);
  });

  it("does not use sticky retrieval state on language-control turns", () => {
    const r = buildKbQuery({
      utterance: "Can you speak in Tamil?",
      activeEntity: CARE,
      activeTopic: "hospital",
      utteranceClass: "language_control",
    });
    expect(r.searchQuery).toBe("Can you speak in Tamil?");
    expect(r.activeTopic).toBeNull();
    expect(r.topicCleared).toBe(true);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/hospital|care health/);
  });

  it("builds Care / Care Health aliases from a pack title", () => {
    const aliases = aliasesFromTitle("Care Supreme Health Insurance").map((a) => a.toLowerCase());
    expect(aliases).toContain("care supreme");
    expect(aliases).toContain("care health");
    expect(aliases).toContain("care");
    expect(aliases).toContain("supreme");
  });
});

describe("Phase 3C conservative augmentation", () => {
  const OFFERINGS = [
    "Care Supreme",
    "Care Ultimate Care",
    "Care Ultimate Joy",
    "Elevate",
    "Long Protection Plan",
  ];

  it("canonicalizes file titles to the knowledge object, not the filename", () => {
    expect(canonicalKnowledgeName("Elevate_Voice_Agent_KB_Complete.md (part 1)")).toBe("Elevate");
  });

  it("never promotes conversation nouns that are not knowledge objects", () => {
    const r = buildKbQueryConservative({
      utterance: "Pudiyala Madam enna solreenga?",
      previousAgentTurn: "What is your age?",
      knownOfferings: OFFERINGS,
    });
    expect(r.activeEntity).toBeNull();
    expect(r.searchQuery).toBe("Pudiyala Madam enna solreenga?");
    expect(r.queryLevel).toBe(0);
  });

  it("level 0: self-contained named offering stays raw", () => {
    const r = buildKbQueryConservative({
      utterance: "What is the waiting period for Care Supreme?",
      knownOfferings: OFFERINGS,
    });
    expect(r.searchQuery).toBe("What is the waiting period for Care Supreme?");
    expect(r.queryLevel).toBe(0);
    expect(r.contextualized).toBe(false);
    expect(r.activeEntity?.name).toBe("Care Supreme");
  });

  it("level 1: prepends validated entity to the raw utterance", () => {
    const r = buildKbQueryConservative({
      utterance: "3 crore enakku tharuveengala?",
      activeEntity: { type: "policy", name: "Elevate", source: "kb_alias", confidence: 0.96 },
      knownOfferings: OFFERINGS,
    });
    expect(r.searchQuery).toBe("Elevate 3 crore enakku tharuveengala?");
    expect(r.queryLevel).toBe(1);
    expect(r.searchQuery.toLowerCase()).not.toMatch(/premium|objection|complete/);
  });

  it("level 2: adds topic only for a strongly referential utterance with no payload", () => {
    const r = buildKbQueryConservative({
      utterance: "What about that?",
      activeEntity: { type: "policy", name: "Care Supreme", source: "kb_alias", confidence: 0.96 },
      activeTopic: "coverage",
      topicEstablishedTurn: 4,
      turnIndex: 5,
      knownOfferings: OFFERINGS,
    });
    expect(r.queryLevel).toBe(2);
    expect(r.searchQuery.toLowerCase()).toContain("care supreme");
    expect(r.searchQuery.toLowerCase()).toContain("coverage");
    expect(r.searchQuery).toContain("What about that?");
  });

  it("does not glue a stale topic onto a payload question", () => {
    const r = buildKbQueryConservative({
      utterance: "3 crore enakku tharuveengala?",
      activeEntity: { type: "policy", name: "Elevate", source: "kb_alias", confidence: 0.96 },
      activeTopic: "premium",
      topicEstablishedTurn: 1,
      turnIndex: 19,
      knownOfferings: OFFERINGS,
    });
    expect(r.queryLevel).toBe(1);
    expect(r.activeTopic).toBeNull();
    expect(r.searchQuery.toLowerCase()).not.toContain("premium");
  });

  it("does not insert location, gender, or experience unless the caller said it", () => {
    const r = buildKbQueryConservative({
      utterance: "What is the waiting period?",
      activeEntity: { type: "policy", name: "Care Supreme", source: "kb_alias", confidence: 0.96 },
      knownOfferings: OFFERINGS,
    });
    expect(r.searchQuery).toBe("Care Supreme What is the waiting period?");
    expect(r.searchQuery.toLowerCase()).not.toMatch(/chennai|madurai|male|female|experienced/);
  });

  it("agent speech can establish an object only via a known alias", () => {
    const r = buildKbQueryConservative({
      utterance: "What is the waiting period?",
      previousAgentTurn: "For long-term protection I'd suggest Care Ultimate Care.",
      knownOfferings: OFFERINGS,
    });
    expect(r.activeEntity?.name).toBe("Care Ultimate Care");
    expect(r.searchQuery).toBe("Care Ultimate Care What is the waiting period?");
  });

  it("does not prepend a sticky plan onto a catalog question", () => {
    const r = buildKbQueryConservative({
      utterance: "Is there any other plans?",
      activeEntity: { type: "policy", name: "Care Supreme", source: "kb_alias", confidence: 0.96 },
      knownOfferings: OFFERINGS,
    });
    expect(r.searchQuery).toBe("Is there any other plans?");
    expect(r.queryLevel).toBe(0);
  });

  it("harvests plan names from attached KB headings", () => {
    const names = harvestOfferingNamesFromText(
      "# CARE HEALTH\n- **Care Ultimate Care** — long-term\n- **Care Supreme** — comprehensive\n- **Sum Insured**\n- **Instant Cover PED Modification**\n- **Tenure Multiplier**\n- **Automatic Recharge**\n- **Unlimited Care**\n",
    );
    expect(names).toEqual(expect.arrayContaining(["Care Ultimate Care", "Care Supreme"]));
    expect(names.join(" ")).not.toMatch(/Sum Insured|Instant Cover|Tenure Multiplier|Automatic Recharge|Unlimited Care/i);
  });
});
