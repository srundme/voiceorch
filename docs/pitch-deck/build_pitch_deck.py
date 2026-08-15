#!/usr/bin/env python3
"""SnapServe AI — Seed pitch deck (₹5 Cr) + Deepgram-style dark slides."""

from pathlib import Path
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
OUT = Path(__file__).resolve().parent
PRS_W, PRS_H = Inches(13.333), Inches(7.5)

# Deepgram-adjacent dark palette + SnapServe accent
BG = RGBColor(0x12, 0x12, 0x14)
FG = RGBColor(0xF5, 0xF5, 0xF5)
MUTED = RGBColor(0xA1, 0xA1, 0xAA)
ACCENT = RGBColor(0xE1, 0x1D, 0x48)  # rose/red like Deepgram
GREEN = RGBColor(0x22, 0xC5, 0x5E)
BLUE = RGBColor(0x38, 0xBD, 0xF8)
CARD = RGBColor(0x1C, 0x1C, 0x1F)
BORDER = RGBColor(0x2A, 0x2A, 0x2E)


def set_slide_bg(slide, color=BG):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_text(slide, left, top, width, height, text, size=18, bold=False, color=FG, align=PP_ALIGN.LEFT, font="Helvetica"):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    return box


def add_lines(slide, left, top, width, height, lines, size=16, color=FG, spacing=6):
    """lines: list of (text, optional dict overrides)"""
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(lines):
        if isinstance(item, str):
            text, opts = item, {}
        else:
            text, opts = item[0], item[1] if len(item) > 1 else {}
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = opts.get("align", PP_ALIGN.LEFT)
        p.space_after = Pt(opts.get("space_after", spacing))
        run = p.add_run()
        run.text = text
        run.font.size = Pt(opts.get("size", size))
        run.font.bold = opts.get("bold", False)
        run.font.color.rgb = opts.get("color", color)
        run.font.name = opts.get("font", "Helvetica")
    return box


def card(slide, left, top, width, height):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = CARD
    shape.line.color.rgb = BORDER
    shape.line.width = Pt(1)
    try:
        shape.adjustments[0] = 0.08
    except Exception:
        pass
    return shape


def footer_logo(slide, label="SNAPSERVE"):
    add_text(slide, Inches(11.2), Inches(7.05), Inches(1.9), Inches(0.35), label, size=10, color=MUTED, align=PP_ALIGN.RIGHT)


def section_tag(slide, text):
    add_text(slide, Inches(11.0), Inches(0.28), Inches(2.0), Inches(0.3), text.upper(), size=11, color=MUTED, align=PP_ALIGN.RIGHT)


def new_slide(prs):
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank
    set_slide_bg(slide)
    return slide


