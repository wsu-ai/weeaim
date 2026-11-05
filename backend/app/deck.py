"""The downloadable venture presentation deck (.pptx).

Built deterministically from what the wizard has saved -- every stage's
ai_analysis and answers, plus the Stage 9 product image -- with no AI call.
All AI- and founder-written text is inserted as plain text runs (python-pptx
escapes it); figures are the ones app code already computed.
"""

import io
import re
import unicodedata
from datetime import date

from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

from app.wizard.translation import cached_translation

NAVY = RGBColor(0x1E, 0x3A, 0x8A)
INK = RGBColor(0x0B, 0x0B, 0x0B)
MUTED = RGBColor(0x52, 0x51, 0x4E)
GRID = RGBColor(0xE7, 0xE5, 0xE4)
SERIES = (RGBColor(0x2A, 0x78, 0xD6), RGBColor(0xEB, 0x68, 0x34), RGBColor(0x1B, 0xAF, 0x7A))
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
SLIDE_W, SLIDE_H = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.6)

LABELS = {
    "en": {
        "prepared": "Prepared with WEEAIM · {date}",
        "problem": "The problem",
        "solution": "Solution: the MVP",
        "customers": "Target customers",
        "market": "Market size",
        "competition": "Competition and positioning",
        "business_model": "Business model",
        "validation": "Assessment and validation",
        "financials": "Financial projection (36 months)",
        "marketing_message": "Marketing: who we target and what we say",
        "marketing_channels": "Marketing: channels and budget",
        "launch": "Launch plan and funnel targets",
        "next_steps": "Next steps",
        "missing": "Not completed yet — finish Stage {number} in WEEAIM.",
        "who": "Who has it",
        "evidence": "Evidence",
        "how_often": "How often / how severe",
        "core_features": "Core features",
        "segment": "Primary segment",
        "traits": "Characteristics",
        "trigger": "Buying trigger",
        "personas": "Personas",
        "scope": "Market",
        "positioning": "Positioning",
        "competitor": "Competitor",
        "their_position": "How they win",
        "our_advantage": "Where we win",
        "our_gap": "Where we're weaker",
        "pricing": "Pricing",
        "unit_economics": "Unit economics (per customer)",
        "contribution": "Monthly contribution",
        "ltv": "Lifetime value",
        "ltv_cac": "LTV : CAC",
        "payback": "CAC payback",
        "months": "{value} months",
        "never": "never",
        "scores": "Desirability {d}% · Feasibility {f}% · Viability {v}% · Overall {o}% — {verdict}",
        "verdicts": {"proceed": "ready to proceed", "strengthen": "strengthen weak areas", "rethink": "rethink"},
        "experiment": "Experiment",
        "pass_bar": "Pass bar",
        "outcome": "Outcome",
        "outcomes": {"passed": "Passed", "failed": "Failed", "inconclusive": "Inconclusive", "not_run": "Not run"},
        "signals": {
            "not_started": "No results yet",
            "keep_testing": "Keep testing",
            "proceed": "Evidence says proceed",
            "stop_or_pivot": "Stop or pivot",
        },
        "at_least": "≥", "at_most": "≤",
        "runway": "Runway", "beyond": "beyond 36 months",
        "burn": "Burn (avg. months 1-6)",
        "break_even": "Break-even month",
        "irr": "IRR (annual)", "npv": "NPV", "funding": "Funding needed",
        "none": "n/a",
        "year": "Year {n}", "revenue": "Revenue", "costs": "Total costs", "ebitda": "EBITDA", "cash": "Cash (end)",
        "messages": "Key messages", "counters": "vs. {alt}", "differentiators": "Differentiators",
        "channel": "Channel", "type": "Type", "budget": "Monthly budget", "kpi": "KPI target",
        "total_budget": "Total: {amount} / month (calculated)",
        "over_projection": "Above the financial projection's marketing costs by {amount} / month.",
        "funnel": "Funnel targets by month {month}",
        "funnel_steps": {"awareness": "Awareness", "leads": "Leads", "trials": "Trials", "paying": "Paying"},
        "conversion": "{rate} from awareness to paying (calculated)",
        "weeks": "Weeks {start}-{end}",
        "open_actions": "Open actions",
        "missing_stages": "Stages still to complete",
        "all_done": "All stages have content.",
    },
    "ko": {
        "prepared": "WEEAIM으로 작성 · {date}",
        "problem": "해결할 문제",
        "solution": "솔루션: MVP",
        "customers": "목표 고객",
        "market": "시장 규모",
        "competition": "경쟁과 포지셔닝",
        "business_model": "비즈니스 모델",
        "validation": "평가와 검증",
        "financials": "재무 전망 (36개월)",
        "marketing_message": "마케팅: 대상과 메시지",
        "marketing_channels": "마케팅: 채널과 예산",
        "launch": "출시 계획과 퍼널 목표",
        "next_steps": "다음 단계",
        "missing": "아직 완료되지 않았습니다 — WEEAIM에서 {number}단계를 완료하세요.",
        "who": "누가 겪나",
        "evidence": "근거",
        "how_often": "빈도·심각성",
        "core_features": "핵심 기능",
        "segment": "주요 고객층",
        "traits": "특성",
        "trigger": "구매 계기",
        "personas": "페르소나",
        "scope": "시장",
        "positioning": "포지셔닝",
        "competitor": "경쟁자",
        "their_position": "현재 강점",
        "our_advantage": "우리가 이기는 점",
        "our_gap": "우리가 약한 점",
        "pricing": "가격",
        "unit_economics": "단위 경제성 (고객 1인당)",
        "contribution": "월 공헌이익",
        "ltv": "고객 생애 가치",
        "ltv_cac": "LTV : CAC",
        "payback": "CAC 회수 기간",
        "months": "{value}개월",
        "never": "회수 불가",
        "scores": "바람직성 {d}% · 실현 가능성 {f}% · 사업성 {v}% · 종합 {o}% — {verdict}",
        "verdicts": {"proceed": "진행 가능", "strengthen": "약한 영역 보강", "rethink": "재검토"},
        "experiment": "실험",
        "pass_bar": "통과 기준",
        "outcome": "결과",
        "outcomes": {"passed": "통과", "failed": "실패", "inconclusive": "판단 보류", "not_run": "미실행"},
        "signals": {
            "not_started": "아직 결과 없음",
            "keep_testing": "계속 검증",
            "proceed": "진행해도 좋다는 근거",
            "stop_or_pivot": "중단 또는 방향 전환",
        },
        "at_least": "≥", "at_most": "≤",
        "runway": "런웨이", "beyond": "36개월 이상",
        "burn": "번 레이트 (1-6개월 평균)",
        "break_even": "손익분기 월",
        "irr": "IRR (연)", "npv": "NPV", "funding": "필요 자금",
        "none": "해당 없음",
        "year": "{n}년 차", "revenue": "매출", "costs": "총비용", "ebitda": "EBITDA", "cash": "현금 (연말)",
        "messages": "핵심 메시지", "counters": "대상: {alt}", "differentiators": "차별점",
        "channel": "채널", "type": "유형", "budget": "월 예산", "kpi": "KPI 목표",
        "total_budget": "합계: 월 {amount} (계산값)",
        "over_projection": "재무 전망의 마케팅 비용보다 월 {amount} 많습니다.",
        "funnel": "{month}개월 차 퍼널 목표",
        "funnel_steps": {"awareness": "인지", "leads": "리드", "trials": "체험", "paying": "유료"},
        "conversion": "인지 대비 유료 전환 {rate} (계산값)",
        "weeks": "{start}-{end}주",
        "open_actions": "남은 실행 항목",
        "missing_stages": "아직 완료할 단계",
        "all_done": "모든 단계에 내용이 있습니다.",
    },
}

