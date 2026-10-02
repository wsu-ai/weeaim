"""Password hashing (Argon2id) and the password policy.

Policy follows NIST SP 800-63B: a length minimum and no forced character
classes. Hashing is CPU-heavy by design -- call from a threadpool in async code.
"""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 128

_hasher = PasswordHasher()
# Verified against when an account has no password (or doesn't exist), so
# the response takes as long as a real check and doesn't reveal which.
_DUMMY_HASH = _hasher.hash("weeaim-timing-equalizer")


def password_problem(password: str, email: str) -> str | None:
    """Returns why the password is unacceptable, or None if it's fine."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return "password_too_short"
    if len(password) > MAX_PASSWORD_LENGTH:
        return "password_too_long"
    local_part = email.split("@", 1)[0].lower()
    if len(local_part) >= 3 and local_part in password.lower():
        return "password_contains_email"
    return None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
