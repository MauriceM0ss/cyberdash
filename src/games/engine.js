// ─────────────────────────────────────────────────────────────────────────
//  Arcade runtime — the bit every cabinet shares.
//
//  A game is a plain object, not a component: it declares the size of the
//  playfield it wants to draw in and gets told to update and draw. Keeping the
//  games out of React means no re-render per frame and no hook rules to work
//  around inside a game loop.
//
//    { w, h, hint, reset(), key(code), update(dt, held), draw(screen) }
//
//  `w`/`h` are the game's own units — a Snake board is 24x18 because that is
//  how many cells it has. `run` scales that to whatever the canvas is and
//  letterboxes the remainder, so no game does arithmetic about pixels.
//
//  Colours come from the live theme (src/index.css) rather than being baked in,
//  so the cabinets restyle with everything else when the theme changes.
// ─────────────────────────────────────────────────────────────────────────

export function readPalette(el) {
  const css = getComputedStyle(el)
  const get = (name, fallback) =>
    css.getPropertyValue(`--${name}`).trim() || fallback
  return {
    bg: get('bg', '#07090b'),
    panel: get('surface-3', '#161b20'),
    line: get('border', 'rgba(120, 140, 150, 0.24)'),
    text: get('text', '#d6f7ef'),
    muted: get('muted', '#7d8a93'),
    brand: get('brand', '#39ff14'),
    accent: get('accent', '#19f0ff'),
    hot: get('accent-2', '#ff2e97'),
  }
}

const MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace"

// Drawing surface in game units. Every method takes game coordinates; the
// transform set up by `run` turns those into device pixels.
class Screen {
  constructor(ctx, palette, w, h) {
    this.ctx = ctx
    this.p = palette
    this.w = w
    this.h = h
  }

  clear(color = this.p.bg) {
    this.ctx.fillStyle = color
    this.ctx.fillRect(0, 0, this.w, this.h)
  }

  // `glow` is the neon: a coloured shadow under the shape itself. Cheap enough
  // at these object counts, and it's the whole look.
  rect(x, y, w, h, color, glow = 0) {
    const { ctx } = this
    ctx.save()
    ctx.fillStyle = color
    if (glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = glow
    }
    ctx.fillRect(x, y, w, h)
    ctx.restore()
  }

  circle(cx, cy, r, color, glow = 0) {
    const { ctx } = this
    ctx.save()
    ctx.fillStyle = color
    if (glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = glow
    }
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // A wedge, for Pac-Man and anything else that needs a mouth.
  wedge(cx, cy, r, from, to, color, glow = 0) {
    const { ctx } = this
    ctx.save()
    ctx.fillStyle = color
    if (glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = glow
    }
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, from, to)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  text(str, x, y, { size = 1, color = this.p.text, align = 'left', glow = 0 } = {}) {
    const { ctx } = this
    ctx.save()
    ctx.font = `${size}px ${MONO}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'middle'
    if (glow) {
      ctx.shadowColor = color
      ctx.shadowBlur = glow
    }
    ctx.fillText(str, x, y)
    ctx.restore()
  }

  // The overlay every cabinet shows when it's waiting for you: a dimmed board
  // with a headline and a "press a key" line under it.
  banner(title, subtitle, color = this.p.brand) {
    this.rect(0, 0, this.w, this.h, 'rgba(0, 0, 0, 0.72)')
    const mid = this.h / 2
    this.text(title, this.w / 2, mid - this.h * 0.04, {
      size: this.h * 0.085,
      color,
      align: 'center',
      glow: 18,
    })
    this.text(subtitle, this.w / 2, mid + this.h * 0.06, {
      size: this.h * 0.042,
      color: this.p.muted,
      align: 'center',
    })
  }
}

// Best score per cabinet. Trivial, but it's what makes a second go feel like it
// counts — and it rides along in the same localStorage the shell already uses.
const bestKey = (id) => `cyberdash.arcade.${id}`

export function readBest(id) {
  try {
    return Number(localStorage.getItem(bestKey(id))) || 0
  } catch {
    return 0
  }
}

export function writeBest(id, score) {
  if (score <= readBest(id)) return readBest(id)
  try {
    localStorage.setItem(bestKey(id), String(score))
  } catch {
    /* private mode, quota — a lost high score is not worth a crash */
  }
  return score
}

// Keys the games use that the browser would otherwise act on (scrolling, mostly).
const SWALLOW = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
])

/**
 * Start `game` on `canvas`. Returns a stop function that tears down every
 * listener, the observer and the frame loop — the tab strip calls it whenever
 * you switch cabinets, so only the one you're looking at is ever running.
 */
export function run(canvas, game) {
  const ctx = canvas.getContext('2d')
  const palette = readPalette(canvas)
  const screen = new Screen(ctx, palette, game.w, game.h)
  const held = new Set()
  let frame = 0
  let last = performance.now()

  // Fit the game's box into the canvas element, centred, at device resolution.
  function resize() {
    const dpr = window.devicePixelRatio || 1
    const box = canvas.getBoundingClientRect()
    if (!box.width || !box.height) return
    canvas.width = Math.round(box.width * dpr)
    canvas.height = Math.round(box.height * dpr)
    const scale = Math.min(box.width / game.w, box.height / game.h)
    const ox = (box.width - game.w * scale) / 2
    const oy = (box.height - game.h * scale) / 2
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr)
    ctx.imageSmoothingEnabled = false
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (SWALLOW.has(e.code)) e.preventDefault()
    if (!e.repeat) game.key?.(e.code)
    held.add(e.code)
  }
  const onKeyUp = (e) => held.delete(e.code)
  // Keys held when the window loses focus would otherwise stay held forever.
  const onBlur = () => held.clear()

  function tick(now) {
    // Clamped: a backgrounded tab hands back a huge delta, and every game would
    // integrate straight through a wall with it.
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    game.update(dt, held)
    game.draw(screen)
    frame = requestAnimationFrame(tick)
  }

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  resize()
  game.reset()
  frame = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}
