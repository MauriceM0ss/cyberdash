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
const EMBED_MODE = 'webview' // 'iframe' | 'webview'
```

**`'webview'` (default).** One native child webview per app (Tauri v2
multi-webview, `unstable` Cargo feature), layered over the shell and positioned
to overlay the stage. Each app is then a *top-level document* rather than a
frame, which buys two things: `X-Frame-Options` / CSP `frame-ancestors` stop
applying, and — the reason it is the default — the app's `localStorage`
persists. See the next section for why that is not automatic.

- `src/nativeStage.js` — imperative manager: create-on-first-launch, keep-alive,
  show/hide on switch, reposition on resize, reload = close + recreate.
- `src/useNativeStage.js` — drives that manager from React state.
- `src-tauri/src/stage.rs` — the GTK placement the frontend asks for.
- Config: `tauri = { features = ["unstable"] }` plus the `core:webview:*`
  permissions in `capabilities/default.json`.

**`'iframe'`.** Apps embed via `<iframe>`, exactly as in the browser. Still the
fallback worth flipping to if the native stage ever misbehaves, but it is
subject to `X-Frame-Options` / CSP — so some apps need `embed: false` — and it
cannot persist anything an embedded app stores. A plain browser always uses
iframes regardless of this setting.

### Why iframes can't be the default — embedded apps forget everything

WebKitGTK gives a **cross-origin iframe memory-only localStorage**. Writes
succeed and read back fine for as long as the window is open, then vanish on
close: nothing is ever written to disk. Framed apps therefore reset every
client-side preference on each launch — CyberNewsHub's collapsed sidebar groups,
MyHours' view state, each app's chosen theme. The same apps in the browser build
keep their state, because browser engines persist third-party frame storage.

Measured on WebKitGTK 4.1 (write, quit the process, relaunch, read):

| Where the page runs                                   | Survives a restart |
| ----------------------------------------------------- | ------------------ |
| Top-level document                                      | yes                |
| Same-origin iframe                                      | yes                |
| Iframe on the same host, different port                  | **no**             |
| Iframe from `tauri://localhost` to `http://localhost`    | **no**             |

The third row closes off the cheap workaround: serving the shell over
`http://localhost:<port>` so the frames become same-host does *not* help —
WebKitGTK draws the line at the origin, port included. Only a top-level document
persists, which is what `'webview'` mode makes each app.

### How the native stage is positioned (and why Tauri can't do it)

On Linux, every webview Tauri builds is packed into the window's default GtkBox
with expand+fill, whichever `WebviewKind` it is. Two webviews therefore split
the window 50/50 — the tiling this prototype originally hit — and `setPosition`
/ `setSize` from the JS API do nothing at all, because wry only honours those
when the webview's parent happens to be a free-positioning container, which
Tauri never gives it.

So the shell installs one itself. `src-tauri/src/stage.rs` lifts the window's
webview out of that GtkBox into a **GtkLayout**, adopts each app webview into it
as it is created, and exposes two commands — `stage_place` and `stage_hide` —
that the frontend calls with the stage rectangle it measured in the DOM. A
GtkLayout child gets exactly the geometry it asks for.

**Size the shell from the container, never from `inner_size()`.** With
client-side decorations those are different numbers: `inner_size()` counts the
invisible resize border GTK draws around the window, ~26px a side here. Trusting
it made the shell 52px wider and taller than the space it had, and everything
anchored to an edge hung off screen — the dock in both of its positions, and the
right-hand end of the top bar. The stage rectangle the frontend measured inside
that oversized viewport was too big as well, so the active app was cropped and
lost its own bottom bar. The stage container's allocation *is* the content area,
so sizing to that leaves nothing to correct for; `install_shell` tracks it
through `size-allocate`, which also covers window resizes without listening for
them separately.

GtkLayout rather than the more obvious GtkFixed: a GtkFixed reports the union of
its children as its own minimum size, so sizing the shell webview to the window
raises the window's minimum, which enlarges the window, which resizes the shell
— the window grows without bound. GtkLayout positions children identically but
always asks for nothing.

Set `CYBERDASH_STAGE_DEBUG=1` to have every placement report what GTK actually
allocated, which separates "we asked for the wrong rectangle" from "we asked
correctly and GTK did something else".

### The tradeoff native webviews carry

They **float above all HTML**, and no amount of `z-index` changes that. So any
HTML that would overlap the stage has to make the app step aside instead:

- the dock lives in a band the stage leaves clear (`--dock-clear-*`),
- the active webview is hidden whenever Home, the About panel, Settings, the
  dock's power menu, or an offline/blocked notice must show through
  (`htmlCoversStage` in `App.jsx`),
- the power-controls error message sits in the top bar's band, the one strip of
  the window that is always shell.

Positioning is also manual in logical pixels, and fractional scaling can leave
1px edge gaps.

## Notes / known caveats

- **Light palette is a first pass.** The dark theme is the original neon look,
  untouched. The light theme is an Adwaita-flavoured starting point in
  `src/index.css` (`:root[data-theme='light']`) — tune to taste.
- **`window.open` and `target="_blank"` need a Rust-side handler.** A WebKitGTK
  webview with no `on_new_window` handler silently drops the request, so such
  links appear dead in the .deb while working in the browser. `src-tauri/src/lib.rs`
  builds the main window itself (hence `"create": false` in `tauri.conf.json` —
  the handler can only be attached at build time) and hands http/https URLs to
  the desktop's browser via `tauri-plugin-opener`. Note WebKitGTK also requires a
  user gesture: a `window.open` called from a click handler is fine, one called
  from a timer or after an `await` is dropped before the handler ever sees it.
- WebKitGTK is the component to watch — both for cross-origin webview quirks and
  because multi-webview is an `unstable` API. Test your actual apps early.
