#!/usr/bin/env python3
"""Build the detailed SnapServe 3-year budget and tranche plan PDF."""

from pathlib import Path

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


OUT = Path(__file__).resolve().parent
OUTPUT_FILE = OUT / "SnapServe-Detailed-3-Year-Budget-and-Round-Plan.pdf"

BG = colors.HexColor("#121214")
CARD = colors.HexColor("#1C1C1F")
FG = colors.HexColor("#F5F5F5")
MUTED = colors.HexColor("#A1A1AA")
ACCENT = colors.HexColor("#E11D48")
GREEN = colors.HexColor("#22C55E")
BLUE = colors.HexColor("#38BDF8")
BORDER = colors.HexColor("#34343A")
WHITE = colors.white


def rs_lakh(value):
    if abs(value) >= 100:
        return f"Rs {value / 100:.2f} Cr"
    return f"Rs {value:.2f} L"


def money_cr(value):
    return f"Rs {value:.2f} Cr"


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=30, leading=34, textColor=FG, alignment=TA_CENTER, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica",
    fontSize=14, leading=20, textColor=MUTED, alignment=TA_CENTER,
))
styles.add(ParagraphStyle(
    name="H1x", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=22, leading=26, textColor=FG, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="H2x", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=15, leading=19, textColor=ACCENT, spaceBefore=8, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Bodyx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.5, leading=14, textColor=FG, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Smallx", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.5, leading=10, textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=11, leading=16, textColor=GREEN, borderColor=BORDER,
    borderWidth=1, borderPadding=10, backColor=CARD, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="Cell", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.3, leading=9.5, textColor=FG,
))
styles.add(ParagraphStyle(
    name="CellBold", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.3, leading=9.5, textColor=FG,
))


def P(text, style="Bodyx"):
    return Paragraph(str(text), styles[style])


def table(data, widths=None, right_cols=(), small=False):
    wrapped = []
    for r, row in enumerate(data):
        wrapped.append([
            P(cell, "CellBold" if r == 0 else ("Smallx" if small else "Cell"))
            if not isinstance(cell, Paragraph) else cell
            for cell in row
        ])
    t = Table(wrapped, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), CARD),
        ("TEXTCOLOR", (0, 0), (-1, 0), FG),
        ("GRID", (0, 0), (-1, -1), 0.45, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [BG, colors.HexColor("#171719")]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for col in right_cols:
        commands.append(("ALIGN", (col, 1), (col, -1), "RIGHT"))
    t.setStyle(TableStyle(commands))
    return t


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, doc.pagesize[0], doc.pagesize[1], fill=1, stroke=0)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7)
    canvas.drawString(14 * mm, 8 * mm, "SnapServe AI Pvt Limited · Confidential · Forward-looking, unaudited")
    canvas.drawRightString(doc.pagesize[0] - 14 * mm, 8 * mm, f"Page {doc.page}")
    canvas.restoreState()


