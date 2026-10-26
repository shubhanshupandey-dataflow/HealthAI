import clsx from 'clsx'
import type { CSSProperties } from 'react'

export type OrbMode = 'idle' | 'ringing' | 'listening' | 'thinking' | 'speaking' | 'ended'

// Swirl rotation period per state: calm when idle, busy while thinking.
const SPEED: Record<OrbMode, string> = {
  idle: '18s',
  ringing: '10s',
  listening: '12s',
  thinking: '3.5s',
  speaking: '7s',
  ended: '40s',
}

/**
 * The assistant's rotating orb (styles in index.css). `level` (0-1) is the live voice volume:
 * the orb swells and its glow brightens as Sophie - or the caller - speaks.
 */
export function Orb({ mode, level = 0, className }: { mode: OrbMode; level?: number; className?: string }) {
  const style = {
    '--level': Math.min(1, Math.max(0, level)).toFixed(3),
    '--orb-speed': SPEED[mode],
  } as CSSProperties
  return (
    <div className={clsx('orb-stage', className)} data-mode={mode} style={style} aria-hidden>
      <div className="orb-glow" />
      <div className="orb-ring" />
      <div className="orb-pulse" />
      <div className="orb-pulse" />
      <div className="orb">
        <div className="orb-swirl a" />
        <div className="orb-swirl b" />
        <div className="orb-gloss" />
        <div className="orb-shade" />
      </div>
    </div>
  )
}
