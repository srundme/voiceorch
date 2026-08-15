#!/usr/bin/env python3
"""Build SnapServe's investor-facing 3-year financial model."""

from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter


OUT = Path(__file__).resolve().parent
OUTPUT_FILE = OUT / "SnapServe-3-Year-Financial-Projection.xlsx"

BG = "121214"
CARD = "1C1C1F"
FG = "F5F5F5"
MUTED = "A1A1AA"
ACCENT = "E11D48"
GREEN = "22C55E"
BORDER = "2A2A2E"

INR = '₹#,##0;[Red](₹#,##0)'
INR_CR = '₹0.00" Cr";[Red](₹0.00" Cr")'
PERCENT = "0.0%"
INTEGER = "#,##0"


def style_sheet(ws, widths):
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A4"
    for col, width in widths.items():
        ws.column_dimensions[col].width = width
    for row in ws.iter_rows():
        for cell in row:
            cell.fill = PatternFill("solid", fgColor=BG)
            cell.font = Font(name="Aptos", color=FG, size=11)
            cell.alignment = Alignment(vertical="center")


def title(ws, text, subtitle):
    ws.merge_cells("A1:E1")
    ws["A1"] = text
    ws["A1"].font = Font(name="Aptos Display", size=20, bold=True, color=FG)
    ws["A1"].fill = PatternFill("solid", fgColor=BG)
    ws.merge_cells("A2:E2")
    ws["A2"] = subtitle
    ws["A2"].font = Font(name="Aptos", size=10, color=MUTED)
    ws["A2"].fill = PatternFill("solid", fgColor=BG)
    ws.row_dimensions[1].height = 30


def header_row(ws, row, start_col, end_col):
    for col in range(start_col, end_col + 1):
        cell = ws.cell(row, col)
        cell.fill = PatternFill("solid", fgColor=CARD)
        cell.font = Font(name="Aptos", bold=True, color=FG)
        cell.border = Border(bottom=Side(style="thin", color=BORDER))
        cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[row].height = 24


def section_row(ws, row, text, end_col=5):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=end_col)
    cell = ws.cell(row, 1)
    cell.value = text
    cell.fill = PatternFill("solid", fgColor=CARD)
    cell.font = Font(name="Aptos", bold=True, color=ACCENT)
    cell.border = Border(bottom=Side(style="thin", color=BORDER))


def build_assumptions(wb):
    ws = wb.active
    ws.title = "Assumptions"
    title(ws, "SnapServe AI — Model Assumptions", "Base case · INR · 3 years · prepared 14 Aug 2026")
    ws.append([])
    ws.append(["Assumption", "Year 1", "Year 2", "Year 3", "Notes"])
    header_row(ws, 4, 1, 5)
    rows = [
        ("Price per minute", 5.00, 5.00, 5.00, "Recognized platform revenue"),
        ("Variable cost per minute", 1.87, 1.75, 1.60, "Routing/volume improvement"),
        ("Average monthly minutes", 300_000, 2_500_000, 11_000_000, "Used for annual P&L"),
        ("Exit monthly minutes", 1_000_000, 5_000_000, 20_000_000, "Year-end run-rate"),
        ("Paying accounts at exit", 250, 1_200, 4_000, "4k–5k mins/account/month"),
        ("Annual operating expenses", 24_000_000, 80_000_000, 240_000_000, "People, GTM, infra, G&A"),
        ("End-of-year team", 12, 35, 80, "Founders included"),
    ]
    for row in rows:
        ws.append(row)
    for row in range(5, 12):
        for col in range(2, 5):
            ws.cell(row, col).fill = PatternFill("solid", fgColor=CARD)
            ws.cell(row, col).font = Font(name="Aptos", bold=True, color=GREEN)
    for col in range(2, 5):
        ws.cell(5, col).number_format = INR
        ws.cell(6, col).number_format = INR
        ws.cell(7, col).number_format = INTEGER
        ws.cell(8, col).number_format = INTEGER
        ws.cell(9, col).number_format = INTEGER
        ws.cell(10, col).number_format = INR
        ws.cell(11, col).number_format = INTEGER
    section_row(ws, 13, "Current baseline")
    baseline = [
        ("Recognized revenue (30d)", 35_083, "", "", "SnapServe Admin"),
        ("Total users", 417, "", "", "SnapServe Admin"),
        ("Total calls", 4_356, "", "", "SnapServe Admin"),
        ("Total minutes (all-time)", 3_982, "", "", "SnapServe Admin"),
        ("Current fixed opex / month", 300_000, "", "", "Founder input"),
    ]
    for row in baseline:
        ws.append(row)
    ws["B14"].number_format = INR
    ws["B18"].number_format = INR
    style_sheet(ws, {"A": 32, "B": 18, "C": 18, "D": 18, "E": 42})
    return ws


