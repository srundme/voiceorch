/** Digits only, with India's country code added to bare 10-digit mobiles. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 8 ? digits : null;
}

export function telLink(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  return d ? `tel:+${d}` : null;
}

/** wa.me link that opens WhatsApp with a prefilled draft; the user still has to press send. */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const d = phoneDigits(phone);
  if (!d) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function mailtoLink(email: string | null | undefined, subject?: string): string | null {
  if (!email || !email.includes("@")) return null;
  return `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
}

/** Prefers a saved map link; otherwise builds a Google Maps search from name + address/area/city. */
export function mapsLink(c: { name?: string | null; address?: string | null; area?: string | null; city?: string | null; mapLink?: string | null }): string | null {
  if (c.mapLink && /^https?:\/\//i.test(c.mapLink)) return c.mapLink;
  const q = [c.name, c.address, c.area, c.city].filter((s) => s && s.trim()).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

export function whatsappIntro(contactName: string | null | undefined, senderName: string | null | undefined): string {
  const hi = contactName?.trim() ? `Hi ${contactName.trim().split(/\s+/)[0]}` : "Hi";
  const from = senderName?.trim() ? `this is ${senderName.trim()} from SnapServe` : "this is SnapServe";
  return `${hi}, ${from}. Following up on our conversation about AI calling for your team.`;
}
