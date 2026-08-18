import { useEffect, useRef, useState } from 'react'
import { powerState } from '../useAppControl.js'

const HEALTH_LABEL = {
  checking: 'checking…',
  up: 'online',
  down: 'offline',
}

// The Home button's icon. Same rule as an app's `icon`: an emoji (e.g. '🏠'),
// or a path to an image in /public served from the root (e.g. '/icons/cyberdash.png').
const HOME_ICON = '/icons/cyberdash.svg'

// A floating dock. Each icon carries a live health light, and icons can be
// dragged to reorder them (order is persisted by the parent).
//
// `position` ('bottom' | 'right') and `size` ('normal' | 'medium' | 'small')
// come from Settings ▸ Preferences and only add a modifier class — the whole
// layout, including the icon size and whether the strip runs across or down,
// is CSS (see App.css). App.jsx keeps the stage clear of whichever edge the
// dock is on.
//
// Right-clicking an icon opens a power menu (start / stop / restart), which is
// why the controls aren't buttons inside the dock item: a dock item is already
// the drag handle for reordering, and nesting a button inside it is both invalid
// HTML and a fight with the drag handlers. The roomier controls live on the Home
// screen.
export default function Dock({
  apps,
  activeId,
  health = {},
  position = 'bottom',
  size = 'normal',
  control,
  onLaunch,
  onReorder,
  onHome,
  onMenuOpen,
}) {
  // { id, x, y } for the open power menu, or null.
  const [menu, setMenu] = useState(null)
  const drag = useDockDrag(onReorder)

  // The menu is HTML, and it opens over the stage. In the .deb the stage is a
  // native webview that no HTML can be drawn on top of, so App has to take the
  // app off screen for as long as the menu is up.
  useEffect(() => {
    onMenuOpen?.(!!menu)
  }, [menu, onMenuOpen])

  // Any click elsewhere, any Esc, or any scroll dismisses the menu — it is
  // positioned in viewport coordinates, so it must not outlive a scroll.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const menuApp = menu ? apps.find((a) => a.id === menu.id) : null

  return (
    <nav
      className={`dock dock--${position} dock--${size}`}
      aria-label="Application dock"
    >
      <div className="dock-inner">
        {apps.map((app) => {
          const state = health[app.id] || 'checking'
          const power = powerState(app.id, control)
          return (
            <button
              key={app.id}
              className={
                'dock-item' +
                (app.id === activeId ? ' is-active' : '') +
                (app.id === drag.draggingId ? ' is-dragging' : '') +
                (power.pending ? ' is-pending' : '') +
                (app.id === drag.overId && app.id !== drag.draggingId
                  ? ' is-drop-target'
                  : '')
              }
              data-app-id={app.id}
              onPointerDown={(e) => drag.onPointerDown(e, app.id)}
              onClick={() => {
                if (drag.consumeClick()) return // that click ended a drag
                onLaunch(app)
              }}
              onContextMenu={(e) => {
                if (!control?.configured) return // no helper — keep the native menu
                e.preventDefault()
                e.stopPropagation()
                setMenu({ id: app.id, x: e.clientX, y: e.clientY })
              }}
              aria-label={`${app.name} · ${HEALTH_LABEL[state]}`}
              title={
                control?.configured
                  ? `${app.name} — right-click for power controls`
                  : app.name
              }
            >
              <Icon icon={app.icon} name={app.name} />
              <span className={`health-dot health-${state}`} />
            </button>
          )
        })}

        <span className="dock-divider" />

        <button className="dock-item dock-home" onClick={onHome} aria-label="Home">
          <Icon icon={HOME_ICON} name="Home" />
        </button>
      </div>

      {menu && menuApp && (
        <PowerMenu
          app={menuApp}
          at={menu}
          control={control}
          onDone={() => setMenu(null)}
        />
      )}
    </nav>
  )
}

