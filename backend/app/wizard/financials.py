"""Stage 12 (Financial Analysis): the 36-month projection and its metrics.

Everything here is deterministic application code (CLAUDE.md: never LLM
output for financial calculations). The AI only drafts the inputs
(FinancialInputs), which the founder can edit; this module turns them into a
monthly projection and the headline metrics. Decimal arithmetic throughout,
rounded half-up only when results are stored.

Per month m = 1..36:
    new[m]       = new customers in month 1 x (1 + growth)^(m-1)
    customers[m] = customers[m-1] x (1 - churn) + new[m]
    revenue      = customers x price
    variable     = customers x variable cost per customer
    acquisition  = new[m] x customer acquisition cost
    fixed        = fixed rows active from their start month
    operating    = active operating rows: flat amount + share of revenue
    one-time     = one-time rows in their month
    EBITDA       = revenue - all costs above
    tax          = max(EBITDA, 0) x tax rate          (simplified, monthly)
    net cash     = EBITDA - tax
    cash         = starting cash + planned raise (from its month) + cumulative net cash

Metrics: gross margin; burn rate (average net outflow over months 1-6, and
peak); runway (months of cash before the balance first goes negative);
operating break-even month (first month from which EBITDA stays >= 0);
break-even customers (monthly fixed + flat operating costs / contribution
per customer); payback month (first month from which cumulative net cash
stays >= 0); funding needed (deepest cash shortfall); NPV and IRR of the
monthly net cash flows (a project IRR: no exit or terminal value).
"""

import math
from decimal import ROUND_HALF_UP, Decimal, localcontext

from app.ai.schemas import HORIZON_MONTHS, FinancialInputs

ZERO = Decimal(0)
ONE = Decimal(1)
BURN_WINDOW = 6


def _d(value: float | int) -> Decimal:
    # Via str() so 0.1 stays 0.1 rather than its binary approximation.
    return Decimal(str(value))


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _ratio(value: Decimal, places: str = "0.0001") -> float:
    return float(value.quantize(Decimal(places), rounding=ROUND_HALF_UP))


def npv(monthly_rate: Decimal, flows: list[Decimal]) -> Decimal:
    """Net present value of flows at months 1..n (discounted from month 0)."""
    total = ZERO
    factor = ONE
    for flow in flows:
        factor = factor * (ONE + monthly_rate)
        total += flow / factor
    return total


def irr_monthly(flows: list[Decimal]) -> Decimal | None:
    """The monthly rate at which NPV is zero, by bisection; None when the
    flows never change sign or no root lies in (-99%, +1000%) a month."""
    if not any(f < 0 for f in flows) or not any(f > 0 for f in flows):
        return None
    low, high = Decimal("-0.99"), Decimal("10")
    npv_low, npv_high = npv(low, flows), npv(high, flows)
    if npv_low == 0:
        return low
    if (npv_low > 0) == (npv_high > 0):
        return None
    for _ in range(200):
        mid = (low + high) / 2
        npv_mid = npv(mid, flows)
        if abs(npv_mid) < Decimal("1e-9") or high - low < Decimal("1e-12"):
            return mid
        if (npv_mid > 0) == (npv_low > 0):
            low, npv_low = mid, npv_mid
        else:
            high = mid
    return (low + high) / 2


def _first_month_staying(values: list[Decimal], ok) -> int | None:
    """The first month (1-based) from which ok(value) holds to the end."""
    month = None
    for index in range(len(values) - 1, -1, -1):
        if not ok(values[index]):
            break
        month = index + 1
    return month


def project(inputs: FinancialInputs) -> dict:
    """The full 36-month projection, yearly summaries, metrics and warnings."""
    with localcontext() as ctx:
        ctx.prec = 34
        return _project(inputs)


