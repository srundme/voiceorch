const COMPANY_SUFFIXES = [
  "private limited",
  "pvt ltd",
  "pvt",
  "limited",
  "ltd",
  "llp",
  "inc",
  "llc",
  "co",
  "company",
  "corporation",
  "corp",
  "enterprises",
  "india",
];

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "rediffmail.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "zohomail.in",
]);

export function normalizeCompanyName(name: string): string {
  let n = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      if (n.endsWith(` ${suffix}`)) {
        n = n.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return n;
}

export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop() ?? "";
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#:]/)[0] ?? "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

export function companyDomainFromEmail(email: string | null | undefined): string | null {
  const domain = normalizeDomain(email && email.includes("@") ? email : null);
  return domain && !FREE_EMAIL_DOMAINS.has(domain) ? domain : null;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const s = email?.trim().toLowerCase();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits.length >= 8 ? `+${digits}` : null;
  if (digits.startsWith("00")) return digits.length >= 10 ? `+${digits.slice(2)}` : null;
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

export function isFuzzyNameMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`));
}
