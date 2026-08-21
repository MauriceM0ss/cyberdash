// ─────────────────────────────────────────────────────────────────────────
//  SERVER CLOSET — one room, in the shape of a Sierra AGI game.
//
//  AGI (Space Quest 1, King's Quest 2, Larry 1) is a much smaller machine than
//  it looks, and this is that machine with a single room loaded into it:
//
//   · A room is drawn, not painted. Sierra stored a picture as a list of
//     drawing commands and replayed it twice — once for the screen you see,
//     once onto a hidden priority screen that decided what passed in front of
//     what. Here the room is drawing code, and priority is a baseline per
//     object, sorted against the ego's feet before anything is drawn.
//   · A hidden control screen decided where you could walk. Here it's a
//     tapering band of floor minus a list of footprints, sampled under the
//     ego's feet — never its middle, which is the classic way to end up
//     standing in a wall from the knees up.
//   · The parser is two words. Every synonym collapses to one id, so
//     "pick up the damn keycard" and "take card" reach the same branch.
//   · The state is a handful of flags and a score. That was the whole save
//     file, and it is the whole save file here.
//
//  Replies arrive in a pop-up window that holds the game until you press a key,
//  because that is what AGI did and it is most of what the pacing is made of.
// ─────────────────────────────────────────────────────────────────────────
import { readBest, writeBest } from './engine.js'
import { sfx } from './sound.js'

const W = 320
const H = 200
const STATUS_H = 10
const PIC_TOP = STATUS_H
const PIC_BOT = 172
const FLOOR_Y = 126 // where the back wall meets the floor
const WALK_TOP = 136 // the ego's feet never go above this…
const WALK_BOT = 166 // …or below this
const RACK_TOP = 70
const MAX_SCORE = 25

const DOORWAY = { x: 222, w: 50, top: 62 }
const DRUM = { x: 58, w: 38, base: 155, h: 26 }

// Footprints the ego can't stand in. The UPS and the racks sit against the back
// wall, above WALK_TOP, so the floor already keeps the ego out of them — only
// the cable drum is out in the room.
const OBSTACLES = [{ x: DRUM.x, y: 146, w: DRUM.w, h: 10 }]

// Where the ego stands to touch a thing. Examining is free; anything that
// involves hands walks there first, which is most of what makes it read as
// Sierra rather than as a menu.
const WALK_TO = {
  RACK: [40, 141],
  LED: [40, 141],
  UPS: [143, 140],
  BREAKER: [143, 140],
  MUG: [143, 140],
  CARD: [143, 140],
  WIRES: [112, 141],
  LOG: [187, 140],
  FIRE: [206, 140],
  DOOR: [247, 139],
  READER: [278, 141],
  CRATE: [77, 161],
}
const HANDS_ON = new Set(['TAKE', 'OPEN', 'CLOSE', 'USE', 'PUSH', 'TOUCH', 'READ', 'DRINK', 'GO', 'HIT'])

// ── Vocabulary ───────────────────────────────────────────────────────────
// Word to id. AGI kept exactly this table and nothing cleverer; the whole
// parser is "collapse the synonyms, then ask what the player said".
const VERBS = {
  look: 'LOOK', l: 'LOOK', examine: 'LOOK', x: 'LOOK', inspect: 'LOOK',
  check: 'LOOK', see: 'LOOK', view: 'LOOK', search: 'LOOK', find: 'LOOK',
  read: 'READ',
  take: 'TAKE', get: 'TAKE', grab: 'TAKE', pick: 'TAKE', steal: 'TAKE', fish: 'TAKE',
  open: 'OPEN', unlock: 'OPEN',
  close: 'CLOSE', shut: 'CLOSE',
  use: 'USE', swipe: 'USE', wave: 'USE', insert: 'USE', badge: 'USE',
  push: 'PUSH', press: 'PUSH', flip: 'PUSH', toggle: 'PUSH', throw: 'PUSH',
  turn: 'PUSH', pull: 'PUSH',
  touch: 'TOUCH', feel: 'TOUCH', poke: 'TOUCH',
  talk: 'TALK', speak: 'TALK', ask: 'TALK', say: 'TALK', hello: 'TALK', hi: 'TALK',
  drink: 'DRINK', sip: 'DRINK', taste: 'DRINK', swallow: 'DRINK',
  smell: 'SMELL', sniff: 'SMELL',
  listen: 'LISTEN', hear: 'LISTEN',
  drop: 'DROP', put: 'DROP',
  go: 'GO', walk: 'GO', move: 'GO', enter: 'GO', leave: 'GO', exit: 'GO', escape: 'GO',
  hit: 'HIT', kick: 'HIT', punch: 'HIT', smash: 'HIT', break: 'HIT',
  wait: 'WAIT', sleep: 'WAIT',
  inventory: 'INV', inv: 'INV', i: 'INV', carrying: 'INV',
  help: 'HELP', commands: 'HELP', verbs: 'HELP',
  xyzzy: 'XYZZY',
}

