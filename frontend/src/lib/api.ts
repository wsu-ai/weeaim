const API_URL = process.env.NEXT_PUBLIC_API_URL;

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
  type: "text" | "list";
};

export type WizardStageStatus = {
  slug: string;
  number: number;
  title_en: string;
  title_ko: string;
  implemented: boolean;
  status: string;
  answers: Record<string, unknown> | null;
  ai_analysis: StageFeedback | IdeaResearchAnalysis | AlternativesResearchAnalysis | null;
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

export type ResearchStageSlug = "idea_discovery" | "existing_alternatives";

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
  stageSlug: ResearchStageSlug,
  language: "en" | "ko",
): Promise<IdeaResearchAnalysis | AlternativesResearchAnalysis>;
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

export function getMe(): Promise<SessionInfo> {
  return authRequest("/api/auth/me", { method: "GET" }, "Failed to load session");
}

export function logout(): Promise<void> {
  return authRequest("/api/auth/logout", { method: "POST" }, "Failed to sign out");
}

export async function createVenture(idea: string): Promise<Venture> {
  const response = await fetch(`${API_URL}/api/ventures`, {
    method: "POST",
    credentials: "include",
    headers: JSON_HEADERS,
    body: JSON.stringify({ idea }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create venture: ${response.status}`);
  }

  return response.json();
}

export async function interpretIdea(ventureId: string): Promise<IdeaInterpretation> {
  const response = await fetch(`${API_URL}/api/ventures/${ventureId}/interpret`, {
    method: "POST",
    credentials: "include",
    headers: JSON_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to interpret idea: ${response.status}`);
  }

  return response.json();
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

export async function analyzeStage(ventureId: string, stageSlug: string): Promise<void> {
  const response = await fetch(
    `${API_URL}/api/ventures/${ventureId}/stages/${stageSlug}/analyze`,
    {
      method: "POST",
      credentials: "include",
    headers: JSON_HEADERS,
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to analyze stage: ${response.status}`);
  }
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
export function deleteVenture(ventureId: string): Promise<void> {
  return authRequest(`/api/ventures/${ventureId}`, { method: "DELETE" }, "Failed to delete venture");
}

export type ResearchRun = {
  id: string;
  created_at: string;
  research: IdeaResearchAnalysis | AlternativesResearchAnalysis;
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