TRANCHES = [
    {
        "name": "Tranche A — Initial close",
        "amount": 15,
        "window": "Months 0-3",
        "trigger": "Signing and definitive CCPS documents",
        "target": "15 paying accounts · 30K mins/month · Rs 1.5L exit MRR",
        "budget": [
            ("Engineering & product", 3, "Reliability fixes, analytics, Meet/WhatsApp completion, QA"),
            ("Sales & customer success", 2, "Founder-led demos, POCs, onboarding, CRM/outreach"),
            ("Production & infrastructure", 3, "Three months Vobiz commitment, cloud and observability"),
            ("Marketing", 1, "Case studies, demo assets, website and targeted outreach"),
            ("Legal, payroll & operations", 6, "Core payroll/rent, CCPS/legal work and contingency"),
        ],
    },
    {
        "name": "Tranche B — Foundation",
        "amount": 85,
        "window": "Months 3-6",
        "trigger": "Reliability plan delivered and paying-customer pipeline validated",
        "target": "50 paying accounts · 1L mins/month · Rs 5L exit MRR",
        "budget": [
            ("Engineering & product", 35, "Core hires, uptime, security, campaign and analytics quality"),
            ("Sales & customer success", 20, "First GTM hires, vertical demos, onboarding playbook"),
            ("Production & infrastructure", 13, "Telephony capacity, inference, cloud and monitoring"),
            ("Marketing", 7, "Vertical content, founder events, lead generation"),
            ("Legal, payroll & operations", 10, "Operations, compliance, finance controls and reserve"),
        ],
    },
    {
        "name": "Tranche C — Early scale",
        "amount": 150,
        "window": "Months 6-12",
        "trigger": "100 paying accounts and approximately 2L monthly minutes",
        "target": "250 paying accounts · path to 10L mins/month · Rs 50L exit MRR",
        "budget": [
            ("Engineering & product", 62, "Scale, Indic quality, partner controls, reporting and automation"),
            ("Sales & customer success", 45, "Vertical AEs, onboarding team and partner activation"),
            ("Production & infrastructure", 22, "Capacity reserves, routing, monitoring and support"),
            ("Marketing", 15, "Case studies, demand generation, events and channel enablement"),
            ("Legal, payroll & operations", 6, "Hiring, contracts, compliance and operating reserve"),
        ],
    },
    {
        "name": "Tranche D — Growth",
        "amount": 250,
        "window": "Months 12-18",
        "trigger": "250 paying accounts and trajectory toward 10L monthly minutes",
        "target": "Repeatable GTM · positive monthly contribution · Series A readiness",
        "budget": [
            ("Engineering & product", 100, "Enterprise reliability, platform breadth, security and scale"),
            ("Sales & customer success", 83, "National GTM, partner success and enterprise onboarding"),
            ("Production & infrastructure", 37, "Volume capacity, working capital and resilience"),
            ("Marketing", 27, "Category building, events, content and pipeline acceleration"),
            ("Legal, payroll & operations", 3, "Governance, diligence readiness and controls"),
        ],
    },
]


QUARTERS = [
    ("Y1 Q1", 0.20, 15, 0.35),
    ("Y1 Q2", 1.00, 50, 0.50),
    ("Y1 Q3", 3.00, 120, 0.65),
    ("Y1 Q4", 7.80, 250, 0.90),
    ("Y2 Q1", 15.0, 400, 1.50),
    ("Y2 Q2", 22.0, 650, 1.80),
    ("Y2 Q3", 28.0, 900, 2.20),
    ("Y2 Q4", 35.0, 1200, 2.50),
    ("Y3 Q1", 60.0, 1800, 4.50),
    ("Y3 Q2", 90.0, 2500, 5.50),
    ("Y3 Q3", 130.0, 3200, 6.50),
    ("Y3 Q4", 160.0, 4000, 7.50),
]


def projection_rows():
    rows = []
    for quarter, avg_monthly_mins_lakh, accounts, opex_cr in QUARTERS:
        price = 5
        variable_cost = 1.87 if quarter.startswith("Y1") else (1.75 if quarter.startswith("Y2") else 1.60)
        quarter_mins_lakh = avg_monthly_mins_lakh * 3
        revenue_cr = quarter_mins_lakh * 100_000 * price / 10_000_000
        cost_cr = quarter_mins_lakh * 100_000 * variable_cost / 10_000_000
        contribution_cr = revenue_cr - cost_cr
        ebitda_cr = contribution_cr - opex_cr
        rows.append({
            "quarter": quarter,
            "avg_mins": avg_monthly_mins_lakh,
            "accounts": accounts,
            "revenue": revenue_cr,
            "cost": cost_cr,
            "contribution": contribution_cr,
            "opex": opex_cr,
            "ebitda": ebitda_cr,
        })
    return rows


PROJECTIONS = projection_rows()


def chart(title_text, labels, values, color=GREEN, suffix=""):
    drawing = Drawing(500, 210)
    chart_obj = VerticalBarChart()
    chart_obj.x = 45
    chart_obj.y = 38
    chart_obj.height = 135
    chart_obj.width = 420
    chart_obj.data = [values]
    chart_obj.categoryAxis.categoryNames = labels
    chart_obj.categoryAxis.labels.fontName = "Helvetica"
    chart_obj.categoryAxis.labels.fontSize = 6
    chart_obj.categoryAxis.labels.fillColor = MUTED
    chart_obj.valueAxis.labels.fontName = "Helvetica"
    chart_obj.valueAxis.labels.fontSize = 7
    chart_obj.valueAxis.labels.fillColor = MUTED
    chart_obj.valueAxis.valueMin = 0
    chart_obj.bars[0].fillColor = color
    chart_obj.bars[0].strokeColor = color
    chart_obj.barSpacing = 4
    drawing.add(chart_obj)
    drawing.add(String(250, 190, title_text, textAnchor="middle", fontName="Helvetica-Bold", fontSize=10, fillColor=FG))
    if suffix:
        drawing.add(String(490, 20, suffix, textAnchor="end", fontName="Helvetica", fontSize=7, fillColor=MUTED))
    return drawing


