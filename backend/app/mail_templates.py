"""Plain-text email content, in the recipient's preferred language."""

from app.mailer import OutgoingEmail

_SIGNATURE = {
    "en": "\n\n— WEEAIM (Woosong Evidence-based Entrepreneurship AI Model)",
    "ko": "\n\n— WEEAIM (Woosong Evidence-based Entrepreneurship AI Model)",
}


def _lang(language: str | None) -> str:
    return language if language in ("en", "ko") else "en"


def _email(to: str, language: str | None, subjects: dict, bodies: dict) -> OutgoingEmail:
    lang = _lang(language)
    return OutgoingEmail(to=to, subject=subjects[lang], body=bodies[lang] + _SIGNATURE[lang])


def verification_code(to: str, language: str | None, code: str, ttl_minutes: int) -> OutgoingEmail:
    return _email(
        to,
        language,
        {"en": "Your WEEAIM verification code", "ko": "WEEAIM 이메일 인증 코드"},
        {
            "en": (
                f"Your verification code is: {code}\n\n"
                f"Enter it on the WEEAIM sign-up page within {ttl_minutes} minutes.\n"
                "If you didn't try to create a WEEAIM account, you can ignore this email."
            ),
            "ko": (
                f"인증 코드: {code}\n\n"
                f"{ttl_minutes}분 이내에 WEEAIM 회원가입 화면에 입력해 주세요.\n"
                "WEEAIM 계정을 만들려고 하지 않으셨다면 이 메일을 무시하셔도 됩니다."
            ),
        },
    )


def password_reset_code(to: str, language: str | None, code: str, ttl_minutes: int) -> OutgoingEmail:
    return _email(
        to,
        language,
        {"en": "Your WEEAIM password reset code", "ko": "WEEAIM 비밀번호 재설정 코드"},
        {
            "en": (
                f"Your password reset code is: {code}\n\n"
                f"It expires in {ttl_minutes} minutes.\n"
                "If you didn't ask to reset your password, you can ignore this email; "
                "your password hasn't changed."
            ),
            "ko": (
                f"비밀번호 재설정 코드: {code}\n\n"
                f"이 코드는 {ttl_minutes}분 후에 만료됩니다.\n"
                "비밀번호 재설정을 요청하지 않으셨다면 이 메일을 무시하셔도 됩니다. "
                "비밀번호는 변경되지 않았습니다."
            ),
        },
    )


def venture_action_code(to: str, language: str | None, code: str, ttl_minutes: int, title: str) -> OutgoingEmail:
    return _email(
        to,
        language,
        {"en": "Your WEEAIM confirmation code", "ko": "WEEAIM 확인 코드"},
        {
            "en": (
                f"Your code to confirm removing the venture \"{title}\" is: {code}\n\n"
                f"It expires in {ttl_minutes} minutes.\n"
                "If you didn't ask for this, you can ignore this email; nothing has changed."
            ),
            "ko": (
                f"벤처 \"{title}\" 삭제를 확인하는 코드: {code}\n\n"
                f"이 코드는 {ttl_minutes}분 후에 만료됩니다.\n"
                "요청하지 않으셨다면 이 메일을 무시하셔도 됩니다. 변경된 것은 없습니다."
            ),
        },
    )


def already_registered(to: str, language: str | None) -> OutgoingEmail:
    return _email(
        to,
        language,
        {"en": "WEEAIM sign-up attempt", "ko": "WEEAIM 회원가입 시도 안내"},
        {
            "en": (
                "Someone tried to create a WEEAIM account with this email address, "
                "but an account already exists.\n\n"
                "If it was you, sign in instead, or use \"Forgot password?\" on the "
                "sign-in page. If it wasn't you, no action is needed."
            ),
            "ko": (
                "이 이메일 주소로 WEEAIM 계정 생성이 시도되었지만, 이미 계정이 존재합니다.\n\n"
                "본인이 시도하셨다면 로그인하시거나, 로그인 화면의 \"비밀번호 찾기\"를 이용해 주세요. "
                "본인이 아니라면 별도로 조치하실 필요는 없습니다."
            ),
        },
    )


def account_approved(to: str, language: str | None, organization_name: str) -> OutgoingEmail:
    return _email(
        to,
        language,
        {"en": "Your WEEAIM account is approved", "ko": "WEEAIM 계정이 승인되었습니다"},
        {
            "en": (
                f"Good news: your WEEAIM account has been approved for {organization_name}.\n\n"
                "You can now sign in with your email address and password."
            ),
            "ko": (
                f"WEEAIM 계정이 {organization_name} 소속으로 승인되었습니다.\n\n"
                "이제 이메일 주소와 비밀번호로 로그인하실 수 있습니다."
            ),
        },
    )


def account_rejected(to: str, language: str | None, note: str | None) -> OutgoingEmail:
    note_en = f"\n\nNote from the administrator: {note}" if note else ""
    note_ko = f"\n\n관리자 메모: {note}" if note else ""
    return _email(
        to,
        language,
        {"en": "Your WEEAIM access request", "ko": "WEEAIM 이용 신청 결과"},
        {
            "en": (
                "Thank you for your interest in WEEAIM. Unfortunately, your access "
                f"request was not approved.{note_en}"
            ),
            "ko": f"WEEAIM에 관심을 가져 주셔서 감사합니다. 아쉽게도 이용 신청이 승인되지 않았습니다.{note_ko}",
        },
    )


def new_signup_for_admin(
    to: str,
    *,
    full_name: str,
    email: str,
    affiliation: str,
    affiliation_name: str | None,
    department: str | None,
    access_reason: str,
) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject=f"WEEAIM: new sign-up awaiting approval ({email})",
        body=(
            "A new user verified their email and is awaiting approval.\n\n"
            f"Name: {full_name}\n"
            f"Email: {email}\n"
            f"Affiliation: {affiliation}"
            + (f" ({affiliation_name})" if affiliation_name else "")
            + "\n"
            + (f"Department/major: {department}\n" if department else "")
            + f"Planned use: {access_reason}\n\n"
            "Approve or reject from backend/ with:\n"
            f"  python -m scripts.manage_signups approve --email {email} --org-slug <slug>\n"
            f"  python -m scripts.manage_signups reject --email {email}"
        ),
    )
