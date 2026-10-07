/**
 * Star Health premium lookup for voice agents (webhook tool
 * `/public/tools/star-premium`). The LLM collects the family details; the
 * arithmetic happens here because the model miscounts savings (call sim:
 * eighteen thousand minus ten thousand six hundred came out as "four thousand").
 */

export interface PremiumTable {
  sumInsuredLakh: number[];
  bands: Array<{ age: number[]; premium: number[] }>;
}

export interface StarPremiumData {
  superStar: Record<string, { individual: PremiumTable; floaterAdult: PremiumTable; floaterChild: PremiumTable }>;
  comprehensive: Record<string, Record<string, PremiumTable>>;
  healthAssure: Record<string, Record<string, PremiumTable>>;
}

export type StarPlan = "super_star" | "comprehensive" | "health_assure";

export const STAR_PLAN_NAMES: Record<StarPlan, string> = {
  super_star: "Super Star",
  comprehensive: "Star Comprehensive",
  health_assure: "Star Health Assure",
};

export function parseStarPlan(raw: unknown): StarPlan | null {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s || s.includes("superstar")) return "super_star";
  if (s.includes("comprehensive")) return "comprehensive";
  if (s.includes("assure")) return "health_assure";
  return null;
}

// ── Zones ────────────────────────────────────────────────────────────────────

const ALIASES: Record<string, string> = {
  madras: "chennai",
  bangalore: "bengaluru",
  bengalooru: "bengaluru",
  trivandrum: "thiruvananthapuram",
  kochi: "ernakulam",
  cochin: "ernakulam",
  gurgaon: "gurugram",
  noida: "gautam buddha nagar",
  "greater noida": "gautam buddha nagar",
  bombay: "mumbai",
  "navi mumbai": "mumbai",
  kancheepuram: "kanchipuram",
  chengalpet: "chengalpattu",
  chengalpattu: "chengalpattu",
  thiruvallur: "tiruvallur",
  ahmednagar: "ahmed nagar",
  muzaffarnagar: "muzaffar nagar",
  hapur: "panchsheel nagar",
  baroda: "vadodara",
  calcutta: "kolkata",
  poona: "pune",
  nasik: "nashik",
  rangareddy: "k v ranga reddy",
  "ranga reddy": "k v ranga reddy",
  medchal: "medchal malkajgiri",
  secunderabad: "hyderabad",
  tn: "tamil nadu",
  tamilnadu: "tamil nadu",
  up: "uttar pradesh",
  mp: "madhya pradesh",
  ap: "andhra pradesh",
  "new delhi": "delhi",
};

/** Used only when the caller's state is not given. */
const CITY_STATE: Record<string, string> = {
  chennai: "tamil nadu", coimbatore: "tamil nadu", madurai: "tamil nadu", trichy: "tamil nadu",
  tiruchirappalli: "tamil nadu", salem: "tamil nadu", tirunelveli: "tamil nadu", vellore: "tamil nadu",
  erode: "tamil nadu", thanjavur: "tamil nadu", tiruppur: "tamil nadu", thoothukudi: "tamil nadu",
  hyderabad: "telangana", bengaluru: "karnataka", mysuru: "karnataka", mysore: "karnataka",
  pune: "maharashtra", nashik: "maharashtra", nagpur: "maharashtra", mumbai: "maharashtra",
  ernakulam: "kerala", kollam: "kerala", thrissur: "kerala", kozhikode: "kerala", thiruvananthapuram: "kerala",
  ahmedabad: "gujarat", surat: "gujarat", vadodara: "gujarat", rajkot: "gujarat",
  vijayawada: "andhra pradesh", visakhapatnam: "andhra pradesh", tirupati: "andhra pradesh",
  lucknow: "uttar pradesh", kanpur: "uttar pradesh", jaipur: "rajasthan", bhopal: "madhya pradesh",
};

const NCR_DISTRICTS = [
  "faridabad", "gurugram", "shahdara", "gautam buddha nagar", "ghaziabad", "mewat", "alwar", "baghpat",
  "bhiwani", "bulandshahar", "fatehabad", "hisar", "jhajjar", "jind", "kaithal", "karnal", "kurukshetra",
  "mahendragarh", "meerut", "muzaffar nagar", "palwal", "panchsheel nagar", "panipat", "rewari", "rohtak",
  "saharanpur", "sirsa", "sonipat",
];

interface ZoneRule { zone: string; cities?: string[]; states?: string[] }

