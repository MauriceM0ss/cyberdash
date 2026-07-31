import pytest

from dockerctl import create_app

TOKEN = "test-token-that-is-long-enough"
APPS = {"rcdb": "rcdb", "myhours": "myhours-2026"}


@pytest.fixture
def app():
    return create_app(apps=dict(APPS), token=TOKEN)


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth():
    return {"Authorization": f"Bearer {TOKEN}"}


class FakeDocker:
    """Stands in for the Engine API so tests never touch a real daemon.

    Records every call, so a test can assert not just the response but that the
    right container was acted on — the property that actually matters here.
    """

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.state = {"state": "running", "health": "healthy", "running": True}
        self.missing: set[str] = set()
        self.error: Exception | None = None

    def _check(self, name):
        from dockerctl.docker_api import ContainerMissing

        if name in self.missing:
            raise ContainerMissing(name)
        if self.error is not None:
            raise self.error

    def inspect(self, name):
        self.calls.append(("inspect", name))
        self._check(name)
        return dict(self.state)

    def start(self, name):
        self.calls.append(("start", name))
        self._check(name)

    def stop(self, name):
        self.calls.append(("stop", name))
        self._check(name)

    def restart(self, name):
        self.calls.append(("restart", name))
        self._check(name)


@pytest.fixture
def fake_docker(monkeypatch):
    """Patch both the module the routes call and the ACTIONS table, which binds
    the real functions at import time."""
    from dockerctl import docker_api, routes

    fake = FakeDocker()
    for name in ("inspect", "start", "stop", "restart"):
        monkeypatch.setattr(docker_api, name, getattr(fake, name))
    monkeypatch.setitem(routes.ACTIONS, "start", fake.start)
    monkeypatch.setitem(routes.ACTIONS, "stop", fake.stop)
    monkeypatch.setitem(routes.ACTIONS, "restart", fake.restart)
    return fake
