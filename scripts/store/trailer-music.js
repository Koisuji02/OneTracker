// The trailer's soundtrack, composed in code (Web Audio, rendered offline) on
// the same cue sheet as the pictures, so every cut lands on the music.
// Loaded into a page by youtube.mjs; `composeTrailerMusic(cue)` returns an
// AudioBuffer. Original, synthesised from scratch: no samples, no licences.
//
// The piece: 100 BPM in A minor, a cinematic ambient build. A pad swell under
// the logo, a rising pluck for each word, an impact on "One app.", then one
// chord per scene (Am F C G, twice) with an arpeggio through a dotted-eighth
// echo, drums that grow scene by scene, a breakdown under "TV Time?" and a
// last impact into a long C major chord on the end card.
/* global OfflineAudioContext */
window.composeTrailerMusic = async (cue) => {
  const SR = 48000
  const ctx = new OfflineAudioContext(2, Math.ceil(cue.duration * SR), SR)
  const beat = cue.bar / 4
  const eighth = beat / 2
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)

  // the same "random" every run
  let seed = 7
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // ---- buses: glue compressor, a long hall, a dark dotted-eighth echo
  const master = ctx.createGain()
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -22
  comp.knee.value = 10
  comp.ratio.value = 4
  comp.attack.value = 0.01
  comp.release.value = 0.3
  master.connect(comp).connect(ctx.destination)
  master.gain.setValueAtTime(0, 0)
  master.gain.linearRampToValueAtTime(0.85, 0.4)
  master.gain.setValueAtTime(0.85, cue.duration - 2.4)
  master.gain.linearRampToValueAtTime(0, cue.duration - 0.05)

  const impulse = (sec, decay) => {
    const len = Math.floor(sec * SR)
    const b = ctx.createBuffer(2, len, SR)
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch)
      for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
    return b
  }
  const reverb = ctx.createConvolver()
  reverb.buffer = impulse(4.5, 2.4)
  const revOut = ctx.createGain()
  revOut.gain.value = 0.5
  reverb.connect(revOut).connect(master)

  const echo = ctx.createDelay(2)
  echo.delayTime.value = eighth * 1.5
  const echoTone = ctx.createBiquadFilter()
  echoTone.type = 'lowpass'
  echoTone.frequency.value = 2400
  const feedback = ctx.createGain()
  feedback.gain.value = 0.36
  echo.connect(echoTone).connect(feedback).connect(echo)
  const echoOut = ctx.createGain()
  echoOut.gain.value = 0.32
  echoTone.connect(echoOut)
  echoOut.connect(master)
  echoOut.connect(reverb)

  const noise = ctx.createBuffer(1, SR * 3, SR)
  {
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1
  }
  const noiseSrc = (t, dur) => {
    const s = ctx.createBufferSource()
    s.buffer = noise
    s.loop = true
    s.start(t, rand() * 2)
    s.stop(t + dur)
    return s
  }
  const send = (node, { dry = 1, rev = 0, del = 0, pan = 0 } = {}) => {
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    node.connect(p)
    const d = ctx.createGain()
    d.gain.value = dry
    p.connect(d).connect(master)
    if (rev) {
      const r = ctx.createGain()
      r.gain.value = rev
      p.connect(r).connect(reverb)
    }
    if (del) {
      const e = ctx.createGain()
      e.gain.value = del
      p.connect(e).connect(echo)
    }
  }

  // ---- instruments
  const CHORDS = {
    Am: { pad: [57, 60, 64, 71], root: 33 },
    F: { pad: [53, 57, 60, 64], root: 29 },
    C: { pad: [55, 60, 64, 74], root: 36 },
    G: { pad: [55, 59, 62, 69], root: 31 },
  }

  /** warm pad: two detuned saws per note through a slowly opening low-pass */
  const pad = (chord, t0, t1, { level = 1, attack = 1.2, release = 1.6, cutoff = 1300, shift = 0 } = {}) => {
    CHORDS[chord].pad.forEach((note, k) => {
      const n = note + shift
      const g = ctx.createGain()
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.Q.value = 0.6
      f.frequency.setValueAtTime(cutoff * 0.45, t0)
      f.frequency.linearRampToValueAtTime(cutoff, t0 + attack + 0.6)
      for (const det of [-9, 9]) {
        const o = ctx.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = mtof(n)
        o.detune.value = det
        o.connect(f)
        o.start(t0)
        o.stop(t1 + release + 0.1)
      }
      const v = 0.026 * level
      g.gain.setValueAtTime(0, t0)
      g.gain.linearRampToValueAtTime(v, t0 + attack)
      g.gain.setValueAtTime(v, t1)
      g.gain.linearRampToValueAtTime(0, t1 + release)
      f.connect(g)
      send(g, { dry: 0.55, rev: 0.9, pan: (k / 3 - 0.5) * 0.9 })
    })
  }

  /** sub bass: sine at the root, ducked on every kick */
  const ducks = []
  const bass = (chord, t0, t1, level = 1) => {
    const f = mtof(CHORDS[chord].root + 12)
    const g = ctx.createGain()
    for (const [mult, amp] of [[1, 1], [2, 0.18]]) {
      const o = ctx.createOscillator()
      o.frequency.value = f * mult
      const a = ctx.createGain()
      a.gain.value = amp
      o.connect(a).connect(g)
      o.start(t0)
      o.stop(t1 + 0.6)
    }
    const v = 0.1 * level
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(v, t0 + 0.08)
    for (const k of ducks) {
      if (k <= t0 || k >= t1) continue
      g.gain.setValueAtTime(v, k)
      g.gain.linearRampToValueAtTime(v * 0.6, k + 0.02)
      g.gain.linearRampToValueAtTime(v, k + 0.32)
    }
    g.gain.setValueAtTime(v, t1)
    g.gain.linearRampToValueAtTime(0, t1 + 0.5)
    send(g, { dry: 1 })
  }

  /** pluck: triangle + octave sine, quick decay, into the echo */
  const pluck = (n, t, vel, pan = 0) => {
    const g = ctx.createGain()
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 3400
    for (const [type, mult, amp] of [['triangle', 1, 1], ['sine', 2, 0.35]]) {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = mtof(n) * mult
      const a = ctx.createGain()
      a.gain.value = amp
      o.connect(a).connect(f)
      o.start(t)
      o.stop(t + 1.2)
    }
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vel, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
    f.connect(g)
    send(g, { dry: 0.65, rev: 0.45, del: 0.55, pan })
  }

  /** bell: a sine with two quiet inharmonic partials, long tail */
  const bell = (n, t, vel) => {
    const g = ctx.createGain()
    for (const [mult, amp] of [[1, 1], [2.76, 0.18], [5.4, 0.06]]) {
      const o = ctx.createOscillator()
      o.frequency.value = mtof(n) * mult
      const a = ctx.createGain()
      a.gain.value = amp
      o.connect(a).connect(g)
      o.start(t)
      o.stop(t + 3.6)
    }
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(vel, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4)
    send(g, { dry: 0.5, rev: 1, del: 0.3 })
  }

  const kick = (t, vel) => {
    ducks.push(t)
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vel, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48)
    o.connect(g)
    o.start(t)
    o.stop(t + 0.5)
    send(g, { dry: 1, rev: 0.08 })
  }

  const hat = (t, vel, pan) => {
    const f = ctx.createBiquadFilter()
    f.type = 'highpass'
    f.frequency.value = 7800
    const g = ctx.createGain()
    g.gain.setValueAtTime(vel, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    noiseSrc(t, 0.08).connect(f).connect(g)
    send(g, { dry: 1, rev: 0.15, pan })
  }

  /** the big hits: a sub boom, a dark noise bloom, air on top */
  const impact = (t, size) => {
    const o = ctx.createOscillator()
    o.frequency.setValueAtTime(74, t)
    o.frequency.exponentialRampToValueAtTime(27, t + 1.8)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.55 * size, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2)
    o.connect(g)
    o.start(t)
    o.stop(t + 3.3)
    send(g, { dry: 1, rev: 0.2 })
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(2400, t)
    f.frequency.exponentialRampToValueAtTime(300, t + 2.4)
    const n = ctx.createGain()
    n.gain.setValueAtTime(0.24 * size, t)
    n.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
    noiseSrc(t, 2.7).connect(f).connect(n)
    send(n, { dry: 0.6, rev: 1 })
  }

  /** noise swelling up to a hit, cut dead on it */
  const riser = (t0, t1, level) => {
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 0.9
    f.frequency.setValueAtTime(320, t0)
    f.frequency.exponentialRampToValueAtTime(5200, t1)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(level, t1 - 0.03)
    g.gain.linearRampToValueAtTime(0, t1)
    noiseSrc(t0, t1 - t0 + 0.05).connect(f).connect(g)
    send(g, { dry: 0.8, rev: 0.4 })
  }

  /** a short sweep across the stereo field into a cut */
  const whoosh = (t, level = 0.09) => {
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.Q.value = 1.3
    f.frequency.setValueAtTime(500, t - 0.5)
    f.frequency.exponentialRampToValueAtTime(3200, t)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t - 0.5)
    g.gain.linearRampToValueAtTime(level, t - 0.06)
    g.gain.linearRampToValueAtTime(0, t + 0.18)
    const p = ctx.createStereoPanner()
    p.pan.setValueAtTime(-0.7, t - 0.5)
    p.pan.linearRampToValueAtTime(0.7, t + 0.18)
    noiseSrc(t - 0.5, 0.75).connect(f).connect(g).connect(p)
    send(p, { dry: 1, rev: 0.3 })
  }

  // ---- the arrangement, on the cue sheet
  const { logoAt, nameAt, words, hit, scenes, end, duration } = cue

  // intro: the A minor pad swells under the logo, a low drone, two bells
  pad('Am', 0, hit, { level: 0.85, attack: 2.6, release: 0.5, cutoff: 1100 })
  bass('Am', nameAt, hit, 0.7)
  bell(76, logoAt, 0.1)
  bell(81, nameAt, 0.08)
  // the words: one pluck each, climbing, while the riser builds to the hit
  ;[69, 72, 76, 79, 81, 84, 88].forEach((n, i) => pluck(n, words[i], 0.11 + i * 0.012, i % 2 ? 0.35 : -0.35))
  riser(words[0], hit, 0.2)
  // "One app."
  impact(hit, 1)
  pad('F', hit, scenes[0].t, { level: 1.1, attack: 0.05, release: 0.8, cutoff: 1800 })
  bass('F', hit, scenes[0].t, 1)
  bell(84, hit, 0.1)

  // one chord per scene; the drums grow with `level`, 0 is the breakdown
  scenes.forEach((s, i) => {
    const t0 = s.t
    const t1 = i + 1 < scenes.length ? scenes[i + 1].t : end
    const L = s.level
    const notes = CHORDS[s.chord].pad
    if (L > 0) {
      // drums first, so the bass knows where to duck
      for (let b = 0; b < 8; b++) {
        const t = t0 + b * beat
        const inBar = b % 4
        if (L >= 2 && (inBar === 0 || inBar === 2)) kick(t, 0.55)
        if (L >= 3 && inBar === 1) kick(t + eighth, 0.32)
        if (L >= 4 && (inBar === 1 || inBar === 3)) kick(t, 0.5)
        if (L >= 2) hat(t + eighth, 0.035 + 0.006 * L, 0.3)
        if (L >= 3) hat(t, 0.022, -0.3)
      }
      whoosh(t0, 0.07 + 0.01 * L)
      if (i > 0) impact(t0, 0.18 + 0.05 * L)
      pad(s.chord, t0, t1, { level: 0.7 + 0.15 * L, attack: 0.35, release: 0.9, cutoff: 1100 + 220 * L })
      // from the middle on, the same chord an octave up: air and width
      if (L >= 3) pad(s.chord, t0, t1, { level: 0.25 * (L - 2), attack: 0.8, release: 0.9, cutoff: 3200, shift: 12 })
      bass(s.chord, t0, t1, 0.8 + 0.1 * L)
      bell(notes[3] + 12, t0, 0.07)
      // the arpeggio: quarters to begin with, then eighths
      const step = L >= 2 ? eighth : beat
      const order = [0, 2, 1, 3, 2, 1, 3, 2]
      for (let k = 0, t = t0; t < t1 - 0.01; k++, t += step) {
        pluck(notes[order[k % order.length]] + 12, t, 0.05 + 0.015 * L, k % 2 ? 0.4 : -0.4)
      }
    } else {
      // breakdown: drums out, a darker pad, sparse plucks, a long swell into the end
      pad(s.chord, t0, t1, { level: 0.9, attack: 0.6, release: 0.4, cutoff: 750 })
      bass(s.chord, t0, t1, 0.6)
      for (let t = t0; t < t1 - beat; t += beat * 2) pluck(notes[3] + 12, t, 0.05)
      riser(t0 + (t1 - t0) / 2, t1, 0.28)
    }
  })

  // the end card: the biggest hit, a long C major chord, a falling bell melody
  impact(end, 1.2)
  pad('C', end, duration - 1.6, { level: 1.15, attack: 0.05, release: 1.5, cutoff: 1900 })
  bass('C', end, duration - 1.8, 1)
  ;[76, 74, 72, 79].forEach((n, i) => bell(n, end + i * 1.2, 0.085))
  for (let k = 0, t = end; t < duration - 2.6; k++, t += beat) {
    pluck(CHORDS.C.pad[[0, 2, 1, 3][k % 4]] + 12, t, Math.max(0.02, 0.07 - k * 0.004), k % 2 ? 0.4 : -0.4)
  }

  const buf = await ctx.startRendering()
  // peak-normalise to -1 dBFS
  let peak = 0
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]))
  }
  const k = peak > 0 ? 0.89 / peak : 1
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < d.length; i++) d[i] *= k
  }
  return buf
}
