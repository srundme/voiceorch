/**
 * Invoice rendering (HTML + PDF) and seller config.
 *
 * Kept free of any DB imports so it can be rendered/previewed standalone. The
 * DB-coupled issuing logic lives in invoice.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SELLER (supplier) details are hardcoded below. GSTIN, PAN and the registered
 * address are required for a legally valid GST tax invoice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import PDFDocument from "pdfkit";
import type { Invoice } from "@workspace/db";
import { GST_RATE } from "../lib/money-inr.js";

// ── Supplier (your company) — EDIT THESE ────────────────────────────────────
export const SELLER = {
  name: "SnapServe AI Private Limited",             // registered legal name
  addressLines: [
    "No 126, RNS Plaza, 3rd Floor, 1st Main,",
    "Doddanagamgala Road (Near Tech Mahindra Gate-1),",
    "KIADB Layout, Konappana Agrahara (V),",
    "Electronic City Phase-2, Bangalore, Karnataka 560100",
  ],
  gstin: "29DOXPG9478G1ZU",
  state: "Karnataka",
  stateCode: "29",                                  // matches first 2 digits of GSTIN
  pan: "DOXPG9478G",
  cin: "",                                          // optional — add if you have one
  email: "billing@snapserve.ai",
  phone: "",                                        // optional
  website: "app.snapserve.ai",
};

export const NUMBER_PREFIX = "SS";
// ────────────────────────────────────────────────────────────────────────────

export type InvoiceType = "wallet_topup" | "phone_number" | "concurrent_slot";

/** Email-safe HTML rendition of the official three-bar SnapServe wordmark. */
function invoiceLogoHtml(): string {
  return (
    "<table cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\"><tr>" +
    "<td style=\"width:34px;vertical-align:middle;padding-right:11px\">" +
    "<div style=\"height:7px;width:32px;border-radius:999px;background:#ffffff\"></div>" +
    "<div style=\"height:7px;width:26px;border-radius:999px;background:rgba(255,255,255,.60);margin:5px 0 0 3px\"></div>" +
    "<div style=\"height:7px;width:20px;border-radius:999px;background:rgba(255,255,255,.36);margin:5px 0 0 6px\"></div>" +
    "</td>" +
    "<td style=\"vertical-align:middle;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:1;color:#ffffff;letter-spacing:-.6px\">" +
    "<strong style=\"font-weight:700\">Snap</strong><span style=\"font-weight:400\">Serve</span>" +
    "</td></tr></table>"
  );
}

/** Draw the official white SnapServe mark in PDFKit's header band. */
function drawInvoiceLogo(doc: PDFKit.PDFDocument, x: number, y: number): void {
  doc.save();
  doc.fillColor("#ffffff").roundedRect(x, y, 32, 7, 3.5).fill();
  doc.fillOpacity(0.6).roundedRect(x + 3, y + 12, 26, 7, 3.5).fill();
  doc.fillOpacity(0.36).roundedRect(x + 6, y + 24, 20, 7, 3.5).fill();
  doc.restore();

  doc
    .fillColor("#ffffff")
    .fontSize(20)
    .font("Helvetica-Bold")
    .text("Snap", x + 44, y + 6, { continued: true })
    .font("Helvetica")
    .text("Serve");
}

/** Indian financial year label for a date, e.g. "2026-27" (FY starts 1 April). */
export function financialYear(d: Date): string {
  const m = d.getMonth(); // 0 = Jan, 3 = Apr
  const y = d.getFullYear();
  const startYear = m >= 3 ? y : y - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

export function formatInvoiceNumber(id: number, d: Date): string {
  return `${NUMBER_PREFIX}/${financialYear(d)}/${String(id).padStart(5, "0")}`;
}

/** Paise → "Rs.1,234.00" (ASCII "Rs." — the ₹ glyph is not in PDF core fonts). */
function money(p: number): string {
  const sign = p < 0 ? "-" : "";
  const rupees = Math.abs(p) / 100;
  return `${sign}Rs.${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Very small INR amount-in-words (rupees only) for the invoice footer. */
function rupeesInWords(paiseTotal: number): string {
  const rupees = Math.round(paiseTotal / 100);
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const twoDigits = (n: number): string =>
    n < 20 ? ones[n]! : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`;
  const threeDigits = (n: number): string =>
    `${n >= 100 ? ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " : "") : ""}${n % 100 ? twoDigits(n % 100) : ""}`;
  if (rupees === 0) return "Zero Rupees Only";
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1_000);
  const rest = rupees % 1_000;
  let out = "";
  if (crore) out += `${twoDigits(crore)} Crore `;
  if (lakh) out += `${twoDigits(lakh)} Lakh `;
  if (thousand) out += `${twoDigits(thousand)} Thousand `;
  if (rest) out += threeDigits(rest);
  return `${out.trim()} Rupees Only`;
}