const NOUNS = {
  rack: 'RACK', racks: 'RACK', server: 'RACK', servers: 'RACK',
  blade: 'RACK', blades: 'RACK', machine: 'RACK', machines: 'RACK',
  ups: 'UPS', battery: 'UPS',
  breaker: 'BREAKER', breakers: 'BREAKER', switch: 'BREAKER', switches: 'BREAKER',
  fuse: 'BREAKER', panel: 'BREAKER',
  mug: 'MUG', cup: 'MUG', coffee: 'MUG', tea: 'MUG',
  card: 'CARD', keycard: 'CARD', badge: 'CARD', key: 'CARD', pass: 'CARD',
  clipboard: 'LOG', log: 'LOG', logbook: 'LOG', sheet: 'LOG', paper: 'LOG',
  notes: 'LOG', checklist: 'LOG',
  door: 'DOOR', doorway: 'DOOR', exit: 'DOOR', out: 'DOOR',
  reader: 'READER', scanner: 'READER',
  wire: 'WIRES', wires: 'WIRES', cable: 'WIRES', cables: 'WIRES',
  bundle: 'WIRES', copper: 'WIRES', conductor: 'WIRES', tray: 'WIRES',
  crate: 'CRATE', drum: 'CRATE', spool: 'CRATE', reel: 'CRATE', box: 'CRATE',
  led: 'LED', leds: 'LED', light: 'LED', lights: 'LED',
  extinguisher: 'FIRE', fire: 'FIRE',
  floor: 'FLOOR', ground: 'FLOOR', tiles: 'FLOOR', tile: 'FLOOR',
  ceiling: 'CEILING', roof: 'CEILING',
  wall: 'WALL', walls: 'WALL',
  room: 'ROOM', closet: 'ROOM', around: 'ROOM', here: 'ROOM',
  me: 'SELF', myself: 'SELF', self: 'SELF', hoodie: 'SELF',
}

// Words the parser drops on the floor before it starts. AGI called these
// "ignore" words and had about this many.
const NOISE = new Set([
  'the', 'a', 'an', 'at', 'to', 'on', 'in', 'into', 'onto', 'with', 'up',
  'down', 'of', 'my', 'your', 'that', 'this', 'it', 'is', 'please', 'and',
  'some', 'damn', 'bloody', 'over', 'through', 'from', 'for',
])

const ASK_FOR_NOUN = {
  TAKE: 'Take what?', READ: 'Read what?', OPEN: 'Open what?', CLOSE: 'Close what?',
  USE: 'Use what, on what?', PUSH: 'Push what?', TOUCH: 'Touch what?',
  DRINK: 'Drink what?', TALK: 'Talk to what?', GO: 'Go where?', HIT: 'Hit what?',
  DROP: 'Drop what?',
}

const BRUSH_OFF = [
  "That's not something you can do here.",
  'You can do that, but not to any effect worth printing.',
  'Nice try.',
  'Nothing about that works.',
]

const HELP_TEXT = [
  'Two words is plenty, and the second one is optional.',
  '',
  'VERBS   look  read  take  open  use  push  touch',
  '        talk  drink  go  hit  inventory',
  'THINGS  rack  ups  breaker  mug  card  clipboard',
  '        door  reader  wires  drum  floor  me',
  '',
  'Arrows walk. F3 repeats your last command.',
]

const wrap = (text, cols) => {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > cols) {
      lines.push(line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) lines.push(line)
  return lines
}

