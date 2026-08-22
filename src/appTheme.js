// ─────────────────────────────────────────────────────────────────────────
//  Theme propagation — keep the embedded apps on the shell's theme.
//
//  Every app in the family implements the same five themes and listens for a
//  `cyberdash:theme` message (see the listener in each app's base template).
//  The shell only posts that message; each app validates it against its own
//  theme list and stores it under its own key, so the list of what's valid
//  stays with the app rather than in a table here.
//
//  Two ways to deliver the same message, because the two builds embed apps
//  differently:
//
//    browser — apps are cross-origin iframes, so postMessage reaches them
//              directly. Targeted at the app's own origin rather than '*', so
//              the theme isn't broadcast to whatever else might be listening.
//    .deb    — apps are native webviews with no window handle to post to, so
//              Rust evaluates the postMessage inside the webview instead
//              (src-tauri/src/apptheme.rs). It lands on the same listener.
// ─────────────────────────────────────────────────────────────────────────

import { invoke } from '@tauri-apps/api/core'

export const THEME_MESSAGE = 'cyberdash:theme'

const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Post the theme to one embedded iframe. Browser build only. */
export function pushThemeToFrame(frame, appUrl, theme) {
  const origin = originOf(appUrl)
  if (!frame?.contentWindow || !origin) return
  try {
    frame.contentWindow.postMessage({ type: THEME_MESSAGE, theme }, origin)
  } catch {
    /* frame torn down mid-push, or a origin that won't accept it */
  }
}

/**
 * Hand the theme to the native side, which remembers it and pushes it to every
 * open app — and to each app as it finishes loading, so a cold start, a reload
 * and an app coming back from being down all pick it up without the shell
 * having to guess when a document became ready.
 */
export function broadcastThemeNative(theme) {
  invoke('theme_broadcast', { theme }).catch((e) => {
    console.error('[appTheme] native theme broadcast failed', e)
  })
}
