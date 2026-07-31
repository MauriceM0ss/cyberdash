import { useCallback, useEffect, useMemo, useState } from 'react'
import { apps as configApps } from './apps.config.js'

// The app list the dashboard actually renders, assembled from three layers:
//
//   apps.config.js   the checked-in baseline, shared by every machine
//   patches          per-field edits to a baseline app, kept in this browser
//   custom           apps added from Settings, kept in this browser
//   hidden           baseline apps removed from view, kept in this browser
//
// Layering rather than replacing keeps apps.config.js meaningful: edits to the
// file still reach every machine, and Reset on any field falls straight back to
// it. The cost is that additions and edits made here are per-browser — Settings
// offers "Copy as config entry" so anything worth keeping can be promoted into
// the file, which is also how it reaches the packaged .deb.

const KEY = 'cyberdash.appRegistry'
// Superseded by the above; still read once so an existing icon override isn't
// silently lost when this replaces it.
const LEGACY_ICONS_KEY = 'cyberdash.iconOverrides'

const FIELDS = ['name', 'url', 'icon', 'embed']

function load() {
  let state = { patches: {}, custom: [], hidden: [] }
  try {
    const raw = JSON.parse(localStorage.getItem(KEY))
    if (raw && typeof raw === 'object') {
      state = {
        patches: raw.patches && typeof raw.patches === 'object' ? raw.patches : {},
        custom: Array.isArray(raw.custom) ? raw.custom : [],
        hidden: Array.isArray(raw.hidden) ? raw.hidden : [],
      }
    }
  } catch {
    /* unreadable — start from the config baseline */
  }

  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_ICONS_KEY))
    if (legacy && typeof legacy === 'object') {
      for (const [id, icon] of Object.entries(legacy)) {
        if (icon && !state.patches[id]?.icon) {
          state.patches[id] = { ...state.patches[id], icon }
        }
      }
      localStorage.removeItem(LEGACY_ICONS_KEY)
    }
  } catch {
    /* nothing to migrate */
  }

  return state
}

/** Ids may only contain what a localStorage key and a React key handle cleanly. */
export function normaliseId(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Validate a candidate app. Returns a message, or null when it's fine.
 * `existingIds` excludes the app being edited so renaming isn't a self-clash.
 */
export function validateApp(app, existingIds) {
  if (!app.name?.trim()) return 'Give the app a name.'
  const id = normaliseId(app.id)
  if (!id) return 'The name needs at least one letter or digit.'
  if (existingIds.includes(id)) return `There's already an app with the id "${id}".`
  if (!app.url?.trim()) return 'Give the app a URL.'
  let parsed
  try {
    parsed = new URL(app.url)
  } catch {
    return 'That URL isn’t valid — include the scheme, e.g. http://localhost:8080'
  }
  if (!/^https?:$/.test(parsed.protocol)) return 'The URL must be http:// or https://'
  return null
}

export function useAppRegistry() {
  const [state, setState] = useState(load)
  const [error, setError] = useState(null)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      setError(null)
    } catch {
      setError(
        'Couldn’t save — this browser’s storage is full. Try a smaller icon ' +
          'image, or reset one you no longer need.',
      )
    }
  }, [state])

  // The resolved list. Memoised on the raw state so identity only changes when
  // something really changed — useHealth and useAppControl key their polling
  // off this array, and a fresh one on every render would restart them.
  const apps = useMemo(() => {
    const base = configApps
      .filter((a) => !state.hidden.includes(a.id))
      .map((a) => ({ ...a, ...cleanPatch(state.patches[a.id]) }))
    const extra = state.custom.map((a) => ({
      ...a,
      ...cleanPatch(state.patches[a.id]),
      custom: true,
    }))
    return [...base, ...extra]
  }, [state])

  const isCustom = useCallback(
    (id) => state.custom.some((a) => a.id === id),
    [state.custom],
  )

  /** Patch one field. An empty value clears the patch for that field. */
  const setField = useCallback((id, field, value) => {
    if (!FIELDS.includes(field)) return
    setState((prev) => {
      const patch = { ...prev.patches[id] }
      const isBlank = value === '' || value === null || value === undefined
      if (isBlank) delete patch[field]
      else patch[field] = typeof value === 'string' ? value.trim() : value
      const patches = { ...prev.patches }
      if (Object.keys(patch).length) patches[id] = patch
      else delete patches[id]
      return { ...prev, patches }
    })
  }, [])

  /** Drop every patch for an app, returning it to its config.js definition. */
  const resetApp = useCallback((id) => {
    setState((prev) => {
      const patches = { ...prev.patches }
      delete patches[id]
      return { ...prev, patches }
    })
  }, [])

  const addApp = useCallback((app) => {
    const id = normaliseId(app.id || app.name)
    setState((prev) => ({
      ...prev,
      custom: [
        ...prev.custom,
        {
          id,
          name: app.name.trim(),
          url: app.url.trim(),
          icon: app.icon?.trim() || '📦',
          embed: app.embed !== false,
        },
      ],
      // A re-add of something previously hidden should reappear, not stay gone.
      hidden: prev.hidden.filter((h) => h !== id),
    }))
    return id
  }, [])

  /**
   * Remove an app. A custom one is deleted outright; a config one is only
   * hidden, since this can't edit the file — "Restore" brings it back.
   */
  const removeApp = useCallback((id) => {
    setState((prev) => {
      const custom = prev.custom.filter((a) => a.id !== id)
      const wasCustom = custom.length !== prev.custom.length
      const patches = { ...prev.patches }
      if (wasCustom) delete patches[id]
      return {
        patches,
        custom,
        hidden: wasCustom || prev.hidden.includes(id) ? prev.hidden : [...prev.hidden, id],
      }
    })
  }, [])

  const restoreApp = useCallback((id) => {
    setState((prev) => ({ ...prev, hidden: prev.hidden.filter((h) => h !== id) }))
  }, [])

  const hiddenApps = useMemo(
    () => configApps.filter((a) => state.hidden.includes(a.id)),
    [state.hidden],
  )

  const isPatched = useCallback(
    (id) => Boolean(state.patches[id] && Object.keys(state.patches[id]).length),
    [state.patches],
  )

  return {
    apps,
    hiddenApps,
    patches: state.patches,
    error,
    isCustom,
    isPatched,
    setField,
    resetApp,
    addApp,
    removeApp,
    restoreApp,
  }
}

// Ignore blank patch values so a cleared field falls back to the baseline
// rather than rendering an app with an empty name or URL.
function cleanPatch(patch) {
  if (!patch) return {}
  const out = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== '' && v !== null && v !== undefined) out[k] = v
  }
  return out
}

/** The apps.config.js entry for an app, for the "Copy as config entry" button. */
export function asConfigEntry(app) {
  return `  {
    id: '${app.id}',
    name: '${app.name.replace(/'/g, "\\'")}',
    icon: '${app.icon.startsWith('data:') ? '/icons/your-icon.svg' : app.icon}',
    url: '${app.url}',
    embed: ${app.embed !== false},
  },`
}

/** The dockerctl allowlist line for an app. */
export function asAllowlistEntry(app, container) {
  return `"${app.id}": "${container || app.id}"`
}
