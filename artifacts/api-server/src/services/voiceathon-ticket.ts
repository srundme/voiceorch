import PDFDocument from "pdfkit";

export type VoiceathonTicketDetails = {
  ticketCode: string;
  eventTitle: string;
  teamName: string;
  leaderName: string;
  leaderEmail: string;
  venue: string;
  eventStartsAt: Date;
  teamSize: number;
};

export async function renderVoiceathonTicketPdf(
  details: VoiceathonTicketDetails,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [720, 300],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, 720, 300).fill("#07111f");
    doc.rect(0, 0, 12, 300).fill("#22d3ee");
    doc.rect(520, 0, 200, 300).fill("#0d1d2f");

    doc.fillColor("#22d3ee").font("Courier-Bold").fontSize(11)
      .text("SNAPSERVE // EVENT ACCESS", 40, 28);
    doc.fillColor("#f8fafc").font("Helvetica-Bold").fontSize(25)
      .text(details.eventTitle, 40, 54, { width: 440, height: 62 });
    doc.fillColor("#94a3b8").font("Courier").fontSize(9)
      .text("REGISTRATION APPROVED · BUILD / SHIP / SPEAK", 40, 118);

    doc.strokeColor("#1e3a50").lineWidth(1).moveTo(40, 143).lineTo(485, 143).stroke();

    const date = details.eventStartsAt.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    });
    const rows = [
      ["TEAM", details.teamName],
      ["LEAD", `${details.leaderName} · ${details.leaderEmail}`],
      ["WHEN", date],
      ["WHERE", details.venue],
      ["CREW", `${details.teamSize} participant${details.teamSize === 1 ? "" : "s"}`],
    ];
    let y = 158;
    for (const [label, value] of rows) {
      doc.fillColor("#64748b").font("Courier-Bold").fontSize(8).text(label!, 40, y);
      doc.fillColor("#e2e8f0").font("Helvetica").fontSize(10).text(value!, 98, y - 1, {
        width: 385,
        ellipsis: true,
      });
      y += 24;
    }

    doc.fillColor("#22d3ee").font("Courier-Bold").fontSize(10)
      .text("ACCESS TOKEN", 548, 38);
    doc.fillColor("#f8fafc").font("Courier-Bold").fontSize(17)
      .text(details.ticketCode, 548, 64, { width: 150 });
    doc.strokeColor("#22d3ee").lineWidth(1).rect(548, 105, 120, 120).stroke();

    // Deterministic circuit-like visual derived from the ticket code.
    const bytes = Buffer.from(details.ticketCode);
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const value = bytes[(row * 8 + col) % bytes.length] ?? 0;
        if ((value + row + col) % 3 !== 0) {
          doc.rect(555 + col * 13, 112 + row * 13, 9, 9)
            .fill((row + col) % 4 === 0 ? "#22d3ee" : "#e2e8f0");
        }
      }
    }
    doc.fillColor("#64748b").font("Courier").fontSize(7)
      .text("Present this pass at check-in", 548, 242, { width: 145, align: "center" });
    doc.fillColor("#334155").fontSize(7)
      .text("snapserve.ai/voiceathon", 548, 266, { width: 145, align: "center" });

    doc.end();
  });
}

export function voiceathonTicketEmailHtml(details: VoiceathonTicketDetails): string {
  const date = details.eventStartsAt.toLocaleString("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
  const safe = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]!);
  return `
    <div style="font-family:Inter,Arial,sans-serif;background:#07111f;color:#e2e8f0;padding:32px;border-radius:14px">
      <div style="font:700 12px monospace;color:#22d3ee;letter-spacing:.12em">SNAPSERVE // ACCESS GRANTED</div>
      <h1 style="margin:12px 0 6px;color:#f8fafc;font-size:28px">Your team is approved.</h1>
      <p style="color:#94a3b8;margin-top:0">The attached PDF is your official event ticket.</p>
      <div style="border:1px solid #1e3a50;border-left:4px solid #22d3ee;border-radius:8px;padding:18px;margin:24px 0">
        <div style="font-size:18px;font-weight:700;color:#f8fafc">${safe(details.teamName)}</div>
        <div style="margin-top:12px"><b>Event:</b> ${safe(details.eventTitle)}</div>
        <div style="margin-top:6px"><b>Date:</b> ${date}</div>
        <div style="margin-top:6px"><b>Venue:</b> ${safe(details.venue)}</div>
        <div style="margin-top:6px"><b>Ticket:</b> <code style="color:#22d3ee">${safe(details.ticketCode)}</code></div>
      </div>
      <p style="color:#94a3b8;font-size:13px">Keep this ticket ready at check-in. Do not share the access token publicly.</p>
    </div>`;
}
