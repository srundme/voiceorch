/**
 * Voice-a-thon certificate PDF renderer (PDFKit) — mirrors invoice-render style.
 */

import PDFDocument from "pdfkit";
import type { VoiceathonCertificateType } from "@workspace/db";

export async function renderVoiceathonCertificatePdf(opts: {
  eventTitle: string;
  recipientName: string;
  teamName: string;
  type: VoiceathonCertificateType;
  verificationCode: string;
  issuedAt: Date;
}): Promise<Buffer> {
  const typeLabel =
    opts.type === "winner" ? "Winner"
      : opts.type === "runner_up" ? "Runner-up"
        : opts.type === "finalist" ? "Finalist"
          : "Participant";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 50, bottom: 50, left: 60, right: 60 },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;

    // Border
    doc.lineWidth(3).strokeColor("#0f172a")
      .rect(30, 30, pageW - 60, pageH - 60).stroke();
    doc.lineWidth(1).strokeColor("#94a3b8")
      .rect(40, 40, pageW - 80, pageH - 80).stroke();

    doc.fillColor("#0f172a").fontSize(14).font("Helvetica")
      .text("SnapServe AI", 0, 70, { align: "center" });

    doc.fontSize(28).font("Helvetica-Bold")
      .text("Certificate of Achievement", 0, 110, { align: "center" });

    doc.fontSize(12).font("Helvetica").fillColor("#475569")
      .text(`This certifies that`, 0, 170, { align: "center" });

    doc.fontSize(26).font("Helvetica-Bold").fillColor("#0f172a")
      .text(opts.recipientName, 0, 200, { align: "center" });

    doc.fontSize(12).font("Helvetica").fillColor("#475569")
      .text(`of team "${opts.teamName}" is recognized as a ${typeLabel} of`, 0, 245, { align: "center" });

    doc.fontSize(18).font("Helvetica-Bold").fillColor("#0f172a")
      .text(opts.eventTitle, 0, 275, { align: "center" });

    doc.fontSize(11).font("Helvetica").fillColor("#64748b")
      .text(`Issued ${opts.issuedAt.toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}`, 0, 330, { align: "center" });

    doc.fontSize(9).fillColor("#94a3b8")
      .text(`Verification code: ${opts.verificationCode}`, 0, pageH - 70, { align: "center" });

    doc.end();
  });
}
