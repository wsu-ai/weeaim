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

// Dev-only headers standing in for real auth -- see backend/app/auth.py.
// Removed once a real identity provider is wired up.
export async function createVenture(idea: string): Promise<Venture> {
  const response = await fetch(`${API_URL}/api/ventures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-User-Email": DEV_USER_EMAIL ?? "",
      "X-Dev-Organization-Slug": DEV_ORG_SLUG ?? "",
    },
    body: JSON.stringify({ idea }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create venture: ${response.status}`);
  }

  return response.json();
}
