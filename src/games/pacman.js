// PAC-MAN — maze, pellets, four ghosts, and a tunnel that wraps.
//
// The maze is written as mirrored half-rows: each entry below is the left ten
// columns and the right nine are its reflection, so the board can't come out
// lopsided. Its connectivity was checked by flood fill before it shipped —
// every one of the 207 pellets is reachable from the start tile.
import { readBest, writeBest } from './engine.js'

const HALVES = [
  '##########', '#........#', '#o##.###.#', '#.........', '#.##.#.###',
  '#....#...#', '####.###.#', '#........#', '#.##.#.#.#', '....#...##',
  '#.##.#.#.#', '#........#', '####.###.#', '#.........', '#.##.#.###',
  '#o...#...#', '##.#.#.###', '#....#...#', '#.######.#', '#.........',
  '##########',
]
const MAZE = HALVES.map((h) => h + [...h.slice(0, 9)].reverse().join(''))
const COLS = MAZE[0].length
const ROWS = MAZE.length
const TILE = 8
const TOP = 14

const START = { x: 9, y: 13 }
const GHOST_HOME = [
  { x: 8, y: 7 },
  { x: 10, y: 7 },
  { x: 8, y: 11 },
  { x: 10, y: 11 },
]
// Where each ghost retreats to when it's not hunting. Splitting them to
// opposite corners is what stops all four arriving as one blob.
const SCATTER = [
  { x: 1, y: 1 },
  { x: 17, y: 1 },
  { x: 1, y: 19 },
  { x: 17, y: 19 },
]

const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]
const KEY_DIRS = {
  ArrowRight: DIRS[0], KeyD: DIRS[0],
  ArrowLeft: DIRS[1], KeyA: DIRS[1],
  ArrowDown: DIRS[2], KeyS: DIRS[2],
  ArrowUp: DIRS[3], KeyW: DIRS[3],
}

const wrapX = (x) => (x + COLS) % COLS
const isWall = (x, y) =>
  y < 0 || y >= ROWS || MAZE[y][wrapX(x)] === '#'

