# CyberDash

> ⚠️ **Disclaimer:** This is a Claude Code "vibe coding" project. It was built
> iteratively with the [Claude Code](https://claude.com/claude-code) AI agent
> and is intended for personal/experimental use. Review the code before relying
> on it.

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

That applies to the browser build. The native `.deb` embeds each app as a
*native child webview* instead of an iframe, which is top-level content — so
those headers don't apply there, and, unlike an iframe on WebKitGTK, the app
keeps whatever it saves in `localStorage` between launches. See TAURI.md.

## Custom icons

Drop image files in `public/icons/` and reference them as `icon: '/icons/foo.png'`.

## Settings

The gear in the top-right opens a tabbed dialog. Everything applies instantly
and is remembered in this browser (or in the Tauri app's own storage) — there's
no Save button.

**Appearance ▸ Theme.** The same five palettes as the CyberNewsHub app, ported
into `src/index.css` as `[data-theme]` blocks:

| Theme | |
| --- | --- |
| **Auto** *(default)* | Follows the desktop's Light/Dark style — Dark Terminal when it's dark, Light when it's light — and keeps following it as you flip it |
| **Dark Terminal** | The original neon-green CyberDash look |
| **Deep Blue** | |
| **Light** | |
| **GitHub** | Primer dark |
| **Amber** | |

Picking anything other than Auto pins that palette and stops following the
desktop.

**Preferences ▸ Dock.** *Position* puts the dock along the bottom (default) or
down the right-hand side; the app area gives up that band, so the dock never
covers an embedded app. On the right the dock reads as a sidebar — the whole
band is solid black in every theme, with no rule along the boundary, so it
meets the app area edge to edge. *Size* is Normal (52 px icons), Medium (44 px), or Small
(36 px) — the whole dock scales, not just the icons.

## Production build

```bash
docker compose run --rm cyberdash npm run build   # outputs to dist/
```

Serve `dist/` with any static host (nginx, Caddy, or another container).
