"""The four endpoints CyberDash calls.

Every route resolves an app id against the startup allowlist and works with the
container name found there. A request never supplies a container name.
"""
from flask import Blueprint, current_app, jsonify

from . import docker_api
from .config import ConfigError, load_apps
from .docker_api import ContainerMissing, DockerError

bp = Blueprint("api", __name__)

# The only actions this service exposes. `stop`/`start` are a power switch: the
# container keeps its identity, config and volumes, so the paired action always
# brings back the same app. `compose down`/`up -d` is deliberately NOT offered —
# it destroys and recreates the container, which silently redeploys the app if
# the image or compose file changed since. That is a deploy, not a button.
ACTIONS = {
    "start": docker_api.start,
    "stop": docker_api.stop,
    "restart": docker_api.restart,
}


def _apps() -> dict[str, str]:
    return current_app.config["DOCKERCTL_APPS"]


def _status_for(app_id: str, container: str) -> dict:
    try:
        info = docker_api.inspect(container)
    except ContainerMissing:
        # Normal when an app was `compose down`-ed: the container is gone, so
        # there is nothing for this service to start. Say so plainly instead of
        # reporting a failure.
        return {"id": app_id, "container": container, "state": "missing",
                "health": None, "running": False}
    return {"id": app_id, "container": container, **info}


@bp.get("/api/apps")
def list_apps():
    """Current state of every allowlisted app."""
    return jsonify({"apps": [_status_for(i, c) for i, c in _apps().items()]})


@bp.get("/api/apps/<app_id>")
def get_app(app_id: str):
    container = _apps().get(app_id)
    if container is None:
        return jsonify({"error": "unknown app"}), 404
    return jsonify(_status_for(app_id, container))


@bp.post("/api/apps/<app_id>/<action>")
def act(app_id: str, action: str):
    """Start, stop or restart one allowlisted app.

    Both path parameters are checked against fixed tables before anything
    reaches the Docker API, so an unknown id or verb costs a 404 and never
    touches the daemon.
    """
    container = _apps().get(app_id)
    if container is None:
        return jsonify({"error": "unknown app"}), 404
    fn = ACTIONS.get(action)
    if fn is None:
        return jsonify({"error": "unknown action"}), 404

    try:
        fn(container)
    except ContainerMissing:
        return jsonify({
            "error": "container does not exist",
            "detail": f"{container} has not been created. Run `docker compose "
                      f"up -d` for that app once; this service can start and "
                      f"stop containers but deliberately cannot create them.",
        }), 409
    except DockerError as e:
        current_app.logger.error("%s %s failed: %s", action, container, e)
        return jsonify({"error": "docker call failed", "detail": str(e)}), 502

    current_app.logger.info("%s %s (app=%s)", action, container, app_id)
    # Report the post-action state so the caller can update without re-polling.
    return jsonify(_status_for(app_id, container))


@bp.post("/api/reload")
def reload_allowlist():
    """Re-read apps.json from disk.

    This exists so adding an app doesn't need a container restart. It does NOT
    let a caller widen the allowlist: apps.json is mounted read-only and lives
    on the host, so editing it already requires filesystem access. All this
    endpoint does is trigger a re-read of a file the caller has no way to write
    — the file remains the only authority over what this service may touch.

    There is deliberately no endpoint that *writes* the allowlist. If one
    existed, a leaked token would escalate from "toggle these containers" to
    "stop any container on the host".
    """
    try:
        apps = load_apps()
    except ConfigError as e:
        # The file on disk is bad — keep serving the previously loaded
        # allowlist rather than dropping to an empty one.
        current_app.logger.warning("reload rejected: %s", e)
        return jsonify({"error": "allowlist rejected", "detail": str(e)}), 400

    current_app.config["DOCKERCTL_APPS"] = apps
    current_app.logger.info(
        "allowlist reloaded; %d app(s): %s", len(apps), ", ".join(sorted(apps))
    )
    return jsonify({"apps": [_status_for(i, c) for i, c in apps.items()]})


@bp.get("/healthz")
def healthz():
    return jsonify({"status": "ok"})
