// ─────────────────────────────────────────────────────────────────────────
//  Native stage — Tauri-only replacement for the <iframe> embedding model.
//
//  Instead of one iframe per app inside the DOM, we create one *native child
//  webview* per app (Tauri v2 multi-webview, `unstable` feature) layered over
//  the shell window and positioned to overlay the shell's "stage" rectangle.
//
//  Why bother: native webviews are top-level web contents, not frames, and that
//  buys two things. `X-Frame-Options` / CSP `frame-ancestors` simply don't
//  apply, so apps that the browser refuses to iframe embed fine here — and,
//  more importantly on Linux, the app gets *persistent* storage. WebKitGTK
//  hands a cross-origin iframe memory-only localStorage, so an iframed app
//  forgets every preference it saves the moment the window closes (see
//  TAURI.md). A top-level document keeps them.
//
//  Placement does NOT go through the Tauri webview API. On Linux every webview
//  Tauri builds is packed into the window's GtkBox, where `setPosition` and
//  `setSize` do nothing at all; the shell installs a GtkFixed of its own and
//  positions the webviews there. That's what the `stage_place` / `stage_hide`
//  commands below are — see src-tauri/src/stage.rs.
//
//  The catch this model makes you feel: native webviews float ABOVE all HTML in
//  the main webview. So the shell reserves a band for the dock (it can't be
//  overlapped by a native view) and hides the active webview whenever an HTML
//  layer must show through (Home, the About panel, offline/blocked notices).
//  All of that orchestration lives in useNativeStage.js; this module is the
//  imperative plumbing it drives.
//
//  Coordinates: the shell measures the stage slot with getBoundingClientRect()
//  (CSS/logical px, relative to the window content top-left) and hands us that
//  rect; the Rust side places the webview in the same logical pixels.
// ─────────────────────────────────────────────────────────────────────────

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Webview } from '@tauri-apps/api/webview'

// id -> { webview: Webview, ready: Promise<boolean> }
const views = new Map()
let activeId = null

const labelFor = (id) => `app__${id}`

const place = (id, rect) =>
  invoke('stage_place', {
    label: labelFor(id),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  })

const conceal = (id) => invoke('stage_hide', { label: labelFor(id) })

// Create (but don't necessarily reveal) the webview for an app at `rect`.
function createView(app, rect) {
  const win = getCurrentWindow()
  const webview = new Webview(win, labelFor(app.id), {
    url: app.url,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  })
  const ready = new Promise((resolve) => {
    webview.once('tauri://created', () => resolve(true))
    webview.once('tauri://error', (e) => {
      console.error('[nativeStage] failed to create webview for', app.id, e)
      resolve(false)
    })
  })
  const entry = { webview, ready }
  views.set(app.id, entry)
  return entry
}

// Show `app` at `rect`, creating its webview on first use and hiding whichever
// app was showing before. Kept alive afterwards — switching away only hides.
export async function showApp(app, rect) {
  if (activeId && activeId !== app.id) conceal(activeId).catch(() => {})
  activeId = app.id

  let entry = views.get(app.id)
  if (!entry) entry = createView(app, rect)

  const ok = await entry.ready
  // Bail if creation failed, or the user switched away while we awaited.
  if (!ok || activeId !== app.id) return

  try {
    // A freshly created webview is packed into the window's GtkBox and splits
    // it with the shell until this first placement re-homes it on the stage.
    await place(app.id, rect)
    await entry.webview.setFocus()
  } catch (e) {
    console.error('[nativeStage] failed to show webview for', app.id, e)
  }
}

// Hide every app webview (Home screen, About panel, or an HTML notice showing).
export async function hideAll() {
  activeId = null
  for (const id of views.keys()) conceal(id).catch(() => {})
}

// Reposition the currently-shown webview — called on window/stage resize.
export async function positionActive(rect) {
  if (!activeId) return
  place(activeId, rect).catch(() => {})
}

// Hard-reload an app: native webviews have no in-place navigate here, so we
// close and recreate. If it's the active app, re-show it at `rect`.
export async function reloadApp(app, rect) {
  const entry = views.get(app.id)
  if (entry) {
    if (await entry.ready) {
      try {
        await entry.webview.close()
      } catch (e) {
        console.error('[nativeStage] failed to close webview for', app.id, e)
      }
    }
    views.delete(app.id)
  }
  if (activeId === app.id && rect) return showApp(app, rect)
}
