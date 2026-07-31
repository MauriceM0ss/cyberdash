// Client for the dockerctl helper service (see dockerctl/README.md).
//
// dockerctl is a narrow gate in front of the Docker socket: it can start, stop
// and restart the containers named in its own allowlist, and nothing else. This
// module is the browser half — it holds the connection settings and wraps the
// four calls the dashboard makes.
//
// The token lives in localStorage, so anyone with devtools on this machine can
// read it. That's acceptable *here* specifically because the token's power is
// bounded to toggling your own app containers — it is not a host credential.
// Don't reuse it for anything else.

const CONFIG_KEY = 'cyberdash.dockerctl'

export const DEFAULT_URL = 'http://127.0.0.1:8033'

export function loadConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}
    return { url: raw.url || DEFAULT_URL, token: raw.token || '' }
  } catch {
    return { url: DEFAULT_URL, token: '' }
  }
}

export function saveConfig({ url, token }) {
  const next = { url: (url || '').trim().replace(/\/+$/, ''), token: (token || '').trim() }
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(next))
  } catch {
    /* storage disabled — the settings apply for this session only */
  }
  return next
}

/** Both halves must be present before we'll show any power controls. */
export function isConfigured(config) {
  return Boolean(config && config.url && config.token)
}

class ControlError extends Error {
  constructor(message, { status = 0, detail = '' } = {}) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

async function request(config, path, { method = 'GET', timeout = 20000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let resp
  try {
    resp = await fetch(`${config.url}${path}`, {
      method,
      headers: { Authorization: `Bearer ${config.token}` },
      cache: 'no-store',
      signal: controller.signal,
    })
  } catch {
    // Network-level failure: wrong port, service down, or CORS refused the
    // response. All indistinguishable from here, so say the useful thing.
    throw new ControlError('Can’t reach the control service', { status: 0 })
  } finally {
    clearTimeout(timer)
  }

  let body = {}
  try {
    body = await resp.json()
  } catch {
    /* some errors legitimately carry no JSON body */
  }

  if (resp.status === 401) throw new ControlError('Token rejected', { status: 401 })
  if (!resp.ok) {
    throw new ControlError(body.error || `Request failed (${resp.status})`, {
      status: resp.status,
      detail: body.detail || '',
    })
  }
  return body
}

/** All allowlisted apps and their container state, keyed by app id. */
export async function listApps(config) {
  const body = await request(config, '/api/apps')
  return Object.fromEntries((body.apps || []).map((a) => [a.id, a]))
}

/**
 * Ask the helper to re-read its apps.json from disk.
 *
 * This is how a newly-registered app becomes controllable without restarting
 * the container. It cannot widen the allowlist by itself — apps.json lives on
 * the host and is mounted read-only, so the file still has to be edited there.
 */
export async function reloadApps(config) {
  const body = await request(config, '/api/reload', { method: 'POST' })
  return Object.fromEntries((body.apps || []).map((a) => [a.id, a]))
}

/** Run one action. Returns that app's state afterwards. */
export function act(config, id, action) {
  return request(config, `/api/apps/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    // `stop` waits out the container's grace period before SIGKILL, so this
    // needs to outlast dockerctl's own STOP_TIMEOUT rather than race it.
    timeout: 45000,
  })
}

/** Settings ▸ Power "Test connection". Resolves with a count, or throws. */
export async function probe(config) {
  const apps = await listApps(config)
  return Object.keys(apps).length
}