export interface TaxSplit {
  baseCents: number;
  cgstCents: number;
  sgstCents: number;
  igstCents: number;
  gstCents: number;
  totalCents: number;
  intraState: boolean;
}

/**
 * Compute the GST split.
 *  - gstInclusive=false → base is the taxable value, GST is added on top.
 *  - gstInclusive=true  → the given amount already includes GST, so the taxable
 *    value is back-calculated.
 * Intra-state (buyer state === seller state, or unknown B2C) → CGST + SGST.
 * Inter-state → IGST.
 */
export function computeTax(amountCents: number, gstInclusive: boolean, buyerStateCode: string | null): TaxSplit {
  let baseCents: number;
  let gstCents: number;
  let totalCents: number;
  if (gstInclusive) {
    totalCents = Math.round(amountCents);
    baseCents = Math.round(totalCents / (1 + GST_RATE));
    gstCents = totalCents - baseCents;
  } else {
    baseCents = Math.round(amountCents);
    gstCents = Math.round(baseCents * GST_RATE);
    totalCents = baseCents + gstCents;
  }
  const intraState = !buyerStateCode || buyerStateCode === SELLER.stateCode;
  const cgstCents = intraState ? Math.round(gstCents / 2) : 0;
  const sgstCents = intraState ? gstCents - cgstCents : 0;
  const igstCents = intraState ? 0 : gstCents;
  return { baseCents, cgstCents, sgstCents, igstCents, gstCents, totalCents, intraState };
}

// ── HTML (in-browser view / email body) ─────────────────────────────────────

