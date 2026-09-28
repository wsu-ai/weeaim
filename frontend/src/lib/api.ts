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