def build():
    prs = Presentation()
    prs.slide_width = PRS_W
    prs.slide_height = PRS_H

    # ── 1 Cover ──────────────────────────────────────────────
    s = new_slide(prs)
    add_text(s, Inches(0.9), Inches(2.2), Inches(11), Inches(0.9), "SNAPSERVE AI", size=44, bold=True, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(3.1), Inches(11), Inches(0.5), "AI voice agents for Indian business — live in minutes, not months.", size=22, color=ACCENT, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(4.0), Inches(11), Inches(0.4), "Seed raise  ·  ₹5 Crore  ·  Confidential", size=16, color=MUTED, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(6.4), Inches(11), Inches(0.4), "Karthikeyan, CEO  ·  karthikeyan@theaitel.com  ·  Chennai", size=14, color=MUTED, align=PP_ALIGN.CENTER)

    # ── 2 Hook ───────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "HOOK")
    add_lines(s, Inches(0.9), Inches(2.0), Inches(11.5), Inches(3.5), [
        ("Voice AI for Indian businesses is stuck.", {"size": 32, "bold": True}),
        ("Between DIY stacks, Western APIs, and BPOs —", {"size": 22, "color": MUTED, "space_after": 14}),
        ("nobody ships production agents that speak India,", {"size": 22}),
        ("run campaigns, and remember every caller.", {"size": 22}),
        ("", {"size": 12}),
        ("We're the founders building that layer.", {"size": 22, "color": ACCENT, "bold": True}),
    ])
    footer_logo(s)

    # ── 3 Problem ────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "PROBLEM")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Problem", size=28, bold=True)
    add_text(s, Inches(0.8), Inches(1.05), Inches(11), Inches(0.5), "Indian SMBs & BPOs can't deploy voice agents without a 3–6 month eng project.", size=18, color=MUTED)

    problems = [
        ("DIY stack", "STT + LLM + TTS + telephony\nstitched by hand"),
        ("Western tools", "Weak on Indian languages,\naccents, local telephony"),
        ("BPO-only", "Human cost scales linearly;\nno memory, no campaigns"),
        ("No ops layer", "No wallet, dispositions,\nMeet agent, or white-label"),
    ]
    for i, (t, d) in enumerate(problems):
        x = Inches(0.8 + i * 3.05)
        card(s, x, Inches(2.0), Inches(2.85), Inches(3.4))
        add_text(s, x + Inches(0.2), Inches(2.3), Inches(2.45), Inches(0.5), t, size=18, bold=True, color=ACCENT)
        add_text(s, x + Inches(0.2), Inches(3.0), Inches(2.45), Inches(2.0), d, size=15, color=FG)
    footer_logo(s)

    # ── 4 Solution ───────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "SOLUTION")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Solution", size=28, bold=True)
    add_text(s, Inches(0.8), Inches(1.05), Inches(11.5), Inches(0.6), "SnapServe is the voice agent platform for India — agents, campaigns, memory, meetings & WhatsApp in one product.", size=18, color=MUTED)

    pillars = [
        ("Agent builder", "Sarvam + global STT/LLM/TTS\nLive in under 10 minutes"),
        ("Campaigns", "Batches, retries, dispositions,\ndeep call intelligence"),
        ("Caller memory", "Every caller remembered\nacross sessions"),
        ("Meet + WhatsApp", "Google Meet / Zoom agents\n+ Vobiz WhatsApp calling"),
        ("Wallet + partners", "₹5/min usage billing\nWhite-label for partners"),
    ]
    for i, (t, d) in enumerate(pillars):
        x = Inches(0.55 + i * 2.5)
        card(s, x, Inches(2.1), Inches(2.35), Inches(3.6))
        add_text(s, x + Inches(0.15), Inches(2.35), Inches(2.05), Inches(0.7), t, size=15, bold=True, color=GREEN)
        add_text(s, x + Inches(0.15), Inches(3.15), Inches(2.05), Inches(2.2), d, size=13, color=FG)
    footer_logo(s)

    # ── 5 Why now ────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "WHY NOW")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Why now", size=28, bold=True)
    whys = [
        ("Indic AI is ready", "Sarvam-class models make Tamil, Hindi, Telugu… production-grade."),
        ("Telephony is programmable", "Vobiz / Plivo-class APIs + WhatsApp calling unlock distribution."),
        ("Cost collapse", "Voice minutes are cheap enough for SMB outbound + support."),
        ("Buyer urgency", "Missed leads & clinic no-shows are bleeding cash every day."),
    ]
    for i, (t, d) in enumerate(whys):
        y = Inches(1.3 + i * 1.2)
        card(s, Inches(0.8), y, Inches(11.7), Inches(1.05))
        add_text(s, Inches(1.05), y + Inches(0.2), Inches(11.2), Inches(0.35), t, size=18, bold=True, color=ACCENT)
        add_text(s, Inches(1.05), y + Inches(0.55), Inches(11.2), Inches(0.4), d, size=15, color=FG)
    footer_logo(s)

    # ── 6 Product ────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "PRODUCT")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Product surface", size=28, bold=True)
    add_text(s, Inches(0.8), Inches(1.1), Inches(11.5), Inches(0.4), "One platform — phone, webcall, meetings, WhatsApp, partners.", size=18, color=MUTED)
    items = [
        "Voice agents with barge-in, KB, tools, transfers",
        "Outbound campaigns + batch workspace + analytics",
        "Inbound routing, DNC, callbacks, bookings",
        "Google Meet / Zoom meeting agents with slides",
        "WhatsApp (Vobiz supply + calling) from wallet",
        "Partner white-label domains + client login",
    ]
    for i, t in enumerate(items):
        col = i % 2
        row = i // 2
        x = Inches(0.8 + col * 6.1)
        y = Inches(1.8 + row * 1.35)
        card(s, x, y, Inches(5.8), Inches(1.15))
        add_text(s, x + Inches(0.3), y + Inches(0.35), Inches(5.2), Inches(0.5), f"→  {t}", size=16, color=FG)
    footer_logo(s)

    # ── 7 Market ─────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "MARKET")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Market — win India enterprise voice first", size=26, bold=True)
    add_text(s, Inches(0.8), Inches(1.15), Inches(11), Inches(0.4), "Beachhead: clinics, D2C, BFSI collections, real estate, staffing, BPO white-label.", size=16, color=MUTED)

    markets = [
        ("₹12,500 Cr+", "India contact-center\n& voice ops opportunity\n(directional)"),
        ("60M+", "Indian SMBs with\nno voice AI stack"),
        ("₹5 / min", "Our wedge price\n— usage scales with\ncustomer success"),
    ]
    for i, (n, d) in enumerate(markets):
        x = Inches(0.8 + i * 4.05)
        card(s, x, Inches(2.0), Inches(3.8), Inches(3.8))
        add_text(s, x + Inches(0.25), Inches(2.4), Inches(3.3), Inches(0.8), n, size=32, bold=True, color=GREEN if i < 2 else ACCENT, align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.25), Inches(3.5), Inches(3.3), Inches(1.8), d, size=16, color=FG, align=PP_ALIGN.CENTER)
    footer_logo(s)

    # ── 8 Traction (HONEST) ──────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "TRACTION")
    add_text(s, Inches(0.8), Inches(0.4), Inches(10), Inches(0.45), "Traction — live product, real usage (Aug 2026)", size=26, bold=True)
    add_text(s, Inches(0.8), Inches(0.95), Inches(11.5), Inches(0.35), "Source: SnapServe Admin · Platform Overview + Finance (15 Jul – 14 Aug 2026)", size=12, color=MUTED)

    metrics = [
        ("417", "Total users"),
        ("4,356", "Total calls"),
        ("3,982", "Total minutes"),
        ("205", "Calls / 24h"),
        ("₹35,083", "Recognized (30d)"),
        ("₹31,100", "Cash-in topups (30d)"),
        ("4,138", "Calls in period"),
        ("54%", "Completion rate*"),
    ]
    for i, (n, l) in enumerate(metrics):
        col, row = i % 4, i // 4
        x = Inches(0.7 + col * 3.15)
        y = Inches(1.5 + row * 2.35)
        card(s, x, y, Inches(2.95), Inches(2.1))
        add_text(s, x + Inches(0.15), y + Inches(0.45), Inches(2.65), Inches(0.7), n, size=28, bold=True, color=GREEN, align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.15), y + Inches(1.25), Inches(2.65), Inches(0.5), l, size=13, color=MUTED, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.8), Inches(6.5), Inches(11), Inches(0.35), "*Completed / total in period. Early-stage volume — raise funds growth, not maintenance.", size=11, color=MUTED)
    footer_logo(s)

    # ── 9 Unit economics ─────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "UNIT ECONOMICS")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Unit economics (INR)", size=28, bold=True)

    econ = [
        ("₹5.00", "Price / minute", GREEN),
        ("₹1.87", "Variable cost / min", ACCENT),
        ("₹3.13", "Contribution / min", GREEN),
        ("62.6%", "Contribution margin", BLUE),
    ]
    for i, (n, l, c) in enumerate(econ):
        x = Inches(0.7 + i * 3.15)
        card(s, x, Inches(1.4), Inches(2.95), Inches(2.2))
        add_text(s, x + Inches(0.1), Inches(1.8), Inches(2.75), Inches(0.7), n, size=32, bold=True, color=c, align=PP_ALIGN.CENTER)
        add_text(s, x + Inches(0.1), Inches(2.7), Inches(2.75), Inches(0.5), l, size=14, color=MUTED, align=PP_ALIGN.CENTER)

    card(s, Inches(0.7), Inches(4.0), Inches(12.0), Inches(2.5))
    add_lines(s, Inches(1.0), Inches(4.25), Inches(11.4), Inches(2.1), [
        ("Fixed burn today ≈ ₹3.0 L / month", {"size": 20, "bold": True}),
        ("  · ₹1.0 L  Vobiz / telephony capacity", {"size": 16, "color": MUTED}),
        ("  · ₹2.0 L  Rent, salaries & ops", {"size": 16, "color": MUTED}),
        ("Break-even ≈ 96,000 minutes / month  (~₹4.8 L recognized) at current margin", {"size": 16, "color": ACCENT, "bold": True, "space_after": 4}),
        ("Today's volume is far below break-even — this raise buys the go-to-market to close the gap.", {"size": 14, "color": FG}),
    ])
    footer_logo(s)

    # ── 10 Business model ────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "MODEL")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Business model", size=28, bold=True)
    add_text(s, Inches(0.8), Inches(1.15), Inches(11), Inches(0.4), "Usage-first. Customers top up wallets. We earn on every minute.", size=18, color=MUTED)

    models = [
        ("Wallet usage", "₹5 / minute platform fee\n(debit as calls run)"),
        ("Phone numbers", "Purchase / rental via wallet\nfor eligible accounts"),
        ("WhatsApp", "Message + call minutes\nbilled from wallet"),
        ("Partners", "White-label sub-accounts\nvolume through partners"),
    ]
    for i, (t, d) in enumerate(models):
        x = Inches(0.7 + i * 3.15)
        card(s, x, Inches(2.0), Inches(2.95), Inches(3.8))
        add_text(s, x + Inches(0.2), Inches(2.4), Inches(2.55), Inches(0.6), t, size=18, bold=True, color=ACCENT)
        add_text(s, x + Inches(0.2), Inches(3.2), Inches(2.55), Inches(2.2), d, size=15, color=FG)
    footer_logo(s)

    # ── 11 Competition ───────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "COMPETITION")
    add_text(s, Inches(0.8), Inches(0.4), Inches(11), Inches(0.45), "Competition — what wins India?", size=26, bold=True)

    # Simple comparison table as cards
    headers = ["", "Western APIs", "DIY / BPO", "SnapServe"]
    rows = [
        ["Indic languages", "Weak", "Custom", "Native"],
        ["Campaigns + CRM ops", "DIY", "Partial", "Built-in"],
        ["Caller memory", "Rare", "Rare", "Core"],
        ["Meet + WhatsApp", "No", "Fragmented", "Yes"],
        ["Wallet / INR billing", "USD cards", "Manual", "Native"],
        ["Time to live agent", "Weeks", "Months", "Minutes"],
    ]
    # header row
    for i, h in enumerate(headers):
        x = Inches(0.5 + i * 3.15)
        add_text(s, x, Inches(1.15), Inches(3.0), Inches(0.4), h, size=14, bold=True, color=MUTED if i else MUTED, align=PP_ALIGN.CENTER if i else PP_ALIGN.LEFT)
    for r, row in enumerate(rows):
        y = Inches(1.65 + r * 0.75)
        for c, cell in enumerate(row):
            x = Inches(0.5 + c * 3.15)
            color = FG
            bold = False
            if c == 3:
                color = GREEN
                bold = True
            elif c in (1, 2) and cell in ("Weak", "Rare", "No", "USD cards", "Months", "Fragmented", "Manual"):
                color = ACCENT
            add_text(s, x, y, Inches(3.0), Inches(0.55), cell, size=15, bold=bold or c == 0, color=color, align=PP_ALIGN.CENTER if c else PP_ALIGN.LEFT)
    footer_logo(s)

    # ── 12 Differentiation ───────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "MOAT")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Why we win", size=28, bold=True)
    diffs = [
        ("India-first stack", "Sarvam + local telephony + vernacular UX — not a US product with a Hindi toggle."),
        ("Ops, not just API", "Campaigns, dispositions, analytics, wallet, partners — the work after the call."),
        ("Relationship memory", "Agents pick up where the last call ended. Sticky by design."),
        ("Distribution wedges", "Meet agents + WhatsApp calling + partner white-label."),
    ]
    for i, (t, d) in enumerate(diffs):
        y = Inches(1.2 + i * 1.25)
        card(s, Inches(0.8), y, Inches(11.7), Inches(1.1))
        add_text(s, Inches(1.1), y + Inches(0.2), Inches(11.2), Inches(0.35), f"{i+1}.  {t}", size=18, bold=True, color=GREEN)
        add_text(s, Inches(1.1), y + Inches(0.55), Inches(11.2), Inches(0.4), d, size=15, color=FG)
    footer_logo(s)

    # ── 13 GTM ───────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "GTM")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "Go-to-market", size=28, bold=True)
    gtms = [
        ("1. Product-led", "Free credit → first agent → wallet top-up"),
        ("2. Vertical sales", "Clinics, D2C, BFSI, real estate, staffing"),
        ("3. Partners", "White-label agencies & BPOs resell SnapServe"),
        ("4. Founder-led", "Meet demos with AI agent Praveen + live POC"),
    ]
    for i, (t, d) in enumerate(gtms):
        x = Inches(0.7 + (i % 2) * 6.2)
        y = Inches(1.4 + (i // 2) * 2.4)
        card(s, x, y, Inches(5.9), Inches(2.1))
        add_text(s, x + Inches(0.3), y + Inches(0.45), Inches(5.3), Inches(0.5), t, size=20, bold=True, color=ACCENT)
        add_text(s, x + Inches(0.3), y + Inches(1.1), Inches(5.3), Inches(0.6), d, size=16, color=FG)
    footer_logo(s)

    # ── 14 Team ──────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "TEAM")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "The right team for India voice AI", size=26, bold=True)

    card(s, Inches(0.8), Inches(1.4), Inches(5.7), Inches(4.5))
    add_lines(s, Inches(1.1), Inches(1.7), Inches(5.2), Inches(4.0), [
        ("Karthikeyan", {"size": 24, "bold": True}),
        ("CEO & Co-founder", {"size": 16, "color": ACCENT}),
        ("", {"size": 8}),
        ("Co-founded TheAitel", {"size": 16}),
        ("Building SnapServe end-to-end product", {"size": 15, "color": MUTED}),
        ("Chennai  ·  karthikeyan@theaitel.com", {"size": 14, "color": MUTED}),
    ])

    card(s, Inches(6.9), Inches(1.4), Inches(5.7), Inches(4.5))
    add_lines(s, Inches(7.2), Inches(1.7), Inches(5.2), Inches(4.0), [
        ("Gopi N", {"size": 24, "bold": True}),
        ("COO & Co-founder", {"size": 16, "color": ACCENT}),
        ("", {"size": 8}),
        ("Co-founded TheAitel", {"size": 16}),
        ("Operations, growth & delivery", {"size": 15, "color": MUTED}),
        ("Chennai", {"size": 14, "color": MUTED}),
    ])
    footer_logo(s)

    # ── 15 3-year projection ─────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "PROJECTIONS")
    add_text(s, Inches(0.8), Inches(0.35), Inches(11), Inches(0.4), "3-year projection (base case, INR)", size=24, bold=True)
    add_text(s, Inches(0.8), Inches(0.85), Inches(11.5), Inches(0.35), "Assumes ₹5/min · ₹1.87 variable · funded GTM after ₹5 Cr raise. Forward-looking — not a promise.", size=12, color=MUTED)

    # Table header
    cols = ["", "Today", "Year 1", "Year 2", "Year 3"]
    data = [
        ["Monthly minutes", "~4K (cumul.)", "10 L", "50 L", "2 Cr"],
        ["Monthly revenue", "~₹35K", "₹50 L", "₹2.5 Cr", "₹10 Cr"],
        ["ARR (exit run-rate)", "—", "₹6 Cr", "₹30 Cr", "₹120 Cr"],
        ["Paying accounts", "Early", "250", "1,200", "4,000"],
        ["Team size", "Founders+", "12", "35", "80"],
        ["Gross margin (var.)", "62.6%", "~63%", "~65%", "~68%"],
    ]
    for i, h in enumerate(cols):
        add_text(s, Inches(0.5 + i * 2.5), Inches(1.35), Inches(2.4), Inches(0.35), h, size=13, bold=True, color=MUTED, align=PP_ALIGN.CENTER if i else PP_ALIGN.LEFT)
    for r, row in enumerate(data):
        y = Inches(1.85 + r * 0.7)
        for c, cell in enumerate(row):
            color = GREEN if c >= 2 else FG
            add_text(s, Inches(0.5 + c * 2.5), y, Inches(2.4), Inches(0.55), cell, size=14, bold=(c == 0 or c >= 2), color=color if c else MUTED, align=PP_ALIGN.CENTER if c else PP_ALIGN.LEFT)

    add_text(s, Inches(0.8), Inches(6.4), Inches(11.5), Inches(0.4), "Y1 exit target: 10 L mins/mo × ₹5 = ₹50 L MRR · ₹6 Cr ARR run-rate.", size=14, color=ACCENT)
    footer_logo(s)

    # ── 16 Annual P&L ────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "FINANCIALS")
    add_text(s, Inches(0.8), Inches(0.35), Inches(11), Inches(0.4), "Annual P&L projection (base case, ₹ Cr)", size=24, bold=True)
    add_text(s, Inches(0.8), Inches(0.85), Inches(11.5), Inches(0.35), "Built from average monthly volume, not exit run-rate. Forward-looking and unaudited.", size=12, color=MUTED)
    pnl_cols = ["", "Year 1", "Year 2", "Year 3"]
    pnl_data = [
        ["Avg. monthly minutes", "3 L", "25 L", "1.10 Cr"],
        ["Revenue", "₹1.80", "₹15.00", "₹66.00"],
        ["Variable cost", "(₹0.67)", "(₹5.25)", "(₹21.12)"],
        ["Gross contribution", "₹1.13", "₹9.75", "₹44.88"],
        ["Operating expenses", "(₹2.40)", "(₹8.00)", "(₹24.00)"],
        ["EBITDA", "(₹1.27)", "₹1.75", "₹20.88"],
        ["EBITDA margin", "(70.7%)", "11.7%", "31.6%"],
    ]
    for i, h in enumerate(pnl_cols):
        add_text(s, Inches(0.8 + i * 3.0), Inches(1.35), Inches(2.8), Inches(0.35), h, size=14, bold=True, color=MUTED, align=PP_ALIGN.CENTER if i else PP_ALIGN.LEFT)
    for r, row in enumerate(pnl_data):
        y = Inches(1.85 + r * 0.62)
        for c, cell in enumerate(row):
            color = FG
            if r in (3, 5) and c:
                color = GREEN if not cell.startswith("(") else ACCENT
            elif c == 0:
                color = MUTED
            add_text(s, Inches(0.8 + c * 3.0), y, Inches(2.8), Inches(0.5), cell, size=15, bold=(c == 0 or r in (3, 5)), color=color, align=PP_ALIGN.CENTER if c else PP_ALIGN.LEFT)
    add_text(s, Inches(0.8), Inches(6.45), Inches(11.5), Inches(0.35), "Expected fully loaded monthly operating break-even around the transition into Year 2.", size=13, color=ACCENT)
    footer_logo(s)

    # ── 17 Ask ───────────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "ASK")
    add_text(s, Inches(0.8), Inches(0.4), Inches(10), Inches(0.45), "The ask", size=28, bold=True)
    add_text(s, Inches(0.8), Inches(1.0), Inches(11), Inches(0.5), "Raising  ₹5 Crore  seed  ·  18-month runway  ·  India + global angels / seed funds", size=18, color=ACCENT)

    funds = [
        ("40%", "Engineering", "Agents, reliability, Meet, WhatsApp, analytics"),
        ("30%", "Sales & CS", "Vertical AEs, onboarding, partner success"),
        ("15%", "Infra", "Vobiz capacity, cloud, observability"),
        ("10%", "Marketing", "Content, demos, events, brand"),
        ("5%", "Legal & ops", "Entity, contracts, compliance"),
    ]
    for i, (pct, title, d) in enumerate(funds):
        y = Inches(1.7 + i * 0.85)
        card(s, Inches(0.8), y, Inches(11.7), Inches(0.75))
        add_text(s, Inches(1.0), y + Inches(0.18), Inches(1.2), Inches(0.4), pct, size=18, bold=True, color=GREEN)
        add_text(s, Inches(2.3), y + Inches(0.18), Inches(3.0), Inches(0.4), title, size=16, bold=True, color=FG)
        add_text(s, Inches(5.5), y + Inches(0.18), Inches(6.7), Inches(0.4), d, size=14, color=MUTED)
    footer_logo(s)

    # ── 18 Round structure ───────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "ROUND TERMS")
    add_text(s, Inches(0.8), Inches(0.35), Inches(11), Inches(0.45), "One seed round · four committed CCPS drawdowns", size=25, bold=True)
    add_text(s, Inches(0.8), Inches(0.9), Inches(11.5), Inches(0.4), "₹20 Cr pre-money · ₹25 Cr post-money · 20% seed dilution · indicative, non-binding", size=16, color=ACCENT)

    tranches = [
        ("A", "₹15 L", "At signing", "Immediate infra, compliance and delivery"),
        ("B", "₹85 L", "Foundation", "Reliability plan + initial paying pipeline"),
        ("C", "₹1.50 Cr", "Early scale", "Target: 100 paying · ~2 L mins/mo"),
        ("D", "₹2.50 Cr", "Growth", "Target: 250 paying · path to 10 L mins/mo"),
    ]
    for i, (label, amount, stage, detail) in enumerate(tranches):
        y = Inches(1.55 + i * 1.05)
        card(s, Inches(0.8), y, Inches(11.7), Inches(0.9))
        add_text(s, Inches(1.0), y + Inches(0.2), Inches(0.6), Inches(0.4), label, size=18, bold=True, color=GREEN)
        add_text(s, Inches(1.65), y + Inches(0.2), Inches(1.6), Inches(0.4), amount, size=18, bold=True)
        add_text(s, Inches(3.3), y + Inches(0.2), Inches(2.0), Inches(0.4), stage, size=15, bold=True, color=ACCENT)
        add_text(s, Inches(5.4), y + Inches(0.2), Inches(6.6), Inches(0.4), detail, size=14, color=MUTED)

    add_text(s, Inches(0.8), Inches(6.05), Inches(11.5), Inches(0.55), "Not four valuation rounds: one financing with milestone-linked releases. Final CCPS rights, ESOP treatment and drawdown protections subject to definitive documents.", size=13, color=MUTED)
    footer_logo(s)

    # ── 19 Milestones ────────────────────────────────────────
    s = new_slide(prs)
    section_tag(s, "MILESTONES")
    add_text(s, Inches(0.8), Inches(0.45), Inches(10), Inches(0.5), "18-month milestones", size=28, bold=True)
    miles = [
        ("0–6 mo", "100 paying · ~2 L monthly minutes · flagship vertical case studies"),
        ("6–12 mo", "10 L mins / ₹50 L MRR exit target · partner channel live"),
        ("12–18 mo", "Repeatable GTM · positive monthly contribution · Series A ready"),
    ]
    for i, (t, d) in enumerate(miles):
        y = Inches(1.5 + i * 1.55)
        card(s, Inches(0.8), y, Inches(11.7), Inches(1.35))
        add_text(s, Inches(1.1), y + Inches(0.3), Inches(11.2), Inches(0.4), t, size=20, bold=True, color=ACCENT)
        add_text(s, Inches(1.1), y + Inches(0.75), Inches(11.2), Inches(0.4), d, size=16, color=FG)
    footer_logo(s)

    # ── 20 Close ─────────────────────────────────────────────
    s = new_slide(prs)
    add_text(s, Inches(0.9), Inches(2.0), Inches(11.5), Inches(0.8), "India will talk to AI.", size=36, bold=True, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(2.9), Inches(11.5), Inches(0.6), "SnapServe makes sure those calls convert.", size=24, color=ACCENT, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(4.0), Inches(11.5), Inches(0.4), "SnapServe AI Pvt Limited  ·  Chennai", size=16, color=MUTED, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(4.6), Inches(11.5), Inches(0.4), "karthikeyan@theaitel.com  ·  app.snapserve.ai", size=16, color=FG, align=PP_ALIGN.CENTER)
    add_text(s, Inches(0.9), Inches(5.4), Inches(11.5), Inches(0.4), "Raising ₹5 Cr seed", size=18, bold=True, color=GREEN, align=PP_ALIGN.CENTER)

    out = OUT / "SnapServe-Seed-Pitch-5Cr.pptx"
    prs.save(out)
    print(f"Wrote {out}")
    return out


if __name__ == "__main__":
    build()
