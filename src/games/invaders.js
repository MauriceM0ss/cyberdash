// ALIEN INVADERS — a marching grid that speeds up as you thin it out, four
// shields that erode, and one shot on screen at a time.
import { readBest, writeBest } from './engine.js'
import { sfx } from './sound.js'

const W = 220
const H = 180
const TOP = 14
const ROWS = 5
const COLS = 9
const ALIEN_W = 11
const ALIEN_H = 8
const GAP_X = 5
const GAP_Y = 4
const SHIP_W = 13
const SHIP_H = 6
const SHIP_Y = H - 12
const FLOOR = SHIP_Y - 2

export default function createInvaders() {
  let aliens, shipX, shot, bombs, shields, score, best, lives, wave, over, started
  let marchDir, marchClock, stepDown, bombClock

  function buildWave() {
    aliens = []
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        aliens.push({
          c,
          r,
          alive: true,
          x: 12 + c * (ALIEN_W + GAP_X),
          y: TOP + 8 + r * (ALIEN_H + GAP_Y),
          value: (ROWS - r) * 10,
        })
    marchDir = 1
    marchClock = 0
    stepDown = false
    bombs = []
    shot = null
  }

  function buildShields() {
    // Each shield is a little block grid so hits chew holes in it rather than
    // removing it whole.
    shields = []
    for (let s = 0; s < 4; s++) {
      const ox = 18 + s * 50
      for (let x = 0; x < 7; x++)
        for (let y = 0; y < 3; y++) {
          if (y === 2 && x > 1 && x < 5) continue // archway underneath
          shields.push({ x: ox + x * 3, y: FLOOR - 26 + y * 3, alive: true })
        }
    }
  }

  const living = () => aliens.filter((a) => a.alive)

  function hitBlock(list, x, y, pad = 1.5) {
    for (const b of list) {
      if (!b.alive) continue
      if (Math.abs(b.x + 1.5 - x) < pad + 1.5 && Math.abs(b.y + 1.5 - y) < pad + 1.5) {
        b.alive = false
        return true
      }
    }
    return false
  }

  return {
    w: W,
    h: H,
    hint: '←→ to move · SPACE to fire',

    reset() {
      shipX = W / 2
      score = 0
      best = readBest('invaders')
      lives = 3
      wave = 1
      over = false
      started = false
      bombClock = 0
      buildWave()
      buildShields()
    },

    key(code) {
      if (!started || over) {
        if (code === 'Space' || code === 'Enter') {
          if (over) this.reset()
          started = true
          sfx.start()
        }
        return
      }
      // One shot in the air at a time — the original's whole rhythm.
      if (code === 'Space' && !shot) {
        shot = { x: shipX, y: SHIP_Y - 2 }
        sfx.shoot()
      }
    },

    update(dt, held) {
      if (!started || over) return

      const speed = 90
      if (held.has('ArrowLeft') || held.has('KeyA')) shipX -= speed * dt
      if (held.has('ArrowRight') || held.has('KeyD')) shipX += speed * dt
      shipX = Math.max(SHIP_W / 2, Math.min(W - SHIP_W / 2, shipX))

      // March: the fewer left, the faster they come. Thinning the wave is what
      // raises the pressure, which is the joke of the original.
      const alive = living()
      const cadence = Math.max(0.08, 0.55 * (alive.length / (ROWS * COLS)) - wave * 0.02)
      marchClock += dt
      if (marchClock >= cadence) {
        marchClock -= cadence
        if (stepDown) {
          for (const a of alive) a.y += 5
          marchDir *= -1
          stepDown = false
        } else {
          for (const a of alive) a.x += 4 * marchDir
          const edge = alive.some((a) => a.x < 4 || a.x + ALIEN_W > W - 4)
          if (edge) stepDown = true
        }
        if (alive.some((a) => a.y + ALIEN_H >= FLOOR - 4)) {
          sfx.die()
          over = true
          best = writeBest('invaders', score)
          return
        }
      }

      // Only the lowest alien in each column can drop a bomb.
      bombClock -= dt
      if (bombClock <= 0 && alive.length) {
        bombClock = 0.5 + Math.random() * (1.4 - Math.min(0.9, wave * 0.15))
        const front = new Map()
        for (const a of alive)
          if (!front.has(a.c) || a.y > front.get(a.c).y) front.set(a.c, a)
        const shooters = [...front.values()]
        const from = shooters[Math.floor(Math.random() * shooters.length)]
        bombs.push({ x: from.x + ALIEN_W / 2, y: from.y + ALIEN_H })
      }

      if (shot) {
        shot.y -= 190 * dt
        if (shot.y < TOP) shot = null
      }
      if (shot && hitBlock(shields, shot.x, shot.y)) shot = null
      if (shot) {
        for (const a of alive) {
          if (
            shot.x > a.x &&
            shot.x < a.x + ALIEN_W &&
            shot.y > a.y &&
            shot.y < a.y + ALIEN_H
          ) {
            a.alive = false
            score += a.value
            sfx.kill()
            shot = null
            break
          }
        }
      }

      for (const bomb of bombs) bomb.y += 70 * dt
      bombs = bombs.filter((bomb) => {
        if (bomb.y > H) return false
        if (hitBlock(shields, bomb.x, bomb.y)) return false
        const hitShip =
          bomb.y > SHIP_Y &&
          bomb.y < SHIP_Y + SHIP_H &&
          Math.abs(bomb.x - shipX) < SHIP_W / 2
        if (hitShip) {
          lives -= 1
          if (lives <= 0) {
            sfx.die()
            over = true
            best = writeBest('invaders', score)
          } else {
            sfx.hit()
          }
          return false
        }
        return true
      })

      if (!living().length) {
        wave += 1
        sfx.level()
        buildWave()
        buildShields()
      }
    },

    draw(g) {
      g.clear()
      g.text(`SCORE ${score}`, 1, 7, { size: 8, color: g.p.brand, glow: 8 })
      g.text(`WAVE ${wave}`, W / 2, 7, { size: 8, color: g.p.muted, align: 'center' })
      g.text('▲'.repeat(Math.max(0, lives)), W - 1, 7, {
        size: 8,
        color: g.p.accent,
        align: 'right',
      })
      g.rect(0, TOP, W, 0.4, g.p.line)

      for (const a of aliens) {
        if (!a.alive) continue
        const tint = a.r === 0 ? g.p.hot : a.r < 3 ? g.p.accent : g.p.brand
        // A blocky little crab: body, eyes, two legs.
        g.rect(a.x + 2, a.y + 1, ALIEN_W - 4, ALIEN_H - 4, tint, 6)
        g.rect(a.x, a.y + 3, ALIEN_W, 2, tint, 4)
        g.rect(a.x + 1, a.y + ALIEN_H - 2, 2, 2, tint)
        g.rect(a.x + ALIEN_W - 3, a.y + ALIEN_H - 2, 2, 2, tint)
      }

      for (const b of shields) if (b.alive) g.rect(b.x, b.y, 3, 3, g.p.brand, 3)

      g.rect(shipX - SHIP_W / 2, SHIP_Y + 2, SHIP_W, SHIP_H - 2, g.p.accent, 12)
      g.rect(shipX - 1.5, SHIP_Y - 1, 3, 3, g.p.accent, 12)

      if (shot) g.rect(shot.x - 0.6, shot.y, 1.2, 4, g.p.brand, 10)
      for (const bomb of bombs) g.rect(bomb.x - 0.6, bomb.y, 1.2, 3.5, g.p.hot, 8)

      if (!started) g.banner('ALIEN INVADERS', 'press SPACE to start', g.p.accent)
      else if (over)
        g.banner(`GAME OVER · ${score}`, 'press SPACE to play again', g.p.hot)
    },
  }
}