export function renderInvoiceHtml(inv: Invoice): string {
  const issued = new Date(inv.createdAt);
  const dateStr = issued.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const halfRate = (inv.gstRateBps / 200).toFixed(0);
  const fullRate = (inv.gstRateBps / 100).toFixed(0);
  const taxRows = inv.igstCents > 0
    ? `<tr><td style="padding:6px 10px;color:#374151">IGST @ ${fullRate}%</td><td style="padding:6px 10px;text-align:right;color:#111827">${money(inv.igstCents)}</td></tr>`
    : `<tr><td style="padding:6px 10px;color:#374151">CGST @ ${halfRate}%</td><td style="padding:6px 10px;text-align:right;color:#111827">${money(inv.cgstCents)}</td></tr>` +
      `<tr><td style="padding:6px 10px;color:#374151">SGST @ ${halfRate}%</td><td style="padding:6px 10px;text-align:right;color:#111827">${money(inv.sgstCents)}</td></tr>`;

  return (
    "<!DOCTYPE html><html><head><meta charset=\"UTF-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Tax Invoice</title></head>" +
    "<body style=\"margin:0;padding:0;background:#f4f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif\">" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\" style=\"background:#f4f4f6;padding:32px 12px\"><tr><td align=\"center\">" +
    "<table width=\"640\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\" style=\"max-width:640px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden\">" +
    "<tr><td style=\"background:#09090b;padding:20px 28px\">" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\"><tr>" +
    `<td style="vertical-align:middle">${invoiceLogoHtml()}</td>` +
    "<td style=\"vertical-align:middle;text-align:right;color:#d1d5db;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase\">Tax Invoice cum Receipt</td>" +
    "</tr></table></td></tr>" +
    "<tr><td style=\"padding:24px 28px\">" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\"><tr>" +
    "<td style=\"vertical-align:top;width:60%\">" +
    `<p style="margin:0 0 2px;font-size:14px;font-weight:700;color:#111827">${SELLER.name}</p>` +
    `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.6">${SELLER.addressLines.join("<br>")}</p>` +
    (SELLER.gstin ? `<p style="margin:6px 0 0;font-size:12px;color:#374151"><strong>GSTIN:</strong> ${SELLER.gstin}</p>` : "") +
    (SELLER.pan ? `<p style="margin:0;font-size:12px;color:#374151"><strong>PAN:</strong> ${SELLER.pan}</p>` : "") +
    (SELLER.cin ? `<p style="margin:0;font-size:12px;color:#374151"><strong>CIN:</strong> ${SELLER.cin}</p>` : "") +
    `<p style="margin:0;font-size:12px;color:#374151"><strong>State:</strong> ${SELLER.state} (${SELLER.stateCode})</p>` +
    "</td>" +
    "<td style=\"vertical-align:top;text-align:right\">" +
    `<p style="margin:0 0 4px;font-size:13px;color:#111827"><strong>Invoice #</strong> ${inv.invoiceNumber}</p>` +
    `<p style="margin:0 0 4px;font-size:12px;color:#6b7280">Date: ${dateStr}</p>` +
    (inv.razorpayPaymentId ? `<p style="margin:0 0 4px;font-size:12px;color:#6b7280">Payment: ${inv.razorpayPaymentId}</p>` : "") +
    "<span style=\"display:inline-block;margin-top:4px;padding:3px 10px;background:#dcfce7;color:#15803d;font-size:11px;font-weight:700;border-radius:999px;letter-spacing:0.04em\">PAID</span>" +
    "</td></tr></table>" +
    "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:18px 0\">" +
    "<p style=\"margin:0 0 4px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.05em\">Billed To</p>" +
    `<p style="margin:0;font-size:14px;font-weight:600;color:#111827">${inv.buyerName || inv.buyerEmail || "Customer"}</p>` +
    (inv.buyerEmail ? `<p style="margin:0;font-size:12px;color:#6b7280">${inv.buyerEmail}</p>` : "") +
    (inv.buyerGstin ? `<p style="margin:2px 0 0;font-size:12px;color:#374151"><strong>GSTIN:</strong> ${inv.buyerGstin}</p>` : "") +
    (inv.placeOfSupply ? `<p style="margin:2px 0 0;font-size:12px;color:#374151"><strong>Place of supply:</strong> ${inv.placeOfSupply}</p>` : "") +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:18px;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;border-spacing:0\">" +
    "<tr style=\"background:#f9fafb\">" +
    "<td style=\"padding:10px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em\">Description</td>" +
    "<td style=\"padding:10px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;text-align:center\">SAC</td>" +
    "<td style=\"padding:10px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;text-align:right\">Taxable Value</td>" +
    "</tr><tr>" +
    `<td style="padding:12px 10px;font-size:13px;color:#111827;border-top:1px solid #e5e7eb">${inv.description}</td>` +
    `<td style="padding:12px 10px;font-size:13px;color:#374151;text-align:center;border-top:1px solid #e5e7eb">${inv.hsnSac || "-"}</td>` +
    `<td style="padding:12px 10px;font-size:13px;color:#111827;text-align:right;border-top:1px solid #e5e7eb">${money(inv.baseCents)}</td>` +
    "</tr></table>" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-top:14px\"><tr><td style=\"width:50%\"></td><td style=\"width:50%\">" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-size:13px\">" +
    `<tr><td style="padding:6px 10px;color:#374151">Taxable value</td><td style="padding:6px 10px;text-align:right;color:#111827">${money(inv.baseCents)}</td></tr>` +
    taxRows +
    `<tr><td style="padding:10px;border-top:2px solid #111827;font-weight:700;color:#111827">Total</td><td style="padding:10px;border-top:2px solid #111827;text-align:right;font-weight:700;color:#111827">${money(inv.totalCents)}</td></tr>` +
    "</table></td></tr></table>" +
    `<p style="margin:14px 0 0;font-size:12px;color:#6b7280"><strong>Amount in words:</strong> ${rupeesInWords(inv.totalCents)}</p>` +
    "<div style=\"margin-top:22px;padding-top:16px;border-top:1px solid #f0f0f0\">" +
    "<p style=\"margin:0;font-size:11px;color:#9ca3af;line-height:1.7\">This is a computer-generated tax invoice cum receipt and does not require a signature. " +
    "For billing questions, contact " + SELLER.email + ".</p></div>" +
    "</td></tr></table></td></tr></table></body></html>"
  );
}

// ── PDF (email attachment / download) ───────────────────────────────────────

