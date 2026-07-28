import { useEffect, useState } from 'react'

// Subscribe to CyberDash's active theme ('light' | 'dark'). The source of truth
// is the `data-theme` attribute on <html>, kept in sync with the desktop by
// src/theme.js; we just mirror its `cyberdash:themechange` events into React.
export function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'dark',
  )
  useEffect(() => {
    const onChange = (e) => setTheme(e.detail)
    document.addEventListener('cyberdash:themechange', onChange)
    return () => document.removeEventListener('cyberdash:themechange', onChange)
  }, [])
  return theme
}
