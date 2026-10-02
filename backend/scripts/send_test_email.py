"""Send a test email using the email settings in .env.

Use it to check SMTP settings before relying on sign-up emails:

    python -m scripts.send_test_email --to you@example.com

With EMAIL_BACKEND=console (the default) the message is only printed here,
not sent. See docs/sign-up-and-approval.md for SMTP setup.
"""

import argparse
import logging
import smtplib

from app.config import settings
from app.dependencies import get_email_sender
from app.mailer import OutgoingEmail


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--to", required=True, help="Where to send the test email")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(message)s")

    print(f"EMAIL_BACKEND={settings.email_backend}")
    if settings.email_backend == "smtp":
        print(
            f"SMTP_HOST={settings.smtp_host} SMTP_PORT={settings.smtp_port} "
            f"SMTP_USE_TLS={settings.smtp_use_tls} SMTP_USERNAME={settings.smtp_username or '(none)'} "
            f"EMAIL_FROM={settings.email_from}"
        )
    else:
        print("Console mode: the email below is NOT sent. Set EMAIL_BACKEND=smtp to send for real.")

    message = OutgoingEmail(
        to=args.to,
        subject="WEEAIM test email",
        body="This is a test email from WEEAIM. If you received it, email sending works.",
    )
    try:
        get_email_sender().send(message)
    except smtplib.SMTPAuthenticationError as exc:
        raise SystemExit(
            f"Login to the SMTP server was refused: {exc}\n"
            "Check SMTP_USERNAME/SMTP_PASSWORD (for Gmail, use an App Password, not your normal password)."
        )
    except (smtplib.SMTPException, OSError) as exc:
        raise SystemExit(f"Sending failed: {type(exc).__name__}: {exc}")

    if settings.email_backend == "smtp":
        print(f"Sent to {args.to}. Check the inbox (and the spam folder).")


if __name__ == "__main__":
    main()
