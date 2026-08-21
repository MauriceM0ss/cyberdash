import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../useTheme.js'
import { run } from '../games/engine.js'
import createSnake from '../games/snake.js'
import createBreakout from '../games/breakout.js'
import createInvaders from '../games/invaders.js'
import createPacman from '../games/pacman.js'
import { CloseIcon } from './Icons.jsx'

// The arcade: a terminal window with a tab per cabinet, one running at a time.
//
// Laid out like a tabbed Linux terminal on purpose — it's a dashboard for
// self-hosted things, so the joke only lands if it looks like a shell. Each tab
// is a canvas game (src/games/); they read their colours from the live theme,
// so the arcade restyles along with everything else.
const CABINETS = [
  { id: 'snake', name: 'snake', create: createSnake },
  { id: 'arkanoid', name: 'arkanoid', create: createBreakout },
  { id: 'invaders', name: 'invaders', create: createInvaders },
  { id: 'pacman', name: 'pacman', create: createPacman },
]

export default function Arcade({ onClose }) {
  const [active, setActive] = useState(CABINETS[0].id)
  const [hint, setHint] = useState('')
  const canvasRef = useRef(null)
  const cabinetRef = useRef(null)
  // The games sample the theme's CSS variables once when they start, so a theme
  // change has to restart the running one for it to pick up the new palette.
  const theme = useTheme()

  // Take focus off whatever was clicked — the button that opened the arcade, or
  // the tab you just switched to. The games listen on `window`, so they'd get
  // the keys either way, but SPACE would also keep re-activating that still-
  // focused button, which is a click the player didn't ask for.
  useEffect(() => {
    cabinetRef.current?.focus()
  }, [active])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cabinet = CABINETS.find((c) => c.id === active)
    const game = cabinet.create()
    setHint(game.hint)
    // run() returns its own teardown: the loop, the key listeners and the
    // resize observer all stop with it, so switching tabs leaves nothing
    // ticking in the background.
    return run(canvas, game)
  }, [active, theme])

  return (
    <div className="modal-backdrop">
      <div
        className="modal arcade-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Arcade"
        ref={cabinetRef}
        tabIndex={-1}
      >
        <div className="term-bar">
          <span className="term-title">cyberdash@arcade:~/games</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close arcade">
            <CloseIcon />
          </button>
        </div>

        <div className="term-tabs" role="tablist">
          {CABINETS.map((c, i) => (
            <button
              key={c.id}
              className={'term-tab' + (c.id === active ? ' is-active' : '')}
              role="tab"
              aria-selected={c.id === active}
              onClick={() => setActive(c.id)}
            >
              <span className="term-tab-n">{i + 1}</span>
              {c.name}
            </button>
          ))}
        </div>

        <div className="term-screen">
          {/* aria-hidden: the running game is pixels, not markup — there is
              nothing here a screen reader can usefully announce. */}
          <canvas ref={canvasRef} className="term-canvas" aria-hidden="true" />
          <div className="term-scanlines" aria-hidden="true" />
        </div>

        <p className="term-hint">
          <span className="term-prompt">$</span> {hint}
          <span className="term-caret" aria-hidden="true">▍</span>
        </p>
      </div>
    </div>
  )
}
