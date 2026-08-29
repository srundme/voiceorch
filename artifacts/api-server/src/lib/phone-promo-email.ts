/**
 * Collapse login emails so one Gmail mailbox cannot burn a one-time promo
 * twice via aliases (dots, plus-tags, googlemail.com).
 */
export function emailPromoFingerprint(email: string | null | undefined): string {
  const raw = String(email ?? "").trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 1) return raw;
  let local = raw.slice(0, at);
  let domain = raw.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replace(/\./g, "");
  }
  if (!local || !domain) return "";
  return `${local}@${domain}`;
}
