"""A deliberately tiny Docker Engine API client over the unix socket.

Only four operations are implemented — inspect, start, stop, restart — because
those are the only four this service is allowed to perform. There is no generic
"run a command" path, no image handling, and no container creation: a compromise
of this process cannot create a privileged container, because the code to do so
does not exist here.

Uses stdlib http.client rather than the docker SDK to keep the dependency
surface of a privileged service as close to zero as possible.
"""
import http.client
import json
import socket
from urllib.parse import quote

from .config import DOCKER_API_VERSION, DOCKER_SOCKET, DOCKER_TIMEOUT, STOP_TIMEOUT


class DockerError(RuntimeError):
    """The daemon could not be reached, or returned something unexpected."""


class ContainerMissing(DockerError):
    """The named container does not exist (never created, or removed)."""


class _UnixHTTPConnection(http.client.HTTPConnection):
    """http.client speaking to a unix domain socket instead of TCP."""

    def __init__(self, socket_path: str, timeout: int):
        super().__init__("localhost", timeout=timeout)
        self._socket_path = socket_path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        try:
            sock.connect(self._socket_path)
        except OSError as e:
            sock.close()
            raise DockerError(f"cannot reach the Docker socket: {e}") from e
        self.sock = sock


def _request(method: str, path: str) -> tuple[int, bytes]:
    conn = _UnixHTTPConnection(DOCKER_SOCKET, DOCKER_TIMEOUT)
    try:
        conn.request(method, f"/{DOCKER_API_VERSION}{path}")
        resp = conn.getresponse()
        return resp.status, resp.read()
    except (OSError, http.client.HTTPException) as e:
        raise DockerError(f"Docker API call failed: {e}") from e
    finally:
        conn.close()


def _container_path(name: str, suffix: str = "") -> str:
    # quote() with an empty safe list, so a name can never introduce a new path
    # segment. config.py already rejects anything outside Docker's name grammar;
    # this is the second belt.
    return f"/containers/{quote(name, safe='')}{suffix}"


def inspect(name: str) -> dict:
    """Return {state, health, running} for a container.

    A missing container is reported as state "missing" by the caller rather than
    raised as an error — it is a normal thing to see when an app has been
    `compose down`-ed rather than stopped.
    """
    status, body = _request("GET", _container_path(name, "/json"))
    if status == 404:
        raise ContainerMissing(name)
    if status != 200:
        raise DockerError(f"inspect {name}: unexpected status {status}")
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise DockerError(f"inspect {name}: malformed response") from e

    state = data.get("State") or {}
    health = (state.get("Health") or {}).get("Status")
    return {
        "state": state.get("Status", "unknown"),
        "health": health,
        "running": bool(state.get("Running")),
    }


def start(name: str) -> None:
    # 204 started, 304 already running — both mean "it is running now".
    _act(name, "/start", ok=(204, 304))


def stop(name: str) -> None:
    # 204 stopped, 304 already stopped.
    _act(name, f"/stop?t={STOP_TIMEOUT}", ok=(204, 304))


def restart(name: str) -> None:
    _act(name, f"/restart?t={STOP_TIMEOUT}", ok=(204,))


def _act(name: str, suffix: str, ok: tuple[int, ...]) -> None:
    status, body = _request("POST", _container_path(name, suffix))
    if status == 404:
        raise ContainerMissing(name)
    if status not in ok:
        raise DockerError(
            f"{suffix.lstrip('/').split('?')[0]} {name}: status {status} "
            f"{body[:200].decode('utf-8', 'replace')}"
        )