def cover(story):
    story.extend([
        Spacer(1, 55 * mm),
        P("SNAPSERVE AI", "CoverTitle"),
        P("Detailed 3-Year Budget, Sales Projection<br/>Production Capacity & Rs 5 Crore Round Plan", "CoverTitle"),
        Spacer(1, 8 * mm),
        P("One CCPS seed round · four committed drawdowns<br/>Rs 20 Cr pre-money · Rs 25 Cr post-money · 20% indicative dilution", "CoverSub"),
        Spacer(1, 22 * mm),
        P("Prepared for investor discussion · 14 August 2026<br/>SnapServe AI Pvt Limited · Chennai", "CoverSub"),
        PageBreak(),
    ])


def executive_summary(story):
    story.extend([
        P("Executive summary", "H1x"),
        P("This document expands the investor pitch deck into a detailed operating budget. It translates each drawdown into hiring, product, production capacity, sales activity and measurable release milestones.", "Bodyx"),
        P("The recommendation is one legally committed Rs 5 crore CCPS round with four milestone-linked drawdowns—not four separate valuation rounds.", "Callout"),
    ])
    summary = [
        ["Metric", "Base case", "Investor interpretation"],
        ["Current price / variable cost", "Rs 5.00 / Rs 1.87 per minute", "Rs 3.13 contribution; 62.6% variable margin"],
        ["Initial drawdown", "Rs 15 lakh", "12-week bridge to reliability and first repeatable paying cohort"],
        ["Full seed commitment", "Rs 5 crore", "18-month product, GTM and capacity plan"],
        ["Y1 exit", "10L monthly mins / Rs 50L MRR", "250 paying accounts; Rs 6 Cr ARR run-rate"],
        ["Y2 exit", "50L monthly mins / Rs 2.5 Cr MRR", "1,200 paying accounts; Rs 30 Cr ARR run-rate"],
        ["Y3 exit", "2 Cr monthly mins / Rs 10 Cr MRR", "4,000 paying accounts; Rs 120 Cr ARR run-rate"],
        ["Valuation", "Rs 20 Cr pre / Rs 25 Cr post", "20% seed ownership before new ESOP adjustment"],
    ]
    story.extend([table(summary, [48 * mm, 55 * mm, 76 * mm]), Spacer(1, 8 * mm)])
    story.append(P("Important: these are management targets, not guaranteed results. The model must be refreshed monthly using actual conversion, usage, collections and delivery cost.", "Smallx"))
    story.append(PageBreak())


def baseline(story):
    story.extend([
        P("1. Honest baseline and unit economics", "H1x"),
        P("The plan starts from live product usage, not a pre-product assumption. Baseline figures come from the SnapServe Admin view for the period available on 14 August 2026.", "Bodyx"),
    ])
    data = [
        ["Metric", "Value", "Comment"],
        ["Total users", "417", "Includes mixed/free/early users"],
        ["Total calls", "4,356", "Live operating history"],
        ["Total minutes", "3,982", "All-time baseline shown in Admin"],
        ["Recognized usage (30d)", "Rs 35,083", "Current monthly revenue baseline"],
        ["Wallet top-ups (30d)", "Rs 31,100", "Cash-in indicator"],
        ["Current fixed opex", "Rs 3L/month", "Rs 1L Vobiz + Rs 2L rent/salaries/ops"],
        ["Price / minute", "Rs 5.00", "Recognized platform revenue"],
        ["Variable cost / minute", "Rs 1.87", "Telephony + AI delivery estimate"],
        ["Contribution / minute", "Rs 3.13", "62.6% before fixed opex"],
        ["Current fixed-cost break-even", "~95,847 mins/month", "Approximately Rs 4.79L monthly revenue"],
    ]
    story.extend([table(data, [55 * mm, 42 * mm, 82 * mm]), Spacer(1, 8 * mm)])
    story.append(P("Why funding is required: the unit economics are positive, but current volume is only a small fraction of fixed-cost break-even. Capital primarily buys distribution, reliability, customer success and capacity.", "Callout"))
    story.append(PageBreak())


