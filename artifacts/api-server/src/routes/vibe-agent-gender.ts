/**
 * Infer agent persona gender from a human first name so Vibe can show only
 * matching male/female voices. Returns null when the name is unknown/unisex —
 * callers should then show the full catalog.
 */

const FEMALE_FIRST_NAMES = new Set([
  "aisha", "amira", "anita", "anjali", "anna", "arushi", "aarushi", "asha", "aditi",
  "ava", "bhavana", "bhavna", "chitra", "clara", "deepa", "divya", "ella", "elizabeth",
  "emma", "fatima", "gayathri", "gayatri", "geetha", "gita", "hannah", "harini",
  "indira", "isha", "jamila", "jennifer", "jessica", "jyoti", "kalpana", "kamala",
  "karen", "kavya", "kirti", "lakshmi", "lavanya", "lisa", "madhavi", "malini",
  "manisha", "mary", "maya", "meera", "mia", "natalie", "neha", "nidhi", "nisha",
  "nora", "olivia", "padma", "parvati", "pooja", "preeti", "priti", "priya", "puja",
  "rachel", "radha", "rani", "reena", "rekha", "rhea", "rita", "ritu", "riya",
  "sakshi", "sangeeta", "sanjana", "sara", "sarah", "sarika", "seema", "shilpa",
  "shreya", "shruti", "simran", "sita", "sneha", "sonali", "sonia", "sophia",
  "sruthi", "sruti", "suma", "sunita", "susan", "sushma", "swati", "tanya", "tanvi",
  "trisha", "uma", "vaishnavi", "vidya", "yamini", "zara",
]);

const MALE_FIRST_NAMES = new Set([
  "abhay", "aditya", "ahmed", "ajay", "akash", "alex", "ali", "alok", "amar", "amit",
  "anand", "andrew", "anirudh", "ankit", "aravind", "arjun", "arvind", "arun", "ashok",
  "balaji", "benjamin", "bharath", "chandru", "chris", "daniel", "david", "deepak",
  "dev", "dinesh", "ganesh", "gokul", "gopal", "hari", "harish", "hassan", "imran",
  "ishaan", "jai", "james", "john", "joseph", "karan", "karthik", "karthikeyan",
  "ken", "kevin", "krishna", "madhav", "mahesh", "manoj", "michael", "mohan",
  "naveen", "nikhil", "nithin", "omar", "pradeep", "pranav", "prasad", "raghav",
  "rahul", "raj", "raja", "rajesh", "ramesh", "ravi", "robert", "rohan", "sachin",
  "sameer", "sanjay", "siddharth", "siva", "shiva", "sriram", "suresh", "surya",
  "thomas", "varun", "venkat", "vijay", "vikram", "vinay", "vivek", "william", "yash",
  "yusuf",
]);

export type AgentNameGender = "male" | "female";

/** First token of the agent name → male | female | null (unknown / unisex). */
export function inferGenderFromAgentName(agentName: string | null | undefined): AgentNameGender | null {
  if (!agentName) return null;
  const first = agentName
    .trim()
    .split(/[\s._-]+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!first || first.length < 2) return null;
  if (FEMALE_FIRST_NAMES.has(first)) return "female";
  if (MALE_FIRST_NAMES.has(first)) return "male";
  return null;
}

/** Normalize catalog gender / description to male | female | null. */
export function resolveVoiceGender(
  gender: string | null | undefined,
  description?: string | null,
): AgentNameGender | null {
  const g = (gender ?? "").toLowerCase().trim();
  if (g === "male" || g === "female") return g;
  const d = (description ?? "").toLowerCase();
  if (/\bfemale\b/.test(d) || /\bwoman\b/.test(d) || /\bgirl\b/.test(d)) return "female";
  if (/\bmale\b/.test(d) || /\bman\b/.test(d) || /\bboy\b/.test(d)) return "male";
  return null;
}

/**
 * Keep voices matching the agent-name gender. If none match (or gender unknown),
 * return the original list so the picker never goes empty.
 */
export function filterVoicesByAgentGender<T extends { gender?: string | null; description?: string | null }>(
  voices: T[],
  agentName: string | null | undefined,
): { voices: T[]; gender: AgentNameGender | null } {
  const gender = inferGenderFromAgentName(agentName);
  if (!gender) return { voices, gender: null };
  const matched = voices.filter((v) => resolveVoiceGender(v.gender, v.description) === gender);
  return { voices: matched.length > 0 ? matched : voices, gender };
}
