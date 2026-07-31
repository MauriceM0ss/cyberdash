"""Bearer-token auth and CORS for the control endpoints."""
import hmac

from flask import current_app, jsonify, request

from .config import ALLOWED_ORIGINS


def _unauthorized():
    return jsonify({"error": "unauthorized"}), 401


def check_token():
    """Reject any /api request without the shared secret.

    /healthz stays open so Docker's own HEALTHCHECK can use it; it reveals
    nothing beyond "the process is alive".
    """
    if not request.path.startswith("/api/"):
        return None
    # CORS preflight carries no Authorization header by design; it is answered
    # by the after_request handler below and never reaches a route.
    if request.method == "OPTIONS":
        return None

    header = request.headers.get("Authorization", "")
    scheme, _, presented = header.partition(" ")
    if scheme.lower() != "bearer" or not presented:
        return _unauthorized()
    if not hmac.compare_digest(presented, current_app.config["DOCKERCTL_TOKEN"]):
        return _unauthorized()
    return None


def add_cors_headers(resp):
    """Echo back only origins on the allowlist — never a bare '*'.

    '*' plus a bearer token would let any page on the machine's browser drive
    this service if it ever learned the token.
    """
    origin = request.headers.get("Origin")
    if origin and origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        resp.headers["Access-Control-Max-Age"] = "600"
    elif origin:
        # An unlisted origin gets no CORS headers, so the caller sees an opaque
        # network failure with no clue why. Log the origin we actually saw —
        # this is the fast way to find out what the packaged .deb's webview
        # sends (tauri://localhost, http://tauri.localhost, or a bare "null"),
        # which is otherwise guesswork. Add it to ALLOWED_ORIGINS to permit it.
        current_app.logger.warning(
            "CORS: refused Origin %r (allowed: %s)", origin, ", ".join(ALLOWED_ORIGINS)
        )
    return resp


def add_security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp
