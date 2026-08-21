// ARKANOID — paddle, ball, wall of bricks. Clearing the wall builds the next
// one a little faster, so a run ends on reflexes rather than on running out.
import { readBest, writeBest } from './engine.js'
import { sfx } from './sound.js'

const W = 240
const H = 180
const TOP = 14
const PADDLE_W = 36
const PADDLE_H = 4
const PADDLE_Y = H - 12
const BALL_R = 2.4
const COLS = 10
const ROWS = 5
const BRICK_W = W / COLS
const BRICK_H = 7
const BRICK_TOP = TOP + 12

export default function createBreakout() {
  let paddleX, ball, bricks, score, best, lives, level, over, started

  function buildWall() {
    bricks = []
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        bricks.push({ c, r, alive: true, value: (ROWS - r) * 10 })
  }

  function serve() {
    // Always served upward, at a slight angle so it never bounces straight up
    // and down forever between paddle and ceiling.
    const speed = 70 + level * 8
    const angle = (Math.random() * 0.5 - 0.25) - Math.PI / 2
    ball = {
      x: W / 2,
      y: PADDLE_Y - 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    }
  }

  return {
    w: W,
    h: H,
    hint: '←→ or A/D to move · SPACE to launch',

    reset() {
      paddleX = W / 2
      score = 0
      best = readBest('breakout')
      lives = 3
      level = 1
      over = false
      started = false
      buildWall()
      serve()
    },

    key(code) {
      if ((code === 'Space' || code === 'Enter') && (!started || over)) {
        if (over) this.reset()
        started = true
        sfx.start()
      }
    },

    update(dt, held) {
      if (!started || over) return

      const speed = 130
      if (held.has('ArrowLeft') || held.has('KeyA')) paddleX -= speed * dt
      if (held.has('ArrowRight') || held.has('KeyD')) paddleX += speed * dt
      paddleX = Math.max(PADDLE_W / 2, Math.min(W - PADDLE_W / 2, paddleX))

      ball.x += ball.vx * dt
      ball.y += ball.vy * dt

      if (ball.x < BALL_R) {
        ball.x = BALL_R
        ball.vx = Math.abs(ball.vx)
      }
      if (ball.x > W - BALL_R) {
        ball.x = W - BALL_R
        ball.vx = -Math.abs(ball.vx)
      }
      if (ball.y < TOP + BALL_R) {
        ball.y = TOP + BALL_R
        ball.vy = Math.abs(ball.vy)
      }

      // Paddle: where it hits decides the angle, which is the only steering the
      // player gets and the whole reason the game has any depth.
      const onPaddle =
        ball.vy > 0 &&
        ball.y + BALL_R >= PADDLE_Y &&
        ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
        Math.abs(ball.x - paddleX) <= PADDLE_W / 2 + BALL_R
      if (onPaddle) {
        const offset = (ball.x - paddleX) / (PADDLE_W / 2) // -1 … 1
        const angle = -Math.PI / 2 + offset * 1.05
        const speed = Math.hypot(ball.vx, ball.vy)
        ball.vx = Math.cos(angle) * speed
        ball.vy = Math.sin(angle) * speed
        ball.y = PADDLE_Y - BALL_R
        sfx.bounce()
      }

      for (const brick of bricks) {
        if (!brick.alive) continue
        const bx = brick.c * BRICK_W
        const by = BRICK_TOP + brick.r * BRICK_H
        if (
          ball.x + BALL_R < bx ||
          ball.x - BALL_R > bx + BRICK_W ||
          ball.y + BALL_R < by ||
          ball.y - BALL_R > by + BRICK_H
        )
          continue
        brick.alive = false
        score += brick.value
        sfx.brick()
        // Bounce off whichever face was nearer — flipping vy unconditionally
        // makes side clips look wrong.
        const fromSide =
          Math.abs(ball.x - (bx + BRICK_W / 2)) / BRICK_W >
          Math.abs(ball.y - (by + BRICK_H / 2)) / BRICK_H
        if (fromSide) ball.vx = -ball.vx
        else ball.vy = -ball.vy
        break // one brick per frame keeps the bounce readable
      }

      if (bricks.every((b) => !b.alive)) {
        level += 1
        sfx.level()
        buildWall()
        serve()
        return
      }

      if (ball.y > H + 4) {
        lives -= 1
        if (lives <= 0) {
          sfx.die()
          over = true
          best = writeBest('breakout', score)
        } else {
          sfx.hit()
          serve()
        }
      }
    },

    draw(g) {
      g.clear()
      g.text(`SCORE ${score}`, 1, 7, { size: 8, color: g.p.brand, glow: 8 })
      g.text(`L${level}`, W / 2, 7, { size: 8, color: g.p.muted, align: 'center' })
      g.text('▮'.repeat(Math.max(0, lives)), W - 1, 7, {
        size: 8,
        color: g.p.accent,
        align: 'right',
      })
      g.rect(0, TOP, W, 0.4, g.p.line)

      for (const brick of bricks) {
        if (!brick.alive) continue
        // Warmer rows at the top, so the wall has depth and the valuable rows
        // read as the risky ones.
        const tint = brick.r < 2 ? g.p.hot : brick.r < 4 ? g.p.accent : g.p.brand
        g.rect(
          brick.c * BRICK_W + 0.8,
          BRICK_TOP + brick.r * BRICK_H + 0.8,
          BRICK_W - 1.6,
          BRICK_H - 1.6,
          tint,
          6,
        )
      }

      g.rect(paddleX - PADDLE_W / 2, PADDLE_Y, PADDLE_W, PADDLE_H, g.p.accent, 14)
      g.circle(ball.x, ball.y, BALL_R, g.p.brand, 14)

      if (!started) g.banner('ARKANOID', 'press SPACE to launch', g.p.accent)
      else if (over)
        g.banner(`GAME OVER · ${score}`, 'press SPACE to play again', g.p.hot)
    },
  }
}
