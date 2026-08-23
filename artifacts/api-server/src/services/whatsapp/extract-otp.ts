/** Extract a 6-digit verification code from a Meta/VoBiz robocall transcript. */
export function extractOtpCode(raw: string): string | null {
  if (!raw) return null;
  // Pass 1: numeric digits, possibly separated ("1 2 3 - 4 5 6").
  const groups = raw.replace(/[^0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  for (const g of groups) if (g.length === 6) return g;
  for (let i = 0; i < groups.length; i++) {
    let acc = "";
    for (let j = i; j < groups.length && acc.length < 6; j++) acc += groups[j];
    if (acc.length >= 6) return acc.slice(0, 6);
  }
  // Pass 2: spelled-out digits ("one two three four five six").
  const words: Record<string, string> = {
    zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
    five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  };
  const mapped = raw.toLowerCase().split(/[^a-z0-9]+/)
    .map((w) => words[w] ?? (/^\d+$/.test(w) ? w : " "))
    .join("");
  const m = mapped.match(/\d{6}/);
  return m ? m[0] : null;
}
