// ─────────────────────────────────────────────────────────────────────────
//  Theme bridge — make CyberDash follow the desktop's Light/Dark preference.
//
//  Two runtime environments, one behaviour:
//
//    • Inside the Tauri (GNOME) shell — we ask the native window for its theme
//      (which Tauri derives from the OS colour-scheme) and subscribe to
//      `onThemeChanged`, so flipping GNOME Settings ▸ Appearance ▸ Dark/Light
//      restyles CyberDash instantly, no restart.
//
//    • In a plain browser (e.g. `docker compose up` + localhost:5173) — we fall
//      back to the `prefers-color-scheme` media query, which WebKitGTK/Chromium
//      also derive from the desktop theme, and watch it for live changes.
//
//  Either way we stamp `data-theme="light" | "dark"` on <html>. The CSS in
//  index.css keys every colour token off that attribute, and an explicit
//  attribute always beats the media-query fallback (see the selector order
//  there). A `cyberdash:themechange` DOM event is emitted so React components
//  (see useTheme.js) can react without prop-drilling.
// ─────────────────────────────────────────────────────────────────────────

const root = document.documentElement

/** Normalise to 'light' | 'dark' and apply it everywhere. */
export function applyTheme(name) {
  const theme = name === 'light' ? 'light' : 'dark'
  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme
    root.style.colorScheme = theme
    document.dispatchEvent(
      new CustomEvent('cyberdash:themechange', { detail: theme }),
    )
  }
  return theme
}

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

/** True when running inside the Tauri native shell. */
export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Set a best-guess theme synchronously (before React paints) to avoid a flash,
 * then start the live source of truth. Safe to call once at startup.
 */
export function initThemeSync() {
  return applyTheme(systemPrefersDark() ? 'dark' : 'light')
}

/** Wire up the live theme source. Returns a cleanup function. */
export async function watchTheme() {
  if (isTauri()) {
    try {
      // Dynamic import so the Tauri API is never pulled into a plain-browser bundle path.
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const current = await win.theme() // 'light' | 'dark' | null
      applyTheme(current ?? (systemPrefersDark() ? 'dark' : 'light'))
      // onThemeChanged resolves to an unlisten fn.
      const unlisten = await win.onThemeChanged(({ payload }) =>
        applyTheme(payload),
      )
      return unlisten
    } catch (err) {
      console.warn(
        '[theme] Tauri theme API unavailable; using media-query fallback.',
        err,
      )
    }
  }

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  applyTheme(mq.matches ? 'dark' : 'light')
  const onChange = (e) => applyTheme(e.matches ? 'dark' : 'light')
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
