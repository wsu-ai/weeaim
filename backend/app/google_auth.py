"""Verification of Google ID tokens from "Sign in with Google".

The frontend hands us the ID token Google issued to the browser; it is
untrusted until every check here passes. We never call Google's tokeninfo
endpoint -- the token is verified locally against Google's published keys.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")

# Given the raw token, returns the public key that should have signed it.
KeyResolver = Callable[[str], Any]


class InvalidGoogleToken(Exception):
    """The credential is not a valid, verified Google ID token for this app."""


class GoogleKeysUnavailable(Exception):
    """Google's signing keys could not be fetched (network/outage)."""


@dataclass(frozen=True)
class GoogleIdentity:
    subject: str
    email: str
    name: str | None


def google_key_resolver() -> KeyResolver:
    # PyJWKClient caches Google's keys and refetches when a token names a
    # key id it hasn't seen (Google rotates keys regularly).
    client = jwt.PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True)
    return lambda token: client.get_signing_key_from_jwt(token).key


class GoogleTokenVerifier:
    def __init__(self, client_id: str, key_resolver: KeyResolver) -> None:
        self._client_id = client_id
        self._key_resolver = key_resolver

    def verify(self, credential: str) -> GoogleIdentity:
        """Blocking (may fetch keys) -- call from a threadpool in async code."""
        if not self._client_id:
            raise InvalidGoogleToken("Google sign-in is not configured")

        try:
            key = self._key_resolver(credential)
            claims = jwt.decode(
                credential,
                key,
                algorithms=["RS256"],
                audience=self._client_id,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
                leeway=30,
            )
        except jwt.PyJWKClientConnectionError as exc:
            raise GoogleKeysUnavailable(str(exc)) from exc
        except jwt.PyJWTError as exc:
            raise InvalidGoogleToken(str(exc)) from exc

        if claims["iss"] not in GOOGLE_ISSUERS:
            raise InvalidGoogleToken("Unexpected issuer")
        # Only trust the email if Google says the account owns it.
        if claims.get("email_verified") is not True:
            raise InvalidGoogleToken("Email not verified by Google")
        email = claims.get("email")
        if not isinstance(email, str) or not email:
            raise InvalidGoogleToken("Token has no email")
        name = claims.get("name")

        return GoogleIdentity(
            subject=str(claims["sub"]),
            email=email,
            name=name if isinstance(name, str) else None,
        )
