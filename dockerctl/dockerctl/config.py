"""Environment-driven settings and the app allowlist.

Everything the service is permitted to touch is fixed here at startup. Nothing
that arrives in a request ever widens it.
"""
import json
import os
from pathlib import Path

# Where the Docker Engine socket is mounted inside the container.
DOCKER_SOCKET = os.environ.get("DOCKER_SOCKET", "/var/run/docker.sock")

# Pinned Engine API version. Old enough to be broadly supported, new enough to
# be well past the deprecated (<1.24) range. Bump deliberately, not by accident.
DOCKER_API_VERSION = os.environ.get("DOCKER_API_VERSION", "v1.43")

# Seconds to wait on a single Engine API call. `stop` can legitimately take the
# full grace period plus a moment, so this sits comfortably above STOP_TIMEOUT.
DOCKER_TIMEOUT = int(os.environ.get("DOCKER_TIMEOUT", "30"))

# Grace period handed to `stop` before the daemon sends SIGKILL.
STOP_TIMEOUT = int(os.environ.get("STOP_TIMEOUT", "10"))

# The allowlist: {app_id: container_name}. Read once at startup.
APPS_FILE = Path(os.environ.get("APPS_FILE", "/config/apps.json"))

# Browser origins allowed to call this service. The dashboard runs at :5173 in a
# browser and at tauri://localhost inside the packaged .deb, so both are default.
ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "ALLOWED_ORIGINS", "http://localhost:5173,tauri://localhost"
    ).split(",")
    if o.strip()
]


class ConfigError(RuntimeError):
    """Raised at startup when the service is not safe to run."""


def get_token() -> str:
    """The shared secret every /api call must present.

    Deliberately mandatory. Without it anyone who can reach the port can stop
    your apps — not a host compromise (this service can only start/stop the
    containers named below), but a trivial denial of service.
    """
    token = os.environ.get("DOCKERCTL_TOKEN", "")
    if not token:
        raise ConfigError(
            "DOCKERCTL_TOKEN is not set. Refusing to start an unauthenticated "
            "control service. Generate one with: openssl rand -hex 32"
        )
    if len(token) < 16:
        raise ConfigError("DOCKERCTL_TOKEN is too short; use at least 16 characters.")
    return token


def load_apps() -> dict[str, str]:
    """Load and validate the {app_id: container_name} allowlist.

    Read once at import/startup rather than per request: the set of things this
    service can act on must not be changeable by anything happening at runtime.
    """
    if not APPS_FILE.is_file():
        raise ConfigError(f"App allowlist not found at {APPS_FILE}.")
    try:
        raw = json.loads(APPS_FILE.read_text())
    except json.JSONDecodeError as e:
        raise ConfigError(f"{APPS_FILE} is not valid JSON: {e}") from e

    if not isinstance(raw, dict) or not raw:
        raise ConfigError(f"{APPS_FILE} must be a non-empty object of id -> container.")

    apps: dict[str, str] = {}
    for app_id, container in raw.items():
        if not isinstance(app_id, str) or not isinstance(container, str):
            raise ConfigError(f"{APPS_FILE}: ids and container names must be strings.")
        if not app_id or not container:
            raise ConfigError(f"{APPS_FILE}: empty id or container name.")
        # Container names go into a URL path. Docker's own name grammar is
        # [a-zA-Z0-9][a-zA-Z0-9_.-]*, so anything outside it is either a typo or
        # an attempt to smuggle a path segment. Reject rather than escape.
        if not _is_valid_container_name(container):
            raise ConfigError(
                f"{APPS_FILE}: {container!r} is not a valid container name."
            )
        apps[app_id] = container
    return apps


def _is_valid_container_name(name: str) -> bool:
    if not name or not (name[0].isalnum()):
        return False
    return all(c.isalnum() or c in "_.-" for c in name)