def funding_roadmap(story):
    story.extend([
        P("2. Funding roadmap: one round, four drawdowns", "H1x"),
        P("All drawdowns should be committed in the same definitive financing documents. Objective release conditions and cure periods reduce the risk of later capital becoming discretionary.", "Bodyx"),
    ])
    rows = [["Drawdown", "Amount", "Window", "Release condition", "Operating target"]]
    for tranche in TRANCHES:
        rows.append([
            tranche["name"].replace("Tranche ", ""),
            rs_lakh(tranche["amount"]),
            tranche["window"],
            tranche["trigger"],
            tranche["target"],
        ])
    rows.append(["Total", "Rs 5.00 Cr", "18 months", "One CCPS financing", "Series A-ready operating system"])
    story.extend([
        table(rows, [27 * mm, 24 * mm, 22 * mm, 53 * mm, 63 * mm], right_cols=(1,), small=True),
        Spacer(1, 8 * mm),
        P("Founder answer: “We are raising one Rs 5 crore seed round through four committed CCPS drawdowns: Rs 15 lakh, Rs 85 lakh, Rs 1.5 crore and Rs 2.5 crore against agreed operating milestones.”", "Callout"),
        PageBreak(),
    ])


def tranche_page(story, tranche, number):
    story.extend([
        P(f"{number}. {tranche['name']}", "H1x"),
        P(f"<b>Capital:</b> {rs_lakh(tranche['amount'])} &nbsp;&nbsp; <b>Deployment:</b> {tranche['window']} &nbsp;&nbsp; <b>Release:</b> {tranche['trigger']}", "Bodyx"),
        P(tranche["target"], "Callout"),
        P("Budget allocation", "H2x"),
    ])
    rows = [["Budget category", "Amount", "%", "What it funds"]]
    for category, amount, detail in tranche["budget"]:
        rows.append([category, rs_lakh(amount), f"{amount / tranche['amount']:.1%}", detail])
    rows.append(["Total", rs_lakh(tranche["amount"]), "100.0%", "Must reconcile to bank drawdown and board-approved budget"])
    story.extend([table(rows, [45 * mm, 28 * mm, 20 * mm, 86 * mm], right_cols=(1, 2)), Spacer(1, 6 * mm)])

    if number == 3:
        story.extend([
            P("First Rs 15 lakh: 12-week execution budget", "H2x"),
            table([
                ["Month", "Opening focus", "Budget guardrail", "Target evidence"],
                ["Month 1", "Fix reliability, complete financing/legal, protect current customers", "Up to Rs 5L", "Uptime dashboard, signed docs, active pipeline"],
                ["Month 2", "POCs, onboarding, case-study calls and production monitoring", "Up to Rs 5L", "5-8 paying accounts, measured usage"],
                ["Month 3", "Repeatable sales motion and Tranche B readiness", "Up to Rs 5L", "15 paying, 30K mins/month, Rs 1.5L MRR"],
            ], [23 * mm, 62 * mm, 31 * mm, 63 * mm], small=True),
            Spacer(1, 5 * mm),
            P("Do not use the Rs 15 lakh for broad hiring. It is a controlled bridge: protect delivery, prove repeatable paid usage and unlock the committed Rs 85 lakh foundation drawdown.", "Callout"),
        ])
    else:
        story.extend([
            P("Release-control rule", "H2x"),
            P("Management reports monthly actual-versus-budget by category. Any category variance above 15% requires a written reforecast; unused funds remain in runway reserve rather than being automatically spent.", "Bodyx"),
        ])
    story.append(PageBreak())


def consolidated_budget(story):
    story.extend([
        P("7. Consolidated Rs 5 crore use of funds", "H1x"),
        P("The drawdown budgets reconcile exactly to the use-of-funds percentages shown in the pitch deck.", "Bodyx"),
    ])
    totals = {}
    for tranche in TRANCHES:
        for category, amount, _ in tranche["budget"]:
            totals[category] = totals.get(category, 0) + amount
    rows = [["Category", "A", "B", "C", "D", "Total", "% of round"]]
    categories = [item[0] for item in TRANCHES[0]["budget"]]
    for category in categories:
        amounts = []
        for tranche in TRANCHES:
            amounts.append(next(amount for name, amount, _ in tranche["budget"] if name == category))
        total = sum(amounts)
        rows.append([category, *[rs_lakh(v) for v in amounts], rs_lakh(total), f"{total / 500:.1%}"])
    rows.append(["Total", "Rs 15L", "Rs 85L", "Rs 1.50Cr", "Rs 2.50Cr", "Rs 5.00Cr", "100.0%"])
    story.extend([
        table(rows, [43 * mm, 21 * mm, 21 * mm, 24 * mm, 24 * mm, 25 * mm, 22 * mm], right_cols=(1, 2, 3, 4, 5, 6), small=True),
        Spacer(1, 8 * mm),
        chart("Use of Rs 5 Cr by budget category", categories, [totals[c] for c in categories], BLUE, "Rs lakh"),
        PageBreak(),
    ])


