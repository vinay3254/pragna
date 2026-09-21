import secrets
from urllib.parse import urlencode
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import RedirectResponse
from app import repository, oauth_providers
from app.auth import create_access_token

router = APIRouter()

STATE_COOKIE_NAME = "oauth_state"
FRONTEND_COOKIE_NAME = "oauth_frontend"


def _backend_base_url(request: Request) -> str:
    settings = request.app.state.settings
    return (
        settings.backend_public_url
        or "https://pragna-p7ij.onrender.com"
    )


def _frontend_base_url(request: Request) -> str:
    settings = request.app.state.settings
    if settings.frontend_public_url:
        return settings.frontend_public_url.rstrip("/")
    cookie_frontend = request.cookies.get(FRONTEND_COOKIE_NAME)
    if cookie_frontend:
        return cookie_frontend.rstrip("/")
    return "https://frontend-mcce.onrender.com"


def _provider_credentials(request: Request, provider: str) -> tuple[str, str]:
    settings = request.app.state.settings
    client_id = getattr(settings, f"{provider}_client_id", None)
    client_secret = getattr(settings, f"{provider}_client_secret", None)
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=503, detail=f"{provider.capitalize()} sign-in is not configured."
        )
    return client_id, client_secret


def _frontend_redirect(request: Request, **params: str) -> RedirectResponse:
    fragment = urlencode(params)
    return RedirectResponse(f"{_frontend_base_url(request)}/auth/callback#{fragment}")


@router.get("/api/auth/{provider}/login")
async def oauth_login(request: Request, provider: str):
    if provider not in oauth_providers.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")

    client_id, _ = _provider_credentials(request, provider)
    state = secrets.token_urlsafe(24)
    redirect_uri = f"{_backend_base_url(request)}/api/auth/{provider}/callback"
    authorize_url = oauth_providers.build_authorize_url(provider, client_id, redirect_uri, state)

    referer = request.headers.get("referer")
    frontend_origin = None
    if referer:
        from urllib.parse import urlparse
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            frontend_origin = f"{parsed.scheme}://{parsed.netloc}"

    is_secure = (
        request.headers.get("x-forwarded-proto") == "https"
        or request.url.scheme == "https"
    )
    response = RedirectResponse(authorize_url)
    response.set_cookie(STATE_COOKIE_NAME, state, httponly=True, max_age=600, samesite="lax", secure=is_secure)
    if frontend_origin:
        response.set_cookie(FRONTEND_COOKIE_NAME, frontend_origin, httponly=True, max_age=600, samesite="lax", secure=is_secure)
    return response


@router.get("/api/auth/{provider}/callback")
async def oauth_callback(
    request: Request, provider: str, code: str | None = None, state: str | None = None
):
    if provider not in oauth_providers.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")

    cookie_state = request.cookies.get(STATE_COOKIE_NAME)
    if not code or not state or not cookie_state or state != cookie_state:
        return _frontend_redirect(request, error="Sign-in failed, please try again.")

    client_id, client_secret = _provider_credentials(request, provider)
    redirect_uri = f"{_backend_base_url(request)}/api/auth/{provider}/callback"

    try:
        access_token = await oauth_providers.exchange_code(
            provider, client_id, client_secret, code, redirect_uri
        )
        profile = await oauth_providers.fetch_profile(provider, access_token)
    except Exception:
        return _frontend_redirect(request, error="Sign-in failed, please try again.")

    if not profile.get("email"):
        return _frontend_redirect(
            request, error=f"Your {provider} account has no accessible email address."
        )

    conn = request.app.state.conn
    is_first_user = repository.count_users(conn) == 0
    user_id, created = repository.get_or_create_oauth_user(
        conn, profile["email"], provider, profile["id"], profile.get("name"), profile.get("avatar_url")
    )
    if created and is_first_user:
        repository.assign_ownerless_conversations(conn, user_id)

    token = create_access_token(user_id, profile["email"], request.app.state.settings.jwt_secret)
    redirect = _frontend_redirect(request, token=token)
    redirect.delete_cookie(STATE_COOKIE_NAME)
    redirect.delete_cookie(FRONTEND_COOKIE_NAME)
    return redirect
