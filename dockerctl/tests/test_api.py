"""Behaviour of the control endpoints, with the Docker API faked out."""


def test_healthz_needs_no_token(client):
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_api_rejects_missing_token(client, fake_docker):
    assert client.get("/api/apps").status_code == 401
    assert fake_docker.calls == []


def test_api_rejects_wrong_token(client, fake_docker):
    resp = client.post(
        "/api/apps/rcdb/stop", headers={"Authorization": "Bearer wrong-token-here"}
    )
    assert resp.status_code == 401
    # The critical part: a bad token must not reach Docker at all.
    assert fake_docker.calls == []


def test_api_rejects_non_bearer_scheme(client, fake_docker):
    resp = client.get("/api/apps", headers={"Authorization": "Basic abc"})
    assert resp.status_code == 401
    assert fake_docker.calls == []


def test_list_apps(client, auth, fake_docker):
    body = client.get("/api/apps", headers=auth).get_json()
    ids = sorted(a["id"] for a in body["apps"])
    assert ids == ["myhours", "rcdb"]
    assert all(a["running"] for a in body["apps"])


def test_start_acts_on_the_mapped_container(client, auth, fake_docker):
    resp = client.post("/api/apps/myhours/start", headers=auth)
    assert resp.status_code == 200
    # The app id is "myhours" but the container is "myhours-2026"; the mapping
    # must come from the allowlist, not from the request.
    assert ("start", "myhours-2026") in fake_docker.calls


def test_stop_and_restart(client, auth, fake_docker):
    assert client.post("/api/apps/rcdb/stop", headers=auth).status_code == 200
    assert client.post("/api/apps/rcdb/restart", headers=auth).status_code == 200
    assert ("stop", "rcdb") in fake_docker.calls
    assert ("restart", "rcdb") in fake_docker.calls


def test_unknown_app_never_touches_docker(client, auth, fake_docker):
    resp = client.post("/api/apps/portainer/stop", headers=auth)
    assert resp.status_code == 404
    assert fake_docker.calls == []


def test_unknown_action_never_touches_docker(client, auth, fake_docker):
    resp = client.post("/api/apps/rcdb/exec", headers=auth)
    assert resp.status_code == 404
    assert fake_docker.calls == []


def test_traversal_in_app_id_is_not_resolvable(client, auth, fake_docker):
    # Even if a caller tries to smuggle a path, it is only ever looked up as a
    # dict key — it can never become a container name.
    for evil in ["../portainer", "rcdb/../portainer", "%2e%2e%2fportainer"]:
        resp = client.post(f"/api/apps/{evil}/stop", headers=auth)
        assert resp.status_code in (404, 405), evil
    assert fake_docker.calls == []


def test_missing_container_reports_409(client, auth, fake_docker):
    fake_docker.missing.add("rcdb")
    resp = client.post("/api/apps/rcdb/start", headers=auth)
    assert resp.status_code == 409
    assert "does not exist" in resp.get_json()["error"]


def test_missing_container_lists_as_missing(client, auth, fake_docker):
    fake_docker.missing.add("rcdb")
    body = client.get("/api/apps/rcdb", headers=auth).get_json()
    assert body["state"] == "missing"
    assert body["running"] is False


def test_docker_failure_reports_502(client, auth, fake_docker):
    from dockerctl.docker_api import DockerError

    fake_docker.error = DockerError("socket gone")
    resp = client.post("/api/apps/rcdb/stop", headers=auth)
    assert resp.status_code == 502


def test_reload_picks_up_a_new_app(client, auth, fake_docker, tmp_path, monkeypatch):
    from dockerctl import config

    f = tmp_path / "apps.json"
    f.write_text('{"rcdb": "rcdb", "grafana": "grafana"}')
    monkeypatch.setattr(config, "APPS_FILE", f)

    body = client.post("/api/reload", headers=auth).get_json()
    assert sorted(a["id"] for a in body["apps"]) == ["grafana", "rcdb"]
    # And the newly-added app is now actionable.
    assert client.post("/api/apps/grafana/stop", headers=auth).status_code == 200
    assert ("stop", "grafana") in fake_docker.calls


def test_reload_needs_a_token(client, auth, fake_docker):
    assert client.post("/api/reload").status_code == 401


def test_reload_keeps_the_old_allowlist_when_the_file_is_bad(
    client, auth, fake_docker, tmp_path, monkeypatch
):
    from dockerctl import config

    f = tmp_path / "apps.json"
    f.write_text('{"evil": "../portainer"}')
    monkeypatch.setattr(config, "APPS_FILE", f)

    assert client.post("/api/reload", headers=auth).status_code == 400
    # The previously loaded apps must still work — a bad edit on disk should not
    # leave the service with nothing, nor adopt the rejected entry.
    assert client.post("/api/apps/rcdb/stop", headers=auth).status_code == 200
    assert client.post("/api/apps/evil/stop", headers=auth).status_code == 404


def test_there_is_no_endpoint_that_writes_the_allowlist(client, auth, fake_docker):
    # Guards the core containment property: the allowlist can only be widened by
    # editing the file on the host, never over HTTP.
    for path, method in [
        ("/api/apps", "post"),
        ("/api/apps/newapp", "post"),
        ("/api/apps/newapp/add", "post"),
    ]:
        resp = getattr(client, method)(path, headers=auth, json={"container": "portainer"})
        assert resp.status_code in (404, 405), path
    assert fake_docker.calls == []


def test_cors_echoes_allowed_origin(client, auth, fake_docker):
    resp = client.get(
        "/api/apps", headers={**auth, "Origin": "http://localhost:5173"}
    )
    assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "Authorization" in resp.headers["Access-Control-Allow-Headers"]


def test_cors_ignores_unlisted_origin(client, auth, fake_docker):
    resp = client.get("/api/apps", headers={**auth, "Origin": "http://evil.example"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_refused_origin_is_logged(client, auth, fake_docker, caplog):
    # The packaged .deb's webview origin is the one thing that can't be checked
    # from here, so a refusal has to say what it saw.
    client.get("/api/apps", headers={**auth, "Origin": "tauri://something-else"})
    assert "tauri://something-else" in caplog.text


def test_cors_never_wildcards(client, auth, fake_docker):
    resp = client.get(
        "/api/apps", headers={**auth, "Origin": "http://localhost:5173"}
    )
    assert resp.headers["Access-Control-Allow-Origin"] != "*"


def test_preflight_succeeds_without_a_token(client):
    resp = client.options(
        "/api/apps/rcdb/stop",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert resp.status_code in (200, 204)
    assert resp.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
