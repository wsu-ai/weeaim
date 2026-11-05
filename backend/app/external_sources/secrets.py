"""Encrypting external sources' API keys at rest.

The Fernet key is derived (HKDF-SHA256) from SOURCE_KEYS_SECRET in .env, so
nothing secret is in the code or the database. A key is decrypted only when
the server calls that source; it's never returned by the API or logged.
"""

import base64

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import settings


class KeyStorageNotConfigured(Exception):
    """SOURCE_KEYS_SECRET isn't set, so keys can't be stored."""


def _fernet() -> Fernet:
    secret = settings.source_keys_secret
    if not secret:
        raise KeyStorageNotConfigured()
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"weeaim-external-source-keys").derive(
        secret.encode()
    )
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt_key(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_key(token: str) -> str | None:
    """The key, or None when it can't be read (e.g. the secret changed)."""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, KeyStorageNotConfigured):
        return None
