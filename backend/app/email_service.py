import logging
import httpx
from app.config import Settings

logger = logging.getLogger(__name__)

EMAILJS_API_URL = "https://api.emailjs.com/api/v1.0/email/send"

# Alias mappings for EmailJS template variables.
# Extra keys are harmless because EmailJS simply ignores unused template parameters.
OTP_CODE_ALIASES = (
    "otp_code",
    "otp",
    "code",
    "passcode",
    "access_code",
    "verification_code",
)

EXPIRY_ALIASES = (
    "expires_in_minutes",
    "expires_in",
    "expiry",
    "expiry_minutes",
    "expires_minutes",
)

RECIPIENT_ALIASES = (
    "to_email",
    "email",
    "user_email",
    "recipient",
    "reply_to",
)

RESET_LINK_ALIASES = (
    "reset_link",
    "link",
    "reset_url",
    "url",
)


class EmailSendError(Exception):
    """Raised when sending an email via EmailJS fails."""
    pass


def expand_template_params(to_email: str, raw_params: dict | None = None) -> dict:
    """
    Expands common email parameters into multiple variable name aliases.
    Extra keys are harmless because EmailJS ignores unused parameters in templates.
    """
    params = raw_params.copy() if raw_params else {}
    expanded = {}

    # 1. Recipient aliases
    for alias in RECIPIENT_ALIASES:
        expanded[alias] = to_email
    expanded["to_name"] = to_email.split("@")[0]

    # 2. App name
    expanded["app_name"] = params.get("app_name", "Pragna-1 A")

    # 3. Code / OTP aliases
    code_val = None
    for k in OTP_CODE_ALIASES:
        if k in params:
            code_val = params[k]
            break
    if code_val is not None:
        for alias in OTP_CODE_ALIASES:
            expanded[alias] = code_val

    # 4. Expiry aliases (number only)
    expiry_val = None
    for k in EXPIRY_ALIASES:
        if k in params:
            expiry_val = params[k]
            break
    if expiry_val is not None:
        for alias in EXPIRY_ALIASES:
            expanded[alias] = expiry_val

    # 5. Reset link aliases
    link_val = None
    for k in RESET_LINK_ALIASES:
        if k in params:
            link_val = params[k]
            break
    if link_val is not None:
        for alias in RESET_LINK_ALIASES:
            expanded[alias] = link_val

    # 6. Include any remaining custom params from caller
    for k, v in params.items():
        if k not in expanded:
            expanded[k] = v

    return expanded


async def send_email(settings: Settings, template_id: str, to_email: str, params: dict) -> None:
    if not settings.is_emailjs_configured():
        raise EmailSendError("EmailJS is not fully configured.")

    template_params = expand_template_params(to_email, params)

    # Debug log line printing ONLY the list of param key names sent (never values or secrets)
    logger.debug("EmailJS sending template_params keys: %s", sorted(list(template_params.keys())))

    payload = {
        "service_id": settings.emailjs_service_id,
        "template_id": template_id,
        "user_id": settings.emailjs_public_key,
        "accessToken": settings.emailjs_private_key,
        "template_params": template_params,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(EMAILJS_API_URL, json=payload)
            if resp.status_code != 200:
                logger.error(
                    "EmailJS error: status=%d body=%s",
                    resp.status_code,
                    resp.text,
                )
                raise EmailSendError(f"EmailJS returned non-200 status: {resp.status_code}")
    except httpx.HTTPError as exc:
        logger.error("EmailJS HTTP network error: %s", exc)
        raise EmailSendError(f"Network error communicating with EmailJS: {exc}") from exc