const ZONE_RULES: Record<StarPlan, { rules: ZoneRule[]; rest: string }> = {
  super_star: {
    rules: [
      { zone: "A", cities: ["delhi", ...NCR_DISTRICTS, "ahmedabad", "surat", "vadodara", "mumbai", "thane", "palghar", "raigad"], states: ["gujarat"] },
      { zone: "B", cities: ["chennai", "ernakulam", "thiruvananthapuram", "bengaluru", "chengalpattu", "kanchipuram", "nashik", "pune", "tiruvallur", "hyderabad", "kollam", "wayanad", "indore", "k v ranga reddy", "medchal malkajgiri", "ahmed nagar", "gwalior"] },
    ],
    rest: "C",
  },
  comprehensive: {
    rules: [
      { zone: "A", cities: ["delhi", ...NCR_DISTRICTS, "bharatpur", "charkhi dadri", "mumbai", "thane", "palghar", "raigad"] },
      { zone: "B", cities: ["ernakulam", "kollam", "wayanad", "thiruvananthapuram", "mathura", "aligarh", "pune", "nashik", "ahmed nagar"] },
      { zone: "C", cities: ["chennai", "bengaluru", "chengalpattu", "kanchipuram", "tiruvallur", "indore", "gwalior"] },
      { zone: "A", states: ["gujarat", "daman and diu", "dadra and nagar haveli"] },
      { zone: "B", states: ["telangana"] },
      { zone: "D", cities: ["kolkata", "north 24 parganas", "paschim bardhaman"], states: ["uttar pradesh", "tamil nadu", "kerala", "maharashtra", "haryana", "madhya pradesh", "karnataka", "rajasthan", "andhra pradesh", "punjab"] },
    ],
    rest: "E",
  },
  health_assure: {
    rules: [
      { zone: "A", cities: ["delhi", "faridabad", "gurugram", "ghaziabad", "gautam buddha nagar", "mumbai", "thane", "ahmedabad", "surat", "vadodara"] },
      { zone: "B", cities: ["pune", "nashik", "thiruvananthapuram", "ernakulam", "chennai", "bengaluru", "hyderabad"], states: ["gujarat"] },
      { zone: "C", cities: ["aligarh", "mathura", "indore", "gwalior", "kollam", "wayanad", "ahmed nagar", ...NCR_DISTRICTS, "bharatpur", "charkhi dadri"], states: ["telangana"] },
    ],
    rest: "D",
  },
};

function normPlace(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  return ALIASES[s] ?? s;
}

export function resolveStarZone(plan: StarPlan, city: unknown, state: unknown): string {
  const c = normPlace(city);
  const st = normPlace(state) || CITY_STATE[c] || "";
  const { rules, rest } = ZONE_RULES[plan];
  for (const r of rules) if (c && r.cities?.includes(c)) return r.zone;
  for (const r of rules) if (st && r.states?.includes(st)) return r.zone;
  return rest;
}

// ── Lookup ───────────────────────────────────────────────────────────────────

export interface StarQuoteInput {
  plan: StarPlan;
  zone: string;
  adultAges: number[];
  childAges: number[];
  sumInsuredLakh: number;
}

export type StarQuote =
  | { ok: true; family: string; sumInsuredLakh: number; premium: number }
  | { ok: false; error: string };

function column(table: PremiumTable, lakh: number): number {
  return table.sumInsuredLakh.findIndex((v) => v >= lakh);
}

function rate(table: PremiumTable, age: number, col: number): number | null {
  const band = table.bands.find((b) => age >= b.age[0]! && age <= b.age[1]!);
  return band?.premium[col] ?? null;
}

