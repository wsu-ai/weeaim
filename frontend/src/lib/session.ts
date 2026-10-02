"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { ApiError, getMe, type SessionInfo } from "@/lib/api";

// The session itself lives in an HttpOnly cookie the browser can't read;
// this asks the backend who is signed in. UX only -- the backend checks the
// cookie on every API call regardless of what the UI thinks.
export const SESSION_QUERY_KEY = ["session"] as const;

async function fetchSession(): Promise<SessionInfo | null> {
  try {
    return await getMe();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** `data` is undefined while loading, null when signed out. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Whether to show admin features: owner or admin of any organization.
 * Display only -- the backend checks the role on every admin request.
 */
export function isAdmin(session: SessionInfo | null | undefined): boolean {
  return !!session?.organizations.some((org) => org.role === "owner" || org.role === "admin");
}

/** Stores the session returned by a sign-in/select/logout call. */
export function useSetSession() {
  const queryClient = useQueryClient();
  return useCallback(
    (session: SessionInfo | null) => queryClient.setQueryData(SESSION_QUERY_KEY, session),
    [queryClient],
  );
}
