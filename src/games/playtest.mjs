// Playtest — run with `node src/games/playtest.mjs`.
//
// Plays every cabinet headlessly: the real game modules, a stub screen, and a
// driver per game. The games keep their state private, so the driver reads the
// board back out of the draw calls — the same information a player gets — and
// plays from that. Exits non-zero if any cabinet stops behaving.
//
// Worth running after touching anything under src/games/. It has already earned
// its keep twice: it caught a Pac-Man maze with pellets walled off from the
// rest of the board, and a tile-centring test that only held at 60fps.
import createSnake from './snake.js'
import createBreakout from './breakout.js'
import createInvaders from './invaders.js'
import createPacman from './pacman.js'

// The games place things at random. Pin the generator so a run either always
// passes or always fails — a flaky playtest is worse than none.
let seed = 1337
Math.random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

const P = { bg:'bg', panel:'panel', line:'line', text:'text',
            muted:'muted', brand:'brand', accent:'accent', hot:'hot' }
const DT = 1 / 60

// Records everything a frame drew, so the driver can see the board.
function watcher() {
  const f = { texts: [], banners: [], circles: [], rects: [], wedges: [] }
  return {
    p: P, w: 0, h: 0, frame: f,
    clear() {}, 
    rect(x, y, w, h, color) { f.rects.push({ x, y, w, h, color }) },
    circle(x, y, r, color) { f.circles.push({ x, y, r, color }) },
    wedge(x, y, r, a, b, color) { f.wedges.push({ x, y, color }) },
    text(str) { f.texts.push(String(str)) },
    banner(title) { f.banners.push(String(title)) },
    reset() { for (const k of Object.keys(f)) f[k] = [] },
  }
}
const scoreOf = (w) => {
  const hit = [...w.frame.texts].reverse().find((t) => t.startsWith('SCORE'))
  return hit ? Number(hit.split(' ')[1]) : 0
}
const results = []
const check = (name, pass, detail) => results.push({ name, pass, detail })

/**
 * Run a game, feeding it whatever `drive` decides from the last frame drawn.
 * Presses SPACE whenever it's waiting, and stops the moment GAME OVER shows.
 */
function session(game, steps, drive = () => null) {
  const w = watcher()
  game.reset()
  let peakScore = 0
  let ended = false
  let deaths = 0
  let peakSegments = 0
  let firstSegments = null
  for (let i = 0; i < steps; i++) {
    w.reset()
    game.draw(w)
    peakScore = Math.max(peakScore, scoreOf(w))
    const segments = w.frame.rects.filter((r) => r.color === P.accent && r.w > 3).length
    if (firstSegments === null && segments) firstSegments = segments
    peakSegments = Math.max(peakSegments, segments)
    const banner = w.frame.banners[0]
    if (banner?.startsWith('GAME OVER')) { ended = true; break }
    if (banner) { if (i) deaths++; game.key('Space'); continue }
    const key = drive(w.frame, i)
    if (key) game.key(key)
    game.update(DT, new Set())
  }
  return { peakScore, ended, deaths, firstSegments, peakSegments }
}

// ── snake: steer at the food ────────────────────────────────────────────────
{
  // Steer at the food, but never command a reversal: the game refuses those
  // (rightly — it would be an instant self-bite), and a driver that keeps
  // issuing them just walks into the far wall.
  const OPPOSITE = { ArrowUp: 'ArrowDown', ArrowDown: 'ArrowUp',
                     ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' }
  // Board geometry, so the driver can also avoid steering into a wall — a
  // greedy player that ignores the edges dies before it has eaten anything.
  const COLS = 26, ROWS = 18, CELL = 10, TOP = 14
  const STEP = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
  let heading = 'ArrowRight'
  const r = session(createSnake(), 60 * 400, (frame) => {
    const food = frame.circles.find((c) => c.color === P.hot)
    const head = frame.rects.find((c) => c.color === P.brand && c.w > 3)
    if (!food || !head) return null
    const hx = Math.round((head.x - 1) / CELL)
    const hy = Math.round((head.y - TOP - 1) / CELL)
    const fx = Math.round((food.x - CELL / 2) / CELL)
    const fy = Math.round((food.y - TOP - CELL / 2) / CELL)

    const inBounds = (k) => {
      const [dx, dy] = STEP[k]
      const nx = hx + dx, ny = hy + dy
      return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS
    }
    const wants = []
    if (fy !== hy) wants.push(fy < hy ? 'ArrowUp' : 'ArrowDown')
    if (fx !== hx) wants.push(fx < hx ? 'ArrowLeft' : 'ArrowRight')
    // Any legal move beats sailing into the edge, so fall back to the sides.
    wants.push('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight')
    const move = wants.find((k) => k !== OPPOSITE[heading] && inBounds(k))
    if (move) heading = move
    return move || null
  })
  check('snake scores by eating', r.peakScore > 0, `score ${r.peakScore}`)
  check(
    'snake grows when it eats',
    r.peakSegments > r.firstSegments,
    `segments ${r.firstSegments} → ${r.peakSegments}, score ${r.peakScore}`,
  )
}
{
  // Straight into the right-hand wall.
  const r = session(createSnake(), 60 * 8)
  check('snake dies against a wall', r.ended, r)
}

// ── arkanoid ────────────────────────────────────────────────────────────────
{
  // Track the ball with the paddle, so it actually clears bricks.
  const r = session(createBreakout(), 60 * 120, (frame) => {
    const ball = frame.circles.find((c) => c.color === P.brand)
    const paddle = frame.rects.find((c) => c.color === P.accent && c.w > 20)
    if (!ball || !paddle) return null
    const centre = paddle.x + paddle.w / 2
    if (ball.x < centre - 2) return 'ArrowLeft'
    if (ball.x > centre + 2) return 'ArrowRight'
    return null
  })
  check('arkanoid breaks bricks', r.peakScore > 0, `score ${r.peakScore}`)
}
{
  const r = session(createBreakout(), 60 * 120)   // never move: must lose
  check('arkanoid ends when lives run out', r.ended, r)
}

// ── invaders ────────────────────────────────────────────────────────────────
{
  const r = session(createInvaders(), 60 * 60, (frame, i) =>
    i % 20 === 0 ? 'Space' : null)
  check('invaders scores on hits', r.peakScore > 0, `score ${r.peakScore}`)
}
{
  const r = session(createInvaders(), 60 * 400)
  check('invaders eventually ends', r.ended, r)
}

// ── pacman ──────────────────────────────────────────────────────────────────
{
  const dirs = ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']
  const r = session(createPacman(), 60 * 120, (frame, i) =>
    i % 18 === 0 ? dirs[(i / 18) % 4] : null)
  check('pacman eats pellets', r.peakScore > 0, `score ${r.peakScore}`)
  check('pacman ghosts catch a careless player', r.ended, r)
}
{
  // Standing still with four ghosts hunting has exactly one outcome.
  const r = session(createPacman(), 60 * 300)
  check('pacman ends when standing still', r.ended, r)
}

let failed = 0
for (const r of results) {
  if (!r.pass) failed++
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  → ' + JSON.stringify(r.detail)}`)
}
console.log(failed ? `\n${failed} FAILED` : '\nall cabinets play')
process.exit(failed ? 1 : 0)
