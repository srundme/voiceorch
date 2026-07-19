/**
 * GST tax-invoice (cum receipt) issuing + delivery.
 *
 * Creates, persists, and emails a single combined GST tax invoice / payment
 * receipt (with a PDF attachment) for every paid purchase (wallet top-up, phone
 * number, concurrent slot). Rendering + seller config live in invoice-render.ts.
 */

import { randomUUID } from "crypto";
import { db, invoicesTable, type Invoice } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { sendBrevoEmail } from "./brevo.js";
import { GST_RATE } from "../lib/money-inr.js";
import {
  SELLER,
  computeTax,
  formatInvoiceNumber,
  renderInvoiceHtml,
  renderInvoicePdf,
  type InvoiceType,
} from "./invoice-render.js";

export type { InvoiceType };

interface IssueInvoiceParams {
  user: { id: number; name?: string | null; email?: string | null };
  type: InvoiceType;
  description: string;
  hsnSac?: string;
  /** Amount in paise. Interpreted per `gstInclusive`. */
  amountCents: number;
  /** true = amount already includes GST (back-calculate base); false = base, GST added on top. */
  gstInclusive?: boolean;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  placeOfSupply?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Create, persist, and email a GST tax invoice cum receipt (with PDF attached).
 * Idempotent per Razorpay payment id (safe to call from both the sync verify
 * path and the async webhook). Never throws — invoicing failures must not break
 * the purchase flow.
 */
export async function issueInvoice(params: IssueInvoiceParams): Promise<Invoice | null> {
  try {
    if (params.razorpayPaymentId) {
      const [existing] = await db
        .select()
        .from(invoicesTable)
        .where(eq(invoicesTable.razorpayPaymentId, params.razorpayPaymentId));
      if (existing) {
        logger.info({ invoiceId: existing.id, paymentId: params.razorpayPaymentId }, "Invoice already issued — skipping");
        return existing;
      }
    }

    const tax = computeTax(params.amountCents, params.gstInclusive ?? false, params.buyerStateCode ?? null);
    const now = new Date();

    const [inserted] = await db
      .insert(invoicesTable)
      .values({
        invoiceNumber: `PENDING-${randomUUID()}`,
        userId: params.user.id,
        type: params.type,
        description: params.description,
        hsnSac: params.hsnSac ?? null,
        baseCents: tax.baseCents,
        cgstCents: tax.cgstCents,
        sgstCents: tax.sgstCents,
        igstCents: tax.igstCents,
        gstCents: tax.gstCents,
        totalCents: tax.totalCents,
        gstRateBps: Math.round(GST_RATE * 10000),
        currency: "INR",
        sellerGstin: SELLER.gstin || null,
        buyerName: params.user.name ?? null,
        buyerEmail: params.user.email ?? null,
        buyerGstin: params.buyerGstin ?? null,
        placeOfSupply: params.placeOfSupply ?? (tax.intraState ? `${SELLER.state} (${SELLER.stateCode})` : null),
        razorpayOrderId: params.razorpayOrderId ?? null,
        razorpayPaymentId: params.razorpayPaymentId ?? null,
        status: "issued",
        metadata: params.metadata ?? null,
      })
      .returning();

    const invoiceNumber = formatInvoiceNumber(inserted!.id, now);
    const [invoice] = await db
      .update(invoicesTable)
      .set({ invoiceNumber })
      .where(eq(invoicesTable.id, inserted!.id))
      .returning();

    if (params.user.email) {
      try {
        const pdf = await renderInvoicePdf(invoice!);
        await sendBrevoEmail(
          params.user.email,
          `Tax Invoice ${invoiceNumber} — SnapServe`,
          renderInvoiceHtml(invoice!),
          [{ content: pdf.toString("base64"), name: `${invoiceNumber.replace(/\//g, "-")}.pdf` }],
          {
            emailType: "invoice",
            toUserId: String(params.user.id),
            toName: params.user.name ?? null,
          },
        );
        await db.update(invoicesTable).set({ emailedAt: new Date() }).where(eq(invoicesTable.id, invoice!.id));
      } catch (emailErr) {
        logger.warn({ emailErr, invoiceId: invoice!.id }, "Invoice email failed — invoice still saved");
      }
    }

    logger.info({ invoiceId: invoice!.id, invoiceNumber, type: params.type, total: tax.totalCents }, "Tax invoice issued");
    return invoice!;
  } catch (err) {
    logger.warn({ err, paymentId: params.razorpayPaymentId, type: params.type }, "issueInvoice failed (non-fatal)");
    return null;
  }
}

export { renderInvoiceHtml, renderInvoicePdf };
