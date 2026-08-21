// SNAKE — grid cabinet. Eat, grow, don't bite yourself or the wall.
import { readBest, writeBest } from './engine.js'

const COLS = 26
const ROWS = 18
const CELL = 10
const START_STEP = 0.13 // seconds between moves
const MIN_STEP = 0.055

const DIRS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
}

export default function createSnake() {
  let snake, dir, queued, food, score, best, over, started, step, clock

  function placeFood() {
    // Rejection sampling. The board is never full enough for this to matter,
    // and "pick a free cell" is otherwise a list-building exercise every meal.
    let spot
    do {
      spot = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
      }
    } while (snake.some((s) => s.x === spot.x && s.y === spot.y))
    food = spot
  }

  return {
    w: COLS * CELL,
    h: ROWS * CELL + 14, // strip along the top for the score line
    hint: '←↑↓→ or WASD to steer · SPACE to start',

    reset() {
      snake = [
        { x: 6, y: 9 },
        { x: 5, y: 9 },
        { x: 4, y: 9 },
      ]
      dir = DIRS.ArrowRight
      queued = []
      score = 0
      best = readBest('snake')
      over = false
      started = false
      step = START_STEP
      clock = 0
      placeFood()
    },

    key(code) {
      if (over || !started) {
        if (code === 'Space' || code === 'Enter') {
          if (over) this.reset()
          started = true
        }
        return
      }
      const next = DIRS[code]
      // Queued rather than applied: two turns inside one step would otherwise
      // let you reverse into your own neck via a diagonal that never happened.
      if (next && queued.length < 2) queued.push(next)
    },

    update(dt) {
      if (over || !started) return
      clock += dt
      if (clock < step) return
      clock -= step

      const next = queued.shift()
      if (next && next.x !== -dir.x && next.y !== -dir.y) dir = next

      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
      const hitWall =
        head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS
      // The tail cell is free by the time the head arrives, so it isn't a hit.
      const hitSelf = snake
        .slice(0, -1)
        .some((s) => s.x === head.x && s.y === head.y)

      if (hitWall || hitSelf) {
        over = true
        best = writeBest('snake', score)
        return
      }

      snake.unshift(head)
      if (head.x === food.x && head.y === food.y) {
        score += 10
        step = Math.max(MIN_STEP, step - 0.004)
        placeFood()
      } else {
        snake.pop()
      }
    },

    draw(g) {
      const top = 14
      g.clear()

      // Faint cell grid, so the board reads as a board and not a void.
      for (let x = 0; x <= COLS; x++)
        g.rect(x * CELL, top, 0.4, ROWS * CELL, g.p.line)
      for (let y = 0; y <= ROWS; y++)
        g.rect(0, top + y * CELL, COLS * CELL, 0.4, g.p.line)

      g.text(`SCORE ${score}`, 1, 7, { size: 8, color: g.p.brand, glow: 8 })
      g.text(`BEST ${best}`, COLS * CELL - 1, 7, {
        size: 8,
        color: g.p.muted,
        align: 'right',
      })

      g.circle(
        food.x * CELL + CELL / 2,
        top + food.y * CELL + CELL / 2,
        CELL * 0.3,
        g.p.hot,
        12,
      )

      snake.forEach((s, i) => {
        const head = i === 0
        g.rect(
          s.x * CELL + 1,
          top + s.y * CELL + 1,
          CELL - 2,
          CELL - 2,
          head ? g.p.brand : g.p.accent,
          head ? 14 : 6,
        )
      })

      if (!started) g.banner('SNAKE', 'press SPACE to start', g.p.brand)
      else if (over)
        g.banner(`GAME OVER · ${score}`, 'press SPACE to play again', g.p.hot)
    },
  }
}
