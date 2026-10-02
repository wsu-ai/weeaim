"""Outgoing email: verification/reset codes and account notices.

ConsoleEmailSender (the development default) only logs the message, so
sign-up works locally without an email account. SmtpEmailSender sends real
mail via the standard library -- no extra dependency.
"""

import logging
import smtplib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from email.message import EmailMessage

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    body: str


class EmailSender(ABC):
    @abstractmethod
    def send(self, message: OutgoingEmail) -> None:
        """Blocking -- call from a threadpool in async code."""


class ConsoleEmailSender(EmailSender):
    def send(self, message: OutgoingEmail) -> None:
        logger.warning(
            "EMAIL_BACKEND=console -- not sent, logged instead.\n"
            "To: %s\nSubject: %s\n\n%s",
            message.to, message.subject, message.body,
        )


class SmtpEmailSender(EmailSender):
    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        use_tls: bool,
        sender: str,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._use_tls = use_tls
        self._sender = sender

    def send(self, message: OutgoingEmail) -> None:
        email = EmailMessage()
        email["From"] = self._sender
        email["To"] = message.to
        email["Subject"] = message.subject
        email.set_content(message.body)

        with smtplib.SMTP(self._host, self._port, timeout=20) as smtp:
            if self._use_tls:
                smtp.starttls()
            if self._username:
                smtp.login(self._username, self._password)
            smtp.send_message(email)
