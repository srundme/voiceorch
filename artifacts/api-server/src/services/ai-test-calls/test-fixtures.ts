/** Shared fixtures for AI Test Calls unit tests (event-registration agent). */
import { normalizeBrief, renumberBrief, type AgentBrief, type BriefAgentInput } from "./brief.js";

export const EVENT_PROMPT = [
  "You are Vijay, registration assistant for Galaxy Marvel Science Fair 2026, organised by Galaxy Marvel Academy.",
  "The fair is on 14 December 2026 at Chennai Trade Centre, Nandambakkam. Registration fee is ₹499 per child.",
  "Eligibility: students aged 6 to 14 only. Politely decline anyone outside this range.",
  "Collect: parent name, child name, child age, 10-digit mobile number. Read the mobile number back digit by digit.",
  "If the parent asks for a discount, explain the fee is fixed but siblings get the second registration at ₹399.",
  "If the caller asks to speak to a human, transfer using transfer_call.",
  "Never discuss parking, food stalls or refunds; say the team will share details on WhatsApp.",
].join("\n\n");

export const EVENT_INPUT: BriefAgentInput = {
  name: "Vijay",
  systemPrompt: EVENT_PROMPT,
  greetingMessage: "Hello! This is Vijay from Galaxy Marvel Academy.",
  language: "en-IN",
  firstSpeaker: "assistant",
  useCase: "registration",
  productDetails: null,
  successCriteria: "Registration captured with all fields",
  tools: [{ name: "transfer_call", description: "Transfer to the events desk" }],
  dispositionFields: [{ key: "child_age", label: "Child age", type: "number", required: true }],
};

export const EVENT_BRIEF_RAW = {
  business: "Galaxy Marvel Academy — organiser of Galaxy Marvel Science Fair 2026",
  offerings: ["Galaxy Marvel Science Fair 2026"],
  counterpart: { who: "parent of a school student", situation: "wants to register their child for the fair" },
  agentDirection: "inbound",
  callObjective: "Register a child for the science fair",
  languages: ["en-IN", "ta-IN"],
  flowSteps: ["Greet as Vijay", "Check eligibility", "Collect details", "Read back mobile", "Confirm fee and close"],
  requiredInfo: [
    { field: "Parent name", validation: "" },
    { field: "Child age", validation: "6-14" },
    { field: "Mobile number", validation: "10-digit" },
  ],
  facts: [
    { text: "Fair date is 14 December 2026", sourceQuote: "on 14 December 2026" },
    { text: "Venue is Chennai Trade Centre, Nandambakkam", sourceQuote: "at Chennai Trade Centre" },
    { text: "Registration fee is ₹499 per child", sourceQuote: "fee is ₹499 per child" },
    { text: "Second sibling registration costs ₹399", sourceQuote: "second registration at ₹399" },
  ],
  rules: [
    { text: "Only students aged 6 to 14 are eligible; decline others", sourceQuote: "aged 6 to 14 only" },
    { text: "Transfer to a human via transfer_call when asked", sourceQuote: "transfer using transfer_call" },
  ],
  objectionsHandled: ["Asks for a discount"],
  outOfScope: ["Parking at the venue", "Refund policy"],
  toolsUsage: [{ tool: "transfer_call", when: "caller asks for a human" }],
};

export function eventBrief(): AgentBrief {
  return renumberBrief(normalizeBrief(EVENT_BRIEF_RAW));
}
