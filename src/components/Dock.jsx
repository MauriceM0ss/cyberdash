import { useEffect, useState } from 'react'
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
// a draggable <button>, and nesting a button inside it is both invalid HTML and
// a fight with the drag handlers. The roomier controls live on the Home screen.
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
}) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)
  // { id, x, y } for the open power menu, or null.
  const [menu, setMenu] = useState(null)

  function endDrag() {
    setDraggingId(null)
    setOverId(null)
  }

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
                (app.id === draggingId ? ' is-dragging' : '') +
                (power.pending ? ' is-pending' : '') +
                (app.id === overId && app.id !== draggingId
                  ? ' is-drop-target'
                  : '')
              }
              draggable
              onDragStart={(e) => {
                setDraggingId(app.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnter={() => setOverId(app.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (draggingId) onReorder(draggingId, app.id)
                endDrag()
              }}
              onDragEnd={endDrag}
              onClick={() => onLaunch(app)}
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
