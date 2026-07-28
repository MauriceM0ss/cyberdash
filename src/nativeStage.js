// ─────────────────────────────────────────────────────────────────────────
//  Native stage — Tauri-only replacement for the <iframe> embedding model.
//
//  Instead of one iframe per app inside the DOM, we create one *native child
//  webview* per app (Tauri v2 multi-webview, `unstable` feature) layered over
//  the shell window and positioned to overlay the shell's "stage" rectangle.
//
//  Why bother: native webviews are top-level web contents, not frames, so
//  `X-Frame-Options` / CSP `frame-ancestors` simply don't apply — apps that the
//  browser refuses to iframe embed just fine here. Health checks, keep-alive,
//  and per-app reload all still work.
//
//  The catch this prototype makes you feel: native webviews float ABOVE all
//  HTML in the main webview. So the shell reserves a band at the bottom for the
//  dock (it can't overlap a native view) and hides the active webview whenever
//  an HTML layer must show through (Home, the About panel, offline/blocked
//  notices). All of that orchestration lives in useNativeStage.js; this module
//  is the imperative plumbing it drives.
//
//  Coordinates: the shell measures the stage slot with getBoundingClientRect()
//  (CSS/logical px, relative to the window content top-left) and hands us that
//  rect; we position the webview with LogicalPosition/LogicalSize so Tauri
//  handles the device-pixel-ratio conversion.
// ─────────────────────────────────────────────────────────────────────────

import { getCurrentWindow } from '@tauri-apps/api/window'
import { Webview } from '@tauri-apps/api/webview'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'

// id -> { webview: Webview, ready: Promise<boolean> }
const views = new Map()
let activeId = null

const labelFor = (id) => `app__${id}`

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
  if (activeId && activeId !== app.id) {
    const prev = views.get(activeId)
    if (prev && (await prev.ready)) prev.webview.hide().catch(() => {})
  }
  activeId = app.id

  let entry = views.get(app.id)
  if (!entry) entry = createView(app, rect)

  const ok = await entry.ready
  // Bail if creation failed, or the user switched away while we awaited.
  if (!ok || activeId !== app.id) return

  try {
    await entry.webview.setPosition(new LogicalPosition(rect.x, rect.y))
    await entry.webview.setSize(new LogicalSize(rect.width, rect.height))
    await entry.webview.show()
    await entry.webview.setFocus()
    if (import.meta.env.DEV) await logPlacement(app, rect, entry.webview)
  } catch (e) {
    console.error('[nativeStage] failed to show webview for', app.id, e)
  }
}

// Temporary diagnostic: compare what we asked for (logical px) against what the
// webview actually reports (physical px), plus the scale factor. Read this in
// the WebKitGTK inspector console (right-click the top bar → Inspect Element).
async function logPlacement(app, rect, webview) {
  try {
    const [pos, size, scale] = await Promise.all([
      webview.position(),
      webview.size(),
      getCurrentWindow().scaleFactor(),
    ])
    console.log(
      `[nativeStage] placement for ${app.id}\n` +
        `  requested (logical): x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}\n` +
        `  applied  (physical): x=${pos.x} y=${pos.y} w=${size.width} h=${size.height}\n` +
        `  scaleFactor=${scale}  devicePixelRatio=${window.devicePixelRatio}\n` +
        `  window inner (logical): ${window.innerWidth}x${window.innerHeight}`,
    )
  } catch (e) {
    console.warn('[nativeStage] placement diagnostic failed', e)
  }
}

// Hide every app webview (Home screen, About panel, or an HTML notice showing).
export async function hideAll() {
  activeId = null
  for (const entry of views.values()) {
    if (await entry.ready) entry.webview.hide().catch(() => {})
  }
}

// Reposition the currently-shown webview — called on window/stage resize.
export async function positionActive(rect) {
  if (!activeId) return
  const entry = views.get(activeId)
  if (!entry || !(await entry.ready)) return
  entry.webview.setPosition(new LogicalPosition(rect.x, rect.y)).catch(() => {})
  entry.webview.setSize(new LogicalSize(rect.width, rect.height)).catch(() => {})
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
