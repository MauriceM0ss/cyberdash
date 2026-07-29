import { useEffect, useState } from 'react'
import { getThemePref, setThemePref } from './theme.js'

// Subscribe to the resolved theme — the concrete palette id currently applied
// ('neon' | 'blue' | 'light' | 'github' | 'amber'). The source of truth is the
// `data-theme` attribute on <html>, stamped by src/theme.js; we just mirror its
// `cyberdash:themechange` events into React.
export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'neon',
  )
  useEffect(() => {
    const onChange = (e) => setTheme(e.detail)
    document.addEventListener('cyberdash:themechange', onChange)
    return () => document.removeEventListener('cyberdash:themechange', onChange)
  }, [])
  return theme
}

// The saved *preference* ('auto' or a theme id) plus a setter, for the picker
// in Settings ▸ Appearance. Kept separate from useTheme because 'auto' is a
// preference that never appears as a resolved theme.
export function useThemePref() {
  const [pref, setPref] = useState(getThemePref)
  useEffect(() => {
    const onChange = (e) => setPref(e.detail)
    document.addEventListener('cyberdash:themepref', onChange)
    return () => document.removeEventListener('cyberdash:themepref', onChange)
  }, [])
  return [pref, setThemePref]
}