// The id of the dock icon under a pointer event, or undefined. The Home button
// is a .dock-item too but carries no app id, so it can't be a drop target.
function itemUnder(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  return el?.closest?.('.dock-item')?.dataset.appId
}

// Reordering by dragging an icon, built on plain pointer events.
//
// Deliberately NOT the HTML5 drag-and-drop API: it worked in the browser but did
// nothing at all in the .deb, whose WebKitGTK webview is a different engine with
// its own rules about what may become a drag source. Pointer down/move/up is
// plumbing every engine agrees on, and it gets touch dragging for free.
//
// The move/up listeners go on `window` rather than the icon, so the gesture
// survives the pointer leaving the icon it started on — which is the whole
// point of a drag. Whatever sits under the cursor is looked up per move via
// elementFromPoint, so no per-icon enter/leave bookkeeping is needed.
function useDockDrag(onReorder) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  // Mutable gesture state — read inside window listeners that are registered
  // once, so it can't live in React state without stale-closure trouble.
  const gesture = useRef(null)
  // Set when a drag ends, so the click that pointerup synthesises launches the
  // app instead of firing on top of the reorder. Consumed by the click handler.
  const swallowClick = useRef(false)

  // Below this many pixels of travel it's a click, not a drag — otherwise every
  // launch would jitter the dock order.
  const THRESHOLD = 5

  useEffect(() => {
    function onMove(e) {
      const g = gesture.current
      if (!g) return
      if (!g.active) {
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < THRESHOLD) return
        g.active = true
        setDraggingId(g.id)
      }
      setOverId(itemUnder(e) || null)
    }

    function onUp(e) {
      const g = gesture.current
      gesture.current = null
      if (!g?.active) return
      swallowClick.current = true
      // Read the drop target from the event, not from `overId` — that's React
      // state, and the last pointermove's render may not have landed yet.
      const target = itemUnder(e)
      if (target && target !== g.id) onReorder(g.id, target)
      setDraggingId(null)
      setOverId(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onReorder])

  return {
    draggingId,
    overId,
    onPointerDown(e, id) {
      if (e.button !== 0) return // right-click opens the power menu
      swallowClick.current = false
      gesture.current = { id, x: e.clientX, y: e.clientY, active: false }
    },
    // True if this click was the tail end of a drag and should be ignored.
    consumeClick() {
      const swallow = swallowClick.current
      swallowClick.current = false
      return swallow
    },
  }
}

// Fixed-position menu at the cursor, nudged back inside the viewport near the
// edges (the dock lives on one, so this is the common case, not an edge case).
function PowerMenu({ app, at, control, onDone }) {
  const power = powerState(app.id, control)
  const width = 168
  const height = 108
  const x = Math.min(at.x, window.innerWidth - width - 8)
  const y = Math.min(at.y, window.innerHeight - height - 8)

  function run(action) {
    control.run(app.id, action)
    onDone()
  }

  return (
    <div
      className="power-menu"
      style={{ left: x, top: y, width }}
      role="menu"
      aria-label={`${app.name} power controls`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="power-menu-title">{app.name}</div>
      {power.reason && <div className="power-menu-note">{power.reason}</div>}
      <button
        className="power-menu-item"
        role="menuitem"
        disabled={power.disabled || power.running}
        onClick={() => run('start')}
      >
        Start
      </button>
      <button
        className="power-menu-item is-danger"
        role="menuitem"
        disabled={power.disabled || !power.running}
        onClick={() => run('stop')}
      >
        Stop
      </button>
      <button
        className="power-menu-item"
        role="menuitem"
        disabled={power.disabled || !power.running}
        onClick={() => run('restart')}
      >
        Restart
      </button>
    </div>
  )
}

// Icon can be an emoji (short string) or an image path/URL.
function Icon({ icon, name }) {
  const isImage = /[\/.]/.test(icon) && icon.length > 2
  if (isImage) {
    return <img className="dock-img" src={icon} alt={name} draggable="false" />
  }
  return <span className="dock-emoji">{icon}</span>
}