export function renderInvoicePdf(inv: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const issued = new Date(inv.createdAt);
      const dateStr = issued.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const left = 50;
      const right = 545;
      const dark = "#111827";
      const grey = "#6b7280";

      // Header band
      doc.rect(0, 0, 595, 76).fill("#09090b");
      drawInvoiceLogo(doc, left, 22);
      doc.fillColor("#d1d5db").fontSize(11).font("Helvetica-Bold")
        .text("TAX INVOICE CUM RECEIPT", 0, 33, { align: "right", width: right });

      // Seller
      let y = 96;
      doc.fillColor(dark).font("Helvetica-Bold").fontSize(12).text(SELLER.name, left, y);
      y += 16;
      doc.font("Helvetica").fontSize(9).fillColor(grey);
      for (const line of SELLER.addressLines) { doc.text(line, left, y, { width: 250 }); y += 12; }
      doc.fillColor("#374151").fontSize(9);
      if (SELLER.gstin) { doc.text(`GSTIN: ${SELLER.gstin}`, left, y); y += 12; }
      if (SELLER.pan) { doc.text(`PAN: ${SELLER.pan}`, left, y); y += 12; }
      if (SELLER.cin) { doc.text(`CIN: ${SELLER.cin}`, left, y); y += 12; }
      doc.text(`State: ${SELLER.state} (${SELLER.stateCode})`, left, y); y += 12;

      // Invoice meta (right column)
      doc.fillColor(dark).font("Helvetica-Bold").fontSize(10)
        .text(`Invoice #: ${inv.invoiceNumber}`, 300, 96, { align: "right", width: right - 300 });
      doc.font("Helvetica").fontSize(9).fillColor(grey)
        .text(`Date: ${dateStr}`, 300, 112, { align: "right", width: right - 300 });
      if (inv.razorpayPaymentId) {
        doc.text(`Payment Ref: ${inv.razorpayPaymentId}`, 300, 125, { align: "right", width: right - 300 });
      }
      doc.font("Helvetica-Bold").fillColor("#15803d").fontSize(11)
        .text("PAID", 300, 140, { align: "right", width: right - 300 });

      // Divider
      y = Math.max(y, 160) + 6;
      doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5e7eb").stroke();
      y += 14;

      // Bill to
      doc.fillColor(grey).font("Helvetica").fontSize(8).text("BILLED TO", left, y);
      y += 12;
      doc.fillColor(dark).font("Helvetica-Bold").fontSize(11).text(inv.buyerName || inv.buyerEmail || "Customer", left, y);
      y += 14;
      doc.font("Helvetica").fontSize(9).fillColor(grey);
      if (inv.buyerEmail) { doc.text(inv.buyerEmail, left, y); y += 12; }
      if (inv.buyerGstin) { doc.fillColor("#374151").text(`GSTIN: ${inv.buyerGstin}`, left, y); y += 12; }
      if (inv.placeOfSupply) { doc.fillColor("#374151").text(`Place of supply: ${inv.placeOfSupply}`, left, y); y += 12; }

      // Line-item table header
      y += 10;
      doc.rect(left, y, right - left, 22).fill("#f3f4f6");
      doc.fillColor(grey).font("Helvetica-Bold").fontSize(8);
      doc.text("DESCRIPTION", left + 8, y + 7);
      doc.text("SAC", 360, y + 7, { width: 60, align: "center" });
      doc.text("TAXABLE VALUE", 430, y + 7, { width: right - 430 - 8, align: "right" });
      y += 22;

      // Line-item row
      doc.fillColor(dark).font("Helvetica").fontSize(10);
      const descHeight = doc.heightOfString(inv.description, { width: 300 });
      doc.text(inv.description, left + 8, y + 8, { width: 300 });
      doc.text(inv.hsnSac || "-", 360, y + 8, { width: 60, align: "center" });
      doc.text(money(inv.baseCents), 430, y + 8, { width: right - 430 - 8, align: "right" });
      y += Math.max(descHeight, 14) + 16;
      doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5e7eb").stroke();
      y += 12;

      // Totals (right aligned)
      const totalsX = 330;
      const labelW = 130;
      const valW = right - (totalsX + labelW);
      const totalRow = (label: string, value: string, bold = false) => {
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 10).fillColor(dark);
        doc.text(label, totalsX, y, { width: labelW });
        doc.text(value, totalsX + labelW, y, { width: valW, align: "right" });
        y += bold ? 20 : 16;
      };
      const halfRate = (inv.gstRateBps / 200).toFixed(0);
      const fullRate = (inv.gstRateBps / 100).toFixed(0);
      totalRow("Taxable value", money(inv.baseCents));
      if (inv.igstCents > 0) {
        totalRow(`IGST @ ${fullRate}%`, money(inv.igstCents));
      } else {
        totalRow(`CGST @ ${halfRate}%`, money(inv.cgstCents));
        totalRow(`SGST @ ${halfRate}%`, money(inv.sgstCents));
      }
      doc.moveTo(totalsX, y).lineTo(right, y).strokeColor("#111827").lineWidth(1.4).stroke();
      y += 6;
      totalRow("Total", money(inv.totalCents), true);

      // Amount in words
      y += 6;
      doc.font("Helvetica").fontSize(9).fillColor(grey)
        .text(`Amount in words: ${rupeesInWords(inv.totalCents)}`, left, y, { width: right - left });

      // Footer
      doc.font("Helvetica").fontSize(8).fillColor("#9ca3af")
        .text(
          "This is a computer-generated tax invoice cum receipt and does not require a signature. " +
          `For billing questions, contact ${SELLER.email}. ${SELLER.website}`,
          left, 780, { width: right - left, align: "center" },
        );

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