def sales_projection(story):
    story.extend([
        P("8. Quarterly sales and revenue projection", "H1x"),
        P("Revenue is usage-based: quarterly minutes × Rs 5 per minute. Account targets imply approximately 4,000-5,000 monthly minutes per mature paying account.", "Bodyx"),
    ])
    rows = [["Quarter", "Avg mins/mo", "Accounts at exit", "Revenue", "Exit direction"]]
    for row in PROJECTIONS:
        direction = (
            "Prove paid cohort" if row["quarter"] == "Y1 Q1"
            else "Vertical repeatability" if row["quarter"] in ("Y1 Q2", "Y1 Q3")
            else "Seed milestone" if row["quarter"] == "Y1 Q4"
            else "Scale accounts + partners"
        )
        rows.append([
            row["quarter"],
            f"{row['avg_mins']:.2f} L",
            f"{row['accounts']:,}",
            money_cr(row["revenue"]),
            direction,
        ])
    story.extend([
        table(rows, [27 * mm, 33 * mm, 33 * mm, 34 * mm, 52 * mm], right_cols=(1, 2, 3), small=True),
        Spacer(1, 6 * mm),
        chart("Quarterly recognized revenue", [r["quarter"] for r in PROJECTIONS], [r["revenue"] for r in PROJECTIONS], GREEN, "Rs crore"),
        PageBreak(),
    ])


def sales_funnel(story):
    story.extend([
        P("9. Sales budget and funnel assumptions", "H1x"),
        P("The sales plan should be managed as a funnel. These starting assumptions must be replaced with actual CRM conversion data after the first 90 days.", "Bodyx"),
    ])
    funnel = [
        ["Stage", "Initial assumption", "Y1 operating requirement", "Owner"],
        ["Qualified opportunities", "20% of targeted prospects", "Build vertical lists and partner referrals", "Founder / SDR"],
        ["POC / live demo", "35% of qualified opportunities", "Demo using customer workflow and phone number", "Founder / Solutions"],
        ["Paid activation", "30% of POCs", "Wallet funded and first 1,000 minutes", "AE / Onboarding"],
        ["90-day retained account", "70% of paid activations", "Usage review, KB quality, campaign support", "Customer Success"],
        ["Expansion", "25% of retained accounts / quarter", "More agents, campaigns, numbers or partner clients", "CS / AE"],
    ]
    story.extend([table(funnel, [39 * mm, 40 * mm, 70 * mm, 30 * mm]), Spacer(1, 8 * mm)])
    sales_budget = [
        ["Period", "Sales & CS capital", "Primary spending", "Output target"],
        ["Tranche A", "Rs 2L", "Founder demos, POCs, onboarding", "15 paying accounts"],
        ["Tranche B", "Rs 20L", "First GTM hires and repeatable vertical motion", "50 paying accounts"],
        ["Tranche C", "Rs 45L", "AEs, onboarding and partner activation", "250 paying accounts"],
        ["Tranche D", "Rs 83L", "National GTM and enterprise customer success", "Series A-ready pipeline"],
        ["Total", "Rs 1.50Cr", "30% of the seed round", "4,000 paying accounts by Y3 exit"],
    ]
    story.extend([
        P("Sales and customer-success capital", "H2x"),
        table(sales_budget, [31 * mm, 35 * mm, 75 * mm, 38 * mm]),
        Spacer(1, 5 * mm),
        P("Governance KPI: track CAC separately for direct SMB, enterprise and partner channels. Do not publish LTV:CAC until retention and expansion cohorts are mature.", "Callout"),
        PageBreak(),
    ])


