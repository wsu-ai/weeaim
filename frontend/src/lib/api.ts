// Unset in production: requests go to the same address, forwarded to the
// backend by next.config.ts. Locally: http://localhost:8000 (.env.local).
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // The backend's machine-readable reason, e.g. "pending_approval".
    readonly detail: string | null = null,
  ) {
    super(message);
  }
}

export type Venture = {
  id: string;
  organization_id: string;
  title: string;
  original_idea: string;
  current_idea_statement: string | null;
  status: string;
  current_wizard_stage: string;
  created_at: string;
};

export type OrganizationSummary = { slug: string; name: string; role: string };

export type SessionInfo = {
  email: string;
  display_name: string | null;
  organizations: OrganizationSummary[];
  // Slug of the organization the session acts in; null until chosen.
  active_organization: string | null;
  /** The user's default location for Stage 6 market sizing. */
  default_country?: string | null;
  default_metro_city?: string | null;
  /** False for accounts without a password (e.g. Google sign-in): they confirm with an emailed code. */
  has_password?: boolean;
};

export type AuthConfig = {
  google_client_id: string | null;
  dev_login_enabled: boolean;
};

export type IdeaInterpretation = {
  title: string;
  summary: string;
  industry: string | null;
  geography: string | null;
  target_customer: string | null;
  problem_hypothesis: string | null;
  confidence: number;
};

export type StageField = {
  name: string;
  label_en: string;
  label_ko: string;
  /** "short": a one-line answer, such as a country name. */
  type: "text" | "list" | "short";
};

export type WizardStageStatus = {
  slug: string;
  number: number;
  title_en: string;
  title_ko: string;
  implemented: boolean;
  status: string;
  answers: Record<string, unknown> | null;
  ai_analysis:
    | StageFeedback
    | IdeaResearchAnalysis
    | AlternativesResearchAnalysis
    | MarketResearchAnalysis
    | CompetitivePositionAnalysis
    | DfvAssessmentAnalysis
    | BusinessModelAnalysis
    | MvpAnalysis
    | ValidationPlanAnalysis
    | FinancialAnalysisAnalysis
    | MarketingPlanAnalysis
    | PersonaInsightsAnalysis
    | null;
  question_schema?: { fields: StageField[] } | null;
  /** Locked until the stages in locked_by are completed (decided by the server). */
  locked?: boolean;
  locked_by?: string[];
};

/** AI feedback on a stage's answers (stages 2+). */
export type StageFeedback = {
  summary: string;
  strengths: string[];
  gaps: string[];
  suggested_next_steps: string[];
  confidence: number;
  /** When the AI mentor's feedback was received (absent on older feedback). */
  analyzed_at?: string;
};

export type FeasibilityRating = "favorable" | "moderate" | "challenging";
export const FEASIBILITY_FACTORS = [
  "technical_complexity",
  "resources_required",
  "regulatory_barriers",
  "time_to_market",
  "customer_access",
] as const;
export type FeasibilityFactorName = (typeof FEASIBILITY_FACTORS)[number];

