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
  the matching palette id on `<html>` as `data-theme`. Every colour token in
  `src/index.css` keys off that, so flipping GNOME's **Settings ▸ Appearance ▸
  Dark/Light** restyles CyberDash live, no restart.

  This is what CyberDash's own **Settings ▸ Appearance ▸ Theme = Auto** means
  (the default). Picking one of the five explicit palettes instead pins it and
  stops consulting the desktop — the `onThemeChanged` subscription stays up,
  it just no longer changes what's applied. Open the About panel (`?`) to see
  the active theme.
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

## Package & install on Ubuntu

```bash
npm run build                 # 1. build the frontend → dist/
npm run tauri build           # 2. compile release + bundle
```

The `.deb` lands at:

```
src-tauri/target/release/bundle/deb/CyberDash_0.1.0_amd64.deb
```

Install it (either command; `apt` pulls the two runtime deps automatically):

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/CyberDash_0.1.0_amd64.deb
# or: sudo dpkg -i <deb> && sudo apt -f install
```

This installs `/usr/bin/cyberdash`, the launcher entry
`/usr/share/applications/CyberDash.desktop`, and the green-alien icon into the
hicolor theme — so **CyberDash appears in the GNOME app grid** with its icon and
launches like any native app. Uninstall with `sudo apt remove cyber-dash`.

Runtime dependencies (declared in the package): `libwebkit2gtk-4.1-0`,
`libgtk-3-0`. The apps themselves still come from your Docker containers on
`localhost` — start them as usual before opening CyberDash.

> **AppImage:** `bundle.targets` is set to `deb` only. Tauri can also build an
> AppImage, but it shells out to `linuxdeploy` (extra downloads + FUSE) which is
> flaky; the `.deb` is the right native package for Ubuntu. Re-add `"appimage"`
> to `targets` in `tauri.conf.json` if you want to try it.

## App icons

The launcher/app icon is generated from `public/favicon.svg` (the green alien).
Regenerate the full multi-size set any time with:

```bash
npm run tauri icon public/favicon.svg
```

The Linux-relevant outputs (`32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns`, `icon.ico`) are committed and referenced by `bundle.icon`; the
Android/iOS/Windows-Store variants it also emits are git-ignored.

## Embedding mode (iframe vs. native webview)

How apps are embedded inside the Tauri shell is a toggle in `src/App.jsx`:

```js
const EMBED_MODE = 'iframe' // 'iframe' | 'webview'
```

**`'iframe'` (default, and what works today).** Apps embed via `<iframe>`,
exactly as in the browser — subject to `X-Frame-Options` / CSP, so some apps
still need `embed: false`. Reliable on WebKitGTK.

**`'webview'` (experiment, currently broken on Linux).** One native child
webview per app (Tauri v2 multi-webview, `unstable` Cargo feature), which would
bypass `X-Frame-Options` entirely — a native webview is top-level content, not a
frame. The code is here:

- `src/nativeStage.js` — imperative manager: create-on-first-launch, keep-alive,
  show/hide on switch, reposition on resize, reload = close + recreate.
- `src/useNativeStage.js` — drives that manager from React state.
- Config: `tauri = { features = ["unstable"] }` and the `core:webview:*`
  permissions in `capabilities/default.json`.

### Why `'webview'` is off by default — the WebKitGTK finding

Tested on GNOME/Wayland at 100% scaling: adding a child webview to the
config-created window makes WebKitGTK **tile the two webviews 50/50** (shell in
the top half, app in the bottom) instead of honoring our `setPosition`/`setSize`
— the placement diagnostic showed `requested h=631` but `applied h=386`, with
the shell webview's own viewport shrunk to half height. This is a known rough
edge of the `unstable` multi-webview API on Linux: a webview added to a
`WebviewWindow` (which already owns a main webview) gets packed in a box, not a
free-positioning container.

The likely real fix is architectural — build a plain `Window` (not a config
`WebviewWindow`) and add the shell + app webviews as positioned children of a
`GtkFixed`, the way Tauri's own `multiwebview` example does. Not done here.

Even once positioned correctly, native webviews carry inherent tradeoffs worth
knowing: they **float above all HTML** (hence the reserved dock band
`--dock-clear`, and hiding the webview when the About panel / offline notice
must show through), positioning is **manual in logical pixels**, and fractional
scaling can leave 1px edge gaps.

## Notes / known caveats

- **Light palette is a first pass.** The dark theme is the original neon look,
  untouched. The light theme is an Adwaita-flavoured starting point in
  `src/index.css` (`:root[data-theme='light']`) — tune to taste.
- WebKitGTK is the component to watch — both for cross-origin webview quirks and
  because multi-webview is an `unstable` API. Test your actual apps early.