def production_budget(story):
    story.extend([
        P("10. Production and service-delivery budget", "H1x"),
        P("For SnapServe, “production” means the cost and capacity required to deliver completed AI voice minutes: telephony, STT/TTS, LLM inference, cloud, monitoring, QA and support.", "Bodyx"),
    ])
    rows = [["Quarter", "Quarter mins", "Revenue", "Variable delivery cost", "Gross contribution", "Var. margin"]]
    for row in PROJECTIONS:
        quarter_mins_lakh = row["avg_mins"] * 3
        rows.append([
            row["quarter"],
            f"{quarter_mins_lakh:.2f} L",
            money_cr(row["revenue"]),
            money_cr(row["cost"]),
            money_cr(row["contribution"]),
            f"{row['contribution'] / row['revenue']:.1%}",
        ])
    story.extend([table(rows, [25 * mm, 30 * mm, 30 * mm, 39 * mm, 37 * mm, 25 * mm], right_cols=(1, 2, 3, 4, 5), small=True), Spacer(1, 5 * mm)])
    story.extend([
        P("Production controls", "H2x"),
        table([
            ["Control", "Target", "Why it matters"],
            ["Blended variable cost", "≤ Rs 1.87/min Y1; Rs 1.60/min by Y3", "Protects contribution margin"],
            ["Capacity headroom", "≥ 30% above rolling 30-day peak", "Prevents campaign congestion"],
            ["Platform availability", "≥ 99.5% in Tranche A; ≥ 99.9% at enterprise scale", "Supports customer trust"],
            ["Call completion", "Improve from current 54% with routing and retries", "Directly drives billable value"],
            ["Cost reconciliation", "Daily provider usage vs wallet ledger", "Prevents margin leakage"],
            ["Quality review", "Sample calls by language, vertical and provider", "Maintains conversion quality"],
        ], [42 * mm, 58 * mm, 79 * mm]),
        PageBreak(),
    ])


def pnl_page(story):
    story.extend([
        P("11. Three-year profit and loss projection", "H1x"),
        P("Annual revenue uses average monthly volume; ARR uses the exit run-rate. Mixing these two is a common forecasting error.", "Bodyx"),
    ])
    annual = [
        ("Year 1", 1.80, -0.6732, 1.1268, -2.40, -1.2732),
        ("Year 2", 15.00, -5.25, 9.75, -8.00, 1.75),
        ("Year 3", 66.00, -21.12, 44.88, -24.00, 20.88),
    ]
    rows = [["Rs crore", "Year 1", "Year 2", "Year 3"]]
    labels = [
        ("Recognized revenue", 1),
        ("Variable delivery cost", 2),
        ("Gross contribution", 3),
        ("Operating expenses", 4),
        ("EBITDA", 5),
    ]
    for label, idx in labels:
        rows.append([label, *[money_cr(year[idx]) for year in annual]])
    rows.append(["EBITDA margin", "-70.7%", "11.7%", "31.6%"])
    rows.append(["Exit ARR run-rate", "Rs 6 Cr", "Rs 30 Cr", "Rs 120 Cr"])
    story.extend([
        table(rows, [62 * mm, 39 * mm, 39 * mm, 39 * mm], right_cols=(1, 2, 3)),
        Spacer(1, 8 * mm),
        chart("Annual recognized revenue vs EBITDA", ["Y1 Revenue", "Y2 Revenue", "Y3 Revenue", "Y1 EBITDA", "Y2 EBITDA", "Y3 EBITDA"], [1.8, 15, 66, -1.2732, 1.75, 20.88], BLUE, "Rs crore"),
        Spacer(1, 4 * mm),
        P("Base-case interpretation: Year 1 is investment-heavy, Year 2 establishes operating leverage, and Year 3 scales margin. The Year 3 result requires the partner channel and enterprise retention assumptions to hold.", "Callout"),
        PageBreak(),
    ])


