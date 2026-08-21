// ─────────────────────────────────────────────────────────────────────────
//  Beeper — PC speaker impressions for the arcade.
//
//  A real PC speaker was a square wave driven by one timer channel: one voice,
//  no volume control, no chords. This keeps that shape on purpose — a single
//  oscillator that every effect retriggers, so a new sound cuts off whatever
//  was still playing rather than piling up on top of it. That constraint is
//  most of what makes it sound like 1985 instead of like a phone.
//
//  Effects are written as note lists, [frequency in Hz, duration in ms], and
//  scheduled ahead on the audio clock so their timing doesn't depend on the
//  frame rate.
// ─────────────────────────────────────────────────────────────────────────

const MUTE_KEY = 'cyberdash.arcade.muted'
// Square waves are harsh and carry: this is deliberately quiet.
const VOLUME = 0.045

let ctx = null
let osc = null
let gain = null
let muted = read()

function read() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

// Built on first use, not at import: constructing an AudioContext before the
// page has had a user gesture gets it suspended, and in Node (the playtest)
// there is no such thing at all.
function ensure() {
  if (ctx) return ctx
  const Ctor =
    typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctor) return null
  try {
    ctx = new Ctor()
    gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(ctx.destination)
    osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = 440
    osc.connect(gain)
    osc.start()
  } catch {
    ctx = null // no audio device, or the browser said no — stay silent
  }
  return ctx
}

function play(notes) {
  if (muted) return
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') c.resume()

  const now = c.currentTime
  // Monophonic: drop whatever was scheduled and start this one now.
  osc.frequency.cancelScheduledValues(now)
  gain.gain.cancelScheduledValues(now)
  gain.gain.setValueAtTime(0, now)

  let at = now
  for (const [freq, ms] of notes) {
    const dur = ms / 1000
    if (freq > 0) {
      osc.frequency.setValueAtTime(freq, at)
      gain.gain.setValueAtTime(VOLUME, at)
      // Ramped off over the last couple of milliseconds. A hard cut to zero
      // puts a click on the end of every note.
      gain.gain.setValueAtTime(VOLUME, Math.max(at, at + dur - 0.003))
      gain.gain.linearRampToValueAtTime(0, at + dur)
    }
    at += dur
  }
}

/** Wake the audio device on a user gesture, so the first effect isn't swallowed. */
export function wake() {
  const c = ensure()
  if (c?.state === 'suspended') c.resume()
}

export function isMuted() {
  return muted
}

export function setMuted(next) {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* private mode — the setting just won't outlive the session */
  }
  if (muted && gain && ctx) {
    gain.gain.cancelScheduledValues(ctx.currentTime)
    gain.gain.setValueAtTime(0, ctx.currentTime)
  }
}

export const sfx = {
  start: () => play([[523, 60], [784, 90]]),
  blip: () => play([[988, 18]]),
  // Two-tone, like the arcade's waka reduced to what one channel can manage.
  eat: () => play([[660, 16], [880, 18]]),
  power: () => play([[440, 45], [659, 45], [988, 70]]),
  bounce: () => play([[523, 16]]),
  brick: () => play([[784, 18], [988, 14]]),
  shoot: () => play([[1245, 12], [740, 14]]),
  kill: () => play([[330, 35], [196, 55]]),
  hit: () => play([[220, 60], [147, 80]]),
  die: () => play([[392, 70], [294, 80], [196, 100], [123, 170]]),
  level: () => play([[523, 70], [659, 70], [784, 70], [1047, 150]]),
}
