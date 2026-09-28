const API_URL = process.env.NEXT_PUBLIC_API_URL;
const DEV_USER_EMAIL = process.env.NEXT_PUBLIC_DEV_USER_EMAIL;
const DEV_ORG_SLUG = process.env.NEXT_PUBLIC_DEV_ORG_SLUG;

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
  ai_analysis: {
    summary: string;
    strengths: string[];
    gaps: string[];
    suggested_next_steps: string[];
    confidence: number;
  } | null;
  question_schema?: { fields: StageField[] } | null;
};

// Dev-only headers standing in for real auth -- see backend/app/auth.py.
// Removed once a real identity provider is wired up.
function devAuthHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Dev-User-Email": DEV_USER_EMAIL ?? "",
    "X-Dev-Organization-Slug": DEV_ORG_SLUG ?? "",
  };
}

export async function createVenture(idea: string): Promise<Venture> {
  const response = await fetch(`${API_URL}/api/ventures`, {
    method: "POST",
    headers: devAuthHeaders(),
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
    headers: devAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to interpret idea: ${response.status}`);
  }

  return response.json();
}

export async function listStages(ventureId: string): Promise<WizardStageStatus[]> {
  const response = await fetch(`${API_URL}/api/ventures/${ventureId}/stages`, {
    headers: devAuthHeaders(),
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
      headers: devAuthHeaders(),
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
      headers: devAuthHeaders(),
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
    headers: devAuthHeaders(),
    body: JSON.stringify(interpretation),
  });

  if (!response.ok) {
    throw new Error(`Failed to confirm idea: ${response.status}`);
  }

  return response.json();
}
