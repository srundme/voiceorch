#!/usr/bin/env python3
"""SnapServe AI — Seed pitch deck as a self-contained PDF (opens anywhere).

Mirrors the PPTX content so the founder always has a viewable, downloadable file
even without PowerPoint/Keynote installed.
"""

from pathlib import Path
from reportlab.lib.pagesizes import landscape
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

OUT = Path(__file__).resolve().parent
PAGE = (13.333 * inch, 7.5 * inch)
W, H = PAGE

BG = HexColor("#121214")
FG = HexColor("#F5F5F5")
MUTED = HexColor("#A1A1AA")
ACCENT = HexColor("#E11D48")
GREEN = HexColor("#22C55E")
BLUE = HexColor("#38BDF8")
CARD = HexColor("#1C1C1F")
BORDER = HexColor("#2A2A2E")

FONT = "Helvetica"
FONT_B = "Helvetica-Bold"


def new_page(c):
    c.setFillColor(BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)


def text(c, x, y, s, size=14, color=FG, bold=False, align="left"):
    c.setFillColor(color)
    c.setFont(FONT_B if bold else FONT, size)
    if align == "center":
        c.drawCentredString(x, y, s)
    elif align == "right":
        c.drawRightString(x, y, s)
    else:
        c.drawString(x, y, s)


def card(c, x, y, w, h):
    c.setFillColor(CARD)
    c.setStrokeColor(BORDER)
    c.setLineWidth(1)
    c.roundRect(x, y, w, h, 8, fill=1, stroke=1)


def tag(c, s):
    text(c, W - 0.6 * inch, H - 0.5 * inch, s.upper(), size=10, color=MUTED, align="right")


def footer(c):
    text(c, W - 0.6 * inch, 0.35 * inch, "SNAPSERVE", size=9, color=MUTED, align="right")


def Y(v):  # convert "from top inches" to pdf y
    return H - v * inch