def build_projection(wb):
    ws = wb.create_sheet("3-Year P&L")
    title(ws, "SnapServe AI — 3-Year P&L", "Base case · formulas link to Assumptions")
    ws.append([])
    ws.append(["₹ crore unless noted", "Year 1", "Year 2", "Year 3", "Formula / interpretation"])
    header_row(ws, 4, 1, 5)
    labels = [
        "Average monthly minutes",
        "Annual minutes",
        "Recognized revenue",
        "Variable delivery cost",
        "Gross contribution",
        "Gross contribution margin",
        "Operating expenses",
        "EBITDA",
        "EBITDA margin",
        "Exit monthly minutes",
        "Exit MRR",
        "Exit ARR run-rate",
        "Paying accounts at exit",
    ]
    notes = [
        "Average volume during year",
        "Average monthly minutes × 12",
        "Annual minutes × ₹5/min",
        "Annual minutes × variable cost/min",
        "Revenue less variable cost",
        "Gross contribution ÷ revenue",
        "People, GTM, infra and G&A",
        "Gross contribution less opex",
        "EBITDA ÷ revenue",
        "Year-end run-rate",
        "Exit minutes × ₹5/min",
        "Exit MRR × 12",
        "Customer count at year end",
    ]
    for idx, label in enumerate(labels, start=5):
        ws.cell(idx, 1, label)
        ws.cell(idx, 5, notes[idx - 5])
    for col in range(2, 5):
        assumptions_col = get_column_letter(col)
        ws.cell(5, col, f"=Assumptions!{assumptions_col}7")
        ws.cell(6, col, f"={get_column_letter(col)}5*12")
        ws.cell(7, col, f"={get_column_letter(col)}6*Assumptions!{assumptions_col}5/10000000")
        ws.cell(8, col, f"=-{get_column_letter(col)}6*Assumptions!{assumptions_col}6/10000000")
        ws.cell(9, col, f"={get_column_letter(col)}7+{get_column_letter(col)}8")
        ws.cell(10, col, f"={get_column_letter(col)}9/{get_column_letter(col)}7")
        ws.cell(11, col, f"=-Assumptions!{assumptions_col}10/10000000")
        ws.cell(12, col, f"={get_column_letter(col)}9+{get_column_letter(col)}11")
        ws.cell(13, col, f"={get_column_letter(col)}12/{get_column_letter(col)}7")
        ws.cell(14, col, f"=Assumptions!{assumptions_col}8")
        ws.cell(15, col, f"={get_column_letter(col)}14*Assumptions!{assumptions_col}5/10000000")
        ws.cell(16, col, f"={get_column_letter(col)}15*12")
        ws.cell(17, col, f"=Assumptions!{assumptions_col}9")
    for row in (7, 8, 9, 11, 12, 15, 16):
        for col in range(2, 5):
            ws.cell(row, col).number_format = '₹0.00" Cr";[Red](₹0.00" Cr")'
    for row in (10, 13):
        for col in range(2, 5):
            ws.cell(row, col).number_format = PERCENT
    for row in (5, 6, 14, 17):
        for col in range(2, 5):
            ws.cell(row, col).number_format = INTEGER
    for row in (9, 12, 16):
        for col in range(1, 5):
            ws.cell(row, col).font = Font(name="Aptos", bold=True, color=GREEN if row != 12 or col == 1 else FG)
            ws.cell(row, col).fill = PatternFill("solid", fgColor=CARD)
    style_sheet(ws, {"A": 32, "B": 18, "C": 18, "D": 18, "E": 42})
    return ws


