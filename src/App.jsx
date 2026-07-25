import { useState, useEffect, useRef } from 'react'
import { apps } from './apps.config.js'
import { useHealth } from './useHealth.js'
import { useTheme } from './useTheme.js'
import { isTauri } from './theme.js'
import { useNativeStage, readRect } from './useNativeStage.js'
import * as nativeStage from './nativeStage.js'
import Dock from './components/Dock.jsx'
import './App.css'

// In the Tauri shell we embed apps as native child webviews (no X-Frame-Options
// limits); in a plain browser we fall back to <iframe>. This flips the whole
// stage between the two strategies.
const NATIVE = isTauri()

const ORDER_KEY = 'cyberdash.dockOrder'
const ACTIVE_KEY = 'cyberdash.activeId'

// Restore the last-open app across refreshes — but only if that app still
// exists in the config and is embeddable. (We never auto-reopen a non-embed app
// on load, since that would pop a new browser tab the moment CyberDash starts.)
function loadActive() {
  const id = localStorage.getItem(ACTIVE_KEY)
  const app = apps.find((a) => a.id === id)
  return app && app.embed ? id : null
}

// Build the dock order from the saved arrangement, reconciled with the current
// config: keep saved ids that still exist (in saved order), drop removed ones,
// and append any newly-added apps at the end.
function loadOrder() {
  let saved = []
  try {
    saved = JSON.parse(localStorage.getItem(ORDER_KEY)) || []
  } catch {
    saved = []
  }
  const ids = apps.map((a) => a.id)
  const ordered = saved.filter((id) => ids.includes(id))
  for (const id of ids) if (!ordered.includes(id)) ordered.push(id)
  return ordered
}

