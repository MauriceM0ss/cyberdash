# dockerctl

A narrow start/stop gate that lets CyberDash power its apps on and off.

## Why this exists rather than just mounting the socket

The obvious way to give a dashboard a "spin up / spin down" button is to mount
`/var/run/docker.sock` into whatever serves the dashboard. Don't. A raw Docker
socket is root on the host: anyone who reaches it can create a container that
bind-mounts `/` and walk straight out. For a service reachable from a browser on
your LAN, that is a very short path from "someone found my dashboard" to
"someone owns my machine".

This service is the gate instead. It:

* acts only on containers named in `apps.json`, read once at startup;
* takes an app **id** from the caller and looks the container name up — a
  request never supplies a container name, image, or command;
* implements exactly four Docker operations: inspect, start, stop, restart. The
  code to create a container, mount a volume or pull an image is not present, so
  a compromise of this process cannot use it;
* requires a shared token on every `/api` call;
* runs as a non-root user, using the host `docker` group for socket access.

Worst case — token leaked, process fully compromised — the attacker can toggle
the handful of containers you listed. That is a nuisance, not a host takeover.

## Why start/stop and not `compose down` / `up -d`

`docker compose down` destroys the container and its network; `up -d` builds a
new one from whatever the compose file and image say *now*. If either changed
since, the paired action silently redeploys the app — a button that sometimes
performs a deploy is a bad button.

`start`/`stop` is a true power switch: same container, same config, same
volumes, so the app that comes back is the app that went away. The consequence
is that this service **cannot create a container that does not exist**. Run
`docker compose up -d` once per app by hand; after that the button works. An app
whose container was removed reports `state: "missing"` rather than failing
mysteriously.

## Setup

1. **Edit `apps.json`** — a flat `{app_id: container_name}` map. The ids should
   match the `id` fields in `src/apps.config.js` so the dashboard can line them
   up; the values are real container names from `docker ps`. Note that a few
   differ from the app name (`cybernewshub` runs as `ctnhub`, `secanalysis` as
   `netscan`, `myhours` as `myhours-2026`).

2. **Generate a token** into a `.env` beside `docker-compose.yml`:

   ```bash
   echo "DOCKERCTL_TOKEN=$(openssl rand -hex 32)" > .env
   ```

   `.env` is gitignored. The service refuses to start without a token, and
   refuses one shorter than 16 characters.

3. **Check your docker GID** matches `group_add` in `docker-compose.yml`:

   ```bash
   getent group docker     # 981 on this host
   ```

4. **Start it:**

   ```bash
   docker compose up -d --build
   ```

It listens on `127.0.0.1:8033` — loopback only, deliberately. This is a
privileged control surface and has no business being on the LAN. If you move it
off loopback, put a reverse proxy with TLS in front of it.

## API

All `/api` routes need `Authorization: Bearer <token>`. `/healthz` does not.

| Method | Path                          | Does                                  |
|--------|-------------------------------|---------------------------------------|
| GET    | `/healthz`                    | liveness, no auth                     |
| GET    | `/api/apps`                   | state of every allowlisted app        |
| GET    | `/api/apps/<id>`              | state of one app                      |
| POST   | `/api/apps/<id>/start`        | start it                              |
| POST   | `/api/apps/<id>/stop`         | stop it (10s grace, then SIGKILL)     |
| POST   | `/api/apps/<id>/restart`      | restart it                            |

Actions are idempotent — stopping a stopped app succeeds. Every action returns
the app's state afterwards, so the caller can update without re-polling.

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8033/api/apps
curl -X POST -H "Authorization: Bearer $TOKEN" \
     http://127.0.0.1:8033/api/apps/rcdb/stop
```

Status codes: `401` bad/missing token, `404` unknown app id or action (nothing
reaches Docker), `409` container does not exist, `502` the Docker call failed.

## Wiring the dashboard to it

`useHealth.js` pings apps with `mode: 'no-cors'`, which is fine for a
reachability light but cannot read a response. These calls are real CORS
requests, so the token goes in an `Authorization` header and the origin must be
listed in `ALLOWED_ORIGINS` — `http://localhost:5173` (vite) and
`tauri://localhost` (the .deb) are the defaults.

The token has to reach the frontend somehow. In a browser it will be visible to
anyone with devtools on that machine; that is acceptable here precisely because
the token's power is bounded to toggling your own containers. Don't reuse it
anywhere else.

## Tests

Either make a venv (`python3 -m venv .venv && .venv/bin/pip install -r
requirements-dev.txt`), or run them in a container:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e PYTHONDONTWRITEBYTECODE=1 -e HOME=/tmp \
  -v "$PWD":/app -w /app python:3.12-slim \
  sh -c "pip install -q -r requirements-dev.txt; python -m pytest -q"
```

The `--user` and `PYTHONDONTWRITEBYTECODE` flags matter: without them the
container writes root-owned `__pycache__` into your working tree, which then
breaks the next build with a confusing `EACCES ... unlink` error.
