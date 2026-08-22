import { useEffect, useState } from 'react'

// Layout preferences set in Settings ▸ Preferences. Each is a plain string
// persisted to localStorage and read back on the next start; the values are
// validated on load so a stale or hand-edited key can't produce a broken class
// name on the dock.

export const DOCK_POSITIONS = [
  { id: 'bottom', name: 'Bottom' },
  { id: 'right', name: 'Right side' },
]

export const DOCK_SIZES = [
  { id: 'normal', name: 'Normal' },
  { id: 'medium', name: 'Medium' },
  { id: 'small', name: 'Small' },
]

export const THEME_SYNC = [
  { id: 'on', name: 'Apply to embedded apps' },
  { id: 'off', name: 'CyberDash only' },
]

const KEYS = {
  dockPosition: 'cyberdash.dockPosition',
  dockSize: 'cyberdash.dockSize',
  themeSync: 'cyberdash.themeSync',
}

const ALLOWED = {
  dockPosition: DOCK_POSITIONS.map((p) => p.id),
  dockSize: DOCK_SIZES.map((s) => s.id),
  themeSync: THEME_SYNC.map((t) => t.id),
}

// Theme sync defaults on: every app in the family already implements the same
// five themes, so matching them is the expected behaviour rather than a
// surprise. Turn it off to theme apps individually.
const DEFAULTS = { dockPosition: 'bottom', dockSize: 'normal', themeSync: 'on' }

function load(name) {
  try {
    const saved = localStorage.getItem(KEYS[name])
    if (ALLOWED[name].includes(saved)) return saved
  } catch {
    /* storage disabled — use the default */
  }
  return DEFAULTS[name]
}

/**
 * One persisted preference: `const [dockSize, setDockSize] = usePref('dockSize')`.
 * Invalid values are ignored rather than stored.
 */
export function usePref(name) {
  const [value, setValue] = useState(() => load(name))

  useEffect(() => {
    try {
      localStorage.setItem(KEYS[name], value)
    } catch {
      /* not persisting is survivable; the choice still applies this session */
    }
  }, [name, value])

  function set(next) {
    if (ALLOWED[name].includes(next)) setValue(next)
  }

  return [value, set]
}
