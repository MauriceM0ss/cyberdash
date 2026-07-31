import { useRef, useState } from 'react'
import { THEMES } from '../theme.js'
import { useThemePref } from '../useTheme.js'
import { DOCK_POSITIONS, DOCK_SIZES } from '../usePrefs.js'
import { DEFAULT_URL, probe } from '../dockerctl.js'
import {
  asAllowlistEntry,
  asConfigEntry,
  normaliseId,
  validateApp,
} from '../useAppRegistry.js'
import { fileToIcon, isImageIcon } from '../iconFile.js'
import { CloseIcon } from './Icons.jsx'

// Tabbed settings dialog, laid out like the CyberNewsHub / SecAnalysis one:
// a tab strip above a single scrolling panel. Every choice here applies live
// and is persisted, so there's no Save button and no Cancel — closing the
// dialog keeps whatever you picked.
const TABS = [
  { id: 'appearance', name: 'Appearance' },
  { id: 'prefs', name: 'Preferences' },
  { id: 'apps', name: 'Apps' },
  { id: 'power', name: 'Power' },
]

export default function Settings({ prefs, control, registry, onClose }) {
  const [tab, setTab] = useState('appearance')
  const [themePref, setThemePref] = useThemePref()

  return (
    // Deliberately no backdrop click-to-close: this dialog holds real edits —
    // app URLs, the dockerctl token — and a stray click outside it shouldn't
    // dismiss them mid-type. Close with the ✕ or Esc (see App.jsx).
    <div className="modal-backdrop">
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
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

        {tab === 'apps' && <AppsPanel registry={registry} control={control} />}

        {tab === 'power' && <PowerPanel control={control} />}
      </div>
    </div>
  )
}

