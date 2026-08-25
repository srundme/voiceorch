#!/usr/bin/env python3
"""One-off: SnapServe Africa brief PDF for a business introduction."""

from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

OUT = "/Users/karthikeyansru/2026snapservep2/docs/marketing/SnapServe-Africa-Voice-AI-Brief.pdf"

TEAL = HexColor("#0f766e")
TEAL_SOFT = HexColor("#ccfbf1")
INK = HexColor("#0f172a")
MUTED = HexColor("#475569")
RULE = HexColor("#e2e8f0")
ROW_ALT = HexColor("#f8fafc")


class Hairline(Flowable):
    def __init__(self, color=RULE, thickness=0.6):
        super().__init__()
        self.color = color
        self.thickness = thickness
        self.height = 6

    def wrap(self, aw, ah):
        self.width = aw
        return aw, self.height

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 3, self.width, 3)


def styles():
    base = getSampleStyleSheet()
    s = {
        "kicker": ParagraphStyle(
            "kicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            textColor=TEAL,
            tracking=1.2,
            spaceAfter=4,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            textColor=INK,
            spaceAfter=8,
        ),
        "lead": ParagraphStyle(
            "lead",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=MUTED,
            spaceAfter=10,
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=12.5,
            leading=16,
            textColor=INK,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14.5,
            textColor=INK,
            spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=INK,
            leftIndent=12,
            bulletIndent=0,
            spaceAfter=3,
        ),
        "cell": ParagraphStyle(
            "cell",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.5,
            leading=11.5,
            textColor=INK,
        ),
        "cellh": ParagraphStyle(
            "cellh",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8.5,
            leading=11,
            textColor=TEAL,
        ),
        "note": ParagraphStyle(
            "note",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=13,
            textColor=MUTED,
            spaceBefore=4,
            spaceAfter=6,
        ),
        "footer": ParagraphStyle(
            "footer",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            textColor=MUTED,
            alignment=TA_LEFT,
        ),
    }
    return s


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(TEAL)
    canvas.rect(0, h - 8, w, 8, fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(18 * mm, 12 * mm, "SnapServe  |  app.snapserve.ai  |  Confidential introduction")
    canvas.drawRightString(w - 18 * mm, 12 * mm, "Page %d" % canvas.getPageNumber())
    canvas.restoreState()


def table_row(left, right, st):
    return [Paragraph(left, st["cell"]), Paragraph(right, st["cell"])]


def build():
    st = styles()
    doc = SimpleDocTemplate(
        OUT,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title="SnapServe: AI Voice Telecaller for Africa and Global Markets",
        author="SnapServe",
        subject="Business introduction",
    )

    story = []
    story.append(Paragraph("SNAPSERVE  |  BUSINESS INTRODUCTION", st["kicker"]))
    story.append(Paragraph("An AI telecaller for your market, including African languages", st["h1"]))
    story.append(
        Paragraph(
            "A short briefing for operators who want to run professional outbound and inbound "
            "phone campaigns without standing up a full call-centre floor first.",
            st["lead"],
        )
    )
    story.append(Hairline())

    story.append(Paragraph("What SnapServe is", st["h2"]))
    story.append(
        Paragraph(
            "SnapServe is software that runs an <b>AI voice agent on the phone</b> - like a "
            "well-trained telecaller who can work all day, in the caller's language.",
            st["body"],
        )
    )
    story.append(
        Paragraph(
            "It can call your customers, or answer when they call you. It speaks naturally - "
            "not a robot menu of &quot;press 1&quot;. It can book appointments, answer common "
            "questions, collect details, and follow up on payments. After the call it can send "
            "a <b>WhatsApp</b> or email, and write the result into a spreadsheet or your CRM.",
            st["body"],
        )
    )
    story.append(
        Paragraph(
            "You do not hire a call-centre floor to start. You set up one agent, give it your "
            "script and your data, and it dials.",
            st["body"],
        )
    )

    story.append(Paragraph("How a call works (no jargon)", st["h2"]))
    story.append(
        Paragraph(
            "The person talks. SnapServe turns speech into text. The AI decides what to say "
            "or do (book a slot, send WhatsApp, transfer to a human, end the call). It speaks "
            "back on the same phone line. You can listen to recordings and see what happened "
            "after each call.",
            st["body"],
        )
    )

    story.append(Paragraph("Global, including Africa", st["h2"]))
    story.append(
        Paragraph(
            "This is not India-only. The same platform can sit on local or international phone "
            "numbers (Nigeria, Kenya, Ghana, South Africa, Tanzania, and others) through global "
            "carriers. WhatsApp matters as much as the phone in Africa - SnapServe already does "
            "mid-call and post-call WhatsApp, not only voice.",
            st["body"],
        )
    )

    headers = [
        Paragraph("Market", st["cellh"]),
        Paragraph("What we can run today", st["cellh"]),
    ]
    rows = [
        headers,
        table_row(
            "English (Nigeria, Kenya, Ghana, South Africa, Tanzania)",
            "Strong. Easiest first launch.",
            st,
        ),
        table_row("French (West / Central Africa)", "Strong.", st),
        table_row("Arabic (North Africa)", "Strong.", st),
        table_row("Portuguese (Angola, Mozambique)", "Strong.", st),
        table_row(
            "Swahili, Hausa, Yoruba, Zulu, Afrikaans, Amharic, Somali, and several others",
            "Available on our Gemini Live voice path (the model hears and speaks the language directly).",
            st,
        ),
        table_row(
            "Igbo, Xhosa, Lingala, and some others",
            "We can list them, but quality must be tested on a live number before you sell it as production.",
            st,
        ),
    ]
    t = Table(rows, colWidths=[78 * mm, 96 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), TEAL_SOFT),
                ("BACKGROUND", (0, 2), (-1, 2), ROW_ALT),
                ("BACKGROUND", (0, 4), (-1, 4), ROW_ALT),
                ("BACKGROUND", (0, 6), (-1, 6), ROW_ALT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("GRID", (0, 0), (-1, -1), 0.4, RULE),
            ]
        )
    )
    story.append(t)

    story.append(Paragraph("How we would implement it with you", st["h2"]))
    steps = [
        "<b>1. Pick one country and one job.</b> Example: Kenya - English + Swahili, callback after a website form. Or Nigeria - English + Hausa/Yoruba, appointment reminder.",
        "<b>2. Get a local number</b> and confirm calling rules (consent, DND, POPIA in South Africa, NDPR in Nigeria, and similar).",
        "<b>3. Write the agent once:</b> who you are, what you sell, what you must never promise, when to transfer to a human.",
        "<b>4. Connect your list:</b> CSV, Google Sheet, or website form. SnapServe dials.",
        "<b>5. Pilot 100-500 calls.</b> Listen to recordings, fix the script, then scale.",
        "<b>6. Add WhatsApp</b> so the customer gets a message after the call (booking, link, summary).",
    ]
    for step in steps:
        story.append(Paragraph("&bull;  " + step, st["bullet"]))
    story.append(
        Paragraph(
            "A first live pilot is usually days, not months, if the use case is clear.",
            st["body"],
        )
    )

    story.append(Paragraph("What we would not claim", st["h2"]))
    story.append(
        Paragraph(
            "SnapServe was built first for India (Hindi, Tamil, Telugu, and other Indian "
            "languages on the phone). That is why the voice quality there is very strong. "
            "For Africa we use the global voice stack, and we should prove Swahili / Hausa / "
            "Yoruba on <b>your</b> numbers before a big campaign. English, French, and Arabic "
            "we can start with more confidence.",
            st["body"],
        )
    )

    next_box = [
        [
            Paragraph(
                "<b>Suggested next step.</b> A 15-minute live demo: you call a number, talk to "
                "the agent in English (and Swahili or French if you want), and we walk through "
                "how it would sit in your business. Start with one country and one campaign.",
                st["body"],
            )
        ]
    ]
    box = Table(next_box, colWidths=[174 * mm])
    box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TEAL_SOFT),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("BOX", (0, 0), (-1, -1), 0, TEAL_SOFT),
            ]
        )
    )
    story.append(Spacer(1, 6))
    story.append(KeepTogether([box]))
    story.append(Spacer(1, 8))
    story.append(Paragraph("SnapServe &nbsp;&nbsp; app.snapserve.ai", st["note"]))

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(OUT)


if __name__ == "__main__":
    build()