DECK_STAGE_SLUGS = (
    "idea_discovery", "problem_definition", "customer_definition", "existing_alternatives",
    "value_proposition", "market_evidence", "persona_validation", "competitive_position", "dfv_assessment", "mvp",
    "business_model", "validation_plan", "financial_analysis", "marketing_plan",
)


def deck_filename(title: str) -> str:
    """A safe ASCII filename from the venture title."""
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_title).strip("-").lower()[:60]
    return f"{slug or 'venture'}-deck.pptx"


def _clip(text: object, limit: int) -> str:
    value = " ".join(str(text or "").split())
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def _num(value: object, places: int = 0) -> str:
    try:
        return f"{float(value):,.{places}f}"
    except (TypeError, ValueError):
        return "—"


def _money(value: object, currency: str) -> str:
    return f"{currency} {_num(value)}".strip()


def _pct(value: object) -> str:
    try:
        return f"{float(value) * 100:.1f}%"
    except (TypeError, ValueError):
        return "—"


class DeckBuilder:
    def __init__(self, language: str):
        self.language = language if language in LABELS else "en"
        self.t = LABELS[self.language]
        self.font = "Malgun Gothic" if self.language == "ko" else "Calibri"
        self.prs = Presentation()
        self.prs.slide_width, self.prs.slide_height = SLIDE_W, SLIDE_H
        self.blank = self.prs.slide_layouts[6]
        self.page = 0
        self.footer_text = ""

    # --- primitives ------------------------------------------------------------

    def _style(self, run, size: int, bold: bool = False, color: RGBColor = INK) -> None:
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = self.font
        # East Asian text (Korean) needs its own typeface attribute.
        r_pr = run._r.get_or_add_rPr()
        for tag in ("a:ea", "a:cs"):
            element = r_pr.find(qn(tag))
            if element is None:
                element = r_pr.makeelement(qn(tag), {})
                r_pr.append(element)
            element.set("typeface", self.font)

    def slide(self, title: str):
        slide = self.prs.slides.add_slide(self.blank)
        self.page += 1
        band = slide.shapes.add_shape(1, 0, 0, SLIDE_W, Inches(1.0))
        band.fill.solid()
        band.fill.fore_color.rgb = NAVY
        band.line.fill.background()
        box = slide.shapes.add_textbox(MARGIN, Inches(0.18), SLIDE_W - 2 * MARGIN, Inches(0.7))
        run = box.text_frame.paragraphs[0].add_run()
        run.text = _clip(title, 90)
        self._style(run, 28, bold=True, color=WHITE)
        footer = slide.shapes.add_textbox(MARGIN, SLIDE_H - Inches(0.45), SLIDE_W - 2 * MARGIN, Inches(0.3))
        paragraph = footer.text_frame.paragraphs[0]
        paragraph.alignment = PP_ALIGN.RIGHT
        run = paragraph.add_run()
        run.text = f"{self.footer_text} · {self.page}"
        self._style(run, 10, color=MUTED)
        return slide

    def text(self, slide, left, top, width, height, items: list[tuple[str, int, bool, RGBColor | None]]) -> None:
        """Paragraphs of (text, size, bold, colour); '• ' prefixes make bullets."""
        frame = slide.shapes.add_textbox(left, top, width, height).text_frame
        frame.word_wrap = True
        for index, (value, size, bold, color) in enumerate(items):
            paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
            paragraph.space_after = Pt(4)
            run = paragraph.add_run()
            run.text = value
            self._style(run, size, bold=bold, color=color or INK)

    def bullets(self, slide, left, top, width, height, heading: str | None, lines: list[str], size: int = 14) -> None:
        items = [(heading, size + 2, True, NAVY)] if heading else []
        items += [(f"• {_clip(line, 160)}", size, False, None) for line in lines if line]
        if items:
            self.text(slide, left, top, width, height, items)

    def table(
        self, slide, left, top, width, rows: list[list[str]], col_widths: list[float] | None = None,
        size: int = 11, header: bool = True,
    ):
        shape = slide.shapes.add_table(len(rows), len(rows[0]), left, top, width, Inches(0.4) * len(rows))
        table = shape.table
        table.first_row = header
        if col_widths:
            total = sum(col_widths)
            for i, w in enumerate(col_widths):
                table.columns[i].width = Emu(int(width * w / total))
        for r, row in enumerate(rows):
            for c, value in enumerate(row):
                cell = table.cell(r, c)
                cell.text = ""
                run = cell.text_frame.paragraphs[0].add_run()
                run.text = _clip(value, 120)
                is_header = header and r == 0
                self._style(run, size, bold=is_header, color=WHITE if is_header else INK)
                if is_header:
                    cell.fill.solid()
                    cell.fill.fore_color.rgb = NAVY
        return table

    def missing(self, slide, number: int | None) -> None:
        self.text(
            slide, MARGIN, Inches(1.4), SLIDE_W - 2 * MARGIN, Inches(1),
            [(self.t["missing"].format(number=number or "?"), 18, False, MUTED)],
        )

    def chart(self, slide, kind, categories: list[str], series: list[tuple[str, list[float]]], left, top, width, height):
        data = CategoryChartData()
        data.categories = categories
        for name, values in series:
            data.add_series(name, values)
        chart = slide.shapes.add_chart(kind, left, top, width, height, data).chart
        chart.has_legend = len(series) > 1
        if chart.has_legend:
            chart.legend.position = XL_LEGEND_POSITION.TOP
            chart.legend.include_in_layout = False
        chart.font.size = Pt(10)
        chart.font.name = self.font
        value_axis = chart.value_axis
        value_axis.tick_labels.number_format = '#,##0'
        value_axis.tick_labels.number_format_is_linked = False
        value_axis.has_major_gridlines = True
        value_axis.major_gridlines.format.line.color.rgb = GRID
        value_axis.major_gridlines.format.line.width = Pt(0.75)
        value_axis.format.line.fill.background()
        if kind == XL_CHART_TYPE.LINE and len(categories) > 12:
            # A label every third month keeps 36 months readable.
            skip = chart.category_axis._element.makeelement(qn("c:tickLblSkip"), {"val": "3"})
            chart.category_axis._element.append(skip)
        if kind == XL_CHART_TYPE.BAR_CLUSTERED:
            chart.category_axis.reverse_order = True  # first item on top
            chart.has_title = False
            plot = chart.plots[0]
            plot.has_data_labels = True
            plot.data_labels.number_format = '#,##0'
            plot.data_labels.number_format_is_linked = False
            plot.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
            plot.data_labels.font.size = Pt(10)
        for index, plot_series in enumerate(chart.plots[0].series):
            color = SERIES[index % len(SERIES)]
            if kind == XL_CHART_TYPE.LINE:
                plot_series.format.line.color.rgb = color
                plot_series.format.line.width = Pt(2)
                plot_series.smooth = False
            else:
                plot_series.format.fill.solid()
                plot_series.format.fill.fore_color.rgb = color
        return chart


