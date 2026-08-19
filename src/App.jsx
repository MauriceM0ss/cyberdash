import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useAppRegistry } from './useAppRegistry.js'
import { useHealth } from './useHealth.js'
import { useAppControl, powerState } from './useAppControl.js'
import { useTheme } from './useTheme.js'
import { isTauri, THEMES } from './theme.js'
import { usePref } from './usePrefs.js'
import { useNativeStage, readRect } from './useNativeStage.js'
import * as nativeStage from './nativeStage.js'
import Dock from './components/Dock.jsx'
import Settings from './components/Settings.jsx'
import {
  ReloadIcon,
  InfoIcon,
  SettingsIcon,
  CloseIcon,
  PowerIcon,
} from './components/Icons.jsx'
import './App.css'

const NATIVE = isTauri()

// How apps are embedded inside the Tauri shell:
//   'webview' — one native child webview per app. Each app is then a top-level
//               document, which is what makes X-Frame-Options irrelevant and,
//               on WebKitGTK, what makes the app's localStorage persist at all
//               — a cross-origin iframe there gets memory-only storage, so an
//               iframed app forgets its every setting on close (see TAURI.md).
//               Placement is ours, not Tauri's: src-tauri/src/stage.rs.
//   'iframe'  — identical to the browser, and the fallback if the native stage
//               ever misbehaves. Subject to X-Frame-Options / CSP, so some apps
//               need embed:false, and embedded apps can't persist anything.
// A plain browser always uses iframes regardless.
const EMBED_MODE = 'webview' // 'iframe' | 'webview'
const USE_WEBVIEW = NATIVE && EMBED_MODE === 'webview'

const ORDER_KEY = 'cyberdash.dockOrder'
const ACTIVE_KEY = 'cyberdash.activeId'

// The last-open app id, as stored. It's validated against the live app list in
// App below rather than here, because apps can now be added and removed at
// runtime — a stored id may stop being valid long after load.
function loadActiveId() {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY))
    return Array.isArray(saved) ? saved : []
  } catch {
    return []
  }
}

// Reconcile a saved dock arrangement against the live app list: keep saved ids
// that still exist (in saved order), drop removed ones, append new ones at the
// end. Returns the original array when nothing changed, so it can be used in an
// effect without looping.
function reconcileOrder(saved, apps) {
  const ids = apps.map((a) => a.id)
  const kept = saved.filter((id) => ids.includes(id))
  const added = ids.filter((id) => !kept.includes(id))
  const next = [...kept, ...added]
  const same =
    next.length === saved.length && next.every((id, i) => id === saved[i])
  return same ? saved : next
}

