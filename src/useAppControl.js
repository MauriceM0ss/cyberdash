import { useCallback, useEffect, useRef, useState } from 'react'
import {
  act,
  isConfigured,
  listApps,
  loadConfig,
  reloadApps,
  saveConfig,
} from './dockerctl.js'

// Container-level state for each app, and the ability to power it on and off.
//
// This sits alongside useHealth rather than replacing it. They answer different
// questions, and the dashboard needs both:
//
//   useHealth      "does the app answer HTTP?"  — from the browser, no setup
//   useAppControl  "does the container exist, and is it running?"  — via dockerctl
//
// The gap between them is exactly the interesting bit. An app can be running
// but not yet serving (just started), or reachable while its container reports
// unhealthy. And only this hook can tell "stopped" apart from "never created",
// which decides whether a Start button can do anything at all.

const INTERVAL = 20000 // slower than the health ping; container state is stable

export function useAppControl() {
  const [config, setConfigState] = useState(loadConfig)
  // { [appId]: { state, health, running, container } }
  const [states, setStates] = useState({})
  // { [appId]: 'start' | 'stop' | 'restart' } while an action is in flight.
  const [busy, setBusy] = useState({})
  // Last connection-level failure, shown once in the UI rather than per app.
  const [error, setError] = useState(null)

  const configured = isConfigured(config)

  // Guards against a slow in-flight poll landing after the component unmounts
  // or after the settings changed, and overwriting fresher state.
  const generation = useRef(0)

  const refresh = useCallback(async () => {
    if (!isConfigured(config)) return
    const gen = ++generation.current
    try {
      const next = await listApps(config)
      if (gen === generation.current) {
        setStates(next)
        setError(null)
      }
    } catch (e) {
      if (gen === generation.current) setError(e.message)
    }
  }, [config])

  useEffect(() => {
    if (!configured) {
      setStates({})
      setError(null)
      return
    }
    refresh()
    const id = setInterval(refresh, INTERVAL)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [configured, refresh])

  /**
   * Power an app on or off. Resolves true on success.
   *
   * `onSettled` lets the caller kick the health poller once the container has
   * moved — a freshly started app needs a few seconds before it serves, and
   * without this the dock light would stay red until the next 15s tick.
   */
  const run = useCallback(
    async (id, action, onSettled) => {
      if (!isConfigured(config) || busy[id]) return false
      setBusy((b) => ({ ...b, [id]: action }))
      try {
        const after = await act(config, id, action)
        setStates((s) => ({ ...s, [id]: { ...s[id], ...after } }))
        setError(null)
        onSettled?.()
        return true
      } catch (e) {
        setError(e.detail ? `${e.message} — ${e.detail}` : e.message)
        return false
      } finally {
        setBusy((b) => {
          const next = { ...b }
          delete next[id]
          return next
        })
        refresh()
      }
    },
    [config, busy, refresh],
  )

  const setConfig = useCallback((next) => {
    setConfigState(saveConfig(next))
    setError(null)
  }, [])

  /** Pick up host-side edits to apps.json. Resolves with the app count. */
  const reload = useCallback(async () => {
    if (!isConfigured(config)) return null
    const next = await reloadApps(config)
    setStates(next)
    setError(null)
    return Object.keys(next).length
  }, [config])

  return {
    config,
    setConfig,
    configured,
    states,
    busy,
    error,
    refresh,
    reload,
    run,
  }
}

/**
 * What the power control for one app should currently offer.
 *
 * Kept out of the components so the dock menu, the home tile and the offline
 * notice can't drift apart on when a button is available.
 */
export function powerState(id, { configured, states, busy }) {
  if (!configured) return { show: false }
  const info = states[id]
  const pending = busy[id]

  if (pending) {
    return {
      show: true,
      pending,
      label: pending === 'stop' ? 'Stopping…' : 'Starting…',
      disabled: true,
      action: null,
    }
  }
  // No entry means dockerctl doesn't have this app in its allowlist — the
  // dashboard knows about it but the helper was never told to manage it.
  if (!info) {
    return {
      show: false,
      reason: 'Not in the dockerctl allowlist (add it to dockerctl/apps.json)',
    }
  }
  if (info.state === 'missing') {
    return {
      show: true,
      disabled: true,
      label: 'No container',
      action: null,
      reason:
        'The container doesn’t exist yet. Run `docker compose up -d` for this ' +
        'app once — dockerctl can start and stop containers but deliberately ' +
        'cannot create them.',
    }
  }
  return info.running
    ? { show: true, disabled: false, label: 'Stop', action: 'stop', running: true }
    : { show: true, disabled: false, label: 'Start', action: 'start', running: false }
}