// ── Apps ──────────────────────────────────────────────────────────────────
// Add, edit and remove apps. Everything here layers over apps.config.js and
// lives in this browser, so each editor offers "Copy as config entry" for
// promoting a change into the file — which is also how it reaches the .deb.
function AppsPanel({ registry, control }) {
  const [openId, setOpenId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [reloadResult, setReloadResult] = useState(null)
  const [reloading, setReloading] = useState(false)

  async function reloadHelper() {
    setReloading(true)
    setReloadResult(null)
    try {
      const count = await control.reload()
      setReloadResult({ ok: true, message: `Reloaded — ${count} app(s) managed.` })
    } catch (e) {
      setReloadResult({ ok: false, message: e.detail || e.message })
    } finally {
      setReloading(false)
    }
  }

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3 className="settings-section-title">Apps</h3>
        <p className="settings-desc">
          Changes here are stored in this browser and layer over{' '}
          <code>apps.config.js</code>. Use <strong>Copy as config entry</strong>{' '}
          to promote one into the file, which is how it reaches your other
          machines and the packaged .deb.
        </p>

        {registry.error && <p className="icon-row-error">{registry.error}</p>}

        <div className="app-rows">
          {registry.apps.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              registry={registry}
              control={control}
              open={openId === app.id}
              onToggle={() => setOpenId(openId === app.id ? null : app.id)}
            />
          ))}
        </div>

        {adding ? (
          <AddAppForm
            registry={registry}
            onDone={(id) => {
              setAdding(false)
              if (id) setOpenId(id)
            }}
          />
        ) : (
          <button className="btn-secondary" onClick={() => setAdding(true)}>
            + Add app
          </button>
        )}

        {registry.hiddenApps.length > 0 && (
          <>
            <h3 className="settings-section-title">Removed</h3>
            <p className="settings-desc">
              These come from <code>apps.config.js</code>, so they're hidden
              rather than deleted — remove them from the file to drop them for
              good.
            </p>
            <div className="app-rows">
              {registry.hiddenApps.map((app) => (
                <div className="app-row app-row--hidden" key={app.id}>
                  <span className="icon-row-preview">
                    <IconPreview icon={app.icon} />
                  </span>
                  <span className="icon-row-name">{app.name}</span>
                  <button
                    className="btn-secondary icon-row-btn"
                    onClick={() => registry.restoreApp(app.id)}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {control.configured && (
          <>
            <h3 className="settings-section-title">dockerctl</h3>
            <p className="settings-desc">
              The helper's allowlist is a file on the host, so a new app has to
              be added to <code>dockerctl/apps.json</code> there — deliberately,
              since letting the dashboard write it would mean a leaked token
              could stop any container on the machine. Once you've edited the
              file, reload to pick it up without restarting the container.
            </p>
            <div className="power-test-row">
              <button
                className="btn-secondary"
                onClick={reloadHelper}
                disabled={reloading}
              >
                {reloading ? 'Reloading…' : 'Reload dockerctl'}
              </button>
              {reloadResult && (
                <span
                  className={
                    'power-test-result' + (reloadResult.ok ? ' is-ok' : ' is-bad')
                  }
                >
                  {reloadResult.message}
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function AppRow({ app, registry, control, open, onToggle }) {
  const fileRef = useRef(null)
  const [fileError, setFileError] = useState(null)
  const custom = registry.isCustom(app.id)
  const patched = registry.isPatched(app.id)
  // Undefined means dockerctl has no entry for this id — the dashboard knows
  // the app but the helper was never told to manage it.
  const managed = control.configured ? Boolean(control.states[app.id]) : null

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setFileError(null)
    try {
      registry.setField(app.id, 'icon', await fileToIcon(file))
    } catch (err) {
      setFileError(err.message)
    }
  }

  return (
    <div className={'app-row-wrap' + (open ? ' is-open' : '')}>
      <div className="app-row">
        <span className="icon-row-preview">
          <IconPreview icon={app.icon} />
        </span>
        <span className="icon-row-name">{app.name}</span>
        {custom && <span className="app-tag">added here</span>}
        {!custom && patched && <span className="app-tag">edited</span>}
        {managed === false && (
          <span className="app-tag is-warn" title="Not in dockerctl/apps.json">
            no power
          </span>
        )}
        <button
          className="btn-secondary icon-row-btn"
          onClick={onToggle}
          aria-expanded={open}
        >
          {open ? 'Done' : 'Edit'}
        </button>
      </div>

      {open && (
        <div className="app-editor">
          <label className="field">
            Name
            <input
              className="modal-input"
              value={app.name}
              onChange={(e) => registry.setField(app.id, 'name', e.target.value)}
            />
          </label>

          <label className="field">
            URL
            <input
              className="modal-input"
              value={app.url}
              spellCheck="false"
              onChange={(e) => registry.setField(app.id, 'url', e.target.value)}
            />
          </label>

          <label className="field">
            Icon
            <div className="app-icon-field">
              <input
                className="modal-input"
                value={app.icon.startsWith('data:') ? '' : app.icon}
                placeholder={
                  app.icon.startsWith('data:') ? '(uploaded image)' : 'emoji or /icons/…'
                }
                spellCheck="false"
                onChange={(e) => registry.setField(app.id, 'icon', e.target.value)}
              />
              <button
                className="btn-secondary icon-row-btn"
                onClick={() => fileRef.current?.click()}
              >
                Upload…
              </button>
            </div>
          </label>
          {fileError && <p className="icon-row-error">{fileError}</p>}

          <label className="app-check">
            <input
              type="checkbox"
              checked={app.embed !== false}
              onChange={(e) => registry.setField(app.id, 'embed', e.target.checked)}
            />
            Open inside the dashboard
          </label>
          <p className="settings-desc">
            Off means it opens in a new browser tab. Some apps refuse to be
            framed (X-Frame-Options / CSP <code>frame-ancestors</code>) and need
            this off, unless you add this dashboard's origin to their CSP.
          </p>

          {managed === false && (
            <div className="app-hint">
              Not managed by dockerctl. Add to <code>dockerctl/apps.json</code>{' '}
              on the host, then Reload below:
              <CopyLine text={asAllowlistEntry(app, app.id)} />
            </div>
          )}

          <div className="app-editor-actions">
            <CopyButton
              label="Copy as config entry"
              text={asConfigEntry(app)}
            />
            {!custom && (
              <button
                className="btn-secondary icon-row-btn"
                onClick={() => registry.resetApp(app.id)}
                disabled={!patched}
                title={patched ? 'Back to the apps.config.js values' : 'No edits to reset'}
              >
                Reset
              </button>
            )}
            <button
              className="btn-secondary icon-row-btn is-danger"
              onClick={() => {
                registry.removeApp(app.id)
                onToggle()
              }}
            >
              Remove
            </button>
          </div>

          <input ref={fileRef} type="file" accept="image/*,.svg" hidden onChange={pick} />
        </div>
      )}
    </div>
  )
}

function AddAppForm({ registry, onDone }) {
  const [draft, setDraft] = useState({ name: '', url: '', icon: '' })
  const [error, setError] = useState(null)

  const id = normaliseId(draft.name)
  const existing = registry.apps.map((a) => a.id)

  function submit() {
    const problem = validateApp({ ...draft, id }, existing)
    if (problem) {
      setError(problem)
      return
    }
    onDone(registry.addApp({ ...draft, id }))
  }

  return (
    <div className="app-editor app-editor--new">
      <label className="field">
        Name
        <input
          className="modal-input"
          value={draft.name}
          autoFocus
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="field">
        URL
        <input
          className="modal-input"
          value={draft.url}
          placeholder="http://localhost:8080"
          spellCheck="false"
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      <label className="field">
        Icon (optional)
        <input
          className="modal-input"
          value={draft.icon}
          placeholder="emoji or /icons/… — defaults to 📦"
          spellCheck="false"
          onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
        />
      </label>
      {id && <p className="settings-desc">id: <code>{id}</code></p>}
      {error && <p className="icon-row-error">{error}</p>}
      <div className="app-editor-actions">
        <button className="btn-secondary" onClick={submit}>
          Add
        </button>
        <button className="btn-secondary" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function CopyButton({ label, text }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn-secondary icon-row-btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          setDone(false)
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}

function CopyLine({ text }) {
  return (
    <div className="app-copy-line">
      <code>{text}</code>
      <CopyButton label="Copy" text={text} />
    </div>
  )
}

function IconPreview({ icon }) {
  return isImageIcon(icon) ? (
    <img className="icon-row-img" src={icon} alt="" aria-hidden="true" />
  ) : (
    <span className="icon-row-emoji" aria-hidden="true">
      {icon}
    </span>
  )
}


// Connection settings for the dockerctl helper. Until both fields are filled in
// and accepted, no power controls appear anywhere in the dashboard.
function PowerPanel({ control }) {
  const [url, setUrl] = useState(control.config.url || DEFAULT_URL)
  const [token, setToken] = useState(control.config.token || '')
  const [result, setResult] = useState(null) // { ok, message }
  const [testing, setTesting] = useState(false)

  async function save() {
    control.setConfig({ url, token })
    setResult(null)
  }

  async function test() {
    setTesting(true)
    setResult(null)
    try {
      const count = await probe({ url: url.trim().replace(/\/+$/, ''), token: token.trim() })
      setResult({ ok: true, message: `Connected — ${count} app(s) under control.` })
      control.setConfig({ url, token }) // a working pair is worth keeping
    } catch (e) {
      setResult({ ok: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h3 className="settings-section-title">App power controls</h3>
        <p className="settings-desc">
          Lets CyberDash start and stop each app’s container. This needs the{' '}
          <code>dockerctl</code> helper running — see <code>dockerctl/README.md</code>.
          It only ever starts and stops the containers listed in its own{' '}
          <code>apps.json</code>; it cannot create one, so an app has to be
          brought up with <code>docker compose up -d</code> once before the
          buttons can do anything.
        </p>

        <label className="field">
          Service URL
          <input
            className="modal-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={save}
            placeholder={DEFAULT_URL}
            spellCheck="false"
          />
        </label>

        <label className="field">
          Token
          <input
            className="modal-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onBlur={save}
            placeholder="DOCKERCTL_TOKEN from dockerctl/.env"
            spellCheck="false"
          />
        </label>

        <div className="power-test-row">
          <button className="btn-secondary" onClick={test} disabled={testing}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {result && (
            <span className={'power-test-result' + (result.ok ? ' is-ok' : ' is-bad')}>
              {result.message}
            </span>
          )}
        </div>

        <p className="settings-desc">
          The token is kept in this browser’s local storage, so anyone with
          devtools on this machine can read it. That’s tolerable here because
          its only power is toggling your own app containers — it is not a host
          credential. Don’t reuse it elsewhere.
        </p>

        <p className="settings-desc">
          Once connected: right-click any dock icon for start / stop / restart,
          or use the power button on each Home screen tile.
        </p>
      </section>
    </div>
  )
}
