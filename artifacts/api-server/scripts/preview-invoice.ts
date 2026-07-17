/* Standalone invoice preview — writes sample PDFs/HTML to /tmp. No DB needed. */
import { writeFileSync } from "fs";
import type { Invoice } from "@workspace/db";
import { computeTax, formatInvoiceNumber, renderInvoiceHtml, renderInvoicePdf } from "../src/services/invoice-render.js";

function sample(
  id: number,
  type: Invoice["type"],
  description: string,
  hsnSac: string,
  amountCents: number,
  gstInclusive: boolean,
): Invoice {
  const tax = computeTax(amountCents, gstInclusive, null);
  const now = new Date();
  return {
    id,
    invoiceNumber: formatInvoiceNumber(id, now),
    userId: 1,
    type,
    description,
    hsnSac,
    baseCents: tax.baseCents,
    cgstCents: tax.cgstCents,
    sgstCents: tax.sgstCents,
    igstCents: tax.igstCents,
    gstCents: tax.gstCents,
    totalCents: tax.totalCents,
    gstRateBps: 1800,
    currency: "INR",
    sellerGstin: "29DOXPG9478G1ZU",
    buyerName: "Karthikeyan S",
    buyerEmail: "karthikeyan@example.com",
    buyerGstin: null,
    placeOfSupply: "Karnataka (29)",
    razorpayOrderId: "order_Qabc123XYZ",
    razorpayPaymentId: "pay_Qdef456UVW",
    status: "issued",
    emailedAt: null,
    metadata: null,
    createdAt: now,
  } as Invoice;
}

async function main() {
  const cases: Array<[Invoice, string]> = [
    [sample(42, "wallet_topup", "Wallet top-up — prepaid calling credit", "998413", 100_000, false), "wallet"],
    [sample(43, "phone_number", "Phone number +91 80 4718 2200 — provisioning & 1 month rental", "998411", 80_000, false), "phone"],
    [sample(44, "concurrent_slot", "Concurrent call slot (limit now 11)", "998413", 100_000, true), "concurrent"],
  ];
  for (const [inv, tag] of cases) {
    const pdf = await renderInvoicePdf(inv);
    writeFileSync(`/tmp/invoice-${tag}.pdf`, pdf);
    writeFileSync(`/tmp/invoice-${tag}.html`, renderInvoiceHtml(inv));
    console.log(`wrote /tmp/invoice-${tag}.pdf (${pdf.length} bytes)`);
  }
}

void main();