def _get(stages: dict, slug: str, language: str = "en") -> tuple[dict, dict]:
    entry = stages.get(slug) or {}
    answers = entry.get("answers") if isinstance(entry.get("answers"), dict) else {}
    analysis = entry.get("ai_analysis") if isinstance(entry.get("ai_analysis"), dict) else {}
    # The deck's language: a cached translation of this very analysis, if any.
    translated = cached_translation(analysis, language) if analysis else None
    if translated is not None:
        analysis = translated
    return answers, analysis


def _png(image: bytes | None) -> io.BytesIO | None:
    """python-pptx can't embed WebP: convert to PNG. None if unreadable."""
    if not image:
        return None
    try:
        with Image.open(io.BytesIO(image)) as picture:
            out = io.BytesIO()
            picture.convert("RGB").save(out, format="PNG")
            out.seek(0)
            return out
    except Exception:  # noqa: BLE001 -- a broken image just isn't shown
        return None


def build_deck(
    title: str,
    stages: dict[str, dict],
    stage_numbers: dict[str, int],
    language: str = "en",
    product_image: bytes | None = None,
    today: date | None = None,
    stage_titles: dict[str, str] | None = None,
) -> bytes:
    """The whole-venture deck: 13 slides from stages 1-13."""
    b = DeckBuilder(language)
    t = b.t
    b.footer_text = _clip(title, 80)
    width = SLIDE_W - 2 * MARGIN
    # Whole EMUs only: PowerPoint rejects fractional offsets in charts and tables.
    half = Emu(int((width - Inches(0.4)) / 2))
    top = Inches(1.3)
    num = stage_numbers.get

    idea_a, idea = _get(stages, "idea_discovery", b.language)
    problem_a, _ = _get(stages, "problem_definition", b.language)
    customer_a, _ = _get(stages, "customer_definition", b.language)
    _, alternatives = _get(stages, "existing_alternatives", b.language)
    _, market = _get(stages, "market_evidence", b.language)
    _, position = _get(stages, "competitive_position", b.language)
    dfv_a, dfv = _get(stages, "dfv_assessment", b.language)
    _, mvp = _get(stages, "mvp", b.language)
    bm_a, bm = _get(stages, "business_model", b.language)
    vp_a, vp = _get(stages, "validation_plan", b.language)
    fa_a, fa = _get(stages, "financial_analysis", b.language)
    mp_a, mp = _get(stages, "marketing_plan", b.language)

    # 1. Title
    s = b.prs.slides.add_slide(b.blank)
    b.page += 1
    background = s.shapes.add_shape(1, 0, 0, SLIDE_W, SLIDE_H)
    background.fill.solid()
    background.fill.fore_color.rgb = NAVY
    background.line.fill.background()
    subtitle = mvp.get("tagline") or idea_a.get("idea_statement") or ""
    b.text(s, MARGIN, Inches(2.4), width, Inches(3), [
        (_clip(title, 90), 40, True, WHITE),
        (_clip(subtitle, 160), 20, False, WHITE),
        (t["prepared"].format(date=(today or date.today()).isoformat()), 14, False, WHITE),
    ])

    # 2. Problem
    s = b.slide(t["problem"])
    if problem_a.get("problem_statement"):
        b.text(s, MARGIN, top, width, Inches(1.4), [(_clip(problem_a["problem_statement"], 400), 20, False, None)])
        b.bullets(s, MARGIN, Inches(3.0), width, Inches(3.5), None, [
            f"{t['who']}: {problem_a.get('who_experiences_it', '')}",
            f"{t['how_often']}: {problem_a.get('frequency_severity', '')}",
            f"{t['evidence']}: {problem_a.get('evidence_for_problem', '')}",
        ], size=16)
    else:
        b.missing(s, num("problem_definition"))

    # 3. Solution / MVP
    s = b.slide(t["solution"])
    if mvp:
        picture = _png(product_image) if mvp.get("offering_type") == "physical_product" else None
        text_width = half if picture else width
        b.text(s, MARGIN, top, text_width, Inches(1.2), [
            (_clip(mvp.get("name"), 80), 24, True, NAVY),
            (_clip(mvp.get("tagline"), 160), 16, False, MUTED),
            (_clip(mvp.get("summary"), 300), 14, False, None),
        ])
        b.bullets(s, MARGIN, Inches(3.6), text_width, Inches(3), t["core_features"], [
            f"{f.get('feature')} — {f.get('why')}" for f in (mvp.get("core_features") or []) if isinstance(f, dict)
        ])
        if picture:
            s.shapes.add_picture(picture, MARGIN + half + Inches(0.4), top, height=Inches(5.4))
    else:
        b.missing(s, num("mvp"))

    # 4. Target customers
    s = b.slide(t["customers"])
    # The founder's own Stage 7 personas first; otherwise the marketing plan's.
    defined_a, _ = _get(stages, "persona_validation", b.language)
    defined = [p for p in (defined_a.get("personas") or []) if isinstance(p, dict) and p.get("name")]
    personas = [p for p in (mp.get("personas") or []) if isinstance(p, dict)]
    if customer_a or personas or defined:
        b.bullets(s, MARGIN, top, half, Inches(5.5), None, [
            f"{t['segment']}: {customer_a.get('primary_customer_segment', '')}",
            f"{t['traits']}: {customer_a.get('customer_characteristics', '')}",
            f"{t['trigger']}: {customer_a.get('buying_trigger', '')}",
        ], size=15)
        if defined:
            b.bullets(s, MARGIN + half + Inches(0.4), top, half, Inches(5.5), t["personas"], [
                f"{p.get('name')} ({p.get('age_min')}-{p.get('age_max')}): {p.get('demographic', '')}" for p in defined
            ])
        elif personas:
            b.bullets(s, MARGIN + half + Inches(0.4), top, half, Inches(5.5), t["personas"], [
                f"{p.get('name')}: {p.get('description')}" for p in personas
            ])
    else:
        b.missing(s, num("customer_definition"))

    # 5. Market size
    s = b.slide(t["market"])
    scopes = [x for x in (market.get("scopes") or []) if isinstance(x, dict) and isinstance(x.get("market_sizes"), dict)]
    if scopes:
        rows = [[t["scope"], "TAM", "SAM", "SOM"]]
        for scope in scopes:
            sizes = scope["market_sizes"]
            currency = sizes.get("currency", "")
            rows.append([scope.get("area_name") or scope.get("scope"), *(_money(sizes.get(k), currency) for k in ("tam", "sam", "som"))])
        b.table(s, MARGIN, top, half, rows, [3, 3, 3, 3])
        # One chart per currency: never mix currencies on one axis.
        local = [x for x in scopes if x["market_sizes"].get("currency") == scopes[-1]["market_sizes"].get("currency")]
        b.chart(s, XL_CHART_TYPE.COLUMN_CLUSTERED, ["TAM", "SAM", "SOM"],
                [(f"{x.get('area_name')} ({x['market_sizes'].get('currency')})",
                  [float(x["market_sizes"].get(k) or 0) for k in ("tam", "sam", "som")]) for x in local],
                MARGIN + half + Inches(0.4), top, half, Inches(5.2))
    else:
        b.missing(s, num("market_evidence"))

    # 6. Competition and positioning
    s = b.slide(t["competition"])
    if position:
        b.text(s, MARGIN, top, width, Inches(1.3), [
            (t["positioning"], 16, True, NAVY), (_clip(position.get("positioning_statement"), 360), 14, False, None),
        ])
        rows = [[t["competitor"], t["their_position"], t["our_advantage"], t["our_gap"]]]
        for row in (position.get("competitor_comparison") or [])[:5]:
            if isinstance(row, dict):
                rows.append([row.get("competitor"), row.get("their_position"), row.get("our_advantage"), row.get("our_gap")])
        if len(rows) > 1:
            b.table(s, MARGIN, Inches(3.0), width, rows, [2, 3, 3, 3], size=10)
    elif alternatives.get("alternatives"):
        b.bullets(s, MARGIN, top, width, Inches(5), None, [
            f"{a.get('name')}: {a.get('description')}" for a in alternatives["alternatives"][:6] if isinstance(a, dict)
        ])
    else:
        b.missing(s, num("competitive_position"))

    # 7. Business model
    s = b.slide(t["business_model"])
    if bm:
        tiers = (bm.get("pricing") or {}).get("tiers") or []
        b.text(s, MARGIN, top, half, Inches(1), [(_clip(bm.get("model_name"), 80), 22, True, NAVY), (_clip(bm.get("summary"), 260), 13, False, None)])
        b.bullets(s, MARGIN, Inches(3.2), half, Inches(3.5), t["pricing"], [
            f"{x.get('name')}: {x.get('price')} — {x.get('target_customer')}" for x in tiers if isinstance(x, dict)
        ])
        economics = bm.get("unit_economics") or {}
        metrics = economics.get("metrics") or {}
        currency = economics.get("currency", "")
        payback = metrics.get("cac_payback_months")
        b.table(s, MARGIN + half + Inches(0.4), top, half, [
            [t["unit_economics"], ""],
            [t["contribution"], _money(metrics.get("monthly_contribution"), currency)],
            [t["ltv"], _money(metrics.get("lifetime_value"), currency)],
            [t["ltv_cac"], "—" if metrics.get("ltv_to_cac") is None else f"{_num(metrics.get('ltv_to_cac'), 2)}×"],
            [t["payback"], t["never"] if payback is None else t["months"].format(value=_num(payback, 1))],
        ], [3, 2], size=13)
    else:
        b.missing(s, num("business_model"))

    # 8. Assessment and validation
    s = b.slide(t["validation"])
    scores = dfv.get("scores") or {}
    experiments = [e for e in (vp.get("experiments") or []) if isinstance(e, dict)]
    if scores or experiments:
        if scores:
            b.text(s, MARGIN, top, width, Inches(0.6), [(t["scores"].format(
                d=scores.get("desirability"), f=scores.get("feasibility"), v=scores.get("viability"),
                o=scores.get("overall"), verdict=t["verdicts"].get(dfv.get("verdict"), ""),
            ), 15, True, NAVY)])
        if experiments:
            outcomes = vp_a.get("experiment_outcomes") or {}
            rows = [[t["experiment"], t["pass_bar"], t["outcome"]]]
            for e in experiments[:7]:
                rows.append([
                    e.get("title"),
                    f"{e.get('metric')} {t.get(e.get('comparator'), '')} {_num(e.get('pass_threshold'), 0)} {e.get('unit')}",
                    t["outcomes"].get(outcomes.get(e.get("id"), "not_run"), ""),
                ])
            b.table(s, MARGIN, Inches(2.1), width, rows, [4, 4, 2], size=11)
            b.text(s, MARGIN, Inches(6.4), width, Inches(0.5), [(t["signals"].get(vp_a.get("decision_signal") or "not_started", ""), 14, True, NAVY)])
    else:
        b.missing(s, num("dfv_assessment"))

    # 9. Financials
    s = b.slide(t["financials"])
    projection = fa_a.get("projection") if isinstance(fa_a.get("projection"), dict) else None
    if projection:
        m = projection.get("metrics") or {}
        currency = m.get("currency", "")
        runway = m.get("runway_months")
        b.table(s, MARGIN, top, Inches(4.6), [
            [t["runway"], t["beyond"] if runway is None else t["months"].format(value=runway)],
            [t["burn"], _money(m.get("burn_rate_average"), currency)],
            [t["break_even"], t["none"] if m.get("operating_break_even_month") is None else str(m.get("operating_break_even_month"))],
            [t["irr"], t["none"] if m.get("irr_annual") is None else _pct(m.get("irr_annual"))],
            [t["npv"], _money(m.get("npv"), currency)],
            [t["funding"], _money(m.get("funding_needed"), currency)],
        ], [3, 2], size=12, header=False)
        months = projection.get("months") or []
        b.chart(s, XL_CHART_TYPE.LINE, [str(x.get("month")) for x in months], [
            (t["revenue"], [float(x.get("revenue") or 0) for x in months]),
            (t["costs"], [float(x.get("total_costs") or 0) for x in months]),
        ], MARGIN + Inches(5.0), top, width - Inches(5.0), Inches(3.4))
        rows = [["", t["revenue"], t["costs"], t["ebitda"], t["cash"]]]
        for year in projection.get("yearly") or []:
            rows.append([t["year"].format(n=year.get("year")), *(_money(year.get(k), currency) for k in ("revenue", "total_costs", "ebitda", "closing_cash"))])
        b.table(s, MARGIN + Inches(5.0), Inches(4.9), width - Inches(5.0), rows, [2, 3, 3, 3, 3], size=10)
    else:
        b.missing(s, num("financial_analysis"))

    # 10. Marketing: who and what
    s = b.slide(t["marketing_message"])
    if mp:
        b.bullets(s, MARGIN, top, half, Inches(5.5), t["messages"], [
            f"{k.get('message')} ({t['counters'].format(alt=k.get('counters'))})" for k in (mp.get("key_messages") or []) if isinstance(k, dict)
        ])
        b.bullets(s, MARGIN + half + Inches(0.4), top, half, Inches(5.5), t["differentiators"], [
            f"{d.get('claim')} — {d.get('versus')}" for d in (mp.get("differentiators") or []) if isinstance(d, dict)
        ])
    else:
        b.missing(s, num("marketing_plan"))

    # 11. Marketing: channels and budget
    s = b.slide(t["marketing_channels"])
    channels = [c for c in (mp.get("channels") or []) if isinstance(c, dict)]
    if channels:
        currency = mp.get("currency", "")
        rows = [[t["channel"], t["type"], t["budget"], t["kpi"]]]
        for c in channels:
            rows.append([c.get("name"), c.get("type"), _money(c.get("monthly_budget"), currency), f"{_num(c.get('kpi_target'))} {c.get('kpi_metric')}"])
        b.table(s, MARGIN, top, half + Inches(1), rows, [3, 2, 2, 3], size=10)
        b.chart(s, XL_CHART_TYPE.BAR_CLUSTERED, [_clip(c.get("name"), 30) for c in channels],
                [(t["budget"], [float(c.get("monthly_budget") or 0) for c in channels])],
                MARGIN + half + Inches(1.4), top, half - Inches(1), Inches(4.6))
        budget = mp.get("budget") or {}
        lines = [(t["total_budget"].format(amount=_money(budget.get("total_monthly"), currency)), 14, True, NAVY)]
        if budget.get("over_projection"):
            lines.append((t["over_projection"].format(amount=_money(budget.get("gap_to_projection"), currency)), 12, False, SERIES[1]))
        b.text(s, MARGIN, Inches(6.1), width, Inches(0.8), lines)
    else:
        b.missing(s, num("marketing_plan"))

    # 12. Launch plan and funnel
    s = b.slide(t["launch"])
    phases = [p for p in (mp.get("launch_phases") or []) if isinstance(p, dict)]
    if phases:
        b.bullets(s, MARGIN, top, half, Inches(5.5), None, [
            f"{p.get('name')} ({t['weeks'].format(start=p.get('start_week'), end=p.get('end_week'))}): {'; '.join(p.get('activities') or [])}"
            for p in phases
        ], size=14)
        funnel = mp.get("funnel") or {}
        rows = [[t["funnel"].format(month=funnel.get("target_month")), ""]]
        rows += [[label, _num(funnel.get(step))] for step, label in t["funnel_steps"].items()]
        b.table(s, MARGIN + half + Inches(0.4), top, half, rows, [3, 2], size=13)
        rate = ((funnel.get("rates") or {}).get("paying_per_awareness"))
        if rate is not None:
            b.text(s, MARGIN + half + Inches(0.4), Inches(4.0), half, Inches(0.6), [(t["conversion"].format(rate=_pct(rate)), 13, False, MUTED)])
    else:
        b.missing(s, num("marketing_plan"))

    # 13. Next steps
    s = b.slide(t["next_steps"])
    done = set(mp_a.get("completed_actions") or []) | set(bm_a.get("completed_actions") or [])
    open_actions = [
        a.get("title") for a in (mp.get("action_items") or []) + (bm.get("things_to_complete") or [])
        if isinstance(a, dict) and a.get("id") not in done
    ][:8]
    missing_stages = [
        f"{num(slug)}. {(stage_titles or {}).get(slug) or slug.replace('_', ' ').title()}" for slug in DECK_STAGE_SLUGS
        if not (stages.get(slug) or {}).get("ai_analysis") and not (stages.get(slug) or {}).get("answers")
    ]
    b.bullets(s, MARGIN, top, half, Inches(5.5), t["open_actions"], open_actions)
    b.bullets(s, MARGIN + half + Inches(0.4), top, half, Inches(5.5), t["missing_stages"], missing_stages or [t["all_done"]])

    out = io.BytesIO()
    b.prs.save(out)
    return out.getvalue()