export function quoteStarPremium(data: StarPremiumData, q: StarQuoteInput): StarQuote {
  const adults = q.adultAges.length;
  const kids = q.childAges.length;
  if (adults === 0) return { ok: false, error: "at least one adult age is needed" };
  if (!(q.sumInsuredLakh > 0)) return { ok: false, error: "sum insured is needed" };
  const family = kids ? `${adults}A+${kids}C` : `${adults}A`;

  if (q.plan === "super_star") {
    const z = data.superStar[q.zone];
    if (!z) return { ok: false, error: `no Super Star chart for zone ${q.zone}` };
    const col = column(z.individual, q.sumInsuredLakh);
    if (col < 0) return { ok: false, error: "sum insured is above the chart" };
    const sumInsuredLakh = z.individual.sumInsuredLakh[col]!;
    if (adults === 1 && kids === 0) {
      const p = rate(z.individual, q.adultAges[0]!, col);
      return p == null ? { ok: false, error: "age is outside the chart" } : { ok: true, family, sumInsuredLakh, premium: p };
    }
    if (adults !== 2) return { ok: false, error: `the Super Star chart has no ${family} floater rate` };
    let total = 0;
    for (const a of q.adultAges) {
      const p = rate(z.floaterAdult, a, col);
      if (p == null) return { ok: false, error: "adult age is outside the chart" };
      total += p;
    }
    for (const c of q.childAges) {
      const p = rate(z.floaterChild, c, col);
      if (p == null) return { ok: false, error: "child age is outside the chart" };
      total += p;
    }
    return { ok: true, family, sumInsuredLakh, premium: total };
  }

  const charts = (q.plan === "comprehensive" ? data.comprehensive : data.healthAssure)[q.zone];
  const table = charts?.[family];
  if (!table) return { ok: false, error: `the ${STAR_PLAN_NAMES[q.plan]} chart has no ${family} rate` };
  const col = column(table, q.sumInsuredLakh);
  if (col < 0) return { ok: false, error: "sum insured is above the chart" };
  const eldest = Math.max(...q.adultAges, ...q.childAges);
  const p = rate(table, eldest, col);
  if (p == null) return { ok: false, error: "age is outside the chart" };
  return { ok: true, family, sumInsuredLakh: table.sumInsuredLakh[col]!, premium: p };
}

// ── Speech ───────────────────────────────────────────────────────────────────

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
  "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : "");
}

/** Indian numbering in English words: 105400 → "one lakh five thousand four hundred". */
export function indianNumberWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zero";
  const parts: string[] = [];
  const units: Array<[number, string]> = [[10_000_000, "crore"], [100_000, "lakh"], [1000, "thousand"], [100, "hundred"]];
  for (const [size, word] of units) {
    const q = Math.floor(n / size);
    if (q) {
      parts.push(`${size === 10_000_000 ? indianNumberWords(q) : under100(q)} ${word}`);
      n %= size;
    }
  }
  if (n) parts.push(under100(n));
  return parts.join(" ");
}

function lakhWords(lakh: number): string {
  if (lakh >= 100) return `${indianNumberWords(lakh / 100)} crore`;
  if (Number.isInteger(lakh)) return `${indianNumberWords(lakh)} lakh`;
  const [whole, frac] = String(lakh).split(".");
  return `${indianNumberWords(Number(whole))} point ${[...frac!].map((d) => ONES[Number(d)]).join(" ")} lakh`;
}

export interface StarPremiumAnswer {
  ok: boolean;
  plan?: string;
  zone?: string;
  family?: string;
  sum_insured?: string;
  star_premium?: number;
  current_premium?: number;
  saving?: number;
  star_is_cheaper?: boolean;
  say: string;
}

export function answerStarPremium(
  data: StarPremiumData,
  input: StarQuoteInput,
  currentPremium: number | null,
): StarPremiumAnswer {
  const quote = quoteStarPremium(data, input);
  const plan = STAR_PLAN_NAMES[input.plan];
  if (!quote.ok) {
    return { ok: false, plan, zone: input.zone, say: `No exact price: ${quote.error}. Do not quote a number; say the senior advisor will confirm the exact premium, and pitch benefits.` };
  }
  const approx = Math.round(quote.premium / 100) * 100;
  const base: StarPremiumAnswer = {
    ok: true,
    plan,
    zone: input.zone,
    family: quote.family,
    sum_insured: lakhWords(quote.sumInsuredLakh),
    star_premium: quote.premium,
    say: `${plan} for ${lakhWords(quote.sumInsuredLakh)} cover is around ${indianNumberWords(approx)} rupees a year, approximate, excluding GST, base plan.`,
  };
  if (currentPremium == null || !(currentPremium > 0)) return base;
  const saving = Math.floor((currentPremium - quote.premium) / 1000) * 1000;
  const cheaper = saving >= 1000;
  return {
    ...base,
    current_premium: currentPremium,
    saving: cheaper ? saving : 0,
    star_is_cheaper: cheaper,
    say: cheaper
      ? `${base.say} That is around ${indianNumberWords(saving)} rupees a year less than what the customer pays now, for the same cover.`
      : "Star is not cheaper for this family. Do not quote the Star price; pitch benefits instead.",
  };
}
