import { useCallback, useEffect, useState } from 'react'

const INTERVAL = 15000 // re-check every 15s
const TIMEOUT = 5000 // treat a hanging request as "down" after 5s

// Ping an app URL. Because our apps don't send CORS headers, we use no-cors:
// the response is opaque (unreadable), but the promise still RESOLVES when the
// server answered and REJECTS on connection-refused / timeout — which is all we
// need for a reachability light. (A net::ERR_CONNECTION_REFUSED line may appear
// in the browser console for down apps; that's expected and harmless.)
async function ping(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return 'up'
  } catch {
    return 'down'
  } finally {
    clearTimeout(timer)
  }
}

// Returns a map of { [app.id]: 'checking' | 'up' | 'down' }, refreshed on an
// interval. Also re-checks when the tab regains focus.
export function useHealth(apps, interval = INTERVAL) {
  const [status, setStatus] = useState(() =>
    Object.fromEntries(apps.map((a) => [a.id, 'checking'])),
  )

  const check = useCallback(() => {
    apps.forEach(async (app) => {
      const next = await ping(app.url)
      setStatus((prev) =>
        prev[app.id] === next ? prev : { ...prev, [app.id]: next },
      )
    })
  }, [apps])

  useEffect(() => {
    check()
    const id = setInterval(check, interval)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [check, interval])

  return status
}
