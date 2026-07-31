"""Startup validation — the service should refuse to run misconfigured."""
import json

import pytest

from dockerctl import config
from dockerctl.config import ConfigError


def _write(tmp_path, monkeypatch, payload):
    f = tmp_path / "apps.json"
    f.write_text(payload if isinstance(payload, str) else json.dumps(payload))
    monkeypatch.setattr(config, "APPS_FILE", f)
    return f


def test_loads_a_valid_allowlist(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {"rcdb": "rcdb", "myhours": "myhours-2026"})
    assert config.load_apps() == {"rcdb": "rcdb", "myhours": "myhours-2026"}


def test_missing_file_is_fatal(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "APPS_FILE", tmp_path / "nope.json")
    with pytest.raises(ConfigError, match="not found"):
        config.load_apps()


def test_malformed_json_is_fatal(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, "{not json")
    with pytest.raises(ConfigError, match="not valid JSON"):
        config.load_apps()


def test_empty_allowlist_is_fatal(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {})
    with pytest.raises(ConfigError, match="non-empty"):
        config.load_apps()


@pytest.mark.parametrize(
    "bad",
    [
        "../portainer",          # path traversal
        "rcdb/json",             # extra path segment
        "rcdb?all=1",            # query smuggling
        "-rcdb",                 # not a valid Docker name start
        "",                      # empty
    ],
)
def test_invalid_container_names_are_rejected(tmp_path, monkeypatch, bad):
    _write(tmp_path, monkeypatch, {"app": bad})
    with pytest.raises(ConfigError):
        config.load_apps()


def test_non_string_values_are_rejected(tmp_path, monkeypatch):
    _write(tmp_path, monkeypatch, {"app": 123})
    with pytest.raises(ConfigError, match="must be strings"):
        config.load_apps()


def test_token_is_required(monkeypatch):
    monkeypatch.delenv("DOCKERCTL_TOKEN", raising=False)
    with pytest.raises(ConfigError, match="not set"):
        config.get_token()


def test_short_token_is_rejected(monkeypatch):
    monkeypatch.setenv("DOCKERCTL_TOKEN", "short")
    with pytest.raises(ConfigError, match="too short"):
        config.get_token()


def test_good_token_is_accepted(monkeypatch):
    monkeypatch.setenv("DOCKERCTL_TOKEN", "a" * 32)
    assert config.get_token() == "a" * 32