def quarterly_cash(story):
    story.extend([
        P("12. Quarterly operating budget and cash discipline", "H1x"),
        P("EBITDA below excludes financing flows and working-capital timing. Tranche receipts are balance-sheet financing, not revenue.", "Bodyx"),
    ])
    rows = [["Quarter", "Gross contribution", "Operating expenses", "EBITDA", "Management action"]]
    for row in PROJECTIONS:
        action = (
            "Protect runway / prove usage" if row["ebitda"] < 0 and row["quarter"].startswith("Y1")
            else "Monitor collections" if row["ebitda"] < 0
            else "Reinvest within approved budget"
        )
        rows.append([
            row["quarter"],
            money_cr(row["contribution"]),
            money_cr(row["opex"]),
            money_cr(row["ebitda"]),
            action,
        ])
    story.extend([
        table(rows, [26 * mm, 38 * mm, 39 * mm, 34 * mm, 49 * mm], right_cols=(1, 2, 3), small=True),
        Spacer(1, 6 * mm),
        P("Cash controls", "H2x"),
        table([
            ["Control", "Rule"],
            ["Minimum runway", "Maintain at least 9 months of board-approved base operating expense after each drawdown."],
            ["Hiring gates", "No role opens without 12-month loaded cost, owner, KPI and approved start date."],
            ["Receivables", "Enterprise credit terms require approval; wallet-funded SMB usage remains prepaid."],
            ["Provider commitments", "Capacity contracts must stay below conservative volume case unless cancellable."],
            ["Reforecast", "Refresh rolling 18-month cash forecast monthly; board review quarterly."],
        ], [45 * mm, 134 * mm]),
        PageBreak(),
    ])


def hiring_and_opex(story):
    story.extend([
        P("13. Hiring and operating-expense plan", "H1x"),
        P("Team growth is a ceiling, not an automatic hiring target. Hiring follows revenue, reliability and sales productivity evidence.", "Bodyx"),
    ])
    rows = [
        ["Function", "End Y1", "End Y2", "End Y3", "Primary KPI"],
        ["Founders / leadership", "2", "4", "6", "Capital allocation and milestone delivery"],
        ["Engineering / AI / product", "5", "14", "30", "Reliability, quality and release velocity"],
        ["Sales / partnerships", "2", "8", "20", "Pipeline, conversion and payback"],
        ["Customer success / solutions", "2", "6", "14", "Activation, retention and expansion"],
        ["Operations / finance / people", "1", "3", "6", "Controls, hiring and collections"],
        ["Support / QA", "0-1 shared", "4", "4", "Resolution time and sampled-call quality"],
        ["Total target", "12", "35", "80", "Subject to approved hiring gates"],
    ]
    story.extend([table(rows, [43 * mm, 25 * mm, 25 * mm, 25 * mm, 61 * mm]), Spacer(1, 7 * mm)])
    opex = [
        ["Opex view", "Year 1", "Year 2", "Year 3"],
        ["Annual operating expenses", "Rs 2.40 Cr", "Rs 8.00 Cr", "Rs 24.00 Cr"],
        ["Average monthly opex", "Rs 20L", "Rs 66.7L", "Rs 2.00 Cr"],
        ["End-of-year team", "12", "35", "80"],
        ["Primary scaling driver", "Product + first GTM", "National GTM + CS", "Enterprise + platform scale"],
    ]
    story.extend([
        P("Operating-expense envelope", "H2x"),
        table(opex, [55 * mm, 38 * mm, 38 * mm, 48 * mm], right_cols=(1, 2, 3)),
        PageBreak(),
    ])


def sensitivity(story):
    story.extend([
        P("14. Scenario and sensitivity analysis", "H1x"),
        P("The largest valuation-sensitive variable is usage growth. The first 90 days should establish whether the base case is credible.", "Bodyx"),
    ])
    scenarios = [
        ["Case", "Y1 exit mins/month", "Y1 exit MRR", "Y1 exit ARR", "Required response"],
        ["Conservative", "5L", "Rs 25L", "Rs 3 Cr", "Slow hiring; prioritize retention and partner conversion"],
        ["Base", "10L", "Rs 50L", "Rs 6 Cr", "Execute approved tranche and hiring plan"],
        ["Aggressive", "20L", "Rs 1 Cr", "Rs 12 Cr", "Add capacity only after collections and quality hold"],
    ]
    story.extend([table(scenarios, [31 * mm, 38 * mm, 34 * mm, 34 * mm, 55 * mm]), Spacer(1, 8 * mm)])
    downside = [
        ["Risk", "Early warning", "Mitigation"],
        ["Sales conversion below plan", "POC-to-paid <20%", "Narrow vertical, strengthen proof and founder-led discovery"],
        ["Usage per account below plan", "<2,500 mins/account/month", "Move toward campaign-heavy and partner accounts"],
        ["Variable cost rises", ">Rs 2/min for two months", "Route providers, renegotiate volume and tighten features"],
        ["Later tranche delayed", "<6 months runway", "Freeze hiring and activate minimum viable Rs 1 Cr plan"],
        ["Collections slow", "DSO >45 days", "Prepaid wallet, credit limits and enterprise approval"],
        ["Quality or uptime drops", "Completion/availability misses SLA", "Pause acquisition, fix reliability and add capacity"],
    ]
    story.extend([
        P("Downside controls", "H2x"),
        table(downside, [47 * mm, 54 * mm, 78 * mm]),
        PageBreak(),
    ])


