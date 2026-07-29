import { useState } from 'react'
import { THEMES } from '../theme.js'
import { useThemePref } from '../useTheme.js'
import { DOCK_POSITIONS, DOCK_SIZES } from '../usePrefs.js'
import { CloseIcon } from './Icons.jsx'

// Tabbed settings dialog, laid out like the CyberNewsHub / SecAnalysis one:
// a tab strip above a single scrolling panel. Every choice here applies live
// and is persisted, so there's no Save button and no Cancel — closing the
// dialog keeps whatever you picked.
const TABS = [
  { id: 'appearance', name: 'Appearance' },
  { id: 'prefs', name: 'Preferences' },
]

export default function Settings({ prefs, onClose }) {
  const [tab, setTab] = useState('appearance')
  const [themePref, setThemePref] = useThemePref()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dlg-head">
          <h2 className="modal-title">Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="settings-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={'settings-tab' + (t.id === tab ? ' is-active' : '')}
              role="tab"
              aria-selected={t.id === tab}
              onClick={() => setTab(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>

        {tab === 'appearance' && (
          <div className="settings-panel">
            <section className="settings-section">
              <h3 className="settings-section-title">Appearance</h3>
              <label className="field">
                Theme
                <select
                  className="modal-input"
                  value={themePref}
                  onChange={(e) => setThemePref(e.target.value)}
                >
                  {THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="settings-desc">
                The same five palettes as CyberNewsHub. Switches instantly and is
                remembered on this machine. <strong>Auto</strong> follows your
                desktop’s Light/Dark style — Dark Terminal when it’s dark, Light
                when it’s light — and keeps following it as you flip it.
              </p>
            </section>
          </div>
        )}

        {tab === 'prefs' && (
          <div className="settings-panel">
            <section className="settings-section">
              <h3 className="settings-section-title">Dock</h3>
              <label className="field">
                Position
                <select
                  className="modal-input"
                  value={prefs.dockPosition}
                  onChange={(e) => prefs.setDockPosition(e.target.value)}
                >
                  {DOCK_POSITIONS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="settings-desc">
                Where the floating dock sits. The app area shrinks to leave it
                clear, so the dock never covers an embedded app.
              </p>

              <label className="field">
                Size
                <select
                  className="modal-input"
                  value={prefs.dockSize}
                  onChange={(e) => prefs.setDockSize(e.target.value)}
                >
                  {DOCK_SIZES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="settings-desc">
                Normal is the original 52 px icon; Medium and Small shrink the
                icons and the dock’s padding to give apps more room.
              </p>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
