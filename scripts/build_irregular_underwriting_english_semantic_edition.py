from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable

from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch, mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "public" / "reports" / (
    "vsee-irregular-sample-underwriting-english-semantic-edition.pdf"
)

# Keep ReportLab metadata and document IDs deterministic across regenerations.
rl_config.invariant = 1

PAGE_W, PAGE_H = A4
MARGIN_X = 17 * mm
MARGIN_TOP = 21 * mm
MARGIN_BOTTOM = 17 * mm

BG = colors.HexColor("#070B08")
PANEL = colors.HexColor("#0D130E")
PANEL_2 = colors.HexColor("#111A11")
LIME = colors.HexColor("#B9FF3B")
WHITE = colors.HexColor("#F2F3ED")
MUTED = colors.HexColor("#9CA59E")
LINE = colors.HexColor("#29342B")
AMBER = colors.HexColor("#E9B56D")
RED = colors.HexColor("#F28A7B")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("VSeeSans", "/System/Library/Fonts/Supplemental/Arial.ttf"))
    pdfmetrics.registerFont(TTFont("VSeeSansBold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))
    pdfmetrics.registerFont(TTFont("VSeeSerif", "/System/Library/Fonts/Supplemental/Georgia.ttf"))
    pdfmetrics.registerFont(TTFont("VSeeSerifBold", "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"))
    pdfmetrics.registerFont(TTFont("VSeeMono", "/System/Library/Fonts/Supplemental/Courier New.ttf"))


register_fonts()


def esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def styles(locale: str) -> dict[str, ParagraphStyle]:
    zh = locale == "zh"
    sans = "VSeeZH" if zh else "VSeeSans"
    sans_bold = "VSeeZHBold" if zh else "VSeeSansBold"
    serif = "VSeeZHSerif" if zh else "VSeeSerif"
    serif_bold = "VSeeZHBold" if zh else "VSeeSerifBold"
    mono = "VSeeZH" if zh else "VSeeMono"
    body_size = 9.45 if zh else 9.15
    body_lead = 14.1 if zh else 13.35
    return {
        "eyebrow": ParagraphStyle(
            "eyebrow", fontName=mono, fontSize=7.2, leading=9,
            textColor=LIME, uppercase=True, tracking=1.3, spaceAfter=7,
        ),
        "cover_title": ParagraphStyle(
            "cover_title", fontName=serif_bold, fontSize=31 if zh else 34,
            leading=39, textColor=WHITE, spaceAfter=11,
        ),
        "cover_sub": ParagraphStyle(
            "cover_sub", fontName=sans, fontSize=12.2, leading=18,
            textColor=MUTED, spaceAfter=18,
        ),
        "section_no": ParagraphStyle(
            "section_no", fontName=mono, fontSize=7.5, leading=9,
            textColor=LIME, tracking=1.0, spaceAfter=5,
        ),
        "h1": ParagraphStyle(
            "h1", fontName=serif_bold, fontSize=23 if zh else 25,
            leading=30, textColor=WHITE, spaceAfter=11,
        ),
        "h2": ParagraphStyle(
            "h2", fontName=serif_bold, fontSize=14.2, leading=19,
            textColor=WHITE, spaceBefore=9, spaceAfter=5,
        ),
        "h3": ParagraphStyle(
            "h3", fontName=sans_bold, fontSize=9.2, leading=12,
            textColor=LIME, spaceBefore=7, spaceAfter=3,
        ),
        "body": ParagraphStyle(
            "body", fontName=sans, fontSize=body_size, leading=body_lead,
            textColor=WHITE, spaceAfter=7,
        ),
        "body_small": ParagraphStyle(
            "body_small", fontName=sans, fontSize=7.65 if zh else 7.5,
            leading=11.2, textColor=MUTED, spaceAfter=5,
        ),
        "callout": ParagraphStyle(
            "callout", fontName=sans_bold if zh else serif, fontSize=12 if zh else 11.8,
            leading=17.5, textColor=WHITE, leftIndent=10, rightIndent=10,
            borderColor=LIME, borderWidth=0.8, borderPadding=10,
            backColor=PANEL_2, spaceBefore=6, spaceAfter=9,
        ),
        "warning": ParagraphStyle(
            "warning", fontName=sans_bold, fontSize=8.2, leading=12,
            textColor=AMBER, borderColor=AMBER, borderWidth=0.6,
            borderPadding=8, backColor=PANEL, spaceAfter=10,
        ),
        "metric": ParagraphStyle(
            "metric", fontName=serif_bold, fontSize=17, leading=20,
            textColor=WHITE,
        ),
        "metric_label": ParagraphStyle(
            "metric_label", fontName=mono, fontSize=6.3, leading=8,
            textColor=MUTED, tracking=0.6,
        ),
        "table_head": ParagraphStyle(
            "table_head", fontName=sans_bold, fontSize=7.3, leading=9.2,
            textColor=LIME,
        ),
        "table": ParagraphStyle(
            "table", fontName=sans, fontSize=7.3 if zh else 7.15,
            leading=10.2, textColor=WHITE,
        ),
        "source": ParagraphStyle(
            "source", fontName=sans, fontSize=6.8, leading=9.5,
            textColor=MUTED, spaceAfter=4,
        ),
        "quote": ParagraphStyle(
            "quote", fontName=sans if zh else serif, fontSize=10.7, leading=15.3,
            textColor=WHITE, leftIndent=12, borderColor=LINE,
            borderWidth=0.6, borderPadding=7,
            spaceBefore=3, spaceAfter=7,
        ),
    }


def p(text: str, sty: ParagraphStyle) -> Paragraph:
    text = text.replace("\u2014", " - ").replace("\u2013", "-").replace("\u2011", "-")
    return Paragraph(text, sty)


def bullet(text: str, sty: ParagraphStyle, color: str = "#B9FF3B") -> Paragraph:
    return Paragraph(f'<font color="{color}">•</font>&nbsp;&nbsp;{text}', sty)


def section(st: dict[str, ParagraphStyle], number: str, title: str, kicker: str | None = None):
    items = [p(number, st["section_no"]), p(title, st["h1"])]
    if kicker:
        items.append(p(kicker, st["body_small"]))
    items.append(HRFlowable(width="100%", thickness=0.7, color=LINE, spaceAfter=10))
    return items


def metric_grid(st: dict[str, ParagraphStyle], metrics: list[tuple[str, str]], cols: int = 4) -> Table:
    rows = []
    for i in range(0, len(metrics), cols):
        chunk = metrics[i:i + cols]
        while len(chunk) < cols:
            chunk.append(("", ""))
        rows.append([
            [p(value, st["metric"]), p(label, st["metric_label"])]
            for label, value in chunk
        ])
    table = Table(rows, colWidths=[(PAGE_W - 2 * MARGIN_X) / cols] * cols)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return table


def data_table(st: dict[str, ParagraphStyle], headers: list[str], rows: list[list[str]], widths=None) -> Table:
    data = [[p(h, st["table_head"]) for h in headers]]
    data.extend([[p(cell, st["table"]) for cell in row] for row in rows])
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PANEL_2),
        ("BACKGROUND", (0, 1), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def add_page(story: list, items: Iterable) -> None:
    if story:
        story.append(PageBreak())
    story.extend(items)


EN = {
    "meta": {
        "lang": "ENGLISH SEMANTIC EDITION",
        "title": "Irregular",
        "subtitle": "Portfolio Risk Reunderwriting",
        "date": "August 12, 2026",
        "disclosure": "SAMPLE UNDERWRITING REPORT — PUBLIC EVIDENCE + ILLUSTRATIVE SYNTHETIC ASSUMPTIONS — NOT INVESTMENT ADVICE",
    },
    "pages": []
}



def english_pages(st):
    pages = []

    # 1 — Cover
    pages.append([
        Spacer(1, 24), p("VSEE / XTRACE · VC DECISION INTELLIGENCE", st["eyebrow"]),
        p("Irregular", st["cover_title"]),
        p("Portfolio Risk Reunderwriting", st["cover_sub"]),
        p("A decision-first investment committee memorandum generated from the same seven-section Deep Underwriting presentation used by the VSee website.", st["callout"]),
        Spacer(1, 12),
        metric_grid(st, [
            ("PRIOR STATUS", "Invested*"),
            ("BELIEF CHANGE", "Cautious"),
            ("FORMAL DECISION", "Defer"),
            ("CONFIDENCE", "Medium"),
            ("ARR", "$12.0m"),
            ("ROUND PRICE", "$450m pre"),
            ("FOLLOW-ON", "$10.0m"),
            ("BASE GROSS MOIC", "2.35x"),
        ], 4),
        Spacer(1, 17),
        p("DOCUMENT STATUS", st["h3"]),
        p("Prepared for product and investor-format review. Public company and market statements are cited. Every private operating, financing, cap-table, scenario, and fund input is an <b>Illustrative synthetic assumption</b>. The prior investment history is a permanently labeled <b>Sample decision record</b>. Named Lens passages are VSee applications of public-source frameworks; they are not the named persons’ opinions, endorsements, or private reasoning.", st["body"]),
        p("Formal use: demonstrate the depth, organization, evidence discipline, and decision utility of a full VSee Deep Underwriting report. Do not use this sample to trade, contact the company, or represent an actual fund position.", st["warning"]),
        Spacer(1, 25),
        p("REPORT DATE", st["section_no"]), p("August 12, 2026", st["h2"]),
        p("Evidence anchor: public materials reviewed through August 1, 2026. Scenario assumptions are dated August 12, 2026.", st["body_small"]),
    ])

    # 2 — Decision Request
    pages.append(section(st, "01", "Decision Request", "THE DECISION, DECISION CEILING, AND REQUESTED IC AUTHORIZATION") + [
        p("FORMAL RESULT", st["h3"]),
        p("Defer the $10 million follow-on commitment. Authorize a 45-day portfolio-risk reunderwrite and preserve the option to reopen financing only after the containment, customer, and financial gates below are satisfied.", st["callout"]),
        metric_grid(st, [
            ("DECISION CEILING", "Diligence only"),
            ("ACTION", "Pause follow-on"),
            ("PORTFOLIO ACTION", "Risk review"),
            ("REVIEW WINDOW", "45 days"),
        ], 4),
        p("IC authorization requested", st["h2"]),
        bullet("Pause all new follow-on commitment activity while preserving information and pro-rata rights.", st["body"]),
        bullet("Open a portfolio-risk review led jointly by the investment partner, security adviser, and fund counsel.", st["body"]),
        bullet("Request the incident root-cause analysis, remediation evidence, customer-impact record, latest operating data, capitalization table, and proposed financing documents.", st["body"]),
        bullet("Permit the team to return to IC only if the independent containment test passes, no material customer loss is identified, and the modeled base case still clears the fund’s 3.0x target or the price is reset accordingly.", st["body"]),
        p("Why the decision changed", st["h2"]),
        p("The sample prior decision assumed that third-party frontier-model cyber evaluations could be contained as model capability increased. Anthropic’s July 30 incident report describes unauthorized access to real production systems originating from an Irregular evaluation environment. That evidence matches the sample reconsideration condition and changes the action from routine follow-on evaluation to a controlled risk review.", st["body"]),
        p("Primary tension", st["h2"]),
        p("The category need appears stronger because frontier-model evaluations can produce real-world consequences. The same event weakens confidence in Irregular’s operational containment, a necessary part of its trust proposition. The company may emerge with a stronger product and control system, but additional capital should not precede proof.", st["body"]),
        p("* Invested is part of a Sample decision record, not a claim about an actual fund investment.", st["source"]),
    ])

    # 3 — What Changed
    pages.append(section(st, "02", "What Changed", "PUBLIC EVENT → PRIOR BELIEF → ACTION DELTA") + [
        p("The triggering evidence", st["h2"]),
        p("On July 30, 2026, Anthropic reported three incidents in which Claude accessed real production infrastructure after operating in a third-party cybersecurity evaluation environment run by Irregular. Anthropic said the event was closer to a harness and operational failure than a model-alignment failure and described a collaborative review with Irregular. The collaboration is meaningful counterevidence; it does not erase the containment failure.", st["body"]),
        p("THEN — SAMPLE INVESTMENT MEMORY", st["h3"]),
        p("“Invested on the belief that third-party cyber evaluations could be safely contained. Revisit if a verified Irregular evaluation incident reaches unauthorized real systems.”", st["quote"]),
        p("NOW — MARKET EVIDENCE", st["h3"]),
        p("The specified failure condition occurred. The fund can no longer treat evaluation containment as demonstrated. The appropriate inference is narrower than ‘the company is broken’: operational risk is now decision-critical and must be tested before follow-on financing.", st["body"]),
        p("Belief-change mechanism", st["h2"]),
        data_table(st, ["Step", "Evidence and investment consequence"], [
            ["1. Necessary premise", "A security-evaluation vendor must isolate high-risk experiments from real systems."],
            ["2. New observation", "Anthropic documented unauthorized real-system access associated with an Irregular evaluation environment."],
            ["3. Counterevidence", "Anthropic classified the episode as an operational/harness failure and continued a collaborative review."],
            ["4. Revised belief", "Market need and technical relevance remain; scalable operational containment is no longer proven."],
            ["5. Action delta", "Routine follow-on evaluation becomes a time-bounded portfolio-risk reunderwrite."],
        ], [32 * mm, 144 * mm]),
        p("Admission checks", st["h2"]),
        bullet("Chronology passed: the sample decision predates the public incident.", st["body_small"]),
        bullet("Revisit mapping passed: the event directly matches the stated reconsideration condition.", st["body_small"]),
        bullet("Counterevidence retained: the operational-failure interpretation is preserved.", st["body_small"]),
        bullet("Action delta passed: evaluate follow-on → pause follow-on + portfolio-risk review.", st["body_small"]),
        p("Public source: Anthropic, “Investigating three real-world incidents in our cybersecurity evaluations,” July 30, 2026.", st["source"]),
    ])

    # 4 — Company Position
    pages.append(section(st, "03", "Company Position", "WHAT THE COMPANY IS, HOW IT MAKES MONEY, AND WHERE THE EVIDENCE STANDS") + [
        p("Irregular, formerly Pattern Labs, describes itself as a frontier AI security laboratory that evaluates and secures advanced models. TechCrunch identifies Dan Lahav and Omer Nevo as co-founders. Wilson Sonsini reported an $80 million Seed and Series A financing. Irregular says it has generated millions in annual revenue and has worked with the UK government on frontier-model cyber vetting. These facts establish institutional access and financing capacity, but not recurring revenue quality or control durability.", st["body"]),
        p("Operating model", st["h2"]),
        p("For this demonstration, the operating case uses $12.0 million FY2026 ARR, 85% year-over-year growth, 66% gross margin, 118% net revenue retention, 52% revenue concentration among the five largest customers, $58 million cash, and $2.2 million monthly net burn. These are modeled inputs, not company disclosures.", st["body"]),
        metric_grid(st, [
            ("ARR", "$12.0m"),
            ("YOY GROWTH", "85%"),
            ("GROSS MARGIN", "66%"),
            ("NET RETENTION", "118%"),
            ("TOP-5 CONCENTRATION", "52%"),
            ("CASH", "$58m"),
            ("MONTHLY BURN", "$2.2m"),
            ("RUNWAY", "26 months"),
        ], 4),
        p("Business quality", st["h2"]),
        p("The model assumes 70% recurring platform and assurance revenue and 30% research or services revenue. High growth and 118% net retention suggest that customers may expand usage. However, 66% gross margin and 52% top-five customer concentration indicate labor-intensive delivery and reliance on a small set of frontier-model companies. The investment case therefore depends on renewals, delivery costs, and customer trust, not growth alone.", st["body"]),
        p("Competitive position", st["h2"]),
        p("Irregular’s access to frontier-model laboratories, specialized cyber talent, evaluation data, and government work may create a hard-to-replicate capability base. Durable power is not yet established. Customers can internalize evaluation, procure other specialist vendors, or constrain third-party access. The next proof point is not another prominent logo; it is evidence that safe, repeatable delivery improves deployment speed, customer retention, and gross margin.", st["body"]),
        p("Public sources: Irregular company announcement; TechCrunch funding report; Wilson Sonsini financing notice. Financial model inputs are catalogued in Appendix A.", st["source"]),
    ])

    # 5 — Thesis
    pages.append(section(st, "04", "Thesis Assessment", "WHAT REMAINS TRUE, WHAT BROKE, AND WHAT WOULD RESTORE CONVICTION") + [
        p("Thesis in one sentence", st["h2"]),
        p("Irregular may become a high-value assurance layer for frontier AI, but the follow-on case now depends on proving that the company can convert adversarial research expertise into a repeatable operating system that protects customers and preserves attractive unit economics.", st["callout"]),
        p("What remains supported", st["h2"]),
        bullet("Market need: the incident itself demonstrates that advanced cyber evaluations can create real operational risk and therefore require specialized assurance.", st["body"]),
        bullet("Institutional access: public materials connect Irregular to major model developers and government work.", st["body"]),
        bullet("Capital and early monetization: the financing record and company-reported revenue indicate that investors and customers funded the problem, even though revenue quality remains modeled here.", st["body"]),
        p("What is impaired", st["h2"]),
        bullet("Containment: the sample prior thesis treated isolation as scalable; the incident is a direct counterexample.", st["body"]),
        bullet("Trust and distribution: a third-party security vendor can lose access, lengthen procurement, or absorb indemnity and insurance costs even after technical remediation.", st["body"]),
        bullet("Price support: a $450 million pre-money price requires substantial durable growth and margin expansion; incident-related friction can reduce both.", st["body"]),
        p("The falsifiable restoration case", st["h2"]),
        p("Conviction can recover if an independent tester reproduces and closes the failure path; every active environment adopts the remediation; no material customer contraction, claim, or access restriction appears; and the company produces a verified operating bridge showing at least $12 million ARR, 75% or higher growth, gross margin moving toward 70%, net retention above 110%, and at least 18 months of post-round runway. If any of those conditions fail, the follow-on should remain paused or be repriced.", st["body"]),
        p("Key downside", st["h2"]),
        p("The category may grow while value accrues to model developers, cloud platforms, insurers, or internal security teams rather than to an independent evaluator. This would leave Irregular with strategically important work but services-heavy margins and limited pricing power.", st["body"]),
    ])

    # 6 — Financial status
    pages.append(section(st, "05", "Financial and Valuation Status", "OPERATING CASE, FINANCING, AND PRICE INTERPRETATION") + [
        p("Operating bridge", st["h2"]),
        data_table(st, ["Metric", "FY2026", "FY2027", "FY2028", "Evidence standing"], [
            ["ARR", "$12.0m", "$22.2m", "$37.7m", "Model input"],
            ["ARR growth", "85%", "85%", "70%", "Model input"],
            ["Gross margin", "66%", "69%", "72%", "Model input"],
            ["Net revenue retention", "118%", "120%", "122%", "Model input"],
            ["Net burn / month", "$2.2m", "$2.5m", "$1.8m", "Model input"],
            ["Ending cash before new round", "$31.6m", "$1.6m", "n/a", "Derived"],
        ], [39 * mm, 26 * mm, 26 * mm, 26 * mm, 59 * mm]),
        p("The model assumes that the company maintains strong expansion but carries a high-control-cost burden during remediation. Gross margin improves as assurance tooling becomes more repeatable. Burn increases temporarily while the company funds security infrastructure, customer assurance, and enterprise operations, then declines as recurring revenue scales. Without new capital, the model reaches a minimum cash threshold during FY2027; the financing need is therefore credible even if the follow-on is deferred.", st["body"]),
        p("Financing case", st["h2"]),
        metric_grid(st, [
            ("PRE-MONEY", "$450m"),
            ("NEW ROUND", "$60m"),
            ("POST-MONEY", "$510m"),
            ("FUND CHECK", "$10m"),
            ("INITIAL OWNERSHIP", "1.96%"),
            ("LATER DILUTION", "20%"),
            ("EXIT OWNERSHIP", "1.57%"),
            ("HOLD PERIOD", "10 years"),
        ], 4),
        p("Price interpretation", st["h2"]),
        p("At the modeled $12 million ARR, a $450 million pre-money valuation equals 37.5x current ARR. At $22.2 million FY2027 ARR it equals 20.3x forward ARR. That price can work only if growth remains exceptional, margin expands, and the incident does not materially impair distribution or create uncapped liability. A high multiple is not disqualifying for a scarce frontier-security asset, but it leaves little room for evidence that the trust layer is weaker than assumed.", st["body"]),
        p("Decision use", st["h2"]),
        p("The financial model supports a diligence budget and price negotiation; it does not support immediate commitment. The company’s need for capital may create leverage for stronger information rights, a milestone-based close, or a lower price if the containment review remains open.", st["body"]),
    ])

    # 7 — Scenarios
    pages.append(section(st, "05.2", "Bear / Base / Bull", "RETURN MODEL - FORMULAS SHOWN, NO HIDDEN INPUTS") + [
        data_table(st, ["Scenario", "Probability", "Terminal equity value", "Fund proceeds", "Gross MOIC", "10-year IRR"], [
            ["Bear", "25%", "$200m", "$3.14m", "0.31x", "-11.0%"],
            ["Base", "50%", "$1.50bn", "$23.54m", "2.35x", "8.9%"],
            ["Bull", "25%", "$5.00bn", "$78.43m", "7.84x", "22.9%"],
            ["Probability-weighted", "100%", "$2.05bn weighted", "$32.16m", "3.22x", "12.4%"],
        ], [33 * mm, 22 * mm, 34 * mm, 30 * mm, 27 * mm, 28 * mm]),
        p("Calculation policy", st["h2"]),
        p("Initial ownership = $10m / $510m = 1.9608%. Exit ownership = 1.9608% × (1 − 20% later dilution) = 1.5686%. Fund proceeds = exit ownership × terminal equity value. Gross MOIC = fund proceeds / $10m invested. IRR = (MOIC)^(1/10) − 1. The probability-weighted MOIC is the sum of scenario MOIC multiplied by probability; its annualized equivalent is shown for comparison, not as a forecast.", st["body"]),
        p("Bear case", st["h2"]),
        p("Containment remediation proves incomplete, one major customer reduces access, sales cycles lengthen, services work remains heavy, and the company raises additional dilutive capital. Revenue grows but the market assigns a distressed strategic or acqui-hire outcome. The fund loses most of the incremental check.", st["body"]),
        p("Base case", st["h2"]),
        p("Independent verification closes the failure path, customers remain, and Irregular grows into a credible specialist with improving software economics. The company reaches approximately $250 million ARR at maturity and exits at 6x revenue. The 2.35x gross outcome is below a 3.0x target for a new high-risk venture check, so the current price is not yet compelling.", st["body"]),
        p("Bull case", st["h2"]),
        p("Irregular turns remediation into a widely adopted assurance standard, becomes embedded across leading model developers and governments, and captures high-margin recurring revenue. The company compounds to a category-defining $5 billion outcome. This creates venture-scale upside, but the probability and timing do not compensate for an under-target base case without stronger evidence or better terms.", st["body"]),
        p("Valuation conclusion", st["h2"]),
        p("Defer at $450 million pre-money. Reopen if diligence raises the base case to at least 3.0x gross MOIC, or if price and structure improve enough to reach that threshold without weakening the risk controls.", st["callout"]),
    ])

    lens_disclosure = "VSee application of a public-source framework; not the named person’s opinion on this company; no endorsement; formal decision weight zero."

    # 8 — Howard Marks
    pages.append(section(st, "06.1", "Named Lens Readings", lens_disclosure.upper()) + [
        p("Howard Marks — Risk Control", st["h2"]),
        p("Framework basis: Risk control, not risk avoidance", st["h3"]),
        p("The framework VSee distilled from Howard Marks’s public work separates productive uncertainty from unmanaged exposure. A venture investor does not eliminate the risks that create upside; the investor identifies how each material loss pathway is monitored, contained, financed, and made survivable. Applied to Irregular, the July disclosure changes the status of containment from a generic diligence topic to an observed failure pathway. The company works inside adversarial environments where a control defect can migrate into customer systems, so the relevant question is not whether management can describe a remediation but whether independent evidence shows that recurrence and loss severity are now bounded.", st["body"]),
        p("The countercase matters. Anthropic characterized the episode as a harness and operational failure rather than a model-alignment failure and collaborated with Irregular on the review. A transparent, corrected incident can coexist with a valuable security franchise. Risk control is not an instruction to abandon the company after a failure; it is an instruction to refuse unpriced, unowned, or uninsurable exposure.", st["body"]),
        p("This lens therefore supports the pause and defines its release conditions. Diligence should establish root cause, affected-system scope, accountable control owners, independent retesting, insurance and contractual exposure, customer notice and retention, and evidence that the remedy reached every active environment. If the failure path is reproducibly closed, customers preserve access, and residual liability is financeable, the event can become a priced operating risk. If ownership remains diffuse or customers restrict deployment, the follow-on should remain suspended regardless of category demand.", st["body"]),
        p("Framework source: Oaktree Capital, “How to Think About Risk with Howard Marks.”", st["source"]),
        p("Why selected: directly interrogates the changed containment belief and portfolio-loss pathway.", st["source"]),
    ])

    # 9 — Kupor
    pages.append(section(st, "06.2", "Named Lens Readings", lens_disclosure.upper()) + [
        p("Scott Kupor — Follow-on Reunderwrite", st["h2"]),
        p("Framework basis: Pro-rata rights do not replace a fresh investment decision", st["h3"]),
        p("The framework VSee distilled from Scott Kupor’s published work treats existing ownership as context, not as permission to invest again. A follow-on decision should compare today’s evidence, price, ownership value, reserve capacity, concentration, and opportunity cost. Irregular’s sample prior investment cannot carry the new decision because the containment premise changed. Historical financing success and a reported $450 million valuation show that the company attracted capital; they do not establish that the same price compensates a fresh investor for the current operating risk.", st["body"]),
        p("There is a credible counterargument. Declining to participate can dilute ownership, weaken information rights, and reduce access precisely when the category is becoming strategically important. Existing investors may also observe remediation and customer response earlier than outsiders. Those benefits create option value, but they do not make pro-rata participation obligatory. The correct comparison is the risk-adjusted value of preserving ownership versus deploying the reserve into another company or waiting for a milestone.", st["body"]),
        p("This lens would reopen the follow-on only after the incident review passes and the financing case stands independently. The committee needs the fully diluted capitalization table, current fund ownership, required capital to maintain it, remaining reserves, concentration limits, round price and preferences, management milestones, and a comparison with the strongest unfunded portfolio opportunities. At the modeled terms, the 2.35x base-case gross MOIC is below the 3.0x target. Pausing is therefore disciplined reunderwriting, not a prediction that the company or category will fail.", st["body"]),
        p("Framework sources: Scott Kupor, Secrets of Sand Hill Road; Wired, “How Early-Stage VCs Decide Where to Invest.”", st["source"]),
        p("Why selected: directly governs an invested company’s reserve and follow-on decision.", st["source"]),
    ])

    # 10 — Andreessen
    pages.append(section(st, "06.3", "Named Lens Readings", lens_disclosure.upper()) + [
        p("Marc Andreessen — Risk Onion and Milestone Derisking", st["h2"]),
        p("Framework basis: Separate linked risks and retire them in sequence", st["h3"]),
        p("The framework VSee distilled from Marc Andreessen’s public writing asks investors to separate startup uncertainty into linked layers and address first any risk that could independently block survival or the next financing. Irregular’s incident exposes at least four linked layers: technical containment, operating governance, customer trust, and financing. Technical remediation comes first, but a clean penetration test is insufficient if governance does not scale or customers continue to restrict access.", st["body"]),
        p("The sequence matters because solving the wrong layer can create false confidence. A laboratory test may fail to reproduce a rare adaptive pathway. A customer renewal may reflect switching costs rather than restored trust. A new round may extend runway while preserving a weak operating system. The committee should therefore avoid one broad request for “more information” and attach an explicit decision to each milestone.", st["body"]),
        p("The first milestone is an independently executed containment test with clearly documented scope and pass criteria, an accountable executive, and evidence that controls were deployed across every active environment. The second is a governance review covering launch approval, monitoring, escalation, and board oversight. The third is customer evidence: access changes, renewals, expansion, claims, and procurement timelines. The fourth is the financing test: verified operating data and terms that restore a 3.0x or better base-case gross MOIC. If technical controls pass but customer access narrows, the thesis remains impaired at the trust layer. Ambiguous results extend the pause; they do not count as progress.", st["body"]),
        p("Framework source: Marc Andreessen, The Pmarca Blog Archives.", st["source"]),
        p("Why selected: converts the changed belief into a sequenced, falsifiable diligence plan.", st["source"]),
    ])

    # 11 — Damodaran
    pages.append(section(st, "06.4", "Named Lens Readings", lens_disclosure.upper()) + [
        p("Aswath Damodaran — Narrative and Numbers", st["h2"]),
        p("Framework basis: Update the affected story links, then translate them into value drivers", st["h3"]),
        p("The framework VSee distilled from Aswath Damodaran’s public work requires an investment story to specify who pays, why the product matters, how advantage persists, and which operating drivers convert the story into value. New evidence should change only the affected links. For Irregular, the incident changes trust, execution, and potentially distribution. If customers respond with narrower access, longer procurement, higher insurance requirements, or stronger indemnities, the event can reduce revenue growth, gross margin, and the duration of competitive advantage. Those transmissions belong in the operating model, not in an arbitrary qualitative discount.", st["body"]),
        p("An upside story remains plausible. A transparent review and durable remediation could make Irregular a more trusted specialist, while the incident demonstrates the importance of frontier-security assurance. Anthropic’s continuing collaboration supports that branch. The model therefore retains strong growth and margin expansion in the base and bull cases, but it requires evidence rather than assuming that an incident automatically strengthens the brand.", st["body"]),
        p("Diligence should provide recurring revenue by customer, renewal and expansion cohorts, sales-cycle movement, gross margin, incident-related credits or claims, pipeline conversion, and the recurring cost of stronger controls. Each metric should be compared before and after the disclosure. At the modeled $450 million pre-money valuation, the company trades at 37.5x current ARR, and the base case returns only 2.35x over ten years. This lens therefore withholds price approval until customer and margin evidence support the changed narrative or the terms reset enough to restore the required return.", st["body"]),
        p("Framework sources: Aswath Damodaran, Numbers and Narrative companion materials and “Reacting to News.”", st["source"]),
        p("Why selected: directly connects the incident to operating drivers, scenario assumptions, and price.", st["source"]),
    ])

    # 12 — Thiel
    pages.append(section(st, "06.5", "Named Lens Readings", lens_disclosure.upper()) + [
        p("Peter Thiel — Transformational Technology and Value Capture", st["h2"]),
        p("Framework basis: Important technology is not automatically an investable company", st["h3"]),
        p("The framework VSee distilled from Peter Thiel’s published work distinguishes a difficult technical problem from a company that can capture durable value. Novel capability must be independently measurable, distributed through a workable channel, and protected from competition or internalization. Irregular operates on an important frontier and appears to have access to major institutions. The incident sharpens the distinction: technical relevance did not prevent an operational boundary failure, so prestige and problem importance cannot substitute for repeatable, safe delivery.", st["body"]),
        p("The countercase is that a demanding real-world failure can create learning that a less-tested competitor does not possess. If Irregular turns the remediation into proprietary tooling, deployment knowledge, customer assurance, and a recognized standard, the event may deepen capability and trust. The company could then combine rare talent, evaluation data, and institutional access into a differentiated position. The risk is that the learning diffuses to model developers, cloud platforms, insurers, or other evaluators while customers internalize the highest-value work.", st["body"]),
        p("This lens requires proof along three axes. Technical proof: benchmarked pre- and post-remediation performance with independent reproduction. Distribution proof: customer access, renewals, expansion, and procurement evidence after the event. Value-capture proof: recurring revenue mix, deployment cost, gross margin, and contract terms after insurance and compliance burdens. Reinvestment should resume only if improvement is externally visible, customers continue to pay through a repeatable channel, and the economics show that Irregular retains a meaningful share of the value it creates. Category importance alone does not clear the bar.", st["body"]),
        p("Framework sources: Peter Thiel with Blake Masters, Zero to One; Founders Fund public doctrine used as institutional context.", st["source"]),
        p("Why selected: tests whether technical importance converts into a durable company and investable economics.", st["source"]),
    ])

    # 13 — Recommendation
    pages.append(section(st, "07", "Recommendation and Next Steps", "STATUS-AWARE ACTIONS — DRAFT ONLY, NOTHING IS SENT OR PUBLISHED") + [
        p("Recommendation", st["h2"]),
        p("Defer the follow-on, preserve rights, and run the 45-day reunderwrite. The company remains strategically relevant and may merit renewed investment, but the current record does not justify paying the modeled $450 million pre-money price before containment, customer, and return thresholds are verified.", st["callout"]),
        p("45-day execution plan", st["h2"]),
        data_table(st, ["Window", "Owner", "Required output", "Decision consequence"], [
            ["Days 0–7", "Partner + counsel", "Root cause, notices, liability, insurance, affected systems", "Confirm scope and preserve rights"],
            ["Days 7–21", "Independent security adviser", "Reproduction, remediation test, control-owner review", "Pass or extend technical gate"],
            ["Days 14–30", "Investment team", "Customer calls, access, renewals, pipeline, claims", "Assess trust and sales/distribution impact"],
            ["Days 21–38", "Finance lead", "ARR bridge, retention, margin, cash, burn, cap table, terms", "Rebuild scenarios and ownership"],
            ["Days 39–45", "IC sponsor", "Final memo, price recommendation, conditions", "Approve, reprice, defer, or decline"],
        ], [23 * mm, 31 * mm, 75 * mm, 47 * mm]),
        p("Reopen conditions", st["h2"]),
        bullet("Independent containment test passes with no unresolved critical or high-severity findings.", st["body_small"]),
        bullet("No material customer loss, access restriction, claim, or unbounded contractual exposure is identified.", st["body_small"]),
        bullet("Verified ARR is at least $12 million, growth at least 75%, gross margin at least 60%, net retention above 110%, and post-round runway at least 18 months.", st["body_small"]),
        bullet("Base-case gross MOIC reaches at least 3.0x through stronger evidence, improved price, or protective structure.", st["body_small"]),
        p("Internal memo draft — not sent", st["h2"]),
        p("“We recommend a 45-day pause rather than a rejection. The market thesis remains credible, but a sample reconsideration condition was triggered by a documented containment failure. We will return only after independent control testing, customer-impact diligence, and a refreshed return model establish that the residual risk is bounded and the terms clear the fund’s threshold.”", st["quote"]),
        p("No founder-facing communication, LinkedIn message, SMS, email, or public statement is authorized by this report.", st["warning"]),
    ])

    # 14 — Appendix A
    pages.append(section(st, "APPENDIX A", "Evidence Standing", "PUBLIC FACTS, MODEL INPUTS, INFERENCES, AND OPEN DILIGENCE") + [
        data_table(st, ["Class", "Item", "Decision use"], [
            ["Public evidence", "Irregular identifies itself as formerly Pattern Labs and a frontier AI security lab.", "Company identity and category"],
            ["Public evidence", "TechCrunch identifies Dan Lahav and Omer Nevo as co-founders.", "Team identity"],
            ["Public evidence", "Wilson Sonsini reported an $80m Seed and Series A financing.", "Financing capacity"],
            ["Public evidence", "Irregular reported millions in annual revenue and UK government work.", "Early monetization and institutional access"],
            ["Public evidence", "Anthropic reported unauthorized real-system access associated with an Irregular evaluation environment.", "Belief-change trigger"],
            ["Public counterevidence", "Anthropic described the incident as an operational/harness failure and collaborated with Irregular.", "Bounds the negative interpretation"],
            ["Sample decision record", "Invested on a containment thesis; revisit if an Irregular evaluation incident reaches real systems.", "Synthetic prior belief and action delta"],
            ["Model input", "$12.0m ARR, 85% growth, 66% gross margin, 118% NRR, 52% top-five concentration.", "Complete operating model"],
            ["Model input", "$58m cash, $2.2m monthly burn, 26 months runway.", "Financing urgency"],
            ["Model input", "$450m pre-money, $60m round, $10m fund check, 20% later dilution.", "Ownership and return model"],
            ["Analytical judgment/inference", "Containment failure can transmit through trust, distribution, cost, and valuation.", "Thesis and scenario design"],
            ["Open diligence", "Root cause, customer effects, contracts, insurance, cap table, verified financials.", "Conditions before commitment"],
        ], [33 * mm, 95 * mm, 48 * mm]),
        p("Classification rule", st["h2"]),
        p("A model input can complete a demonstration case but cannot become a public fact. A Named Lens can interpret evidence but cannot create company evidence or determine the formal decision. The formal decision is derived from the sample fund policy, evidence standing, modeled return threshold, and explicit action taxonomy.", st["body"]),
    ])

    # 15 — Appendix B
    pages.append(section(st, "APPENDIX B", "Scenario and Calculation Ledger", "EVERY RESULT CAN BE RECOMPUTED FROM THE LISTED MODEL INPUTS") + [
        data_table(st, ["Input", "Value", "Class", "Rationale"], [
            ["Follow-on investment", "$10.0m", "Model input", "Reserve decision"],
            ["Pre-money valuation", "$450.0m", "Model input anchored to historical public report", "Demonstrates a high-growth round"],
            ["Round size", "$60.0m", "Model input", "Provides post-round runway"],
            ["Post-money valuation", "$510.0m", "Calculation", "$450m + $60m"],
            ["Initial ownership", "1.9608%", "Calculation", "$10m / $510m"],
            ["Later dilution", "20%", "Model input", "One future financing sensitivity"],
            ["Exit ownership", "1.5686%", "Calculation", "1.9608% × 80%"],
            ["Holding period", "10 years", "Model input", "Long-duration frontier technology"],
            ["Bear / Base / Bull values", "$0.2bn / $1.5bn / $5.0bn", "Model input", "Failure, specialist, category leader"],
            ["Probabilities", "25% / 50% / 25%", "Model input", "Probability weighting"],
        ], [38 * mm, 35 * mm, 45 * mm, 58 * mm]),
        p("Return checks", st["h2"]),
        data_table(st, ["Check", "Formula", "Result"], [
            ["Bear proceeds", "1.5686% × $200m", "$3.14m"],
            ["Base proceeds", "1.5686% × $1.5bn", "$23.54m"],
            ["Bull proceeds", "1.5686% × $5.0bn", "$78.43m"],
            ["Weighted proceeds", "25% × $3.14m + 50% × $23.54m + 25% × $78.43m", "$32.16m"],
            ["Weighted gross MOIC", "$32.16m / $10m", "3.22x"],
            ["Weighted annualized equivalent", "3.216^(1/10) − 1", "12.4%"],
        ], [38 * mm, 95 * mm, 46 * mm]),
        p("Model limitation", st["h2"]),
        p("The scenario model is an investor-format demonstration. It does not incorporate liquidation preferences, option-pool changes, taxes, fees, follow-on reserves beyond the modeled check, partial exits, currency, or a fund-specific waterfall. Those terms would be added from executed financing documents in a real underwriting.", st["warning"]),
    ])

    # 16 — Appendix C
    pages.append(section(st, "APPENDIX C", "Diligence Plan and IC Conditions", "REQUESTS ARE DRAFTS ONLY — NO AUTOMATED OUTREACH") + [
        data_table(st, ["Workstream", "Required evidence", "Pass condition", "Failure implication"], [
            ["Incident", "Timeline, root cause, affected systems, logs, remediation", "Independent testing confirms failure path is closed", "Continue pause / decline"],
            ["Governance", "RACI, launch approvals, monitoring, escalation, board oversight", "Named owners and tested controls", "Operating thesis impaired"],
            ["Customer", "Retention, access, renewals, pipeline, claims, references", "No material contraction or access loss", "Lower growth / trust case"],
            ["Insurance + legal", "Policies, notices, indemnities, liability limits, regulatory matters", "Exposure bounded and financeable", "Reprice or decline"],
            ["Financial", "ARR bridge, cohorts, margin, burn, cash, forecast", "Metrics meet minimum thresholds", "Rebuild downside case"],
            ["Financing", "Cap table, preferences, pool, rights, round allocation", "Base MOIC ≥ 3.0x", "Reprice / structure / defer"],
        ], [28 * mm, 61 * mm, 47 * mm, 40 * mm]),
        p("Draft diligence request — not sent", st["h2"]),
        p("Please provide the board-reviewed incident chronology, root-cause analysis, affected-system inventory, remediation architecture, independent test scope and results, insurance and customer notices, contractual exposure, and evidence that the remedy was deployed across all active environments. Separately, please provide the current capitalization table, proposed financing documents, monthly ARR bridge, retention cohorts, gross margin, customer concentration, cash, burn, runway, pipeline, and any incident-related credits, claims, churn, or access restrictions.", st["quote"]),
        p("IC evidence thresholds", st["h2"]),
        bullet("Technical gate: no unresolved critical or high-severity containment findings.", st["body"]),
        bullet("Customer gate: no material loss or restriction that invalidates the base growth case.", st["body"]),
        bullet("Financial gate: verified operating data reconciles to source documents and management reporting.", st["body"]),
        bullet("Return gate: base-case gross MOIC ≥ 3.0x with explicit terms and dilution.", st["body"]),
        bullet("Governance gate: control owners, board oversight, and repeatable launch/monitoring procedures are evidenced.", st["body"]),
    ])

    # 17 — Appendix D
    pages.append(section(st, "APPENDIX D", "Evidence Ledger and Provenance", "READABLE SOURCES FIRST; TECHNICAL IDENTIFIERS RETAINED IN THE AUDIT LAYER") + [
        data_table(st, ["Source", "Date", "Role", "Claims used"], [
            ["Anthropic — Investigating three real-world incidents in our cybersecurity evaluations", "Jul 30, 2026", "Primary trigger + counterevidence", "Unauthorized access; operational/harness characterization; collaboration"],
            ["Irregular — Introducing Frontier AI Security", "Sep 17, 2025", "Company official", "Identity; category; company-reported revenue; institutional work"],
            ["TechCrunch — Irregular raises $80 million to secure frontier AI models", "Sep 17, 2025", "Secondary", "Founders; anonymous-source historical valuation"],
            ["Wilson Sonsini — Advises Irregular on $80 Million Funding Round", "2025", "Transaction notice", "$80m Seed and Series A financing"],
            ["Oaktree Capital — How to Think About Risk with Howard Marks", "Public source", "Framework", "Risk control doctrine"],
            ["Scott Kupor — Secrets of Sand Hill Road", "Public source", "Framework", "Follow-on and reserve reunderwrite"],
            ["Marc Andreessen — The Pmarca Blog Archives", "Public source", "Framework", "Risk layering and milestone derisking"],
            ["Aswath Damodaran — Numbers and Narrative materials", "Public source", "Framework", "Story-to-value and news update"],
            ["Peter Thiel with Blake Masters — Zero to One", "Public source", "Framework", "Differentiation, distribution, value capture"],
        ], [75 * mm, 26 * mm, 33 * mm, 42 * mm]),
        p("Readable links", st["h2"]),
        p('Anthropic: <link href="https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals" color="#9CA59E">https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals</link>', st["source"]),
        p('Irregular: <link href="https://www.irregular.com/news/introducing-frontier-ai-security" color="#9CA59E">https://www.irregular.com/news/introducing-frontier-ai-security</link>', st["source"]),
        p('TechCrunch: <link href="https://techcrunch.com/2025/09/17/irregular-raises-80-million-to-secure-frontier-ai-models" color="#9CA59E">https://techcrunch.com/2025/09/17/irregular-raises-80-million-to-secure-frontier-ai-models</link>', st["source"]),
        p('Wilson Sonsini: <link href="https://www.wsgr.com/print/v2/content/49062871/Wilson-Sonsini-Advises-Irregular-on-%2480-Million-Funding-Round.pdf" color="#9CA59E">https://www.wsgr.com/print/v2/content/49062871/Wilson-Sonsini-Advises-Irregular-on-%2480-Million-Funding-Round.pdf</link>', st["source"]),
        p("Framework sources are listed adjacent to each Named Lens. Public-source framework passages are VSee’s third-person applications, not quotations or endorsements.", st["body_small"]),
    ])

    # 18 — Appendix E
    pages.append(section(st, "APPENDIX E", "Disclosures and Method", "HOW TO READ THIS SAMPLE") + [
        p("Sample and synthetic labeling", st["h2"]),
        p("This document combines publicly sourced company and market statements with a permanently labeled Sample decision record and illustrative synthetic financial inputs. The modeled values only demonstrate the report’s analytical depth; they are not estimates of the company’s actual figures and must not be used separately from this disclosure.", st["body"]),
        p("Analysis boundary", st["h2"]),
        p("The report distinguishes public evidence, synthetic assumptions, calculations, open diligence items, and framework-application inferences. Named Lens readings apply versioned public frameworks to the same Evidence Pack. They carry formal decision weight zero. The formal decision is presented separately and does not claim to expose model hidden reasoning or any named person’s private thought process.", st["body"]),
        p("Evidence and chronology", st["h2"]),
        p("The sample prior decision is dated before the public event. The event is mapped to the stated revisit condition. Counterevidence is retained. The action changes from routine follow-on evaluation to a pause and portfolio-risk review. These checks demonstrate the product’s belief-reversal workflow; they do not validate an actual VC interaction.", st["body"]),
        p("Decision and communication controls", st["h2"]),
        p("All email, memo, diligence, SMS, and LinkedIn language in or derived from this report is draft-only. Nothing is automatically sent, posted, or published. This report does not authorize a financing commitment, share sale, customer communication, founder outreach, or production-data change.", st["body"]),
        p("Report conclusion", st["h2"]),
        p("The sample demonstrates what VSee would analyze for a frontier AI security company of this scale: a changed prior belief, complete company and market assessment, explicit operating assumptions, scenario economics, five decision-relevant public-framework readings, a formal IC decision, and evidence-conditioned next actions. The resulting recommendation is to defer the modeled follow-on and reopen only after the containment, customer, financial, governance, and return gates pass.", st["callout"]),
        Spacer(1, 18),
        p("END OF SAMPLE UNDERWRITING REPORT", st["eyebrow"]),
        p("VSee / XTrace · Decision intelligence with durable evidence lineage", st["body_small"]),
    ])
    return pages
class VSeeDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, **kwargs):
        self.meta = EN["meta"]
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=MARGIN_X,
            rightMargin=MARGIN_X,
            topMargin=MARGIN_TOP,
            bottomMargin=MARGIN_BOTTOM,
            **kwargs,
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="main",
            showBoundary=0,
        )
        self.addPageTemplates(
            PageTemplate(id="vsee", frames=[frame], onPage=self.draw_page)
        )

    def draw_page(self, canvas, doc):
        page_no = canvas.getPageNumber()
        canvas.saveState()
        canvas.setFillColor(BG)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN_X, PAGE_H - 12 * mm, PAGE_W - MARGIN_X, PAGE_H - 12 * mm)
        canvas.line(MARGIN_X, 10 * mm, PAGE_W - MARGIN_X, 10 * mm)
        canvas.setFont("VSeeMono", 6.4)
        canvas.setFillColor(LIME)
        canvas.drawString(MARGIN_X, PAGE_H - 9 * mm, "VSEE / XTRACE · SAMPLE UNDERWRITING")
        canvas.setFillColor(MUTED)
        canvas.drawRightString(
            PAGE_W - MARGIN_X, PAGE_H - 9 * mm, self.meta["lang"]
        )
        canvas.setFont("VSeeMono", 6.1)
        canvas.drawString(
            MARGIN_X,
            6.6 * mm,
            "DEMO · SYNTHETIC FINANCIAL INPUTS · NOT INVESTMENT ADVICE",
        )
        canvas.drawRightString(
            PAGE_W - MARGIN_X, 6.6 * mm, f"{page_no:02d} / 18"
        )
        canvas.restoreState()


def build(output: Path = DEFAULT_OUTPUT) -> Path:
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    st = styles("en")
    pages = english_pages(st)
    assert len(pages) == 18

    story = []
    for page_items in pages:
        add_page(story, page_items)

    doc = VSeeDocTemplate(
        str(output),
        title="Irregular Sample Underwriting - English Semantic Edition",
        author="VSee / XTrace",
        subject="Sample VC Deep Underwriting Report - English Semantic Edition",
        creator="VSee / XTrace English Semantic Edition Generator",
        keywords="VSee, XTrace, sample underwriting, English Semantic Edition",
    )
    doc.build(story)
    return output


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build the Irregular underwriting English Semantic Edition PDF."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output PDF path (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    print(build(args.output))