export default function App() {
  // The currently open app (null = home screen). Restored from the last session.
  const [activeId, setActiveId] = useState(loadActiveId)
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
  // Whether the Settings dialog is open.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Whether the dock's power menu is up — another HTML layer that has to be
  // able to show through the stage. See htmlCoversStage below.
  const [dockMenuOpen, setDockMenuOpen] = useState(false)
  // Dock layout, chosen in Settings ▸ Preferences and persisted.
  const [dockPosition, setDockPosition] = usePref('dockPosition')
  const [dockSize, setDockSize] = usePref('dockSize')
  // apps.config.js layered with the edits, additions and removals made in
  // Settings ▸ Apps. `apps` is memoised inside the hook, so the pollers below
  // only restart when the list genuinely changes.
  const registry = useAppRegistry()
  const apps = registry.apps
  // Live reachability of each app: { [id]: 'checking' | 'up' | 'down' }.
  const [health, recheckHealth] = useHealth(apps)
  // Container state + power controls, via the dockerctl helper. Inert (and no
  // buttons are shown) until it's configured in Settings ▸ Power.
  const appControl = useAppControl()
  // The DOM element the native stage webview is positioned to overlay (Tauri).
  const stageSlotRef = useRef(null)

  // A container starts in about a second, but the app inside it needs longer
  // before it answers HTTP. Re-check health a few times over the next ~10s so
  // the lights catch up promptly instead of sitting wrong until the next tick.
  const kickTimers = useRef([])
  const kickHealth = useCallback(() => {
    kickTimers.current.forEach(clearTimeout)
    kickTimers.current = [700, 2500, 5000, 9000].map((d) =>
      setTimeout(recheckHealth, d),
    )
  }, [recheckHealth])
  useEffect(() => () => kickTimers.current.forEach(clearTimeout), [])

  // Every power action re-checks health when it settles, so callers downstream
  // (dock menu, home tile, offline notice) don't each have to remember to.
  const control = useMemo(
    () => ({ ...appControl, run: (id, action) => appControl.run(id, action, kickHealth) }),
    [appControl, kickHealth],
  )

  useEffect(() => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  }, [order])

  // Keep the dock arrangement and the open app in step with the app list, which
  // Settings ▸ Apps can change at any time: a newly added app joins the end of
  // the dock, and closing over a removed one drops you back Home rather than
  // leaving a dead frame on screen.
  useEffect(() => {
    setOrder((prev) => reconcileOrder(prev, apps))
    setActiveId((prev) => (prev && !apps.some((a) => a.id === prev) ? null : prev))
  }, [apps])

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
        if (USE_WEBVIEW) {
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

  // Only embeddable apps are ever "active" — launching a non-embed app opens a
  // tab instead. The guard also covers a stored id whose app has since been
  // edited to embed:false.
  const active = apps.find((a) => a.id === activeId && a.embed) || null

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
    if (USE_WEBVIEW) {
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

      // Esc closes our own panels even when focus is in one of their fields.
      // This is checked before the input guard below on purpose: Settings no
      // longer closes on a backdrop click, so without this you'd have no
      // keyboard way out while typing in it.
      if (e.key === 'Escape' && (settingsOpen || helpOpen)) {
        if (settingsOpen) setSettingsOpen(false)
        else setHelpOpen(false)
        e.preventDefault()
        return
      }

      const el = e.target
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return

      if (e.key === 'Escape') {
        setActiveId(null) // no panel open — Esc goes Home
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
  }, [orderedApps, activeId, helpOpen, settingsOpen])

  // Drive the native child webviews from state (inert in a plain browser). We
  // hide the active webview whenever an HTML layer must show through it, since
  // native webviews float above all HTML in the shell window.
  const htmlCoversStage =
    helpOpen ||
    settingsOpen ||
    dockMenuOpen ||
    (!!active && (blocked[active.id] || health[active.id] === 'down'))
  useNativeStage({
    enabled: USE_WEBVIEW,
    activeApp: USE_WEBVIEW && active && active.embed ? active : null,
    coverHtml: htmlCoversStage,
    slotRef: stageSlotRef,
  })

  return (
    // The dock modifiers live on the root so the stage can leave the right
    // band clear (see .app--dock-right in App.css) — the native webview can't
    // be overlapped by HTML, so the clearance has to be real layout, not a
    // z-index trick.
    <div className={`app app--dock-${dockPosition} app--dock-${dockSize}`}>
      {/* Thin bar that always sits above every app frame; carries CyberDash's
          own controls so they never overlap an app's content. */}
      <TopBar
        canReload={!!active && !blocked[active.id]}
        onReload={() => active && reloadApp(active.id)}
        onHelp={() => setHelpOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="stage">
        {/* Home screen — shown when no app is open. */}
        {!active && (
          <Home
            apps={orderedApps}
            health={health}
            control={control}
            onLaunch={launch}
          />
        )}

        {/* Blocked notice — shown when the active app refuses to be framed. */}
        {active && blocked[active.id] && <BlockedNotice app={active} />}

        {/* Offline notice — shown when the active app is unreachable. It swaps
            back to the live frame automatically once health returns (see the
            auto-recovery effect above). */}
        {active && !blocked[active.id] && health[active.id] === 'down' && (
          <OfflineNotice app={active} control={control} />
        )}

        {/* NATIVE (Tauri): a native child webview per app floats over this
            reserved slot — see useNativeStage. The slot is just a measurement
            target + backdrop; the real app content is the OS webview on top.
            X-Frame-Options / CSP don't apply to a top-level webview, so apps
            that refuse to iframe embed fine here. */}
        {USE_WEBVIEW && active && active.embed && (
          <div className="app-frame native-stage" ref={stageSlotRef} aria-hidden="true" />
        )}

        {/* BROWSER: every embeddable app is mounted once as an iframe and kept
            alive for the life of the tab; switching apps only toggles which
            frame is visible. Hiding an inactive frame with `display:none` keeps
            its document intact — open dialogs, scroll position, form input, and
            any background polling/notifications all survive a switch — instead
            of destroying and cold-reloading it. */}
        {!USE_WEBVIEW &&
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
        position={dockPosition}
        size={dockSize}
        control={control}
        onLaunch={launch}
        onReorder={reorder}
        onHome={() => setActiveId(null)}
        onMenuOpen={setDockMenuOpen}
      />

      {/* Connection-level trouble with the helper, reported once rather than
          on every tile. Action failures surface here too. */}
      {control.error && (
        <div className="control-error" role="status">
          Power controls: {control.error}
        </div>
      )}

      {helpOpen && (
        <HelpOverlay appCount={apps.length} onClose={() => setHelpOpen(false)} />
      )}

      {settingsOpen && (
        <Settings
          prefs={{ dockPosition, setDockPosition, dockSize, setDockSize }}
          control={control}
          registry={registry}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

// The persistent top bar — CyberDash's own chrome, always shown regardless of
// which app is framed below (each embedded app already shows its own title).
// Left: the CyberDash wordmark. Right: an action cluster matching SecAnalysis's
// — 34px monochrome .icon-btn buttons carrying the same stroke-SVG glyphs, on
// the same near-black bar (--header-*), so the two apps' chrome is identical.
function TopBar({ canReload, onReload, onHelp, onSettings }) {
  return (
    <header className="app-bar">
      <span className="app-bar-title">CyberDash</span>
      <div className="header-actions">
        {canReload && (
          <button
            className="icon-btn"
            onClick={onReload}
            title="Reload this app  (r)"
            aria-label="Reload current app"
          >
            <ReloadIcon />
          </button>
        )}
        <button
          className="icon-btn"
          onClick={onHelp}
          title="About CyberDash  (?)"
          aria-label="About CyberDash"
          aria-haspopup="dialog"
        >
          <InfoIcon />
        </button>
        <button
          className="icon-btn"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          aria-haspopup="dialog"
        >
          <SettingsIcon />
        </button>
      </div>
    </header>
  )
}

// About / help overlay. Closes on the ✕, on a backdrop click, or via Esc / ?
// (both handled by the global key handler in App).
function HelpOverlay({ appCount, onClose }) {
  const theme = useTheme()
  const themeName = THEMES.find((t) => t.id === theme)?.name || theme
  const source = isTauri() ? 'GNOME desktop' : 'browser (prefers-color-scheme)'
  return (
    <div className="help-overlay" onClick={onClose}>
      <div
        className="help-card"
        role="dialog"
        aria-label="About CyberDash"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn help-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
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
          Theme: <strong>{themeName}</strong> — change it in Settings ▸
          Appearance. On <em>Auto</em> it follows your {source}, so flipping
          your desktop’s Light/Dark style restyles CyberDash instantly.
        </p>
        <p className="help-theme">
          Shell origin: <strong>{window.location.origin}</strong> — this is the
          origin apps see as the framer; add it to their CSP{' '}
          <code>frame-ancestors</code> to allow embedding.
        </p>
      </div>
    </div>
  )
}

const HEALTH_LABEL = { checking: 'checking…', up: 'online', down: 'offline' }

function Home({ apps, health, control, onLaunch }) {
  return (
    <div className="home">
      <h1 className="home-title">CyberDash</h1>
      <Clock />
      <div className="status-grid">
        {apps.map((app) => {
          const state = health[app.id] || 'checking'
          const power = powerState(app.id, control)
          return (
            // A div, not a button: the power control is a button of its own and
            // nesting one inside another is invalid. The card's whole area is
            // still clickable via .status-launch below.
            <div key={app.id} className="status-tile">
              <button
                className="status-launch"
                onClick={() => onLaunch(app)}
                title={`Open ${app.name}`}
              >
                <HomeIcon icon={app.icon} name={app.name} />
                <span className="status-name">{app.name}</span>
                <span className="status-state">
                  <span className={`status-dot health-${state}`} />
                  {power.pending ? power.label : HEALTH_LABEL[state]}
                </span>
              </button>
              {power.show && (
                <button
                  className={
                    'status-power' +
                    (power.running ? ' is-running' : '') +
                    (power.pending ? ' is-pending' : '')
                  }
                  disabled={power.disabled}
                  title={power.reason || `${power.label} ${app.name}`}
                  aria-label={`${power.label} ${app.name}`}
                  onClick={() => power.action && control.run(app.id, power.action)}
                >
                  <PowerIcon />
                </button>
              )}
            </div>
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

function OfflineNotice({ app, control }) {
  const power = powerState(app.id, control)
  // The most useful place in the whole dashboard for a Start button: the app is
  // unreachable, you're already looking at the reason, and the fix is one click.
  const canStart = power.show && !power.disabled && !power.running

  return (
    <div className="home">
      <div className="offline-badge">🔌</div>
      <h1 className="offline-title">{app.name} is offline</h1>
      <p className="home-sub">
        Can’t reach {app.url}. Retrying every few seconds — this will switch to
        the app automatically the moment it’s back.
      </p>
      {power.pending && <p className="home-sub">{power.label}</p>}
      {power.reason && <p className="home-sub">{power.reason}</p>}
      <div className="offline-actions">
        {canStart && (
          <button
            className="open-btn"
            onClick={() => control.run(app.id, 'start')}
          >
            Start {app.name}
          </button>
        )}
        <a className="open-btn" href={app.url} target="_blank" rel="noopener">
          Open {app.name} ↗
        </a>
      </div>
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