def build():
    out = OUT / "SnapServe-Seed-Pitch-5Cr.pdf"
    c = canvas.Canvas(str(out), pagesize=PAGE)

    # 1 Cover
    new_page(c)
    text(c, W / 2, Y(3.0), "SNAPSERVE AI", size=44, bold=True, align="center")
    text(c, W / 2, Y(3.7), "AI voice agents for Indian business — live in minutes, not months.", size=20, color=ACCENT, align="center")
    text(c, W / 2, Y(4.4), "Seed raise  ·  Rs 5 Crore  ·  Confidential", size=15, color=MUTED, align="center")
    text(c, W / 2, Y(6.6), "Karthikeyan, CEO  ·  karthikeyan@theaitel.com  ·  Chennai", size=13, color=MUTED, align="center")
    footer(c); c.showPage()

    # 2 Hook
    new_page(c); tag(c, "Hook")
    text(c, 0.9 * inch, Y(2.4), "Voice AI for Indian businesses is stuck.", size=30, bold=True)
    for i, line in enumerate([
        ("Between DIY stacks, Western APIs, and BPOs —", MUTED),
        ("nobody ships production agents that speak India,", FG),
        ("run campaigns, and remember every caller.", FG),
    ]):
        text(c, 0.9 * inch, Y(3.2 + i * 0.55), line[0], size=20, color=line[1])
    text(c, 0.9 * inch, Y(5.2), "We're the founders building that layer.", size=20, color=ACCENT, bold=True)
    footer(c); c.showPage()

    # 3 Problem
    new_page(c); tag(c, "Problem")
    text(c, 0.8 * inch, Y(0.9), "Problem", size=28, bold=True)
    text(c, 0.8 * inch, Y(1.45), "Indian SMBs & BPOs can't deploy voice agents without a 3-6 month eng project.", size=16, color=MUTED)
    probs = [
        ("DIY stack", ["STT + LLM + TTS +", "telephony by hand"]),
        ("Western tools", ["Weak on Indian", "languages & telephony"]),
        ("BPO-only", ["Human cost scales;", "no memory or campaigns"]),
        ("No ops layer", ["No wallet, dispositions,", "Meet agent or white-label"]),
    ]
    for i, (t, d) in enumerate(probs):
        x = (0.8 + i * 3.05) * inch
        card(c, x, Y(5.5), 2.85 * inch, 3.35 * inch)
        text(c, x + 0.2 * inch, Y(2.35), t, size=17, bold=True, color=ACCENT)
        for j, ln in enumerate(d):
            text(c, x + 0.2 * inch, Y(3.0 + j * 0.35), ln, size=13, color=FG)
    footer(c); c.showPage()

    # 4 Solution
    new_page(c); tag(c, "Solution")
    text(c, 0.8 * inch, Y(0.9), "Solution", size=28, bold=True)
    text(c, 0.8 * inch, Y(1.45), "The voice agent platform for India — agents, campaigns, memory, meetings & WhatsApp.", size=15, color=MUTED)
    pillars = [
        ("Agent builder", ["Sarvam + global stack", "Live in <10 minutes"]),
        ("Campaigns", ["Batches, retries,", "dispositions, intel"]),
        ("Caller memory", ["Every caller", "remembered"]),
        ("Meet + WhatsApp", ["Meet/Zoom agents", "+ WhatsApp calling"]),
        ("Wallet + partners", ["Rs 5/min billing", "White-label partners"]),
    ]
    for i, (t, d) in enumerate(pillars):
        x = (0.55 + i * 2.5) * inch
        card(c, x, Y(5.7), 2.35 * inch, 3.6 * inch)
        text(c, x + 0.15 * inch, Y(2.45), t, size=14, bold=True, color=GREEN)
        for j, ln in enumerate(d):
            text(c, x + 0.15 * inch, Y(3.1 + j * 0.35), ln, size=12, color=FG)
    footer(c); c.showPage()

    # 5 Why now
    new_page(c); tag(c, "Why now")
    text(c, 0.8 * inch, Y(0.9), "Why now", size=28, bold=True)
    whys = [
        ("Indic AI is ready", "Sarvam-class models make Tamil, Hindi, Telugu production-grade."),
        ("Telephony is programmable", "Vobiz / Plivo APIs + WhatsApp calling unlock distribution."),
        ("Cost collapse", "Voice minutes are cheap enough for SMB outbound + support."),
        ("Buyer urgency", "Missed leads & clinic no-shows bleed cash every day."),
    ]
    for i, (t, d) in enumerate(whys):
        y = 1.3 + i * 1.2
        card(c, 0.8 * inch, Y(y + 1.05), 11.7 * inch, 1.05 * inch)
        text(c, 1.05 * inch, Y(y + 0.4), t, size=17, bold=True, color=ACCENT)
        text(c, 1.05 * inch, Y(y + 0.8), d, size=14, color=FG)
    footer(c); c.showPage()

    # 6 Product
    new_page(c); tag(c, "Product")
    text(c, 0.8 * inch, Y(0.9), "Product surface", size=28, bold=True)
    text(c, 0.8 * inch, Y(1.45), "One platform — phone, webcall, meetings, WhatsApp, partners.", size=15, color=MUTED)
    items = [
        "Voice agents: barge-in, KB, tools, transfers",
        "Outbound campaigns + batch analytics",
        "Inbound routing, DNC, callbacks, bookings",
        "Google Meet / Zoom meeting agents",
        "WhatsApp (Vobiz supply + calling) from wallet",
        "Partner white-label domains + client login",
    ]
    for i, t in enumerate(items):
        col, row = i % 2, i // 2
        x = (0.8 + col * 6.1) * inch
        y = 1.9 + row * 1.35
        card(c, x, Y(y + 1.15), 5.8 * inch, 1.15 * inch)
        text(c, x + 0.3 * inch, Y(y + 0.65), f"-  {t}", size=15, color=FG)
    footer(c); c.showPage()

    # 7 Market
    new_page(c); tag(c, "Market")
    text(c, 0.8 * inch, Y(0.9), "Market — win India enterprise voice first", size=25, bold=True)
    text(c, 0.8 * inch, Y(1.45), "Beachhead: clinics, D2C, BFSI collections, real estate, staffing, BPO white-label.", size=14, color=MUTED)
    mk = [
        ("Rs 12,500 Cr+", ["India contact-center", "& voice ops (directional)"], GREEN),
        ("60M+", ["Indian SMBs with", "no voice AI stack"], GREEN),
        ("Rs 5 / min", ["Our wedge price —", "scales with success"], ACCENT),
    ]
    for i, (n, d, col) in enumerate(mk):
        x = (0.8 + i * 4.05) * inch
        card(c, x, Y(5.8), 3.8 * inch, 3.6 * inch)
        text(c, x + 1.9 * inch, Y(2.9), n, size=28, bold=True, color=col, align="center")
        for j, ln in enumerate(d):
            text(c, x + 1.9 * inch, Y(3.6 + j * 0.4), ln, size=14, color=FG, align="center")
    footer(c); c.showPage()

    # 8 Traction
    new_page(c); tag(c, "Traction")
    text(c, 0.8 * inch, Y(0.85), "Traction — live product, real usage (Aug 2026)", size=24, bold=True)
    text(c, 0.8 * inch, Y(1.3), "Source: SnapServe Admin — Platform Overview + Finance (15 Jul - 14 Aug 2026)", size=11, color=MUTED)
    metrics = [
        ("417", "Total users"), ("4,356", "Total calls"),
        ("3,982", "Total minutes"), ("205", "Calls / 24h"),
        ("Rs 35,083", "Recognized (30d)"), ("Rs 31,100", "Cash-in topups"),
        ("4,138", "Calls in period"), ("54%", "Completion rate*"),
    ]
    for i, (n, l) in enumerate(metrics):
        col, row = i % 4, i // 4
        x = (0.7 + col * 3.15) * inch
        y = 1.7 + row * 2.35
        card(c, x, Y(y + 2.1), 2.95 * inch, 2.1 * inch)
        text(c, x + 1.475 * inch, Y(y + 0.9), n, size=24, bold=True, color=GREEN, align="center")
        text(c, x + 1.475 * inch, Y(y + 1.55), l, size=12, color=MUTED, align="center")
    text(c, 0.8 * inch, Y(6.7), "*Completed / total in period. Early-stage volume — raise funds growth, not maintenance.", size=10, color=MUTED)
    footer(c); c.showPage()

    # 9 Unit economics
    new_page(c); tag(c, "Unit economics")
    text(c, 0.8 * inch, Y(0.9), "Unit economics (INR)", size=28, bold=True)
    econ = [("Rs 5.00", "Price / minute", GREEN), ("Rs 1.87", "Variable cost / min", ACCENT),
            ("Rs 3.13", "Contribution / min", GREEN), ("62.6%", "Contribution margin", BLUE)]
    for i, (n, l, col) in enumerate(econ):
        x = (0.7 + i * 3.15) * inch
        card(c, x, Y(3.6), 2.95 * inch, 2.2 * inch)
        text(c, x + 1.475 * inch, Y(2.3), n, size=28, bold=True, color=col, align="center")
        text(c, x + 1.475 * inch, Y(3.0), l, size=13, color=MUTED, align="center")
    card(c, 0.7 * inch, Y(6.5), 12.0 * inch, 2.5 * inch)
    lines = [
        ("Fixed burn today ~ Rs 3.0 L / month", 19, True, FG),
        ("  - Rs 1.0 L  Vobiz / telephony capacity", 15, False, MUTED),
        ("  - Rs 2.0 L  Rent, salaries & ops", 15, False, MUTED),
        ("Break-even ~ 96,000 minutes / month (~Rs 4.8 L) at current margin", 15, True, ACCENT),
        ("Today's volume is far below break-even — this raise buys the go-to-market.", 13, False, FG),
    ]
    for i, (t, sz, b, col) in enumerate(lines):
        text(c, 1.0 * inch, Y(4.55 + i * 0.38), t, size=sz, bold=b, color=col)
    footer(c); c.showPage()

    # 10 Model
    new_page(c); tag(c, "Model")
    text(c, 0.8 * inch, Y(0.9), "Business model", size=28, bold=True)
    text(c, 0.8 * inch, Y(1.45), "Usage-first. Customers top up wallets. We earn on every minute.", size=15, color=MUTED)
    models = [
        ("Wallet usage", ["Rs 5 / minute", "platform fee"]),
        ("Phone numbers", ["Purchase / rental", "via wallet"]),
        ("WhatsApp", ["Message + call", "minutes from wallet"]),
        ("Partners", ["White-label", "sub-accounts"]),
    ]
    for i, (t, d) in enumerate(models):
        x = (0.7 + i * 3.15) * inch
        card(c, x, Y(5.8), 2.95 * inch, 3.6 * inch)
        text(c, x + 0.2 * inch, Y(2.45), t, size=17, bold=True, color=ACCENT)
        for j, ln in enumerate(d):
            text(c, x + 0.2 * inch, Y(3.15 + j * 0.35), ln, size=13, color=FG)
    footer(c); c.showPage()

    # 11 Competition
    new_page(c); tag(c, "Competition")
    text(c, 0.8 * inch, Y(0.85), "Competition — what wins India?", size=25, bold=True)
    headers = ["", "Western APIs", "DIY / BPO", "SnapServe"]
    rows = [
        ["Indic languages", "Weak", "Custom", "Native"],
        ["Campaigns + CRM", "DIY", "Partial", "Built-in"],
        ["Caller memory", "Rare", "Rare", "Core"],
        ["Meet + WhatsApp", "No", "Fragmented", "Yes"],
        ["INR wallet billing", "USD cards", "Manual", "Native"],
        ["Time to live agent", "Weeks", "Months", "Minutes"],
    ]
    for i, h in enumerate(headers):
        x = (0.6 + i * 3.15) * inch
        text(c, x + (1.4 * inch if i else 0), Y(1.5), h, size=13, bold=True, color=MUTED, align="center" if i else "left")
    bad = {"Weak", "Rare", "No", "USD cards", "Months", "Fragmented", "Manual", "DIY"}
    for r, row in enumerate(rows):
        y = 2.0 + r * 0.72
        for cc, cell in enumerate(row):
            x = (0.6 + cc * 3.15) * inch
            col = FG; b = cc == 0
            if cc == 3:
                col = GREEN; b = True
            elif cell in bad:
                col = ACCENT
            text(c, x + (1.4 * inch if cc else 0), Y(y), cell, size=14, bold=b, color=col, align="center" if cc else "left")
    footer(c); c.showPage()

    # 12 Moat
    new_page(c); tag(c, "Moat")
    text(c, 0.8 * inch, Y(0.9), "Why we win", size=28, bold=True)
    diffs = [
        ("India-first stack", "Sarvam + local telephony + vernacular UX — not a US product with a toggle."),
        ("Ops, not just API", "Campaigns, dispositions, analytics, wallet, partners — the work after the call."),
        ("Relationship memory", "Agents pick up where the last call ended. Sticky by design."),
        ("Distribution wedges", "Meet agents + WhatsApp calling + partner white-label."),
    ]
    for i, (t, d) in enumerate(diffs):
        y = 1.2 + i * 1.25
        card(c, 0.8 * inch, Y(y + 1.1), 11.7 * inch, 1.1 * inch)
        text(c, 1.1 * inch, Y(y + 0.4), f"{i+1}.  {t}", size=17, bold=True, color=GREEN)
        text(c, 1.1 * inch, Y(y + 0.8), d, size=14, color=FG)
    footer(c); c.showPage()

    # 13 GTM
    new_page(c); tag(c, "GTM")
    text(c, 0.8 * inch, Y(0.9), "Go-to-market", size=28, bold=True)
    gtms = [
        ("1. Product-led", "Free credit -> first agent -> wallet top-up"),
        ("2. Vertical sales", "Clinics, D2C, BFSI, real estate, staffing"),
        ("3. Partners", "White-label agencies & BPOs resell SnapServe"),
        ("4. Founder-led", "Meet demos with AI agent + live POC"),
    ]
    for i, (t, d) in enumerate(gtms):
        x = (0.7 + (i % 2) * 6.2) * inch
        y = 1.4 + (i // 2) * 2.4
        card(c, x, Y(y + 2.1), 5.9 * inch, 2.1 * inch)
        text(c, x + 0.3 * inch, Y(y + 0.7), t, size=19, bold=True, color=ACCENT)
        text(c, x + 0.3 * inch, Y(y + 1.35), d, size=15, color=FG)
    footer(c); c.showPage()

    # 14 Team
    new_page(c); tag(c, "Team")
    text(c, 0.8 * inch, Y(0.9), "The right team for India voice AI", size=25, bold=True)
    people = [
        (0.8, "Karthikeyan", "CEO & Co-founder", ["Co-founded TheAitel", "Builds SnapServe end-to-end", "karthikeyan@theaitel.com"]),
        (6.9, "Gopi N", "COO & Co-founder", ["Co-founded TheAitel", "Operations, growth & delivery", "Chennai"]),
    ]
    for px, name, role, d in people:
        card(c, px * inch, Y(5.9), 5.7 * inch, 4.5 * inch)
        text(c, (px + 0.3) * inch, Y(2.2), name, size=24, bold=True)
        text(c, (px + 0.3) * inch, Y(2.7), role, size=15, color=ACCENT)
        for j, ln in enumerate(d):
            text(c, (px + 0.3) * inch, Y(3.4 + j * 0.42), ln, size=14, color=FG if j == 0 else MUTED)
    footer(c); c.showPage()

    # 15 Projections
    new_page(c); tag(c, "Projections")
    text(c, 0.8 * inch, Y(0.75), "3-year projection (base case, INR)", size=24, bold=True)
    text(c, 0.8 * inch, Y(1.2), "Assumes Rs 5/min, Rs 1.87 variable, funded GTM after Rs 5 Cr raise. Forward-looking.", size=11, color=MUTED)
    cols = ["", "Today", "Year 1", "Year 2", "Year 3"]
    data = [
        ["Monthly minutes", "~few K", "1.0 L", "5.0 L", "20 L"],
        ["Monthly revenue", "~Rs 35K", "Rs 50 L", "Rs 2.5 Cr", "Rs 10 Cr"],
        ["ARR run-rate", "-", "Rs 6 Cr", "Rs 30 Cr", "Rs 120 Cr"],
        ["Paying accounts", "Early", "250", "1,200", "4,000"],
        ["Team size", "Founders+", "12", "35", "80"],
        ["Var. gross margin", "62.6%", "~63%", "~65%", "~68%"],
    ]
    for i, h in enumerate(cols):
        x = (0.6 + i * 2.5) * inch
        text(c, x + (1.1 * inch if i else 0), Y(1.75), h, size=13, bold=True, color=MUTED, align="center" if i else "left")
    for r, row in enumerate(data):
        y = 2.25 + r * 0.68
        for cc, cell in enumerate(row):
            x = (0.6 + cc * 2.5) * inch
            col = GREEN if cc >= 2 else (MUTED if cc == 1 else FG)
            text(c, x + (1.1 * inch if cc else 0), Y(y), cell, size=14, bold=(cc == 0 or cc >= 2), color=col, align="center" if cc else "left")
    text(c, 0.8 * inch, Y(6.6), "Y1 focus: cross break-even (~96K mins/mo) and hit durable Rs 50 L / mo run-rate.", size=13, color=ACCENT)
    footer(c); c.showPage()

    # 16 Ask
    new_page(c); tag(c, "Ask")
    text(c, 0.8 * inch, Y(0.85), "The ask", size=28, bold=True)
    text(c, 0.8 * inch, Y(1.4), "Raising  Rs 5 Crore  seed  ·  18-month runway  ·  India + global angels / seed funds", size=16, color=ACCENT)
    funds = [
        ("40%", "Engineering", "Agents, reliability, Meet, WhatsApp, analytics"),
        ("30%", "Sales & CS", "Vertical AEs, onboarding, partner success"),
        ("15%", "Infra", "Vobiz capacity, cloud, observability"),
        ("10%", "Marketing", "Content, demos, events, brand"),
        ("5%", "Legal & ops", "Entity, contracts, compliance"),
    ]
    for i, (pct, title, d) in enumerate(funds):
        y = 1.9 + i * 0.9
        card(c, 0.8 * inch, Y(y + 0.75), 11.7 * inch, 0.75 * inch)
        text(c, 1.0 * inch, Y(y + 0.48), pct, size=18, bold=True, color=GREEN)
        text(c, 2.3 * inch, Y(y + 0.48), title, size=16, bold=True, color=FG)
        text(c, 5.5 * inch, Y(y + 0.48), d, size=13, color=MUTED)
    footer(c); c.showPage()

    # 17 Milestones
    new_page(c); tag(c, "Milestones")
    text(c, 0.8 * inch, Y(0.9), "18-month milestones", size=28, bold=True)
    miles = [
        ("0-6 mo", "Cross break-even minutes, 100 paying, flagship vertical cases"),
        ("6-12 mo", "Rs 50 L / mo run-rate, partner channel live, Meet+WA scale"),
        ("12-18 mo", "Rs 6 Cr ARR trajectory, Series A ready metrics, expand cities"),
    ]
    for i, (t, d) in enumerate(miles):
        y = 1.5 + i * 1.55
        card(c, 0.8 * inch, Y(y + 1.35), 11.7 * inch, 1.35 * inch)
        text(c, 1.1 * inch, Y(y + 0.55), t, size=20, bold=True, color=ACCENT)
        text(c, 1.1 * inch, Y(y + 1.0), d, size=15, color=FG)
    footer(c); c.showPage()

    # 18 Close
    new_page(c)
    text(c, W / 2, Y(2.8), "India will talk to AI.", size=36, bold=True, align="center")
    text(c, W / 2, Y(3.5), "SnapServe makes sure those calls convert.", size=22, color=ACCENT, align="center")
    text(c, W / 2, Y(4.5), "SnapServe AI Pvt Limited  ·  Chennai", size=15, color=MUTED, align="center")
    text(c, W / 2, Y(5.0), "karthikeyan@theaitel.com  ·  app.snapserve.ai", size=15, color=FG, align="center")
    text(c, W / 2, Y(5.7), "Raising Rs 5 Cr seed", size=18, bold=True, color=GREEN, align="center")
    footer(c); c.showPage()

    c.save()
    print(f"Wrote {out}")
    return out


if __name__ == "__main__":
    build()
