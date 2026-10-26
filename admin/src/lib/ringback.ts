/**
 * UK phone ringback ("ring-ring ... ring-ring"): 400 Hz + 450 Hz, 0.4 s on, 0.2 s off, 0.4 s on, 2 s off.
 * Generated with Web Audio, so no sound files are needed. Must be started from a click
 * (browsers only allow audio after a user gesture).
 */
export interface Ringback {
  stop: () => void
}

type AudioContextCtor = typeof AudioContext

export function startRingback(volume = 0.06): Ringback {
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  if (!Ctor) return { stop: () => {} }

  const ctx = new Ctor()
  const gain = ctx.createGain()
  gain.gain.value = 0
  gain.connect(ctx.destination)
  const oscillators = [400, 450].map((frequency) => {
    const osc = ctx.createOscillator()
    osc.frequency.value = frequency
    osc.connect(gain)
    osc.start()
    return osc
  })

  // Schedule two minutes of cadence up front; setTargetAtTime gives soft edges (no clicks).
  const start = ctx.currentTime + 0.05
  for (let i = 0; i < 40; i++) {
    const base = start + i * 3
    for (const [on, off] of [
      [0, 0.4],
      [0.6, 1.0],
    ]) {
      gain.gain.setTargetAtTime(volume, base + on, 0.012)
      gain.gain.setTargetAtTime(0, base + off, 0.012)
    }
  }

  let stopped = false
  return {
    stop() {
      if (stopped) return
      stopped = true
      const now = ctx.currentTime
      gain.gain.cancelScheduledValues(now)
      gain.gain.setTargetAtTime(0, now, 0.03)
      window.setTimeout(() => {
        oscillators.forEach((osc) => osc.stop())
        void ctx.close()
      }, 250)
    },
  }
}