def _project(inputs: FinancialInputs) -> dict:
    drivers = inputs.revenue_drivers
    price = _d(drivers.monthly_price_per_customer.value)
    churn = _d(drivers.monthly_churn_rate.value)
    growth = _d(drivers.monthly_growth_rate_new_customers.value)
    new_first = _d(drivers.new_customers_month_1.value)
    variable_per_customer = _d(drivers.variable_cost_per_customer.value)
    cac = _d(drivers.customer_acquisition_cost.value)
    tax_rate = _d(inputs.tax_rate)
    raise_amount = _d(inputs.funding.planned_raise_amount)
    raise_month = inputs.funding.planned_raise_month

    customers = _d(drivers.starting_customers.value)
    cash = _d(inputs.funding.starting_cash)
    cumulative = ZERO
    months: list[dict] = []
    ebitda_by_month: list[Decimal] = []
    net_by_month: list[Decimal] = []
    cumulative_by_month: list[Decimal] = []
    cash_by_month: list[Decimal] = []
    totals = {"revenue": ZERO, "variable": ZERO}

    for m in range(1, HORIZON_MONTHS + 1):
        new = new_first * (ONE + growth) ** (m - 1)
        customers = customers * (ONE - churn) + new
        revenue = customers * price
        variable = customers * variable_per_customer
        acquisition = new * cac
        fixed = sum((_d(c.monthly_amount) for c in inputs.fixed_costs if c.start_month <= m), ZERO)
        operating = sum(
            (_d(c.monthly_amount) + _d(c.percent_of_revenue) * revenue for c in inputs.operating_costs if c.start_month <= m),
            ZERO,
        )
        one_time = sum((_d(c.amount) for c in inputs.one_time_costs if c.month == m), ZERO)
        total_costs = variable + acquisition + fixed + operating + one_time
        ebitda = revenue - total_costs
        tax = max(ebitda, ZERO) * tax_rate
        net = ebitda - tax
        cumulative += net
        cash += net + (raise_amount if raise_month == m else ZERO)

        totals["revenue"] += revenue
        totals["variable"] += variable
        ebitda_by_month.append(ebitda)
        net_by_month.append(net)
        cumulative_by_month.append(cumulative)
        cash_by_month.append(cash)
        months.append(
            {
                "month": m,
                "new_customers": _ratio(new, "0.1"),
                "customers": _ratio(customers, "0.1"),
                "revenue": _money(revenue),
                "variable_costs": _money(variable),
                "acquisition_costs": _money(acquisition),
                "fixed_costs": _money(fixed),
                "operating_costs": _money(operating),
                "one_time_costs": _money(one_time),
                "total_costs": _money(total_costs),
                "ebitda": _money(ebitda),
                "tax": _money(tax),
                "net_cash_flow": _money(net),
                "cash_balance": _money(cash),
            }
        )

    # --- Metrics -------------------------------------------------------------
    outflows = [max(-net, ZERO) for net in net_by_month]
    burn_average = sum(outflows[:BURN_WINDOW], ZERO) / BURN_WINDOW
    cash_out_month = next((m for m, balance in enumerate(cash_by_month, 1) if balance < 0), None)
    operating_break_even = _first_month_staying(ebitda_by_month, lambda v: v >= 0)
    payback_month = _first_month_staying(cumulative_by_month, lambda v: v >= 0)
    lowest = min(cash_by_month)
    lowest_month = cash_by_month.index(lowest) + 1

    share_of_revenue = sum((_d(c.percent_of_revenue) for c in inputs.operating_costs), ZERO)
    contribution = price * (ONE - share_of_revenue) - variable_per_customer
    run_rate_costs = sum((_d(c.monthly_amount) for c in inputs.fixed_costs), ZERO) + sum(
        (_d(c.monthly_amount) for c in inputs.operating_costs), ZERO
    )
    if contribution > 0:
        break_even_customers: int | None = math.ceil(run_rate_costs / contribution)
    else:
        break_even_customers = None

    monthly_discount = (ONE + _d(inputs.discount_rate_annual)) ** (ONE / 12) - ONE
    irr = irr_monthly(net_by_month)
    irr_annual = (ONE + irr) ** 12 - ONE if irr is not None else None

    metrics = {
        "currency": inputs.currency.strip().upper(),
        "total_revenue": _money(totals["revenue"]),
        "gross_margin": _ratio((totals["revenue"] - totals["variable"]) / totals["revenue"]) if totals["revenue"] > 0 else None,
        "burn_rate_average": _money(burn_average),
        "burn_rate_peak": _money(max(outflows)),
        "cash_out_month": cash_out_month,
        # Whole months the cash lasts; None = it lasts beyond the horizon.
        "runway_months": cash_out_month - 1 if cash_out_month else None,
        "operating_break_even_month": operating_break_even,
        "break_even_customers": break_even_customers,
        "break_even_revenue": _money(break_even_customers * price) if break_even_customers is not None else None,
        "contribution_per_customer": _money(contribution),
        "payback_month": payback_month,
        "funding_needed": _money(max(-lowest, ZERO)),
        "lowest_cash_month": lowest_month,
        "npv": _money(npv(monthly_discount, net_by_month)),
        "irr_monthly": _ratio(irr, "0.000001") if irr is not None else None,
        "irr_annual": _ratio(irr_annual, "0.0001") if irr_annual is not None else None,
        "closing_cash": _money(cash_by_month[-1]),
    }

    yearly = []
    for year in range(HORIZON_MONTHS // 12):
        chunk = months[year * 12 : (year + 1) * 12]
        yearly.append(
            {
                "year": year + 1,
                "revenue": _money(sum((_d(m["revenue"]) for m in chunk), ZERO)),
                "total_costs": _money(sum((_d(m["total_costs"]) for m in chunk), ZERO)),
                "ebitda": _money(sum((_d(m["ebitda"]) for m in chunk), ZERO)),
                "net_cash_flow": _money(sum((_d(m["net_cash_flow"]) for m in chunk), ZERO)),
                "closing_customers": chunk[-1]["customers"],
                "closing_cash": chunk[-1]["cash_balance"],
            }
        )

    warnings = []
    if contribution <= 0:
        warnings.append("negative_contribution")
    if cash_out_month is not None and (operating_break_even is None or operating_break_even > cash_out_month):
        warnings.append("runway_before_break_even")
    if any(c.monthly_amount == 0 for c in inputs.fixed_costs) or any(
        c.monthly_amount == 0 and c.percent_of_revenue == 0 for c in inputs.operating_costs
    ) or any(c.amount == 0 for c in inputs.one_time_costs):
        warnings.append("zero_amount_rows")
    if churn == 0:
        warnings.append("zero_churn")

    return {"months": months, "yearly": yearly, "metrics": metrics, "warnings": warnings}
