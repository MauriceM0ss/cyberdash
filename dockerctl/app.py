"""dockerctl entrypoint — thin wrapper around the application factory.

Run directly (``python app.py``) or via a WSGI server pointing at ``app:app``.
"""
import sys

from dockerctl import ConfigError, create_app

try:
    app = create_app()
except ConfigError as e:
    print(f"dockerctl: {e}", file=sys.stderr)
    raise SystemExit(1) from e

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
