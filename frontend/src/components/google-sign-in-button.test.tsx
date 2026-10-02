import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleSignInButton } from "./google-sign-in-button";

// next/script doesn't load anything under jsdom; report the script as ready
// straight away, as the browser would once accounts.google.com responds.
vi.mock("next/script", () => ({
  default: ({ onReady }: { onReady?: () => void }) => {
    onReady?.();
    return null;
  },
}));

afterEach(() => {
  delete window.google;
});

function stubGoogle() {
  const initialize = vi.fn();
  const renderButton = vi.fn();
  window.google = { accounts: { id: { initialize, renderButton } } };
  return { initialize, renderButton };
}

describe("GoogleSignInButton", () => {
  it("initializes Google Identity Services and renders the official button", () => {
    const { initialize, renderButton } = stubGoogle();
    render(<GoogleSignInButton clientId="client-123" locale="ko" onCredential={vi.fn()} />);

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "client-123", ux_mode: "popup" }),
    );
    expect(renderButton).toHaveBeenCalledWith(
      screen.getByTestId("google-sign-in"),
      expect.objectContaining({ locale: "ko", text: "signin_with" }),
    );
  });

  it("passes Google's credential to the callback", () => {
    const { initialize } = stubGoogle();
    const onCredential = vi.fn();
    render(<GoogleSignInButton clientId="client-123" locale="en" onCredential={onCredential} />);

    const { callback } = initialize.mock.calls[0][0];
    callback({ credential: "id-token-from-google" });
    callback({});

    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(onCredential).toHaveBeenCalledWith("id-token-from-google");
  });
});
