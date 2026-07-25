import { useEffect } from 'react'
import * as stage from './nativeStage.js'

// Round a DOM rect into the integer logical-pixel box a native webview wants.
export function readRect(el) {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }
}

// Drive the native child webviews from React state (Tauri only). When
// `enabled` is false (plain browser) this is inert and the DOM <iframe> path in
// App.jsx runs instead.
//
//   activeApp  the app object to show, or null (Home)
//   coverHtml  true when an HTML layer must show through (About panel, or an
//              offline/blocked notice) — we hide the webview so it doesn't
//              float over that HTML
//   slotRef    ref to the reserved stage element we overlay
export function useNativeStage({ enabled, activeApp, coverHtml, slotRef }) {
  // Show / hide in response to which app is active and whether HTML is on top.
  useEffect(() => {
    if (!enabled) return
    const shouldShow = activeApp && !coverHtml
    const rect = readRect(slotRef.current)
    if (shouldShow && rect) stage.showApp(activeApp, rect)
    else stage.hideAll()
  }, [enabled, activeApp, coverHtml, slotRef])

  // Keep the shown webview glued to the stage as the window/stage resizes.
  useEffect(() => {
    if (!enabled) return
    const reposition = () => {
      const rect = readRect(slotRef.current)
      if (rect) stage.positionActive(rect)
    }
    window.addEventListener('resize', reposition)
    const el = slotRef.current
    const ro = el ? new ResizeObserver(reposition) : null
    if (el && ro) ro.observe(el)
    return () => {
      window.removeEventListener('resize', reposition)
      ro?.disconnect()
    }
  }, [enabled, slotRef])
}