def investor_terms(story):
    story.extend([
        P("15. Investor terms and diligence readiness", "H1x"),
        P("Indicative commercial position: Rs 20 crore pre-money, Rs 25 crore post-money, Rs 5 crore CCPS and 20% seed ownership before any new ESOP pool adjustment.", "Callout"),
    ])
    terms = [
        ["Issue", "Founder position to discuss", "Why it matters"],
        ["Instrument", "CCPS; final conversion and rights drafted by counsel", "Standard priced seed structure for an Indian Pvt Ltd"],
        ["Drawdowns", "Entire Rs 5 Cr committed at signing", "Avoids financing risk after hiring begins"],
        ["Milestones", "Objective, measurable and with cure periods", "Prevents subjective withholding"],
        ["Valuation", "Fixed across all four drawdowns", "Avoids hidden repricing"],
        ["Liquidation preference", "Target 1x non-participating", "Avoids double-dip economics"],
        ["Anti-dilution", "Broad-based weighted average; no full ratchet", "Protects founders in future financing"],
        ["ESOP", "Model pool expansion explicitly", "Pre-money pools increase founder dilution"],
        ["Board / reserved matters", "Proportionate, clearly scoped", "Preserves operating ability"],
        ["Legal review", "Indian startup counsel + CA/CS", "CCPS, FEMA and company-law compliance"],
    ]
    story.extend([table(terms, [43 * mm, 69 * mm, 67 * mm]), Spacer(1, 7 * mm)])
    story.append(P("This document is a management planning model, not legal, tax or investment advice. Definitive documents control.", "Smallx"))
    story.append(PageBreak())


def management_dashboard(story):
    story.extend([
        P("16. Monthly board dashboard", "H1x"),
        P("Every monthly investor update should compare actual results with the approved budget and explain corrective action.", "Bodyx"),
    ])
    dashboard = [
        ["Section", "Metrics to report", "Decision enabled"],
        ["Sales", "Qualified pipeline, demos, POCs, paid activations, CAC", "Whether to add GTM capacity"],
        ["Revenue", "Wallet cash-in, recognized usage, MRR, expansion, collections", "Quality and durability of growth"],
        ["Usage", "Minutes, calls, completion, minutes/account, channel mix", "Capacity and customer value"],
        ["Production", "Cost/min, provider mix, uptime, latency, failure rate", "Margin and reliability action"],
        ["Customer", "Activation, 30/90-day retention, support, NPS/case studies", "Retention and expansion priorities"],
        ["Cash", "Opening cash, burn, runway, budget variance, receivables", "Hiring and tranche timing"],
        ["People", "Headcount, loaded cost, open roles, productivity", "Hiring gate decisions"],
        ["Milestones", "Tranche release evidence and next constraints", "Board/investor alignment"],
    ]
    story.extend([
        table(dashboard, [35 * mm, 90 * mm, 54 * mm]),
        Spacer(1, 8 * mm),
        P("Next operating step", "H2x"),
        P("At the end of each month, replace forecast values with actuals, roll the model forward by one month, and update conservative/base/aggressive cases. Investor confidence comes from forecast accuracy and transparent corrections—not only from ambitious targets.", "Callout"),
    ])


def build():
    doc = SimpleDocTemplate(
        str(OUTPUT_FILE),
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title="SnapServe Detailed 3-Year Budget and Round Plan",
        author="SnapServe AI Pvt Limited",
        subject="Investor budget, projections and Rs 5 crore CCPS round plan",
    )
    story = []
    cover(story)
    executive_summary(story)
    baseline(story)
    funding_roadmap(story)
    for index, tranche in enumerate(TRANCHES, start=3):
        tranche_page(story, tranche, index)
    consolidated_budget(story)
    sales_projection(story)
    sales_funnel(story)
    production_budget(story)
    pnl_page(story)
    quarterly_cash(story)
    hiring_and_opex(story)
    sensitivity(story)
    investor_terms(story)
    management_dashboard(story)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Wrote {OUTPUT_FILE}")
    return OUTPUT_FILE


if __name__ == "__main__":
    build()