/** Stage 1: web-researched expert view of the idea. */
export type IdeaResearchAnalysis = {
  kind: "idea_research";
  summary: string;
  market_status: "no_close_matches_found" | "some_similar_offerings" | "crowded_market";
  existing_solutions: {
    name: string;
    description: string;
    similarity: "direct" | "partial" | "adjacent";
    /** The business's website, only when the web search actually found it. */
    url: string | null;
    /** Web search for the business; absent on research from before it existed. */
    search_url?: string;
  }[];
  feasibility: string[];
  /** Computed by the backend from the factor ratings (0-100); absent on older research. */
  feasibility_score?: number;
  feasibility_factors?: Record<FeasibilityFactorName, { rating: FeasibilityRating; reason: string }>;
  viability: string[];
  differentiation_opportunities: string[];
  key_risks: string[];
  suggested_next_steps: string[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  language: "en" | "ko";
};

export function isIdeaResearch(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is IdeaResearchAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "idea_research";
}

/** Stage 4: the alternatives customers use today, researched on the web. */
export type AlternativesResearchAnalysis = {
  kind: "alternatives_research";
  summary: string;
  /** Set when the stage's AI agent produced this research. */
  agent_run_id?: string;
  alternatives: {
    name: string;
    category: "direct_competitor" | "indirect_competitor" | "substitute" | "workaround";
    description: string;
    strengths: string[];
    weaknesses: string[];
    pricing: string | null;
    /** Official website, only when the web search actually found it. */
    url: string | null;
    search_url: string;
  }[];
  switching_barriers: string[];
  unmet_needs: string[];
  positioning_recommendations: string[];
  suggested_next_steps: string[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  /** When the stage 1-3 answers this research used were last changed. */
  based_on: string | null;
  language: "en" | "ko";
};

export type ResearchStageSlug =
  | "idea_discovery"
  | "existing_alternatives"
  | "market_evidence"
  | "persona_validation"
  | "competitive_position"
  | "dfv_assessment"
  | "mvp"
  | "business_model"
  | "validation_plan"
  | "financial_analysis"
  | "marketing_plan";

export type ActionPriority = "high" | "medium" | "low";
export type ActionTimeframe = "this_week" | "this_month" | "this_quarter";

export type ActionItem = {
  /** Stable server-assigned ID; what the founder's ticks refer to. */
  id: string;
  title: string;
  why: string;
  steps: string[];
  priority: ActionPriority;
  timeframe: ActionTimeframe;
  success_metric: string;
};

export type DfvDimension = "desirability" | "feasibility" | "viability";
export type DfvRating = "strong" | "moderate" | "weak";
export type DfvVerdict = "proceed" | "strengthen" | "rethink";

export type DfvCriterion = {
  criterion: string;
  rating: DfvRating;
  reason: string;
  evidence: string;
  /** The wizard stage the evidence came from, or "none". */
  evidence_stage: string;
  evidence_gap: string | null;
};

export type DfvActionItem = ActionItem & { dimension: DfvDimension; criterion: string };

/** Stage 8: DFV ratings from stages 1-7; scores and verdict computed by the server. */
export type DfvAssessmentAnalysis = {
  kind: "dfv_assessment";
  summary: string;
  scores: Record<DfvDimension | "overall", number>;
  verdict: DfvVerdict;
  dimensions: Record<DfvDimension, DfvCriterion[]>;
  assumptions_to_test: string[];
  action_items: DfvActionItem[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

export type CanvasBlock =
  | "customer_segments"
  | "value_propositions"
  | "channels"
  | "customer_relationships"
  | "revenue_streams"
  | "key_resources"
  | "key_activities"
  | "key_partnerships"
  | "cost_structure";

export type UnitEconomicsInput =
  | "monthly_revenue_per_customer"
  | "monthly_cost_to_serve"
  | "customer_acquisition_cost"
  | "monthly_churn_rate";

export type HealthStatus = "healthy" | "watch" | "unhealthy";

export type CompletionArea = "customers" | "offering" | "go_to_market" | "operations" | "finances" | "validation";

export type ThingToComplete = ActionItem & { area: CompletionArea };

/** Stage 9: the recommended business model; unit economics computed by the server. */
export type BusinessModelAnalysis = {
  kind: "business_model";
  summary: string;
  model_name: string;
  model_type: string;
  why_this_model: { reason: string; evidence_stage: string }[];
  alternatives_considered: { name: string; why_not: string; when_it_would_fit: string }[];
  canvas: Record<CanvasBlock, string[]>;
  pricing: {
    strategy: string;
    tiers: { name: string; price: string; includes: string[]; target_customer: string }[];
  };
  unit_economics: {
    currency: string;
    inputs: Record<UnitEconomicsInput, SourcedFigure>;
    metrics: {
      currency: string;
      monthly_contribution: number;
      /** Share (0.75 = 75%); null when revenue is 0. */
      contribution_margin: number | null;
      customer_lifetime_months: number;
      lifetime_value: number;
      /** Null when there's no acquisition cost. */
      ltv_to_cac: number | null;
      /** Null when each customer loses money (never paid back). */
      cac_payback_months: number | null;
    };
    health: Record<"ltv_to_cac" | "cac_payback_months" | "contribution_margin", HealthStatus>;
  };
  launch_kpis: string[];
  key_risks: string[];
  things_to_complete: ThingToComplete[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

export type OfferingType = "physical_product" | "online_service" | "offline_service";

export type MockupIcon =
  | "sparkles"
  | "clock"
  | "shield"
  | "heart"
  | "users"
  | "chart"
  | "calendar"
  | "chat"
  | "map"
  | "star"
  | "leaf"
  | "book"
  | "camera"
  | "cart"
  | "bell"
  | "lightning";

export type WebsiteMockup = {
  brand_name: string;
  /** #rrggbb, checked by the server (invalid values replaced). */
  primary_color: string;
  accent_color: string;
  nav_items: string[];
  hero_headline: string;
  hero_subheadline: string;
  cta_label: string;
  features: { title: string; description: string; icon: MockupIcon }[];
  how_it_works: string[];
  pricing_teaser: string;
  footer_note: string;
};

/** Stage 9: the minimum viable product or service. */
export type MvpAnalysis = {
  kind: "mvp";
  offering_type: OfferingType;
  offering_type_reason: string;
  /** "founder" when the founder chose the type; otherwise the AI did. */
  offering_type_source: "ai" | "founder";
  name: string;
  tagline: string;
  summary: string;
  target_user: string;
  problem_solved: string;
  core_features: { feature: string; why: string }[];
  left_out_for_now: string[];
  how_to_test: string[];
  physical_product: {
    image_prompt: string;
    materials: string[];
    dimensions: string;
    components: string[];
    prototype_route: string;
  } | null;
  website_mockup: WebsiteMockup | null;
  offline_service: {
    overview: string;
    customer_journey: { step: string; what_happens: string }[];
    delivery: { where: string; who_delivers: string; when: string };
    what_customer_gets: string[];
    resources_needed: string[];
    pricing_note: string;
  } | null;
  /** The generated concept image (physical products), served by assetUrl(). */
  image: { asset_id: string; content_type: string } | null;
  image_failed: boolean;
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

export type ExperimentOutcome = "passed" | "failed" | "inconclusive" | "not_run";
export type DecisionSignal = "not_started" | "keep_testing" | "proceed" | "stop_or_pivot";

export type ValidationExperiment = {
  /** Stable server-assigned ID; what recorded results refer to. */
  id: string;
  title: string;
  assumption_tested: string;
  method_type: string;
  method: string;
  participants: string;
  sample_size: number | null;
  metric: string;
  unit: string;
  comparator: "at_least" | "at_most";
  pass_threshold: number;
  /** Null when there's no separate fail bar (anything short of pass fails). */
  fail_threshold: number | null;
  critical: boolean;
  phase: number;
  duration_weeks: number;
  cost_estimate: string;
  owner: string;
};

/** Stage 11: experiments with pass/fail bars set before any results. */
export type ValidationPlanAnalysis = {
  kind: "validation_plan";
  summary: string;
  prerequisite_fixes: string[];
  assumptions: {
    assumption: string;
    dimension: "desirability" | "feasibility" | "viability" | "legal";
    risk: "high" | "medium" | "low";
    source_stage: string;
  }[];
  experiments: ValidationExperiment[];
  decision_rules: { proceed_if: string; narrow_or_pivot_if: string; stop_if: string };
  ethics_and_legal: string[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

/** Stage 11 answers: results recorded by the founder; outcomes computed by the server. */
export type ValidationResults = {
  experiment_results?: Record<string, { value: number | null; notes: string }>;
  experiment_outcomes?: Record<string, ExperimentOutcome>;
  decision_signal?: DecisionSignal;
};

export type Driver = { value: number; explanation: string; is_estimate: boolean };

export type RevenueDriverName =
  | "monthly_price_per_customer"
  | "starting_customers"
  | "new_customers_month_1"
  | "monthly_growth_rate_new_customers"
  | "monthly_churn_rate"
  | "variable_cost_per_customer"
  | "customer_acquisition_cost";

export type FixedCostCategory = "salaries" | "rent" | "software" | "insurance" | "legal_accounting" | "utilities" | "other";
export type OperatingCostCategory = "marketing" | "ai_infrastructure" | "payment_fees" | "travel" | "support" | "other";

export type FixedCost = {
  name: string;
  category: FixedCostCategory;
  monthly_amount: number;
  start_month: number;
  note: string;
};
export type OperatingCost = {
  name: string;
  category: OperatingCostCategory;
  monthly_amount: number;
  /** Share of revenue, 0-1. */
  percent_of_revenue: number;
  start_month: number;
  note: string;
};
export type OneTimeCost = { name: string; amount: number; month: number; note: string };

/** Every input to the 36-month projection: drafted by the AI, edited by the founder. */
export type FinancialInputs = {
  currency: string;
  revenue_drivers: Record<RevenueDriverName, Driver>;
  fixed_costs: FixedCost[];
  operating_costs: OperatingCost[];
  one_time_costs: OneTimeCost[];
  funding: { starting_cash: number; planned_raise_amount: number; planned_raise_month: number | null };
  tax_rate: number;
  discount_rate_annual: number;
};

export type ProjectionMonth = {
  month: number;
  new_customers: number;
  customers: number;
  revenue: number;
  variable_costs: number;
  acquisition_costs: number;
  fixed_costs: number;
  operating_costs: number;
  one_time_costs: number;
  total_costs: number;
  ebitda: number;
  tax: number;
  net_cash_flow: number;
  cash_balance: number;
};

export type FinancialWarning = "negative_contribution" | "runway_before_break_even" | "zero_amount_rows" | "zero_churn";

/** Computed by the server from FinancialInputs (never by the AI). */
export type Projection = {
  months: ProjectionMonth[];
  yearly: {
    year: number;
    revenue: number;
    total_costs: number;
    ebitda: number;
    net_cash_flow: number;
    closing_customers: number;
    closing_cash: number;
  }[];
  metrics: {
    currency: string;
    total_revenue: number;
    gross_margin: number | null;
    burn_rate_average: number;
    burn_rate_peak: number;
    cash_out_month: number | null;
    /** Null: the cash lasts beyond the 36-month horizon. */
    runway_months: number | null;
    operating_break_even_month: number | null;
    break_even_customers: number | null;
    break_even_revenue: number | null;
    contribution_per_customer: number;
    payback_month: number | null;
    funding_needed: number;
    lowest_cash_month: number;
    npv: number;
    irr_monthly: number | null;
    irr_annual: number | null;
    closing_cash: number;
  };
  warnings: FinancialWarning[];
};

/** Stage 12: the AI's draft inputs (the projection lives in the stage's answers). */
export type FinancialAnalysisAnalysis = {
  kind: "financial_analysis";
  summary: string;
  assumption_notes: string[];
  inputs: FinancialInputs;
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

/** Stage 12 answers: the founder's inputs and the server-computed projection. */
export type FinancialAnswers = {
  financial_inputs?: FinancialInputs | null;
  inputs_source?: "ai_draft" | "founder";
  projection?: Projection | null;
};

export type ChannelType = "organic" | "paid" | "partnership" | "direct_sales" | "community" | "events" | "referral";

export type MarketingChannel = {
  name: string;
  type: ChannelType;
  why: string;
  tactics: string[];
  monthly_budget: number;
  start_month: number;
  kpi_metric: string;
  kpi_target: number;
  /** Only when the web search actually found it. */
  url: string | null;
};

/** Stage 13: the marketing plan; budget totals and funnel rates computed by the server. */
export type MarketingPlanAnalysis = {
  kind: "marketing_plan";
  summary: string;
  positioning_recap: string;
  currency: string;
  personas: { name: string; description: string; pains: string[]; where_to_reach: string[] }[];
  key_messages: { message: string; proof_point: string; counters: string }[];
  differentiators: { claim: string; versus: string }[];
  channels: MarketingChannel[];
  budget: {
    total_monthly: number;
    by_type: { type: ChannelType; monthly: number; share: number | null }[];
    /** Stage 12's monthly marketing costs; null when there's no projection. */
    projection_monthly: number | null;
    gap_to_projection: number | null;
    over_projection: boolean;
  };
  launch_phases: { name: string; start_week: number; end_week: number; activities: string[] }[];
  funnel: {
    target_month: number;
    awareness: number;
    leads: number;
    trials: number;
    paying: number;
    rates: {
      leads_per_awareness: number | null;
      trials_per_lead: number | null;
      paying_per_trial: number | null;
      paying_per_awareness: number | null;
    };
  };
  risks: string[];
  action_items: ActionItem[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

export type IncomeLevel = "low" | "lower_middle" | "middle" | "upper_middle" | "high";
export type PersonaGender = "female" | "male" | "non_binary" | "any";
export type MaritalStatus = "single" | "married" | "divorced" | "widowed" | "any";

/** A target persona the founder defines in Stage 7 (saved in the stage's answers). */
export type TargetPersona = {
  /** Assigned by the server; empty for a persona not saved yet. */
  id: string;
  name: string;
  age_min: number;
  age_max: number;
  demographic: string;
  income_level: IncomeLevel;
  gender: PersonaGender;
  marital_status: MaritalStatus;
  notes: string;
};

export type PersonaMessage = {
  id: string;
  role: "founder" | "persona";
  content: string;
  created_at: string;
};

/** What the general market data says about people matching a persona. */
export type PersonaMarketProfile = {
  kind: "persona_market_profile";
  persona_id: string;
  summary: string;
  facts: {
    fact: string;
    applies_to: string;
    source_title: string | null;
    /** Only when the web search actually saw that site. */
    source_url: string | null;
    source_verified: boolean;
  }[];
  daily_life_and_habits: string[];
  current_alternatives: string[];
  spending_and_price_sensitivity: string[];
  adoption_signals: string[];
  likely_objections: string[];
  data_gaps: string[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  language: "en" | "ko";
};

/** Stage 7: insights from the (simulated) persona conversations. */
export type PersonaInsightsAnalysis = {
  kind: "persona_insights";
  summary: string;
  /** What the summary read (absent in summaries made before these were recorded). */
  conversations_used?: number;
  market_profiles_used?: number;
  per_persona: {
    persona_id: string;
    name: string;
    reactions: string[];
    objections: string[];
    willingness_to_pay: "strong" | "some" | "none" | "unclear";
    feasibility_signals: string[];
    viability_signals: string[];
    /** Word for word from the persona's replies (checked by the server). */
    quotes: string[];
  }[];
  assumptions_to_test_with_real_customers: string[];
  confidence: number;
  simulated: true;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
};

/** Stage 8: the competitive position synthesized from stages 1-7. */
export type CompetitivePositionAnalysis = {
  kind: "competitive_position";
  summary: string;
  positioning_statement: string;
  target_segment: string;
  market_category: string;
  competitor_comparison: {
    competitor: string;
    their_position: string;
    our_advantage: string;
    our_gap: string;
    /** Official website, only when the web search actually found it. */
    url: string | null;
    search_url: string;
  }[];
  differentiators: {
    claim: string;
    evidence: string;
    evidence_stage: "idea_discovery" | "existing_alternatives" | "market_evidence" | "founder_answers";
  }[];
  risks: string[];
  defensibility: string;
  action_items: ActionItem[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  /** When the stage 1-6 answers or research this used last changed. */
  based_on: string | null;
  language: "en" | "ko";
};

/** A figure's source, checked by the server against what the web search saw. */
type CheckedSource = {
  source_title: string | null;
  /** Only present when the search actually cited or consulted that site. */
  source_url: string | null;
  source_verified: boolean;
  /** Web search for the source title, as a fallback when unconfirmed. */
  search_url: string | null;
};

export type SourcedFigure = CheckedSource & {
  value: number;
  unit: string;
  explanation: string;
  year: number | null;
  is_estimate: boolean;
};

export type MarketDemographic = CheckedSource & {
  segment: string;
  geography: string;
  description: string;
  count: number;
  unit: "people" | "households" | "businesses" | "organizations";
  year: number | null;
};

export type PublishedMarketSize = CheckedSource & {
  label: string;
  value: number;
  currency: string;
  year: number | null;
  scope: string;
  publisher: string;
};

export type MarketInputs = {
  total_customers: SourcedFigure;
  annual_revenue_per_customer: SourcedFigure;
  serviceable_share: SourcedFigure;
  obtainable_share: SourcedFigure;
};

/** One geography's market: sizes computed by the server from its inputs. */
export type MarketScopeResult = {
  scope: "global" | "country" | "metro" | "legacy";
  area_name: string;
  market_sizes: { currency: string; tam: number; sam: number; som: number };
  inputs: MarketInputs;
  demographics: MarketDemographic[];
  published_market_sizes: PublishedMarketSize[];
};

/** Stage 6: market evidence for global, the founder's country and metro city. */
export type MarketResearchAnalysis = {
  kind: "market_research";
  summary: string;
  location?: { country: string; metro_city: string } | null;
  scopes?: MarketScopeResult[];
  consistency_warnings?: ("metro_exceeds_country" | "country_exceeds_global")[];
  vendors: {
    name: string;
    description: string;
    business_model: string;
    traction: string;
    url: string | null;
    evidence_url: string | null;
    evidence_verified: boolean;
    search_url: string;
  }[];
  assumptions: string[];
  data_gaps: string[];
  suggested_next_steps: string[];
  confidence: number;
  sources: { title: string; url: string }[];
  researched_at: string;
  based_on: string | null;
  language: "en" | "ko";
  // Research saved before the three-geography format had a single market.
  market_sizes?: MarketScopeResult["market_sizes"];
  inputs?: MarketInputs;
  demographics?: MarketDemographic[];
  published_market_sizes?: PublishedMarketSize[];
};

/** The research's scopes, treating older single-market research as one scope. */
export function marketScopes(research: MarketResearchAnalysis): MarketScopeResult[] {
  if (research.scopes?.length) return research.scopes;
  if (research.market_sizes && research.inputs) {
    return [
      {
        scope: "legacy",
        area_name: "",
        market_sizes: research.market_sizes,
        inputs: research.inputs,
        demographics: research.demographics ?? [],
        published_market_sizes: research.published_market_sizes ?? [],
      },
    ];
  }
  return [];
}

export function isMarketResearch(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is MarketResearchAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "market_research";
}

export function isCompetitivePosition(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is CompetitivePositionAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "competitive_position";
}

export function isDfvAssessment(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is DfvAssessmentAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "dfv_assessment";
}

export function isBusinessModel(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is BusinessModelAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "business_model";
}

export function isPersonaInsights(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is PersonaInsightsAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "persona_insights";
}

export function listPersonaMessages(ventureId: string, personaId: string): Promise<PersonaMessage[]> {
  return authRequest(
    `/api/ventures/${ventureId}/personas/${personaId}/messages`,
    { method: "GET" },
    "Failed to load the conversation",
  );
}

/** Sends the founder's message; returns it and the AI persona's reply. */
export function sendPersonaMessage(
  ventureId: string,
  personaId: string,
  content: string,
  language: "en" | "ko",
): Promise<{ founder: PersonaMessage; persona: PersonaMessage }> {
  return postJson(
    `/api/ventures/${ventureId}/personas/${personaId}/messages`,
    { content, language },
    "Failed to send the message",
  );
}

/** The cached market research for the persona's current criteria (404 if none). */
export function getPersonaMarketProfile(ventureId: string, personaId: string): Promise<PersonaMarketProfile> {
  return authRequest(
    `/api/ventures/${ventureId}/personas/${personaId}/market-profile`,
    { method: "GET" },
    "Failed to load the market profile",
  );
}

/** Researches (web search) people matching the persona's criteria; cached per criteria. */
export function researchPersonaMarket(
  ventureId: string,
  personaId: string,
  language: "en" | "ko",
  refresh = false,
): Promise<PersonaMarketProfile> {
  return postJson(
    `/api/ventures/${ventureId}/personas/${personaId}/market-profile`,
    { language, refresh },
    "Failed to research the market",
  );
}

export function resetPersonaConversation(ventureId: string, personaId: string): Promise<void> {
  return authRequest(
    `/api/ventures/${ventureId}/personas/${personaId}/messages`,
    { method: "DELETE" },
    "Failed to start over",
  );
}

export function isMarketingPlan(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is MarketingPlanAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "marketing_plan";
}

// --- Stage AI agents (see backend/app/agents/) ---------------------------------

/** Stages that have an AI agent (Stage 15 isn't built yet). */
export const AGENT_STAGES = [
  "idea_discovery",
  "problem_definition",
  "customer_definition",
  "existing_alternatives",
  "value_proposition",
  "market_evidence",
  "persona_validation",
  "competitive_position",
  "dfv_assessment",
  "mvp",
  "business_model",
  "validation_plan",
  "financial_analysis",
  "marketing_plan",
];

export type AgentRunStatus =
  | "queued"
  | "running"
  | "waiting_for_founder"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled";

export const ACTIVE_AGENT_STATUSES: AgentRunStatus[] = ["queued", "running", "waiting_for_founder", "paused"];

export type AgentRunStep = {
  seq: number;
  kind: "model" | "tool" | "web_search" | "question" | "answer" | "limit" | "error";
  tool_name: string | null;
  arguments: Record<string, unknown> | null;
  /** For error and limit steps: what went wrong (e.g. {"error": "RateLimitError"}). */
  result?: Record<string, unknown> | null;
  created_at: string;
};

export type AgentRun = {
  id: string;
  stage_slug: string;
  status: AgentRunStatus;
  language: "en" | "ko";
  model_turns: number;
  web_searches: number;
  tokens_used: number;
  /** Time spent working (not waiting or paused), in milliseconds. */
  active_ms: number;
  /** The agent's question while it waits for the founder. */
  pending_question: string | null;
  /** Draft answers for the founder to review; never saved by the agent. */
  proposed_answers: Record<string, string | string[]> | null;
  error:
    | "limit_reached"
    | "interrupted"
    | "agent_error"
    | "no_result"
    | "location_required"
    | "no_conversations"
    | "venture_archived"
    | "token_limit_reached"
    | null;
  created_at: string;
  finished_at: string | null;
  steps: AgentRunStep[];
};

/** Starts the stage's agent; with replace, stops its active run first (re-run). */
export function startAgentRun(
  ventureId: string,
  stageSlug: string,
  language: "en" | "ko",
  replace = false,
): Promise<AgentRun> {
  return postJson(
    `/api/ventures/${ventureId}/stages/${stageSlug}/agent-runs`,
    replace ? { language, replace } : { language },
    "Failed to start the AI agent",
  );
}

export function pauseAgentRun(ventureId: string, runId: string): Promise<AgentRun> {
  return postJson(`/api/ventures/${ventureId}/agent-runs/${runId}/pause`, {}, "Failed to pause");
}

export function resumeAgentRun(ventureId: string, runId: string): Promise<AgentRun> {
  return postJson(`/api/ventures/${ventureId}/agent-runs/${runId}/resume`, {}, "Failed to resume");
}

/** One stage's agent for a venture, for "My AI Agents". */
export type VentureAgent = {
  stage_number: number;
  slug: string;
  title_en: string;
  title_ko: string;
  /** False when the stage has no agent (Stage 15 isn't built yet). */
  available: boolean;
  /** Stages to complete before this one unlocks (empty when unlocked). */
  locked_by: string[];
  runs: number;
  total_active_ms: number;
  total_tokens: number;
  latest: {
    id: string;
    status: AgentRunStatus;
    error: AgentRun["error"];
    pending_question: string | null;
    created_at: string;
  } | null;
};

export function listVentureAgents(ventureId: string): Promise<VentureAgent[]> {
  return authRequest(`/api/ventures/${ventureId}/agents`, { method: "GET" }, "Failed to load the AI agents");
}

/** The stage's most recent agent run, or null if it never ran. */
export function getLatestAgentRun(ventureId: string, stageSlug: string): Promise<AgentRun | null> {
  return authRequest(
    `/api/ventures/${ventureId}/stages/${stageSlug}/agent-runs/latest`,
    { method: "GET" },
    "Failed to load the AI agent",
  );
}

export function answerAgentRun(ventureId: string, runId: string, answer: string): Promise<AgentRun> {
  return postJson(
    `/api/ventures/${ventureId}/agent-runs/${runId}/answer`,
    { answer },
    "Failed to send the answer",
  );
}

export function cancelAgentRun(ventureId: string, runId: string): Promise<AgentRun> {
  return postJson(`/api/ventures/${ventureId}/agent-runs/${runId}/cancel`, {}, "Failed to cancel");
}

// --- Token usage and limits (Settings -> Token Usage) ---------------------------

export type TokenLimits = {
  /** null means no limit. */
  per_venture_limit: number | null;
  organization_limit: number | null;
};

export type TokenUsage = {
  ventures: { venture_id: string | null; title: string | null; archived: boolean; tokens: number }[];
  organization_total: number;
  limits: TokenLimits;
  updated_at: string | null;
  /** Owners and admins can change the limits. */
  can_edit: boolean;
};

export function getTokenUsage(): Promise<TokenUsage> {
  return authRequest("/api/token-usage", { method: "GET" }, "Failed to load token usage");
}

export function updateTokenLimits(limits: TokenLimits): Promise<TokenUsage> {
  return authRequest(
    "/api/token-usage/limits",
    { method: "PUT", body: JSON.stringify(limits) },
    "Failed to save the token limits",
  );
}

// --- Professor Notes and Study Guide (per stage) ---------------------------------

export type LearningKind = "professor_notes" | "study_guide";

type LearningMeta = { stage_slug: string; language: "en" | "ko"; generated_at: string };

export type ProfessorNotesContent = LearningMeta & {
  kind: "professor_notes";
  overview: string;
  learning_objectives: string[];
  core_concepts: { name: string; explanation: string; why_it_matters: string }[];
  frameworks: { name: string; how_to_use: string }[];
  teaching_plan: { minutes: number; activity: string }[];
  discussion_questions: string[];
  common_misconceptions: { misconception: string; correction: string }[];
  class_activity: { title: string; instructions: string[]; deliverable: string };
  assessment_ideas: string[];
  example_from_this_venture: string;
};

export type StudyGuideContent = LearningMeta & {
  kind: "study_guide";
  overview: string;
  learning_objectives: string[];
  key_terms: { term: string; definition: string }[];
  concepts_explained: { concept: string; explanation: string; example: string }[];
  worked_example: string;
  self_check: { question: string; options: string[]; answer_index: number; explanation: string }[];
  practice_exercise: { task: string; steps: string[]; success_criteria: string[] };
  summary_points: string[];
};

export type LearningContent = ProfessorNotesContent | StudyGuideContent;

/** The saved material for this stage and language, or null when none was written yet. */
export async function getLearning(
  ventureId: string,
  stageSlug: string,
  kind: LearningKind,
  language: "en" | "ko",
): Promise<LearningContent | null> {
  try {
    return await authRequest(
      `/api/ventures/${ventureId}/stages/${stageSlug}/learning/${kind}?language=${language}`,
      { method: "GET" },
      "Failed to load",
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Writes fresh Professor Notes / a fresh Study Guide for this stage (AI). */
export function generateLearning(
  ventureId: string,
  stageSlug: string,
  kind: LearningKind,
  language: "en" | "ko",
): Promise<LearningContent> {
  return postJson(`/api/ventures/${ventureId}/stages/${stageSlug}/learning/${kind}`, { language }, "Failed to write");
}

// --- External data sources (Stage 1 -> External Source) --------------------------

export type ExternalSource = {
  id: string;
  name: string;
  /** https://..., with a {query} placeholder. */
  url_template: string;
  header_name: string | null;
  /** The key itself is never sent back. */
  has_key: boolean;
  enabled: boolean;
  last_status: "ok" | "error" | null;
  last_error: string | null;
  last_used_at: string | null;
};

export type ExternalSourceList = { sources: ExternalSource[]; can_edit: boolean; keys_supported: boolean };

export function listExternalSources(): Promise<ExternalSourceList> {
  return authRequest("/api/external-sources", { method: "GET" }, "Failed to load external sources");
}

export function createExternalSource(source: {
  name: string;
  url_template: string;
  header_name: string | null;
  api_key: string | null;
}): Promise<ExternalSource> {
  return postJson("/api/external-sources", source, "Failed to add the source");
}

/** api_key: left out keeps the saved key; "" removes it. */
export function updateExternalSource(
  id: string,
  change: { name?: string; url_template?: string; header_name?: string; api_key?: string; enabled?: boolean },
): Promise<ExternalSource> {
  return authRequest(`/api/external-sources/${id}`, { method: "PATCH", body: JSON.stringify(change) }, "Failed to update the source");
}

export function deleteExternalSource(id: string): Promise<void> {
  return authRequest(`/api/external-sources/${id}`, { method: "DELETE" }, "Failed to delete the source");
}

export function testExternalSource(
  id: string,
): Promise<{ status: "ok" | "error"; error: string | null; items: number; sample_titles: string[] }> {
  return postJson(`/api/external-sources/${id}/test`, {}, "Failed to test the source");
}

/** The venture's presentation deck (.pptx), built by the server from every stage. */
export async function downloadDeck(
  ventureId: string,
  language: "en" | "ko",
): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(
    `${API_URL}/api/ventures/${encodeURIComponent(ventureId)}/deck.pptx?language=${language}`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new ApiError(`Failed to create the deck: ${response.status}`, response.status, null);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? "venture-deck.pptx" };
}

export function isFinancialAnalysis(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is FinancialAnalysisAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "financial_analysis";
}

export function isValidationPlan(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is ValidationPlanAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "validation_plan";
}

export function isMvp(analysis: WizardStageStatus["ai_analysis"]): analysis is MvpAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "mvp";
}

/** URL of a venture's generated file (same origin in production via the /api rewrite). */
export function assetUrl(ventureId: string, assetId: string): string {
  return `${API_URL}/api/ventures/${encodeURIComponent(ventureId)}/assets/${encodeURIComponent(assetId)}`;
}

export function isAlternativesResearch(
  analysis: WizardStageStatus["ai_analysis"],
): analysis is AlternativesResearchAnalysis {
  return !!analysis && "kind" in analysis && analysis.kind === "alternatives_research";
}

export function researchStage(
  ventureId: string,
  stageSlug: "existing_alternatives",
  language: "en" | "ko",
): Promise<AlternativesResearchAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "market_evidence",
  language: "en" | "ko",
): Promise<MarketResearchAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "competitive_position",
  language: "en" | "ko",
): Promise<CompetitivePositionAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "dfv_assessment",
  language: "en" | "ko",
): Promise<DfvAssessmentAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "business_model",
  language: "en" | "ko",
): Promise<BusinessModelAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "mvp",
  language: "en" | "ko",
): Promise<MvpAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "validation_plan",
  language: "en" | "ko",
): Promise<ValidationPlanAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "financial_analysis",
  language: "en" | "ko",
): Promise<FinancialAnalysisAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "marketing_plan",
  language: "en" | "ko",
): Promise<MarketingPlanAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: "persona_validation",
  language: "en" | "ko",
): Promise<PersonaInsightsAnalysis>;
export function researchStage(
  ventureId: string,
  stageSlug: ResearchStageSlug,
  language: "en" | "ko",
): Promise<
  | IdeaResearchAnalysis
  | AlternativesResearchAnalysis
  | MarketResearchAnalysis
  | CompetitivePositionAnalysis
  | DfvAssessmentAnalysis
  | BusinessModelAnalysis
  | MvpAnalysis
  | ValidationPlanAnalysis
  | FinancialAnalysisAnalysis
  | MarketingPlanAnalysis
  | PersonaInsightsAnalysis
>;
export function researchStage(ventureId: string, stageSlug: ResearchStageSlug, language: "en" | "ko") {
  return postJson(
    `/api/ventures/${ventureId}/stages/${stageSlug}/research`,
    { language },
    "Failed to run research",
  );
}

export function researchIdea(
  ventureId: string,
  language: "en" | "ko",
): Promise<IdeaResearchAnalysis> {
  return postJson(
    `/api/ventures/${ventureId}/stages/idea_discovery/research`,
    { language },
    "Failed to research idea",
  );
}

// Identity travels in the HttpOnly session cookie set at sign-in (see
// backend/app/routers/auth.py). JavaScript never sees it; every request just
// includes credentials so the browser sends it along.
const JSON_HEADERS: HeadersInit = { "Content-Type": "application/json" };

async function authRequest<T>(path: string, init: RequestInit, failure: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: JSON_HEADERS,
  });
  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // Not JSON (e.g. a proxy error page) -- the status alone will do.
    }
    throw new ApiError(`${failure}: ${response.status}`, response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function getAuthConfig(): Promise<AuthConfig> {
  return authRequest("/api/auth/config", { method: "GET" }, "Failed to load sign-in options");
}

export function googleLogin(credential: string): Promise<SessionInfo> {
  return authRequest(
    "/api/auth/google",
    { method: "POST", body: JSON.stringify({ credential }) },
    "Failed to sign in with Google",
  );
}

export function devLogin(email: string): Promise<SessionInfo> {
  return authRequest(
    "/api/auth/dev-login",
    { method: "POST", body: JSON.stringify({ email }) },
    "Failed to sign in",
  );
}

export function selectOrganization(slug: string): Promise<SessionInfo> {
  return authRequest(
    "/api/auth/select-organization",
    { method: "POST", body: JSON.stringify({ slug }) },
    "Failed to select organization",
  );
}

export type Affiliation =
  | "woosong_student"
  | "woosong_faculty_staff"
  | "woosong_alumni"
  | "external_founder"
  | "other";

export type SignupPayload = {
  full_name: string;
  email: string;
  password: string;
  affiliation: Affiliation;
  affiliation_name: string | null;
  department: string | null;
  preferred_language: "en" | "ko";
  access_reason: string;
  accept_terms: boolean;
  accept_privacy: boolean;
  accept_ai_processing: boolean;
};

type StatusResult = { status: string };

type StageAnalysisValue = NonNullable<WizardStageStatus["ai_analysis"]>;

/** The language an analysis was written in (generic feedback: English). */
export function analysisLanguage(analysis: StageAnalysisValue): "en" | "ko" {
  const language = "language" in analysis ? analysis.language : undefined;
  return language === "ko" ? "ko" : "en";
}

/** Must match TRANSLATION_VERSION in backend/app/wizard/translation.py. */
const TRANSLATION_VERSION = 2;

/** A cached translation of this very analysis into the language, made with
 * the current translation rules; null otherwise (the server redoes it). */
export function cachedTranslation(analysis: StageAnalysisValue, language: "en" | "ko"): StageAnalysisValue | null {
  const translations = (analysis as { translations?: Record<string, StageAnalysisValue> }).translations;
  const cached = translations?.[language] as
    | (StageAnalysisValue & { researched_at?: string; translation_version?: number })
    | undefined;
  const researchedAt = (analysis as { researched_at?: string }).researched_at;
  return cached && cached.researched_at === researchedAt && cached.translation_version === TRANSLATION_VERSION
    ? cached
    : null;
}

/** The stage's saved analysis translated by the server (cached there after the first time). */
export function translateStageAnalysis(
  ventureId: string,
  stageSlug: string,
  language: "en" | "ko",
): Promise<StageAnalysisValue> {
  return postJson(
    `/api/ventures/${ventureId}/stages/${stageSlug}/translate`,
    { language },
    "Failed to translate",
  );
}

function postJson<T>(path: string, body: unknown, failure: string): Promise<T> {
  return authRequest(path, { method: "POST", body: JSON.stringify(body) }, failure);
}

export function signup(payload: SignupPayload): Promise<StatusResult> {
  return postJson("/api/auth/signup", payload, "Failed to sign up");
}

export function verifyEmail(email: string, code: string, password: string): Promise<StatusResult> {
  return postJson("/api/auth/verify-email", { email, code, password }, "Failed to verify email");
}

export function resendVerification(email: string): Promise<StatusResult> {
  return postJson("/api/auth/resend-verification", { email }, "Failed to resend code");
}

export function passwordLogin(email: string, password: string): Promise<SessionInfo> {
  return postJson("/api/auth/login", { email, password }, "Failed to sign in");
}

export function forgotPassword(email: string): Promise<StatusResult> {
  return postJson("/api/auth/forgot-password", { email }, "Failed to request reset code");
}

export function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<StatusResult> {
  return postJson(
    "/api/auth/reset-password",
    { email, code, new_password: newPassword },
    "Failed to reset password",
  );
}

/** Saves the signed-in user's default location; empty strings clear it. */
export function updatePreferences(preferences: {
  default_country: string;
  default_metro_city: string;
}): Promise<SessionInfo> {
  return authRequest(
    "/api/auth/me/preferences",
    { method: "PATCH", body: JSON.stringify(preferences) },
    "Failed to save settings",
  );
}

export function getMe(): Promise<SessionInfo> {
  return authRequest("/api/auth/me", { method: "GET" }, "Failed to load session");
}

export function logout(): Promise<void> {
  return authRequest("/api/auth/logout", { method: "POST" }, "Failed to sign out");
}

export async function createVenture(idea: string): Promise<Venture> {
  return authRequest<Venture>(
    "/api/ventures",
    { method: "POST", body: JSON.stringify({ idea }) },
    "Failed to create venture",
  );
}

export async function interpretIdea(ventureId: string): Promise<IdeaInterpretation> {
  return authRequest<IdeaInterpretation>(
    `/api/ventures/${ventureId}/interpret`,
    { method: "POST" },
    "Failed to interpret idea",
  );
}

export async function getVenture(ventureId: string): Promise<Venture> {
  const response = await fetch(`${API_URL}/api/ventures/${ventureId}`, {
    credentials: "include",
    headers: JSON_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to load venture: ${response.status}`);
  }

  return response.json();
}

export async function listStages(ventureId: string): Promise<WizardStageStatus[]> {
  const response = await fetch(`${API_URL}/api/ventures/${ventureId}/stages`, {
    credentials: "include",
    headers: JSON_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to list stages: ${response.status}`);
  }

  return response.json();
}

export async function updateStage(
  ventureId: string,
  stageSlug: string,
  body: { answers: Record<string, unknown>; complete: boolean },
): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/ventures/${ventureId}/stages/${stageSlug}`,
    {
      method: "PUT",
      credentials: "include",
    headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to update stage: ${response.status}`);
  }
}

/**
 * "Ask AI Mentor Feedback": weighs the AI Mentor Agent's drafts against the
 * answers on the page (sent as they are, saved or not). The server refuses
 * with 422 "agent_not_run" or "no_answers" when either is missing.
 */
export async function analyzeStage(
  ventureId: string,
  stageSlug: string,
  answers: Record<string, unknown>,
): Promise<void> {
  await postJson(
    `/api/ventures/${ventureId}/stages/${stageSlug}/analyze`,
    { answers },
    "Failed to analyze stage",
  );
}

export async function confirmIdea(
  ventureId: string,
  interpretation: IdeaInterpretation,
): Promise<Venture> {
  const response = await fetch(`${API_URL}/api/ventures/${ventureId}/confirm-idea`, {
    method: "POST",
    credentials: "include",
    headers: JSON_HEADERS,
    body: JSON.stringify(interpretation),
  });

  if (!response.ok) {
    throw new Error(`Failed to confirm idea: ${response.status}`);
  }

  return response.json();
}

// --- Admin dashboard: sign-up review ---

export type SignupStatus = "pending" | "approved" | "rejected";

export type SignupReviewItem = {
  id: string;
  full_name: string | null;
  email: string;
  affiliation: Affiliation | null;
  affiliation_name: string | null;
  department: string | null;
  preferred_language: "en" | "ko";
  access_reason: string | null;
  registered_at: string;
  verified_at: string | null;
  status: SignupStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
  organizations: string[];
};

export type AdminOrganization = {
  slug: string;
  name: string;
  grantable_roles: ("member" | "admin" | "owner")[];
};

export type ReviewResult = { status: string; email_sent: boolean };

export function listSignups(status: SignupStatus): Promise<SignupReviewItem[]> {
  return authRequest(
    `/api/admin/signups?status=${status}`,
    { method: "GET" },
    "Failed to load sign-ups",
  );
}

export function listAdminOrganizations(): Promise<AdminOrganization[]> {
  return authRequest("/api/admin/organizations", { method: "GET" }, "Failed to load organizations");
}

export function approveSignup(
  userId: string,
  organizationSlug: string,
  role: string,
): Promise<ReviewResult> {
  return postJson(
    `/api/admin/signups/${userId}/approve`,
    { organization_slug: organizationSlug, role },
    "Failed to approve sign-up",
  );
}

export function rejectSignup(userId: string, note: string): Promise<ReviewResult> {
  return postJson(
    `/api/admin/signups/${userId}/reject`,
    { note: note.trim() || null },
    "Failed to reject sign-up",
  );
}

// --- Remembered work: venture list and research history ---

export type VentureSummary = Venture & {
  completed_stages: number;
  total_stages: number;
  feasibility_score: number | null;
  researched_at: string | null;
  updated_at: string;
  /** Whether the signed-in user may delete it (decided by the server). */
  can_delete: boolean;
};

/** Permanently deletes a venture and everything it owns. */
/** Proof that it's really the signed-in user: their password, or an emailed code. */
export type Reauth = { password: string } | { code: string };

export type ArchivedVenture = Venture & {
  archived_at: string;
  archived_by_name: string | null;
  completed_stages: number;
  total_stages: number;
};

/** Emails the signed-in user a code to confirm archiving or deleting a venture. */
export function requestReauthCode(ventureId: string): Promise<void> {
  return postJson(`/api/ventures/${ventureId}/reauth-code`, {}, "Failed to send the code");
}

/** Archives the venture: hidden everywhere, everything kept, restorable. */
export function archiveVenture(ventureId: string, reauth: Reauth): Promise<void> {
  return postJson(`/api/ventures/${ventureId}/archive`, reauth, "Failed to archive venture");
}

export function listArchivedVentures(): Promise<ArchivedVenture[]> {
  return authRequest("/api/ventures/archived", { method: "GET" }, "Failed to load archived ventures");
}

export function restoreVenture(ventureId: string): Promise<Venture> {
  return postJson(`/api/ventures/${ventureId}/restore`, {}, "Failed to restore venture");
}

/** Permanently deletes an archived venture. */
export function deleteVenture(ventureId: string, reauth: Reauth): Promise<void> {
  return postJson(`/api/ventures/${ventureId}/delete-permanently`, reauth, "Failed to delete venture");
}

/** The archived venture -- all stages, research, revisions and chats -- as one JSON file. */
export async function downloadVentureArchive(ventureId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(
    `${API_URL}/api/ventures/${encodeURIComponent(ventureId)}/archive/export`,
    { method: "GET", credentials: "include" },
  );
  if (!response.ok) {
    throw new ApiError(`Failed to download the archive: ${response.status}`, response.status, null);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match?.[1] ?? "weeaim-archive.json" };
}

export type ResearchRun = {
  id: string;
  created_at: string;
  research:
    | IdeaResearchAnalysis
    | AlternativesResearchAnalysis
    | MarketResearchAnalysis
    | CompetitivePositionAnalysis
    | DfvAssessmentAnalysis
    | BusinessModelAnalysis
    | MvpAnalysis
    | ValidationPlanAnalysis
    | FinancialAnalysisAnalysis
    | MarketingPlanAnalysis
    | PersonaInsightsAnalysis;
};

export function listVentures(): Promise<VentureSummary[]> {
  return authRequest("/api/ventures", { method: "GET" }, "Failed to load ventures");
}

export function researchHistory(ventureId: string): Promise<ResearchRun[]> {
  return stageResearchHistory(ventureId, "idea_discovery");
}

/** Every saved research run for a stage, newest first. */
export function stageResearchHistory(
  ventureId: string,
  stageSlug: ResearchStageSlug,
): Promise<ResearchRun[]> {
  return authRequest(
    `/api/ventures/${ventureId}/stages/${stageSlug}/research/history`,
    { method: "GET" },
    "Failed to load research history",
  );
}
