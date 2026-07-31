"""dockerctl — a narrow start/stop gate in front of the Docker Engine API.

CyberDash needs to power its apps on and off. Handing a web-facing service the
Docker socket normally means handing it the host: with a raw socket you can
create a container that mounts / and escalate to root. This service exists so
that never happens. It:

  * acts only on containers named in a startup allowlist (see config.py);
  * exposes only start / stop / restart / inspect — the code to create a
    container, mount a volume or pull an image is simply not present;
  * takes an app *id* from the caller, never a container name, image or command;
  * requires a shared token on every /api call.

The blast radius of a full compromise is therefore "your dashboard apps get
toggled", not "your machine is owned".
"""
import logging

from flask import Flask, jsonify
from werkzeug.exceptions import HTTPException

from .config import ConfigError, get_token, load_apps
from .routes import bp
from .security import add_cors_headers, add_security_headers, check_token

__all__ = ["create_app", "ConfigError"]


def _configure_logging(app: Flask) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    @app.errorhandler(Exception)
    def _log_unhandled(e):
        if isinstance(e, HTTPException):
            return e
        app.logger.exception("Unhandled error")
        return jsonify({"error": "internal server error"}), 500


def create_app(apps: dict[str, str] | None = None, token: str | None = None) -> Flask:
    """Build the app. Both config sources can be injected, which is what the
    tests use instead of writing files and environment variables."""
    app = Flask(__name__)
    app.config["DOCKERCTL_APPS"] = load_apps() if apps is None else apps
    app.config["DOCKERCTL_TOKEN"] = get_token() if token is None else token

    app.register_blueprint(bp)
    app.before_request(check_token)
    app.after_request(add_cors_headers)
    app.after_request(add_security_headers)
    _configure_logging(app)

    app.logger.info(
        "dockerctl ready; %d app(s) allowlisted: %s",
        len(app.config["DOCKERCTL_APPS"]),
        ", ".join(sorted(app.config["DOCKERCTL_APPS"])),
    )
    return app
