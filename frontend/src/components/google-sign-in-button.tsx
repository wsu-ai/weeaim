"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";

type GoogleSignInButtonProps = {
  clientId: string;
  locale: string;
  onCredential: (credential: string) => void;
};

/** Google's official "Sign in with Google" button (Google Identity Services). */
export function GoogleSignInButton({ clientId, locale, onCredential }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // Keep the latest callback without re-initializing Google on every render.
  const onCredentialRef = useRef(onCredential);
  useEffect(() => {
    onCredentialRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    const gis = window.google?.accounts.id;
    if (!scriptReady || !gis || !containerRef.current) return;

    gis.initialize({
      client_id: clientId,
      ux_mode: "popup",
      callback: (response) => {
        if (response.credential) onCredentialRef.current(response.credential);
      },
    });
    gis.renderButton(containerRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "pill",
      width: 300,
      locale,
    });
  }, [scriptReady, clientId, locale]);

  return (
    <>
      <Script src={GSI_SCRIPT_URL} strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <div ref={containerRef} className="flex min-h-11 justify-center" data-testid="google-sign-in" />
    </>
  );
}
