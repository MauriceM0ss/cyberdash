// ─────────────────────────────────────────────────────────────────────────
//  Theme engine.
//
//  CyberDash ships the five palettes from the CyberNewsHub app (see
//  index.css). The *preference* — what you picked in Settings ▸ Appearance —
//  is one of those five ids, or 'auto'.
//
//    • 'auto' (the default) keeps the original behaviour: follow the desktop's
//      Light/Dark style, resolving to `neon` when it's dark and `light` when
//      it's light. Inside the Tauri (GNOME) shell we ask the native window and
//      subscribe to `onThemeChanged`, so flipping GNOME Settings ▸ Appearance
//      restyles CyberDash instantly, no restart. In a plain browser we use the
//      `prefers-color-scheme` media query and watch it the same way.
//
//    • An explicit theme pins that palette and stops following the desktop.
//
//  Either way we stamp a concrete theme id on <html> as `data-theme`; the CSS
//  in index.css keys every colour token off that. A `cyberdash:themechange`
//  DOM event is emitted so React components (see useTheme.js) can react
//  without prop-drilling.
// ─────────────────────────────────────────────────────────────────────────

const root = document.documentElement

const PREF_KEY = 'cyberdash.theme'

/** The pickable themes, in the order Settings shows them. */
export const THEMES = [
  { id: 'auto', name: 'Auto (follow desktop)' },
  { id: 'neon', name: 'Dark Terminal' },
  { id: 'blue', name: 'Deep Blue' },
  { id: 'light', name: 'Light' },
  { id: 'github', name: 'GitHub' },
  { id: 'amber', name: 'Amber' },
]

const CONCRETE = THEMES.map((t) => t.id).filter((id) => id !== 'auto')

/** The saved preference: a theme id, or 'auto'. */
export function getThemePref() {
  try {
    const saved = localStorage.getItem(PREF_KEY)
    if (saved === 'auto' || CONCRETE.includes(saved)) return saved
  } catch {
    /* private mode / storage disabled — fall through to the default */
  }
  return 'auto'
}

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

/** Stamp a concrete theme id on <html>, announcing the change once. */
function stamp(id) {
  const theme = CONCRETE.includes(id) ? id : 'neon'
  if (root.dataset.theme !== theme) {
    root.dataset.theme = theme
    document.dispatchEvent(
      new CustomEvent('cyberdash:themechange', { detail: theme }),
    )
  }
  return theme
}

/**
 * Apply the current preference. `desktop` is the desktop's own light/dark
 * style ('light' | 'dark' | null) when we know it; only 'auto' consults it.
 */
function applyPref(pref, desktop) {
  if (pref !== 'auto') return stamp(pref)
  const dark = desktop ? desktop === 'dark' : systemPrefersDark()
  return stamp(dark ? 'neon' : 'light')
}

/** Persist a new preference and apply it immediately. */
export function setThemePref(pref) {
  const next = pref === 'auto' || CONCRETE.includes(pref) ? pref : 'auto'
  try {
    localStorage.setItem(PREF_KEY, next)
  } catch {
    /* not persisting is survivable; the theme still applies for this session */
  }
  document.dispatchEvent(
    new CustomEvent('cyberdash:themepref', { detail: next }),
  )
  return applyPref(next, lastDesktopTheme)
}

/** True when running inside the Tauri native shell. */
export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

// The desktop's last-reported light/dark style. Cached so that switching the
// preference back to 'auto' resolves correctly without re-querying the shell.
let lastDesktopTheme = null

/**
 * Set a best-guess theme synchronously (before React paints) to avoid a flash,
 * then start the live source of truth. Safe to call once at startup.
 */
export function initThemeSync() {
  return applyPref(getThemePref(), null)
}

/** Wire up the live desktop-theme source. Returns a cleanup function. */
export async function watchTheme() {
  if (isTauri()) {
    try {
      // Dynamic import so the Tauri API is never pulled into a plain-browser bundle path.
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      lastDesktopTheme = (await win.theme()) ?? null // 'light' | 'dark' | null
      applyPref(getThemePref(), lastDesktopTheme)
      // onThemeChanged resolves to an unlisten fn.
      const unlisten = await win.onThemeChanged(({ payload }) => {
        lastDesktopTheme = payload
        applyPref(getThemePref(), payload)
      })
      return unlisten
    } catch (err) {
      console.warn(
        '[theme] Tauri theme API unavailable; using media-query fallback.',
        err,
      )
    }
  }

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  lastDesktopTheme = mq.matches ? 'dark' : 'light'
  applyPref(getThemePref(), lastDesktopTheme)
  const onChange = (e) => {
    lastDesktopTheme = e.matches ? 'dark' : 'light'
    applyPref(getThemePref(), lastDesktopTheme)
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