export default function createPacman() {
  let pellets, pac, ghosts, score, best, lives, level, over, started
  let modeClock, chasing, frightened, mouth

  function resetPellets() {
    pellets = MAZE.map((row) => [...row].map((c) => (c === '.' || c === 'o' ? c : null)))
  }

  const pelletsLeft = () =>
    pellets.reduce((n, row) => n + row.filter(Boolean).length, 0)

  function placeActors() {
    pac = { x: START.x, y: START.y, dir: DIRS[1], want: DIRS[1], speed: 5.6 }
    ghosts = GHOST_HOME.map((home, i) => ({
      x: home.x,
      y: home.y,
      dir: DIRS[i % 2],
      speed: 4.6 + level * 0.2,
      index: i,
    }))
    modeClock = 0
    chasing = false
    frightened = 0
  }

  // An actor may only change direction while sitting on a tile centre —
  // otherwise it would cut corners through walls.
  //
  // The tolerance has to scale with how far the actor moves per frame, not be a
  // fixed number: an actor advances `speed * dt` a frame, so the closest it ever
  // lands to a centre can be half a step away. A fixed epsilon smaller than that
  // gets skipped on a slow frame, and since the wall check happens here, an
  // actor that skips its centre keeps going — through walls and past junctions.
  // Half a step plus a hair catches every centre exactly once at any frame rate.
  const atCentre = (a, dt) => {
    const eps = Math.max(0.02, a.speed * dt * 0.55)
    return Math.abs(a.x - Math.round(a.x)) < eps && Math.abs(a.y - Math.round(a.y)) < eps
  }

  function step(a, dt) {
    a.x = wrapX(a.x + a.dir.x * a.speed * dt)
    a.y += a.dir.y * a.speed * dt
  }

  function canGo(a, dir) {
    return !isWall(Math.round(a.x) + dir.x, Math.round(a.y) + dir.y)
  }

  // Greedy chase: of the ways out of this tile, take the one that ends up
  // nearest the target, never reversing. It isn't the arcade's exact routing
  // but it produces the same pinned-in-a-corner feeling.
  function chooseGhostDir(g) {
    const target = frightened
      ? { x: Math.random() * COLS, y: Math.random() * ROWS }
      : chasing
        ? { x: pac.x, y: pac.y }
        : SCATTER[g.index]
    const back = { x: -g.dir.x, y: -g.dir.y }
    let bestDir = null
    let bestScore = Infinity
    for (const dir of DIRS) {
      if (dir.x === back.x && dir.y === back.y) continue
      if (!canGo(g, dir)) continue
      const nx = wrapX(Math.round(g.x) + dir.x)
      const ny = Math.round(g.y) + dir.y
      const d = (nx - target.x) ** 2 + (ny - target.y) ** 2
      if (d < bestScore) {
        bestScore = d
        bestDir = dir
      }
    }
    // Dead end: reversing is the only move left.
    return bestDir || back
  }

  function loseLife() {
    lives -= 1
    if (lives <= 0) {
      over = true
      best = writeBest('pacman', score)
    } else {
      placeActors()
      started = false
    }
  }

  return {
    w: COLS * TILE,
    h: ROWS * TILE + TOP,
    hint: '←↑↓→ or WASD · eat the big ones to turn the tables',

    reset() {
      score = 0
      best = readBest('pacman')
      lives = 3
      level = 1
      over = false
      started = false
      mouth = 0
      resetPellets()
      placeActors()
    },

    key(code) {
      if (over) {
        if (code === 'Space' || code === 'Enter') this.reset()
        return
      }
      if (!started) {
        if (code === 'Space' || code === 'Enter') started = true
        return
      }
      const dir = KEY_DIRS[code]
      if (dir) pac.want = dir
    },

    update(dt, held) {
      if (over || !started) return

      // Held keys as well as presses, so holding into a wall turns you the
      // moment the corridor opens up.
      for (const [code, dir] of Object.entries(KEY_DIRS))
        if (held.has(code)) pac.want = dir

      mouth += dt * 10

      if (atCentre(pac, dt)) {
        // Snapped exactly, so the drift can't accumulate across tiles.
        pac.x = Math.round(pac.x)
        pac.y = Math.round(pac.y)
        if (canGo(pac, pac.want)) pac.dir = pac.want
        if (!canGo(pac, pac.dir)) pac.dir = { x: 0, y: 0 }
      }
      step(pac, dt)

      const tx = wrapX(Math.round(pac.x))
      const ty = Math.round(pac.y)
      const pellet = pellets[ty]?.[tx]
      if (pellet) {
        pellets[ty][tx] = null
        score += pellet === 'o' ? 50 : 10
        if (pellet === 'o') frightened = 7
      }

      if (!pelletsLeft()) {
        level += 1
        score += 200
        resetPellets()
        placeActors()
        started = false
        return
      }

      // Scatter and chase alternate; a power pellet suspends both.
      if (frightened > 0) {
        frightened -= dt
      } else {
        modeClock += dt
        const phase = chasing ? 18 : 7
        if (modeClock > phase) {
          modeClock = 0
          chasing = !chasing
        }
      }

      for (const g of ghosts) {
        g.speed = frightened > 0 ? 3.1 : 4.6 + level * 0.2
        if (atCentre(g, dt)) {
          g.x = Math.round(g.x)
          g.y = Math.round(g.y)
          g.dir = chooseGhostDir(g)
        }
        step(g, dt)

        const touching = Math.hypot(g.x - pac.x, g.y - pac.y) < 0.7
        if (!touching) continue
        if (frightened > 0) {
          score += 200
          const home = GHOST_HOME[g.index]
          g.x = home.x
          g.y = home.y
        } else {
          loseLife()
          return
        }
      }
    },

    draw(g) {
      g.clear()
      g.text(`SCORE ${score}`, 1, 7, { size: 8, color: g.p.brand, glow: 8 })
      g.text(`L${level}`, (COLS * TILE) / 2, 7, {
        size: 8,
        color: g.p.muted,
        align: 'center',
      })
      g.text('●'.repeat(Math.max(0, lives)), COLS * TILE - 1, 7, {
        size: 8,
        color: g.p.accent,
        align: 'right',
      })

      for (let y = 0; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) {
          const px = x * TILE
          const py = TOP + y * TILE
          if (MAZE[y][x] === '#') {
            // Only the faces that border open space are drawn, so a run of wall
            // tiles reads as one continuous corridor edge instead of a grid of
            // separate boxes. No glow on these: they're most of the objects on
            // screen, and the shadow pass is the expensive part.
            const solid = (dx, dy) => MAZE[y + dy]?.[x + dx] === '#'
            const t = 0.9
            if (!solid(0, -1)) g.rect(px, py, TILE, t, g.p.accent)
            if (!solid(0, 1)) g.rect(px, py + TILE - t, TILE, t, g.p.accent)
            if (!solid(-1, 0)) g.rect(px, py, t, TILE, g.p.accent)
            if (!solid(1, 0)) g.rect(px + TILE - t, py, t, TILE, g.p.accent)
            continue
          }
          const pellet = pellets[y][x]
          if (pellet === '.') g.circle(px + TILE / 2, py + TILE / 2, 0.9, g.p.text)
          else if (pellet === 'o')
            g.circle(px + TILE / 2, py + TILE / 2, 2.4, g.p.hot, 12)
        }

      // Pac: a wedge whose mouth opens along the way it's facing.
      const open = (Math.sin(mouth) * 0.5 + 0.5) * 0.7
      const facing = Math.atan2(pac.dir.y, pac.dir.x)
      g.wedge(
        pac.x * TILE + TILE / 2,
        TOP + pac.y * TILE + TILE / 2,
        TILE * 0.45,
        facing + open,
        facing - open + Math.PI * 2,
        g.p.brand,
        14,
      )

      for (const ghost of ghosts) {
        const cx = ghost.x * TILE + TILE / 2
        const cy = TOP + ghost.y * TILE + TILE / 2
        const colour =
          frightened > 0
            ? frightened < 2 && Math.floor(frightened * 8) % 2
              ? g.p.text
              : g.p.muted
            : [g.p.hot, g.p.accent, g.p.brand, g.p.text][ghost.index]
        g.circle(cx, cy - 0.6, TILE * 0.38, colour, 12)
        g.rect(cx - TILE * 0.38, cy - 0.6, TILE * 0.76, TILE * 0.36, colour, 12)
        g.circle(cx - 1.2, cy - 1.2, 0.7, g.p.bg)
        g.circle(cx + 1.2, cy - 1.2, 0.7, g.p.bg)
      }

      if (over) g.banner(`GAME OVER · ${score}`, 'press SPACE to play again', g.p.hot)
      else if (!started)
        g.banner(level > 1 ? `LEVEL ${level}` : 'PAC-MAN', 'press SPACE to start', g.p.brand)
    },
  }
}