export default function App() {
  // The currently open app (null = home screen). Restored from the last session.
  const [activeId, setActiveId] = useState(loadActive)
  // Apps whose iframe failed to load (blocked by X-Frame-Options / CSP).
  const [blocked, setBlocked] = useState({})
  // User-defined dock order (array of app ids), persisted to localStorage.
  const [order, setOrder] = useState(loadOrder)
  // Per-app reload counter. Bumping an app's number changes its iframe `key`,
  // which remounts just that one frame (a fresh load) and leaves the others —
  // and their preserved state — untouched.
  const [reloadNonce, setReloadNonce] = useState({})
  // Whether the About / help overlay is open.
  const [helpOpen, setHelpOpen] = useState(false)
  // Live reachability of each app: { [id]: 'checking' | 'up' | 'down' }.
  const health = useHealth(apps)
  // The DOM element the native stage webview is positioned to overlay (Tauri).
  const stageSlotRef = useRef(null)

  useEffect(() => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  }, [order])

  // Remember which app is open (or clear it for the home screen) so a refresh
  // reopens where you left off.
  useEffect(() => {
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId)
    else localStorage.removeItem(ACTIVE_KEY)
  }, [activeId])

  // Auto-recovery: a frame/webview that failed while its app was down won't
  // retry on its own, so when a health check flips an app from 'down' back to
  // 'up' we freshly reload just that one — remounting the iframe (browser) or
  // recreating the native webview (Tauri). The offline card is then replaced by
  // the now-live app automatically.
  const prevHealth = useRef({})
  useEffect(() => {
    for (const a of apps) {
      if (prevHealth.current[a.id] === 'down' && health[a.id] === 'up') {
        if (NATIVE) {
          if (a.embed) {
            nativeStage.reloadApp(a, readRect(stageSlotRef.current))
          }
        } else {
          setReloadNonce((n) => ({ ...n, [a.id]: (n[a.id] || 0) + 1 }))
        }
      }
    }
    prevHealth.current = health
  }, [health])

  const orderedApps = order
    .map((id) => apps.find((a) => a.id === id))
    .filter(Boolean)

  const active = apps.find((a) => a.id === activeId) || null

  // Move the dragged icon so it lands before (drag left) or after (drag right)
  // the icon it was dropped on.
  function reorder(fromId, toId) {
    setOrder((prev) => {
      const from = prev.indexOf(fromId)
      const to = prev.indexOf(toId)
      if (from === -1 || to === -1 || from === to) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function launch(app) {
    if (!app.embed) {
      window.open(app.url, '_blank', 'noopener')
      return
    }
    setActiveId(app.id)
  }

  // Force a fresh load of a single embedded app: recreate its native webview
  // (Tauri) or bump its reload nonce to remount the iframe (browser).
  function reloadApp(id) {
    if (NATIVE) {
      const app = apps.find((a) => a.id === id)
      if (app?.embed) nativeStage.reloadApp(app, readRect(stageSlotRef.current))
      return
    }
    setReloadNonce((n) => ({ ...n, [id]: (n[id] || 0) + 1 }))
  }

  // Keyboard shortcuts, active whenever the CyberDash shell itself has focus:
  //   1–9  jump to the Nth app in dock order   ·   Esc  go Home   ·   r  reload
  // NOTE: a cross-origin iframe swallows its own key events, so these fire only
  // when focus is on the dashboard chrome (Home screen, or just after clicking
  // the dock), not while you're typing inside an embedded app.
  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return // leave browser combos alone
      const el = e.target
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

      if (e.key === 'Escape') {
        // Esc closes the help overlay first, otherwise returns Home.
        if (helpOpen) setHelpOpen(false)
        else setActiveId(null)
      } else if (e.key === '?') {
        setHelpOpen((v) => !v)
      } else if (e.key >= '1' && e.key <= '9') {
        const app = orderedApps[Number(e.key) - 1]
        if (app) launch(app)
      } else if (e.key === 'r' && activeId) {
        reloadApp(activeId)
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [orderedApps, activeId, helpOpen])

  // Drive the native child webviews from state (inert in a plain browser). We
  // hide the active webview whenever an HTML layer must show through it, since
  // native webviews float above all HTML in the shell window.
  const htmlCoversStage =
    helpOpen ||
    (!!active && (blocked[active.id] || health[active.id] === 'down'))
  useNativeStage({
    enabled: NATIVE,
    activeApp: NATIVE && active && active.embed ? active : null,
    coverHtml: htmlCoversStage,
    slotRef: stageSlotRef,
  })

  return (
    <div className="app">
      {/* Thin bar that always sits above every app frame; carries CyberDash's
          own controls so they never overlap an app's content. */}
      <TopBar
        canReload={!!active && !blocked[active.id]}
        onReload={() => active && reloadApp(active.id)}
        onHelp={() => setHelpOpen(true)}
      />

      <main className="stage">
        {/* Home screen — shown when no app is open. */}
        {!active && (
          <Home apps={orderedApps} health={health} onLaunch={launch} />
        )}

        {/* Blocked notice — shown when the active app refuses to be framed. */}
        {active && blocked[active.id] && <BlockedNotice app={active} />}

        {/* Offline notice — shown when the active app is unreachable. It swaps
            back to the live frame automatically once health returns (see the
            auto-recovery effect above). */}
        {active && !blocked[active.id] && health[active.id] === 'down' && (
          <OfflineNotice app={active} />
        )}

        {/* NATIVE (Tauri): a native child webview per app floats over this
            reserved slot — see useNativeStage. The slot is just a measurement
            target + backdrop; the real app content is the OS webview on top.
            X-Frame-Options / CSP don't apply to a top-level webview, so apps
            that refuse to iframe embed fine here. */}
        {NATIVE && active && active.embed && (
          <div className="app-frame native-stage" ref={stageSlotRef} aria-hidden="true" />
        )}

        {/* BROWSER: every embeddable app is mounted once as an iframe and kept
            alive for the life of the tab; switching apps only toggles which
            frame is visible. Hiding an inactive frame with `display:none` keeps
            its document intact — open dialogs, scroll position, form input, and
            any background polling/notifications all survive a switch — instead
            of destroying and cold-reloading it. */}
        {!NATIVE &&
          apps
            .filter((a) => a.embed)
            .map((a) => {
              const isActive = a.id === activeId
              return (
                <iframe
                  key={`${a.id}:${reloadNonce[a.id] || 0}`}
                  className="app-frame"
                  src={a.url}
                  title={a.name}
                  // The frame stays mounted but hidden unless it's the active,
                  // non-blocked, reachable app — a BlockedNotice or
                  // OfflineNotice above takes its place otherwise. ('checking'
                  // still shows the frame; we only hide on a confirmed 'down'.)
                  style={{
                    display:
                      isActive && !blocked[a.id] && health[a.id] !== 'down'
                        ? 'block'
                        : 'none',
                  }}
                  // If the frame is refused we can't always detect it, but many
                  // browsers fire onError; the manual "open in tab" escape hatch
                  // in BlockedNotice covers the silent cases.
                  onError={() => setBlocked((b) => ({ ...b, [a.id]: true }))}
                />
              )
            })}
      </main>

      <Dock
        apps={orderedApps}
        activeId={activeId}
        health={health}
        onLaunch={launch}
        onReorder={reorder}
        onHome={() => setActiveId(null)}
      />

      {helpOpen && (
        <HelpOverlay appCount={apps.length} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  )
}

// The persistent top bar — CyberDash's own chrome, always shown regardless of
// which app is framed below (each embedded app already shows its own title).
// Left: the CyberDash wordmark. Right: reload-this-app and an About/help toggle.
function TopBar({ canReload, onReload, onHelp }) {
  return (
    <header className="app-bar">
      <span className="app-bar-title">CyberDash</span>
      <div className="app-bar-actions">
        {canReload && (
          <button
            className="bar-btn"
            onClick={onReload}
            title="Reload this app  (r)"
            aria-label="Reload current app"
          >
            ↻
          </button>
        )}
        <button
          className="bar-btn"
          onClick={onHelp}
          title="About CyberDash  (?)"
          aria-label="About CyberDash"
        >
          ?
        </button>
      </div>
    </header>
  )
}

// About / help overlay. Closes on the ✕, on a backdrop click, or via Esc / ?
// (both handled by the global key handler in App).
function HelpOverlay({ appCount, onClose }) {
  const theme = useTheme()
  const source = isTauri() ? 'GNOME desktop' : 'browser (prefers-color-scheme)'
  return (
    <div className="help-overlay" onClick={onClose}>
      <div
        className="help-card"
        role="dialog"
        aria-label="About CyberDash"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="help-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <h2 className="help-title">CyberDash</h2>
        <p className="help-text">
          A single-tab launcher for your {appCount} self-hosted apps. Each app
          runs in its own frame and stays alive in the background, so switching
          is instant and any open dialogs, scroll position, and background
          notifications survive a switch. Drag the dock icons to reorder them.
        </p>
        <h3 className="help-sub">Keyboard shortcuts</h3>
        <ul className="help-keys">
          <li>
            <span className="help-combo">
              <kbd>1</kbd>–<kbd>9</kbd>
            </span>
            <span>Jump to app by dock position</span>
          </li>
          <li>
            <span className="help-combo">
              <kbd>Esc</kbd>
            </span>
            <span>Back home / close this panel</span>
          </li>
          <li>
            <span className="help-combo">
              <kbd>r</kbd>
            </span>
            <span>Reload the current app</span>
          </li>
          <li>
            <span className="help-combo">
              <kbd>?</kbd>
            </span>
            <span>Toggle this help</span>
          </li>
        </ul>
        <p className="help-note">
          Shortcuts fire only when the dashboard has focus — click the bar or
          dock first if you’ve been typing inside an app.
        </p>
        <p className="help-theme">
          Theme: <strong>{theme}</strong> — following your {source}. Flip your
          desktop’s Light/Dark style and CyberDash follows instantly.
        </p>
      </div>
    </div>
  )
}

const HEALTH_LABEL = { checking: 'checking…', up: 'online', down: 'offline' }

function Home({ apps, health, onLaunch }) {
  return (
    <div className="home">
      <h1 className="home-title">CyberDash</h1>
      <Clock />
      <div className="status-grid">
        {apps.map((app) => {
          const state = health[app.id] || 'checking'
          return (
            <button
              key={app.id}
              className="status-tile"
              onClick={() => onLaunch(app)}
              title={`Open ${app.name}`}
            >
              <HomeIcon icon={app.icon} name={app.name} />
              <span className="status-name">{app.name}</span>
              <span className="status-state">
                <span className={`status-dot health-${state}`} />
                {HEALTH_LABEL[state]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Live clock, isolated in its own component so its per-second tick re-renders
// only the clock, not the whole dashboard grid.
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const date = now.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return (
    <div className="home-clock">
      <div className="clock-time">{time}</div>
      <div className="clock-date">{date}</div>
    </div>
  )
}

// Icon can be an emoji (short string) or an image path/URL — same rule the
// dock uses.
function HomeIcon({ icon, name }) {
  const isImage = /[\/.]/.test(icon) && icon.length > 2
  return isImage ? (
    <img className="status-img" src={icon} alt={name} draggable="false" />
  ) : (
    <span className="status-emoji">{icon}</span>
  )
}

function OfflineNotice({ app }) {
  return (
    <div className="home">
      <div className="offline-badge">🔌</div>
      <h1 className="offline-title">{app.name} is offline</h1>
      <p className="home-sub">
        Can’t reach {app.url}. Retrying every few seconds — this will switch to
        the app automatically the moment it’s back.
      </p>
      <a className="open-btn" href={app.url} target="_blank" rel="noopener">
        Open {app.name} ↗
      </a>
    </div>
  )
}

function BlockedNotice({ app }) {
  return (
    <div className="home">
      <h1 className="home-title">{app.name} can’t be embedded</h1>
      <p className="home-sub">
        This app refuses to load in a frame (X-Frame-Options / CSP). Open it in
        a new tab instead:
      </p>
      <a
        className="open-btn"
        href={app.url}
        target="_blank"
        rel="noopener"
      >
        Open {app.name} ↗
      </a>
    </div>
  )
}
