import { useState } from 'react'

const HEALTH_LABEL = {
  checking: 'checking…',
  up: 'online',
  down: 'offline',
}

// The Home button's icon. Same rule as an app's `icon`: an emoji (e.g. '🏠'),
// or a path to an image in /public served from the root (e.g. '/icons/cyberdash.png').
const HOME_ICON = '/icons/cyberdash.png'

// A floating dock. Icons stay a fixed size; each carries a live health light.
// Icons can be dragged to reorder them (order is persisted by the parent).
export default function Dock({ apps, activeId, health = {}, onLaunch, onReorder, onHome }) {
  const [draggingId, setDraggingId] = useState(null)
  const [overId, setOverId] = useState(null)

  function endDrag() {
    setDraggingId(null)
    setOverId(null)
  }

  return (
    <nav className="dock" aria-label="Application dock">
      <div className="dock-inner">
        {apps.map((app) => {
          const state = health[app.id] || 'checking'
          return (
            <button
              key={app.id}
              className={
                'dock-item' +
                (app.id === activeId ? ' is-active' : '') +
                (app.id === draggingId ? ' is-dragging' : '') +
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
              aria-label={`${app.name} · ${HEALTH_LABEL[state]}`}
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
    </nav>
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