export default function createQuest() {
  // mode: what is on screen. 'play' is the only one that ticks.
  let mode, score, best, scored, flags, input, lastCommand, popup
  let ego, goal, goalTimer, clock, phase, moving, brushOff

  // ── State ──────────────────────────────────────────────────────────────
  function award(id, points) {
    if (scored.has(id)) return
    scored.add(id)
    score += points
    sfx.eat()
  }

  function say(text, after = null) {
    popup = { lines: Array.isArray(text) ? text : wrap(text, 46), after }
  }

  const near = (spot) =>
    Math.abs(ego.x - spot[0]) < 26 && Math.abs(ego.y - spot[1]) < 16

  // ── Parser ─────────────────────────────────────────────────────────────
  function parse(line) {
    const words = line
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !NOISE.has(w))
    let verb = null
    let noun = null
    let unknown = null
    for (const w of words) {
      if (!verb && VERBS[w]) verb = VERBS[w]
      else if (!noun && NOUNS[w]) noun = NOUNS[w]
      else if (!VERBS[w] && !NOUNS[w] && !unknown) unknown = w
    }
    return { verb, noun, unknown }
  }

  function submit() {
    const line = input.trim()
    input = ''
    if (!line) return
    lastCommand = line
    const { verb, noun, unknown } = parse(line)

    // A word we don't have is only worth complaining about when it's the reason
    // we're stuck — if the verb and the noun both landed, whatever else the
    // player typed was decoration.
    if (unknown && !(verb && noun)) return say(`You don't know the word "${unknown}".`)
    if (!verb) return say("That sentence doesn't have a verb in it that this room recognises.")
    if (!noun && ASK_FOR_NOUN[verb]) return say(ASK_FOR_NOUN[verb])

    // Hands-on verbs walk the ego over first, and the reply waits until it
    // arrives. Looking is free, from anywhere, as it was in AGI.
    const spot = WALK_TO[noun]
    if (spot && HANDS_ON.has(verb) && !near(spot)) {
      goal = { x: spot[0], y: spot[1], then: () => act(verb, noun) }
      goalTimer = 5
      return
    }
    act(verb, noun)
  }

  // ── Room logic ─────────────────────────────────────────────────────────
  // The one big switch. AGI kept a script per room that looked very like this,
  // and there is no structure that beats it below about a hundred branches.
  function act(verb, noun) {
    switch (verb) {
      case 'HELP':
        return say(HELP_TEXT)
      case 'INV':
        return say(
          flags.card
            ? 'You are carrying: one keycard, slightly damp.'
            : 'You are carrying nothing but the hoodie you stand in.',
        )
      case 'XYZZY':
        return say("Nothing happens. This isn't that kind of cave.")
      case 'WAIT':
        return say('Time passes. The fans do not.')
      case 'SMELL':
        return say('Hot dust and old coffee, in that order.')
      case 'LISTEN':
        return say(
          'Fans, the UPS, and your own tinnitus, which the fans are responsible for.',
        )
      case 'HIT':
        return say(
          noun === 'UPS'
            ? 'Percussive maintenance has its place. Its place is not a box holding eleven minutes of mains voltage.'
            : 'You hit it. It goes on doing exactly what it was doing.',
        )
      case 'TALK':
        return say(
          noun === 'SELF'
            ? 'You have been doing that since about eleven.'
            : 'You talk to it. It hums back, which is more than most colleagues manage.',
        )
      case 'DROP':
        return say(
          flags.card && noun === 'CARD'
            ? "You'd only have to fish it out of something again."
            : "You aren't carrying that.",
        )
      case 'READ':
        return noun === 'LOG' || noun === 'RACK' || noun === 'BREAKER'
          ? act('LOOK', noun)
          : say('There is nothing written on it.')
      case 'LOOK':
        return look(noun)
      case 'TAKE':
        return take(noun)
      case 'PUSH':
        return push(noun)
      case 'TOUCH':
        return touch(noun)
      case 'DRINK':
        return drink(noun)
      case 'OPEN':
      case 'USE':
      case 'GO':
        return open(verb, noun)
      case 'CLOSE':
        return say('It closes itself. That is the entire problem with it.')
      default:
        return say(BRUSH_OFF[brushOff++ % BRUSH_OFF.length])
    }
  }

  function look(noun) {
    switch (noun) {
      case null:
      case 'ROOM':
        return say(
          'A server closet. The lease calls it Suite C. Two racks hum along ' +
            'the back wall, a UPS squats beside them, and a clipboard hangs ' +
            'where a window would be if anyone here had earned one. The only ' +
            'door has a badge reader next to it.',
        )
      case 'RACK':
        return say(
          'Blade servers, stacked like a filing cabinet nobody dares open. A ' +
            'sticker on the front reads DO NOT POWER CYCLE — ASK DAVE. Under ' +
            'it, in biro: Dave left in 2019.',
        )
      case 'LED':
        return say(
          'Green, mostly. One is amber, and has been amber long enough that ' +
            'everyone has quietly agreed to call it green.',
        )
      case 'UPS':
        return say(
          'A UPS the size of a suitcase, humming one note that will stay with ' +
            'you for the rest of your life. Its breaker panel carries three ' +
            'switches: 1 MAINS, 2 RACKS, 3 DOOR.',
        )
      case 'BREAKER':
        return say(
          flags.breaker
            ? 'Three switches, all three up. Number three feeds the door.'
            : 'Three switches. Two are up. Number three, labelled DOOR, is down.',
        )
      case 'MUG': {
        if (!flags.found) {
          award('mug', 5)
          flags.found = true
          return say(
            'A mug of coffee that went cold in another season. There is ' +
              'something rectangular at the bottom of it.',
          )
        }
        return say(
          flags.card
            ? 'An empty mug, and a ring of something that used to be coffee.'
            : 'The keycard is still in there, soaking.',
        )
      }
      case 'CARD':
        if (flags.card) return say('A contractor keycard. It smells of March.')
        if (flags.found) return say('It is in the mug, under a centimetre of coffee.')
        return say("You don't see that here.")
      case 'LOG':
        award('log', 3)
        flags.log = true
        return say([
          'MAINTENANCE LOG',
          '',
          '11 MAR  Badge reader dead again, clicking all',
          '        night. Killed its breaker (no. 3) so',
          '        it would shut up.',
          '12 MAR  Spare card is in the mug.',
          '        Do not lose the mug.',
        ])
      case 'DOOR':
        return say(
          flags.open
            ? 'Open, and the corridor beyond it is unreasonably bright.'
            : 'Steel, self-closing, no handle on this side. The reader is the handle.',
        )
      case 'READER':
        return say(
          flags.breaker
            ? 'A badge reader, lit and waiting, with a small green eye.'
            : 'A badge reader with no light in it whatsoever.',
        )
      case 'WIRES':
        return say(
          'A bundle drops out of the ceiling tray into the second rack. One ' +
            'of them has been stripped back and taped, and the tape has given ' +
            'up. That is bare copper, in a room you are standing in.',
        )
      case 'CRATE':
        return say(
          'A drum of Cat6, half unwound, and a box of five hundred zip ties. ' +
            'DO NOT USE — DAVE is written on the side.',
        )
      case 'FLOOR':
        return say(
          'Raised tiles, over a void full of cabling nobody has mapped since ' +
            'the move.',
        )
      case 'FIRE':
        return say(
          'A CO2 extinguisher, inspected annually by a sticker. The last date ' +
            'on it is in a font that has been out of fashion for some time.',
        )
      case 'CEILING':
        return say('A cable tray, a smoke detector, and one dead fluorescent tube.')
      case 'WALL':
        return say(
          'Painted breeze block, painted so many times that the block is now a ' +
            'rumour.',
        )
      case 'SELF':
        return say(
          'A systems administrator in a hoodie, shut in a room with the ' +
            'machines they administer. You have had worse Tuesdays.',
        )
      default:
        return say('You look. It looks back, in the sense that it does nothing.')
    }
  }

  function take(noun) {
    if (noun === 'CARD') {
      if (!flags.found) return say("You don't see that here.")
      if (flags.card) return say('You already have it.')
      flags.card = true
      award('card', 5)
      return say(
        'You fish the keycard out of the coffee and wipe it on your hoodie. ' +
          "It is the hoodie's problem now.",
      )
    }
    if (noun === 'WIRES') return electrocute()
    if (noun === 'MUG')
      return say('You would only put it down somewhere worse.')
    if (noun === 'FIRE')
      return say('Off its bracket it becomes your responsibility. Leave it there.')
    return say('That is not loose, and it is not yours.')
  }

  function push(noun) {
    if (noun !== 'BREAKER')
      return say('You push it. It has the good manners not to react.')
    if (!flags.breaker) {
      flags.breaker = true
      award('breaker', 5)
      sfx.power()
      return say(
        'You flip breaker 3. Off to your right the badge reader clears its ' +
          'throat and lights up.',
      )
    }
    flags.breaker = false
    sfx.blip()
    return say(
      'You flip it back down, undoing the only productive thing you have done ' +
        'today.',
    )
  }

  function touch(noun) {
    if (noun === 'WIRES') return electrocute()
    if (noun === 'RACK') return say('Warm. Warmer than the datasheet would like.')
    if (noun === 'UPS') return say('It vibrates, at the frequency of a headache.')
    return say('It feels the way it looks.')
  }

  function drink(noun) {
    if (noun !== 'MUG') return say('There is nothing drinkable about that.')
    if (!flags.found) {
      flags.found = true
      award('mug', 5)
      return say(
        'You drink. Something clatters against your teeth: a keycard, which ' +
          'has been in there since March.',
      )
    }
    return say('You have had quite enough of that mug for one lifetime.')
  }

  function open(verb, noun) {
    if (noun === 'MUG' || noun === 'CRATE') return say('It is already as open as it gets.')
    if (noun === 'RACK') return say('The rack door is locked, and the key is Dave.')
    if (noun !== 'DOOR' && noun !== 'READER' && noun !== 'CARD')
      return say('That does not open.')

    if (flags.open) return exitRoom()
    if (!flags.card)
      return say(
        noun === 'CARD'
          ? "You haven't got a card. That is rather the shape of the problem."
          : 'It is locked, and it opens for cards, not for people.',
      )
    if (!flags.breaker)
      return say('You wave the card at the reader. The reader is dark, and unimpressed.')

    flags.open = true
    sfx.start()
    return say(
      'The reader blinks green, thinks it over, and the bolt lets go with a ' +
        'clack. The door swings in.',
      'exit',
    )
  }

  function electrocute() {
    sfx.die()
    return say(
      'You take hold of the bare conductor. The UPS, which has waited its ' +
        'entire service life for this moment, delivers eleven minutes of ' +
        'runtime in roughly four milliseconds.',
      'dead',
    )
  }

  function exitRoom() {
    // Walk out rather than cut out. The score only lands once the ego is
    // through the doorway, which is the last thing the walk code has to prove.
    goal = {
      x: DOORWAY.x + DOORWAY.w / 2,
      y: WALK_TOP,
      then: () => {
        award('escape', 7)
        best = writeBest('quest', score)
        sfx.level()
        mode = 'won'
      },
    }
    goalTimer = 6
  }

  // ── Walking ────────────────────────────────────────────────────────────
  const scaleAt = (y) => 0.78 + ((y - WALK_TOP) / (WALK_BOT - WALK_TOP)) * 0.36

  function walkable(x, y) {
    if (y < WALK_TOP || y > WALK_BOT) return false
    // The floor tapers with the perspective, so the walkable strip does too.
    const margin = 16 - 12 * ((y - WALK_TOP) / (WALK_BOT - WALK_TOP))
    if (x < margin || x > W - margin) return false
    return !OBSTACLES.some((o) => x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h)
  }

  // Vertical is slower than horizontal on purpose: the floor is in perspective,
  // so a step "into" the room covers more ground than a step across it, and
  // matching the speeds makes the ego look like it's skating backwards.
  function step(dx, dy, dt) {
    const len = Math.hypot(dx, dy) || 1
    const nx = ego.x + (dx / len) * 62 * dt
    const ny = ego.y + (dy / len) * 34 * dt
    // Slide along whatever we hit rather than sticking to it.
    if (walkable(nx, ny)) {
      ego.x = nx
      ego.y = ny
    } else if (walkable(nx, ego.y)) {
      ego.x = nx
    } else if (walkable(ego.x, ny)) {
      ego.y = ny
    } else {
      return false
    }
    if (Math.abs(dx) > Math.abs(dy)) ego.face = dx > 0 ? 'right' : 'left'
    else ego.face = dy > 0 ? 'down' : 'up'
    moving = true
    phase += dt * 11
    return true
  }

  function reset() {
    mode = 'title'
    score = 0
    best = readBest('quest')
    scored = new Set()
    flags = { log: false, found: false, card: false, breaker: false, open: false }
    input = ''
    lastCommand = ''
    popup = null
    goal = null
    goalTimer = 0
    clock = 0
    phase = 0
    moving = false
    brushOff = 0
    ego = { x: 176, y: 158, face: 'down' }
  }

  // Anything covering the room eats the keypress that dismisses it, whether
  // that press arrived as a character or as a key code.
  function overlay(k) {
    if (popup) {
      const after = popup.after
      popup = null
      if (after === 'dead') {
        best = writeBest('quest', score)
        mode = 'dead'
      } else if (after === 'exit') {
        exitRoom()
      }
      return true
    }
    if (mode === 'title') {
      if (k === ' ' || k === 'Enter') {
        mode = 'play'
        sfx.start()
      }
      return true
    }
    if (mode === 'dead' || mode === 'won') {
      if (k === ' ' || k === 'Enter') reset()
      return true
    }
    return false
  }

  return {
    w: W,
    h: H,
    hint: 'type a command · ←→↑↓ to walk · F3 repeats · try HELP',

    reset,

    key(code) {
      // Space and Enter arrive here in the playtest and as characters in a
      // browser; normalise so the overlay only has one shape to check.
      const k = code === 'Space' ? ' ' : code
      if (overlay(k)) return
      if (code === 'Enter') return submit()
      if (code === 'Backspace') {
        input = input.slice(0, -1)
        return
      }
      if (code === 'F3') {
        input = lastCommand
        sfx.blip()
        return
      }
      // Taking the wheel cancels whatever the ego was walking off to do.
      if (code.startsWith('Arrow')) goal = null
    },

    typed(ch) {
      if (overlay(ch)) return
      if (input.length < 40) input += ch
    },

    update(dt, held) {
      clock += dt
      if (mode !== 'play' || popup) return

      moving = false
      const dx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0)
      const dy = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0)

      if (dx || dy) {
        goal = null
        step(dx, dy, dt)
      } else if (goal) {
        const gx = goal.x - ego.x
        const gy = goal.y - ego.y
        goalTimer -= dt
        const arrived = Math.abs(gx) < 2.5 && Math.abs(gy) < 2
        // The timeout is the honest answer to "what if it can't get there":
        // a player who has walled the ego in still deserves their reply.
        if (arrived || goalTimer <= 0 || !step(gx, gy, dt)) {
          const done = goal.then
          goal = null
          done()
        }
      }

      // Walking out under your own steam counts too.
      if (
        flags.open &&
        mode === 'play' &&
        ego.y <= WALK_TOP + 1.5 &&
        ego.x > DOORWAY.x + 6 &&
        ego.x < DOORWAY.x + DOORWAY.w - 6
      ) {
        award('escape', 7)
        best = writeBest('quest', score)
        sfx.level()
        mode = 'won'
      }
    },

    draw(g) {
      const p = g.p
      g.clear()
      drawRoom(g, p, clock, flags)

      // Priority: everything left standing on the floor is sorted by its
      // baseline against the ego's feet, which is the whole of AGI's depth
      // handling and all this room needs of it.
      const actors = [
        { y: DRUM.base, paint: () => drawDrum(g, p) },
        { y: ego.y, paint: () => drawEgo(g, p, ego, scaleAt(ego.y), moving ? phase : 0) },
      ]
      if (mode === 'won') actors.pop()
      actors.sort((a, b) => a.y - b.y).forEach((a) => a.paint())

      drawStatus(g, p, score)
      drawInput(g, p, input, clock, mode === 'play' && !popup)

      if (popup) drawWindow(g, p, popup.lines)
      else if (mode === 'title')
        g.banner('SERVER CLOSET', 'press SPACE to begin', p.brand)
      else if (mode === 'dead') g.banner('YOU ARE DEAD', 'press SPACE to try again', p.hot)
      else if (mode === 'won')
        g.banner(`YOU ESCAPED · ${score} OF ${MAX_SCORE}`, `best ${best} · press SPACE`, p.brand)
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  The picture.
//
//  Sierra's rooms were a list of draw commands rather than a bitmap, which is
//  why an AGI game shipped a hundred rooms on two floppies. These are that
//  list, written as functions. Colours come from the live theme; depth comes
//  from the order they're called in.
// ─────────────────────────────────────────────────────────────────────────
const SHADE = (a) => `rgba(0, 0, 0, ${a})`
const LIT = (a) => `rgba(255, 255, 255, ${a})`

function drawRoom(g, p, clock, flags) {
  // Wall, then the darker slab of ceiling above the light line.
  g.rect(0, PIC_TOP, W, FLOOR_Y - PIC_TOP, p.panel)
  g.rect(0, PIC_TOP, W, 16, SHADE(0.5))
  for (let x = 16; x < W; x += 32)
    g.rect(x, PIC_TOP + 16, 0.5, FLOOR_Y - PIC_TOP - 16, SHADE(0.22))
  g.rect(0, FLOOR_Y - 2, W, 2, SHADE(0.4))

  // One dead tube, a cable tray, and the smoke detector nobody has tested.
  g.rect(54, 15, 74, 2.5, LIT(0.12))
  g.rect(0, 20, W, 4, SHADE(0.45))
  for (let x = 4; x < W; x += 9) g.rect(x, 20, 1.2, 4, SHADE(0.3))
  g.circle(198, 22, 3, SHADE(0.6))
  if (Math.floor(clock * 0.7) % 2 === 0) g.circle(198, 22, 1, p.hot, 5)

  drawFloor(g, p)
  drawRack(g, p, 18, 44, clock, 0)
  drawRack(g, p, 66, 44, clock, 3)
  drawWires(g, p)
  drawUps(g, p, clock, flags)
  drawClipboard(g, p)
  drawExtinguisher(g, p)
  drawDoor(g, p, clock, flags)
}

// Raised floor, in perspective. The tile lines converge on a vanishing point
// above the wall line and bunch up towards the back, which is the entire trick.
function drawFloor(g, p) {
  const depth = PIC_BOT - FLOOR_Y
  g.rect(0, FLOOR_Y, W, depth, p.panel)
  g.rect(0, FLOOR_Y, W, depth, LIT(0.04))

  const vpY = FLOOR_Y - 34
  const t = (FLOOR_Y - vpY) / (PIC_BOT - vpY)
  for (let fx = -80; fx <= W + 80; fx += 40)
    g.line(160 + (fx - 160) * t, FLOOR_Y, fx, PIC_BOT, SHADE(0.3), 0.7)
  for (let i = 1; i <= 5; i++)
    g.line(0, FLOOR_Y + depth * (i / 5) ** 1.7, W, FLOOR_Y + depth * (i / 5) ** 1.7, SHADE(0.3), 0.7)
}

function drawRack(g, p, x, w, clock, seed) {
  g.rect(x, RACK_TOP, w, FLOOR_Y - RACK_TOP, SHADE(0.55))
  g.rect(x, RACK_TOP, w, 2.5, p.line)
  g.rect(x + 2, RACK_TOP + 3, w - 4, FLOOR_Y - RACK_TOP - 6, p.bg)

  for (let i = 0; i < 9; i++) {
    const y = RACK_TOP + 5.5 + i * 5.6
    g.rect(x + 4, y, w - 8, 4.2, LIT(0.07))
    g.rect(x + 4, y, w - 8, 0.5, SHADE(0.45))
    // Deterministic per slot, so the rack blinks the same way every run — the
    // playtest pins Math.random, and this way it doesn't have to.
    const rate = 1.4 + ((i * 7 + seed) % 5) * 0.6
    const on = Math.floor(clock * rate + i) % 3 !== 0
    g.rect(x + 6, y + 1.2, 1.6, 1.6, on ? p.brand : SHADE(0.55), on ? 4 : 0)
    g.rect(x + 9.5, y + 1.2, 1.6, 1.6, i === 4 && seed ? p.hot : LIT(0.14), 0)
    for (let k = 0; k < 5; k++) g.rect(x + w - 16 + k * 2.6, y + 1, 1.2, 2.4, SHADE(0.5))
  }
}

// The bundle out of the tray, and the one that has lost its tape.
function drawWires(g, p) {
  g.line(96, 24, 104, 46, SHADE(0.65), 2)
  g.line(104, 46, 100, 70, SHADE(0.65), 2)
  g.line(104, 24, 114, 44, SHADE(0.55), 1.4)
  g.line(114, 44, 110, 70, SHADE(0.55), 1.4)
  g.line(110, 24, 118, 42, SHADE(0.6), 1.4)
  g.line(118, 42, 116, 58, SHADE(0.6), 1.4)
  g.line(116, 58, 113, 66, p.hot, 1.4, 6) // stripped back, and taped by an optimist
}

function drawUps(g, p, clock, flags) {
  g.rect(124, 96, 38, 30, SHADE(0.5))
  g.rect(124, 96, 38, 2, p.line)
  g.rect(126, 99, 34, 25, p.bg)
  g.text('UPS', 128, 103, { size: 5, color: p.muted })

  // Three breakers: two up, and one that is the puzzle.
  for (let i = 0; i < 3; i++) {
    const bx = 130 + i * 8
    const up = i < 2 || flags.breaker
    g.rect(bx, 107, 5, 10, LIT(0.1))
    g.rect(bx + 1, up ? 108 : 112.5, 3, 3.5, up ? p.brand : p.muted, up ? 3 : 0)
  }
  g.rect(150, 107, 8, 5, SHADE(0.7))
  g.rect(151, 108.5, 2, 2, p.brand, 4)
  if (Math.floor(clock * 1.3) % 2 === 0) g.rect(154.5, 108.5, 2, 2, p.brand, 4)

  drawMug(g, p, flags)
}

function drawMug(g, p, flags) {
  g.rect(146, 90.5, 2.4, 4, LIT(0.3)) // handle
  g.rect(147, 91.5, 1, 2, p.bg)
  g.rect(137, 88.5, 9, 7.5, LIT(0.45))
  g.rect(138, 89.5, 7, 1.6, SHADE(0.72)) // coffee, of a sort
  // The card, still in there, poking out where a spoon would be.
  if (flags.found && !flags.card) g.rect(140.5, 85.5, 2, 4.5, p.accent, 5)
}

function drawClipboard(g, p) {
  g.rect(176, 62, 22, 30, SHADE(0.45))
  g.rect(177.5, 64, 19, 27, p.muted)
  g.rect(183, 61, 8, 3, p.line)
  for (let i = 0; i < 6; i++) g.rect(180, 68 + i * 3.6, 13, 0.8, SHADE(0.35))
}

// Wall furniture. It exists because a bare stretch of wall between the UPS and
// the door looked like a room that hadn't finished loading.
function drawExtinguisher(g, p) {
  g.rect(205, 92, 8, 18, p.hot)
  g.rect(205, 92, 8, 18, SHADE(0.35))
  g.rect(206.5, 88, 5, 4, SHADE(0.6))
  g.rect(204, 96, 10, 1.5, SHADE(0.55))
  g.rect(206, 98, 6, 5, LIT(0.25))
}

function drawDoor(g, p, clock, flags) {
  const { x, w, top } = DOORWAY
  g.rect(x - 3, top - 3, w + 6, FLOOR_Y - top + 3, SHADE(0.6))

  if (flags.open) {
    // A corridor, which after all this is basically the treasure.
    g.rect(x, top, w, FLOOR_Y - top, p.bg)
    g.rect(x + 4, top + 4, w - 8, FLOOR_Y - top - 4, LIT(0.5))
    g.rect(x + 10, top + 10, w - 20, FLOOR_Y - top - 10, LIT(0.7))
  } else {
    g.rect(x, top, w, FLOOR_Y - top, SHADE(0.35))
    g.rect(x + 3, top + 3, w - 6, FLOOR_Y - top - 6, LIT(0.05))
    g.rect(x + w / 2, top + 3, 0.6, FLOOR_Y - top - 6, SHADE(0.4))
    g.rect(x + 3, FLOOR_Y - 16, w - 6, 13, LIT(0.07)) // kick plate
  }

  g.rect(x + 14, top - 12, 22, 8, SHADE(0.7))
  g.text('EXIT', x + 25, top - 8, { size: 5, color: p.brand, align: 'center', glow: 6 })

  // The badge reader, which is the actual door handle.
  g.rect(278, 92, 10, 13, SHADE(0.65))
  g.rect(279, 93, 8, 5, p.bg)
  const lit = flags.breaker && Math.floor(clock * 1.6) % 2 === 0
  g.rect(281.5, 100, 3, 2.5, flags.breaker ? p.brand : SHADE(0.75), lit ? 6 : 0)
}

function drawDrum(g, p) {
  const { x, w, base, h } = DRUM
  g.rect(x, base - h, w, h, SHADE(0.6))
  g.rect(x + 1.5, base - h + 1.5, w - 3, h - 3, p.panel)
  g.line(x + 2, base - h + 2, x + w - 2, base - 2, SHADE(0.45), 1)
  g.line(x + w - 2, base - h + 2, x + 2, base - 2, SHADE(0.45), 1)
  g.rect(x, base - h, w, 2, p.line)
  g.rect(x - 1, base - 2, w + 2, 2, SHADE(0.75))
}

// The ego. Four facings, two frames of legs, and a size that comes off the
// floor position — the cheapest perspective there is, and the one Sierra used.
function drawEgo(g, p, ego, s, phase) {
  const h = 44 * s
  const bw = 13 * s
  const { x, y, face } = ego
  const swing = phase ? Math.sin(phase) : 0
  const legH = h * 0.34

  g.rect(x - bw * 0.62, y - 1.2, bw * 1.24, 2.2, SHADE(0.4))
  g.rect(x - bw * 0.46 + swing * 2.4 * s, y - legH, bw * 0.36, legH, SHADE(0.8))
  g.rect(x + bw * 0.1 - swing * 2.4 * s, y - legH, bw * 0.36, legH, SHADE(0.8))
  // Arms in the hoodie's colour and then knocked back, or they read as no arms
  // at all against the torso.
  const arm = (ax, lift) => {
    g.rect(ax, y - h * 0.72 + lift, bw * 0.22, h * 0.3, p.accent)
    g.rect(ax, y - h * 0.72 + lift, bw * 0.22, h * 0.3, SHADE(0.3))
  }
  arm(x - bw / 2 - bw * 0.22, -swing * 1.6 * s)
  arm(x + bw / 2, swing * 1.6 * s)
  g.rect(x - bw / 2, y - h * 0.74, bw, h * 0.42, p.accent, 5)
  g.rect(x - bw / 2, y - h * 0.74, bw, h * 0.07, SHADE(0.25)) // hood, down

  // The head is the only circle in the room drawn in the text colour, which is
  // how the playtest finds the ego without the game handing out its state.
  const hr = h * 0.115
  const hy = y - h * 0.85
  g.circle(x, hy, hr, p.text)
  if (face === 'up') {
    g.circle(x, hy, hr, p.accent) // hood up, facing away
  } else if (face === 'down') {
    g.rect(x - hr * 0.6, hy - hr * 0.1, hr * 0.35, hr * 0.35, SHADE(0.85))
    g.rect(x + hr * 0.25, hy - hr * 0.1, hr * 0.35, hr * 0.35, SHADE(0.85))
  } else {
    const dir = face === 'right' ? 1 : -1
    g.rect(x + dir * hr * 0.1, hy - hr * 0.1, hr * 0.35, hr * 0.35, SHADE(0.85))
    g.rect(x + dir * hr * 0.85, hy + hr * 0.1, hr * 0.4, hr * 0.3, p.text)
  }
}

function drawStatus(g, p, score) {
  g.rect(0, 0, W, STATUS_H, p.panel)
  g.rect(0, STATUS_H - 0.6, W, 0.6, p.line)
  g.text(`SCORE ${score} OF ${MAX_SCORE}`, 5, STATUS_H / 2, { size: 6.5, color: p.brand })
  g.text('SERVER CLOSET', W - 5, STATUS_H / 2, {
    size: 6.5,
    color: p.muted,
    align: 'right',
  })
}

function drawInput(g, p, input, clock, live) {
  g.rect(0, PIC_BOT, W, H - PIC_BOT, p.panel)
  g.rect(0, PIC_BOT, W, 0.6, p.line)
  const y = PIC_BOT + (H - PIC_BOT) / 2
  g.text('>', 6, y, { size: 8, color: p.brand })
  g.text(input, 14, y, { size: 8, color: p.text })
  // 0.6em per character, because the font is monospaced and nothing here can
  // measure text — the playtest has no canvas to ask.
  if (live && Math.floor(clock * 2) % 2 === 0)
    g.rect(14.5 + input.length * 4.8, y - 4.2, 4.4, 8.4, p.brand)
}

function drawWindow(g, p, lines) {
  const size = 7.5
  const lh = size * 1.5
  const longest = lines.reduce((n, l) => Math.max(n, l.length), 0)
  const width = Math.min(W - 32, longest * size * 0.6 + 18)
  const height = lines.length * lh + 17
  const x = (W - width) / 2
  const y = PIC_TOP + (PIC_BOT - PIC_TOP - height) / 2

  g.rect(x + 3, y + 3, width, height, SHADE(0.55))
  g.rect(x, y, width, height, p.bg)
  g.rect(x, y, width, 1, p.brand, 6)
  g.rect(x, y + height - 1, width, 1, p.brand, 6)
  g.rect(x, y, 1, height, p.brand, 6)
  g.rect(x + width - 1, y, 1, height, p.brand, 6)

  lines.forEach((line, i) => g.text(line, x + 9, y + 11 + i * lh, { size, color: p.text }))
  g.text('press any key', x + width - 9, y + height - 5.5, {
    size: 5.5,
    color: p.muted,
    align: 'right',
  })
}
