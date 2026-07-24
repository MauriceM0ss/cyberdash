# CyberDash

A minimal dashboard with a floating, macOS-style dock. Each dock icon launches
one of your self-hosted apps (MyHours, RCDB, …) — by default embedded inside the
dashboard via an iframe, with a one-click fallback to open in a new tab for apps
that refuse to be framed.

The dashboard is fully decoupled from your apps: it just points at the ports
your Docker containers already expose. iframes are loaded by *your browser*, so
`localhost:8090` resolves to your host machine exactly as it does today.

## Run it (Docker — no Node needed on the host)

```bash
docker compose up
```

Then open <http://localhost:5173>. Hot-reload is on, so edits show up live.

Stop with `Ctrl-C`, or `docker compose down` to also clean up.

> Using Podman? `podman compose up` works the same way.

## Configure your apps

Edit **`src/apps.config.js`** — one object per app:

```js
{
  id: 'myhours',
  name: 'MyHours',
  icon: '⏱️',                    // emoji, or an image path like '/icons/x.png'
  url: 'http://localhost:8090',
  embed: true,                    // false = always open in a new tab
}
```

If an app shows an "can't be embedded" message, it sends
`X-Frame-Options` / a CSP `frame-ancestors` header. Set `embed: false` for it
(or use the fallback button that appears).

## Custom icons

Drop image files in `public/icons/` and reference them as `icon: '/icons/foo.png'`.

## Production build

```bash
docker compose run --rm cyberdash npm run build   # outputs to dist/
```

Serve `dist/` with any static host (nginx, Caddy, or another container).
