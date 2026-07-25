# CyberDash — Tauri shell (prototype)

> Branch: `prototype/tauri-shell`. This wraps the existing React/Vite frontend
> in a native GNOME window and makes CyberDash follow the desktop's Light/Dark
> theme. The Docker back-ends are unchanged — the shell just loads the same
> `localhost:PORT` apps your browser does today.

## What this prototype demonstrates

- A native window (`.desktop` launcher, app icon, Alt-Tab identity) hosting the
  unchanged CyberDash UI.
- **GNOME dark/light integration.** The window's `theme` is left unset in
  `src-tauri/tauri.conf.json`, so Tauri follows the OS colour-scheme. The
  frontend (`src/theme.js`) reads it via `@tauri-apps/api`'s
  `getCurrentWindow().theme()` and subscribes to `onThemeChanged`, then stamps
  `data-theme="light|dark"` on `<html>`. Every colour token in `src/index.css`
  keys off that, so flipping **Settings ▸ Appearance ▸ Dark/Light** restyles
  CyberDash live, no restart. Open the About panel (`?`) to see the active
  theme and its source.
- The same code runs in a plain browser (`docker compose up`), where it falls
  back to the `prefers-color-scheme` media query.

## Prerequisites (host machine — one-time)

A native desktop app needs a host toolchain; the Docker-only-Node setup was to
avoid host Node for the web app, but Tauri builds a real binary:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# GNOME/WebKitGTK + build deps (Debian/Ubuntu)
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Tauri CLI (either works)
cargo install tauri-cli --version '^2.0'   # → `cargo tauri`
# ...or use the npm devDependency below → `npm run tauri`
```

## Run it

The frontend dev server and the Tauri shell are started separately, so you can
keep serving the frontend from Docker if you prefer:

```bash
# 1. Start the Vite dev server (either way exposes http://localhost:5173)
docker compose up            # your existing Docker flow, OR
npm install && npm run dev   # host Node

# 2. In another terminal, launch the native shell (points at :5173)
cargo tauri dev              # or: npm run tauri dev
```

## Build a native package

```bash
npm run build                       # produces dist/ (host Node, or in Docker)
cargo tauri build                   # → src-tauri/target/release/bundle/{deb,appimage}/
```

## App icons

`src-tauri/icons/icon.png` is a placeholder copy of `public/icons/cyberdash.png`
so the project builds out of the box. To generate the full multi-size icon set
from any square source PNG:

```bash
cargo tauri icon public/icons/cyberdash.png
```

## Native webview embedding (iframe → child webview)

In the Tauri shell, apps are no longer embedded as `<iframe>`s. Each app is a
**native child webview** (Tauri v2 multi-webview, the `unstable` Cargo feature)
layered over the shell window and positioned to overlay the stage. The same
React app still uses iframes in a plain browser — `src/App.jsx` branches on
`NATIVE = isTauri()`.

- `src/nativeStage.js` — imperative manager: create-on-first-launch, keep-alive,
  show/hide on switch, reposition on resize, reload = close + recreate.
- `src/useNativeStage.js` — drives that manager from React state.
- Config: `tauri = { features = ["unstable"] }` and the `core:webview:*`
  permissions in `capabilities/default.json`.

**The payoff:** a native webview is top-level web content, not a frame, so
`X-Frame-Options` / CSP `frame-ancestors` don't apply. Apps the browser refuses
to iframe now embed fine — you can flip their `embed: false` to `true`.

**The tradeoffs this prototype makes you feel (by design):**

- **Native webviews float above all HTML** in the shell window; HTML can't be
  drawn on top of them. So the shell reserves a bottom band (`--dock-clear`) for
  the dock, and hides the active webview whenever an HTML layer must show
  through (About panel, offline/blocked notices). The old look — a translucent
  dock floating *over* a full-height app — isn't possible with a native view;
  the dock now sits in a reserved strip.
- **Keep-alive** works (switching hides/shows, preserving each app's state), but
  the views are OS-level, not DOM nodes — no `display:none` tricks, positioning
  is manual in logical pixels.
- **Fractional scaling** (e.g. Wayland 125%) can cause 1px positioning gaps at
  the webview edges; fine for a prototype, worth revisiting.

## Notes / known caveats

- **Light palette is a first pass.** The dark theme is the original neon look,
  untouched. The light theme is an Adwaita-flavoured starting point in
  `src/index.css` (`:root[data-theme='light']`) — tune to taste.
- WebKitGTK is the component to watch — both for cross-origin webview quirks and
  because multi-webview is an `unstable` API. Test your actual apps early.