def build_round(wb):
    ws = wb.create_sheet("Seed Round")
    title(ws, "₹5 Cr Seed Round — Indicative Structure", "One CCPS round · four committed drawdowns · subject to definitive documents")
    ws.append([])
    ws.append(["Cap table", "Amount", "Ownership", "", ""])
    header_row(ws, 4, 1, 3)
    cap = [
        ("Pre-money valuation", 200_000_000, "", "", ""),
        ("New investment", 50_000_000, "", "", ""),
        ("Post-money valuation", 250_000_000, "", "", ""),
        ("Seed investors", "", 0.20, "", ""),
        ("Founders (before new ESOP)", "", 0.80, "", ""),
    ]
    for row in cap:
        ws.append(row)
    for row in range(5, 8):
        ws.cell(row, 2).number_format = INR
    for row in range(8, 10):
        ws.cell(row, 3).number_format = PERCENT
    section_row(ws, 11, "Committed drawdown schedule")
    ws.append(["Tranche", "Amount", "Indicative trigger", "Primary use", "Cumulative funded"])
    header_row(ws, 12, 1, 5)
    tranches = [
        ("A — Initial close", 1_500_000, "Signing / definitive documents", "Infra, compliance, delivery", 1_500_000),
        ("B — Foundation", 8_500_000, "Reliability plan + paying pipeline", "Core hires and capacity", 10_000_000),
        ("C — Early scale", 15_000_000, "100 paying + ~2 L mins/month", "Vertical GTM and onboarding", 25_000_000),
        ("D — Growth", 25_000_000, "250 paying + path to 10 L mins/month", "National scale / Series A readiness", 50_000_000),
    ]
    for row in tranches:
        ws.append(row)
    for row in range(13, 17):
        ws.cell(row, 2).number_format = INR
        ws.cell(row, 5).number_format = INR
    section_row(ws, 18, "Important negotiation points")
    points = [
        "Entire ₹5 Cr should be legally committed; later tranches should not be discretionary.",
        "Define objective milestones, cure periods and who certifies achievement.",
        "Confirm valuation is fixed across tranches and shares issue only against funded capital.",
        "Negotiate 1× non-participating liquidation preference; avoid participating preference.",
        "Model any ESOP pool expansion before agreeing whether it is pre-money or post-money.",
        "Final CCPS terms require Indian startup counsel and CA/CS review.",
    ]
    for idx, point in enumerate(points, start=19):
        ws.merge_cells(start_row=idx, start_column=1, end_row=idx, end_column=5)
        ws.cell(idx, 1, f"• {point}")
        ws.cell(idx, 1).font = Font(name="Aptos", color=MUTED)
    style_sheet(ws, {"A": 25, "B": 18, "C": 36, "D": 34, "E": 20})
    return ws


def build_sensitivity(wb):
    ws = wb.create_sheet("Sensitivity")
    title(ws, "Year 1 Exit Sensitivity", "Revenue remains ₹5/min; scenarios change exit monthly volume")
    ws.append([])
    ws.append(["Case", "Exit monthly minutes", "Exit MRR", "Exit ARR", "Comment"])
    header_row(ws, 4, 1, 5)
    cases = [
        ("Conservative", 500_000, 2_500_000, 30_000_000, "Slower enterprise conversion"),
        ("Base", 1_000_000, 5_000_000, 60_000_000, "250 accounts × ~4k mins"),
        ("Aggressive", 2_000_000, 10_000_000, 120_000_000, "Partner channel outperforms"),
    ]
    for row in cases:
        ws.append(row)
    for row in range(5, 8):
        ws.cell(row, 2).number_format = INTEGER
        ws.cell(row, 3).number_format = INR
        ws.cell(row, 4).number_format = INR
    for col in range(1, 6):
        ws.cell(6, col).fill = PatternFill("solid", fgColor=CARD)
        ws.cell(6, col).font = Font(name="Aptos", bold=True, color=GREEN)
    style_sheet(ws, {"A": 20, "B": 24, "C": 20, "D": 20, "E": 38})
    return ws


def build():
    wb = Workbook()
    build_assumptions(wb)
    build_projection(wb)
    build_round(wb)
    build_sensitivity(wb)
    wb.calculation.fullCalcOnLoad = True
    wb.calculation.forceFullCalc = True
    wb.calculation.calcMode = "auto"
    wb.save(OUTPUT_FILE)

    # Re-open to ensure the generated workbook is structurally valid.
    checked = load_workbook(OUTPUT_FILE, data_only=False)
    assert checked.sheetnames == ["Assumptions", "3-Year P&L", "Seed Round", "Sensitivity"]
    print(f"Wrote {OUTPUT_FILE}")
    return OUTPUT_FILE


if __name__ == "__main__":
    build()
