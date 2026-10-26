import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useLocalParticipant,
  useTrackVolume,
  useTranscriptions,
  useVoiceAssistant,
  type TrackReference,
} from '@livekit/components-react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { LocalAudioTrack } from 'livekit-client'
import { AlertCircle, ArrowUpRight, Captions, Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BrandLogo } from '../components/Brand'
import { Orb, type OrbMode } from '../components/Orb'
import { buttonClass } from '../components/ui'
import { errorMessage, get, post } from '../lib/api'
import { startRingback, type Ringback } from '../lib/ringback'
import type { AgentSettings, ClinicSettings, Paged, Patient, SystemStatus } from '../lib/types'

type Phase = 'idle' | 'ringing' | 'live' | 'ended'

interface Connection {
  server_url: string
  token: string
  room_name: string
}

interface Line {
  id: string
  me: boolean
  text: string
  ts: number
}

const NO_ANSWER_MS = 45_000
const SUGGESTIONS = [
  'What time do you close on Saturdays?',
  'Can I book a check-up next week?',
  'I’ve got toothache - can I be seen today?',
  'How much is teeth whitening?',
]
const REQUIRED_KEYS = ['livekit', 'deepgram', 'google'] as const
const KEY_NAMES = { livekit: 'LiveKit', deepgram: 'Deepgram', google: 'Google Gemini' }

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function Assistant() {
  const { data: agentSettings } = useQuery({ queryKey: ['settings', 'agent'], queryFn: () => get<AgentSettings>('/settings/agent') })
  const { data: clinic } = useQuery({ queryKey: ['settings', 'clinic'], queryFn: () => get<ClinicSettings>('/settings/clinic') })
  const { data: status } = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const { data: patients } = useQuery({
    queryKey: ['patients', 'sample'],
    queryFn: () => get<Paged<Patient>>('/patients', { page_size: 6 }),
  })
  const name = agentSettings?.agent_name || 'Sophie'

  const [phase, setPhase] = useState<Phase>('idle')
  const [conn, setConn] = useState<Connection | null>(null)
  const [callerNumber, setCallerNumber] = useState('')
  const [error, setError] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [duration, setDuration] = useState(0)
  const ring = useRef<Ringback | null>(null)
  const answeredAt = useRef<number | null>(null)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase

  useEffect(() => {
    document.title = `${name} · Adele Care`
  }, [name])
  useEffect(() => () => ring.current?.stop(), [])

  const stopRing = useCallback(() => {
    ring.current?.stop()
    ring.current = null
  }, [])

  async function call() {
    setError('')
    setLines([])
    setDuration(0)
    answeredAt.current = null
    ring.current = startRingback() // started inside the click, so the browser allows the sound
    setPhase('ringing')
    try {
      setConn(await post<Connection>('/livekit/token', { caller_number: callerNumber, caller_name: 'Demo caller' }))
    } catch (err) {
      stopRing()
      setPhase('idle')
      setError(errorMessage(err))
    }
  }

  const answered = useCallback(() => {
    if (phaseRef.current !== 'ringing') return
    stopRing()
    answeredAt.current = Date.now()
    setPhase('live')
  }, [stopRing])

  const hangUp = useCallback(
    (reason?: string) => {
      stopRing()
      setConn(null)
      if (phaseRef.current !== 'idle' && phaseRef.current !== 'ended') {
        setDuration(answeredAt.current ? Math.round((Date.now() - answeredAt.current) / 1000) : 0)
        setPhase('ended')
      }
      if (reason) setError(reason)
    },
    [stopRing],
  )

  // Stable callbacks: CallBody re-renders many times a second (voice levels), so inline
  // functions would keep resetting its timers.
  const noAnswer = useCallback(
    () => hangUp(`${name} didn’t pick up. Is the voice agent running? Start it with start.ps1.`),
    [hangUp, name],
  )
  const endCall = useCallback(() => hangUp(), [hangUp])

  const missing = status ? REQUIRED_KEYS.filter((k) => !status.keys[k]) : []

  return (
    <div className="brand-backdrop flex min-h-full flex-col">
      <header className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3">
          <BrandLogo className="h-8" />
          <span className="hidden rounded-full border border-teal-200 bg-white/70 px-2.5 py-1 font-mono text-[11px] tracking-[0.14em] text-teal-700 uppercase sm:inline">
            AI Receptionist
          </span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-600 md:inline">{clinic?.name}</span>
          <a href="/calls" target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 'sm')}>
            Call logs <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </header>

      <LiveKitRoom
        serverUrl={conn?.server_url}
        token={conn?.token}
        connect={!!conn}
        audio={!!conn}
        video={false}
        onDisconnected={endCall}
        onError={(e) => setError(e.message)}
        className="flex flex-1 flex-col"
      >
        <CallBody
          name={name}
          phase={phase}
          lines={lines}
          duration={duration}
          answeredAt={answeredAt}
          onLines={setLines}
          onAnswered={answered}
          onNoAnswer={noAnswer}
          onHangUp={endCall}
          onCall={call}
          callerNumber={callerNumber}
          onCallerNumber={setCallerNumber}
          patients={patients?.items.filter((p) => p.phone) ?? []}
          error={error}
          missing={missing}
        />
        {conn && <RoomAudioRenderer />}
        <StartAudio
          label="Tap to hear Sophie"
          className={buttonClass('primary', 'md', 'fixed bottom-6 left-1/2 z-20 -translate-x-1/2 shadow-lg')}
        />
      </LiveKitRoom>
    </div>
  )
}

function CallBody({
  name,
  phase,
  lines,
  duration,
  answeredAt,
  onLines,
  onAnswered,
  onNoAnswer,
  onHangUp,
  onCall,
  callerNumber,
  onCallerNumber,
  patients,
  error,
  missing,
}: {
  name: string
  phase: Phase
  lines: Line[]
  duration: number
  answeredAt: { current: number | null }
  onLines: (lines: Line[]) => void
  onAnswered: () => void
  onNoAnswer: () => void
  onHangUp: () => void
  onCall: () => void
  callerNumber: string
  onCallerNumber: (value: string) => void
  patients: Patient[]
  error: string
  missing: readonly string[]
}) {
  const { state, audioTrack, agent } = useVoiceAssistant()
  const { localParticipant, microphoneTrack, isMicrophoneEnabled } = useLocalParticipant()
  const transcriptions = useTranscriptions()
  const [showTranscript, setShowTranscript] = useState(false)
  const [, tick] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  // Stop ringing the moment Sophie starts her greeting - like a real call being answered.
  useEffect(() => {
    if (phase === 'ringing' && state === 'speaking') onAnswered()
  }, [phase, state, onAnswered])
  // Fallback if the agent joins but stays silent (e.g. greeting disabled).
  useEffect(() => {
    if (phase !== 'ringing' || !agent || state !== 'listening') return
    const t = window.setTimeout(onAnswered, 2500)
    return () => window.clearTimeout(t)
  }, [phase, agent, state, onAnswered])
  useEffect(() => {
    if (phase !== 'ringing') return
    const t = window.setTimeout(onNoAnswer, NO_ANSWER_MS)
    return () => window.clearTimeout(t)
  }, [phase, onNoAnswer])
  useEffect(() => {
    if (phase !== 'live') return
    const t = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [phase])

  const live = useMemo(
    () =>
      transcriptions
        .map((t) => ({
          id: t.streamInfo.id,
          me: t.participantInfo.identity === localParticipant.identity,
          text: t.text.trim(),
          ts: t.streamInfo.timestamp,
        }))
        .filter((l) => l.text)
        .sort((a, b) => a.ts - b.ts),
    [transcriptions, localParticipant.identity],
  )
  // Keep the transcript after hang-up (the room's own list is cleared on disconnect).
  useEffect(() => {
    if (live.length) onLines(live)
  }, [live, onLines])
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [lines, showTranscript])

  let mode: OrbMode = 'idle'
  if (phase === 'ringing') mode = 'ringing'
  else if (phase === 'ended') mode = 'ended'
  else if (phase === 'live') mode = state === 'speaking' ? 'speaking' : state === 'thinking' ? 'thinking' : 'listening'

  const elapsed = answeredAt.current ? Math.round((Date.now() - answeredAt.current) / 1000) : 0
  const statusText =
    phase === 'idle'
      ? `Call ${name} to hear how she answers your patients`
      : phase === 'ringing'
        ? agent
          ? 'Connecting…'
          : 'Ringing…'
        : phase === 'ended'
          ? `Call ended${duration ? ` · ${clock(duration)}` : ''}`
          : state === 'speaking'
            ? `${name} is speaking`
            : state === 'thinking'
              ? 'Thinking…'
              : 'Listening…'

  const lastAgent = [...lines].reverse().find((l) => !l.me)
  const lastCaller = [...lines].reverse().find((l) => l.me)

  return (
    <main className="flex flex-1 flex-col items-center px-5 pb-10">
      <LiveOrb
        mode={mode}
        agentTrack={audioTrack}
        micTrack={microphoneTrack?.track as LocalAudioTrack | undefined}
        micEnabled={isMicrophoneEnabled}
        className="mt-6 w-[min(62vw,300px)] sm:mt-10"
      />

      <h1 className="mt-12 font-serif text-[40px] leading-none font-medium tracking-tight text-slate-900">{name}</h1>
      <p className="mt-3 flex items-center gap-2 text-[15px] text-slate-600" aria-live="polite">
        {phase === 'live' && <span className="size-2 rounded-full bg-emerald-500" />}
        {statusText}
        {phase === 'live' && <span className="font-mono text-sm text-slate-500 tabular-nums">{clock(elapsed)}</span>}
      </p>

      {/* controls */}
      <div className="mt-8 flex flex-col items-center gap-4">
        {(phase === 'idle' || phase === 'ended') && (
          <>
            <button
              onClick={onCall}
              disabled={missing.includes('livekit')}
              className={buttonClass('primary', 'md', 'h-14 px-8 text-base disabled:opacity-50')}
            >
              <Phone className="size-5" />
              {phase === 'ended' ? 'Call again' : `Call ${name}`}
            </button>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              Calling from
              <select
                value={callerNumber}
                onChange={(e) => onCallerNumber(e.target.value)}
                className="h-9 rounded-full border border-slate-300 bg-white/80 px-3 text-sm text-slate-800 shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              >
                <option value="">an unknown number (new caller)</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.phone}>
                    {p.full_name} · {p.phone}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {phase === 'ringing' && (
          <RoundButton label="Cancel call" tone="danger" onClick={onHangUp}>
            <PhoneOff className="size-6" />
          </RoundButton>
        )}
        {phase === 'live' && (
          <div className="flex items-center gap-4">
            <RoundButton
              label={isMicrophoneEnabled ? 'Mute' : 'Unmute'}
              tone={isMicrophoneEnabled ? 'light' : 'dark'}
              onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
            >
              {isMicrophoneEnabled ? <Mic className="size-5" /> : <MicOff className="size-5" />}
            </RoundButton>
            <RoundButton label="End call" tone="danger" size="lg" onClick={onHangUp}>
              <PhoneOff className="size-6" />
            </RoundButton>
            <RoundButton
              label={showTranscript ? 'Hide transcript' : 'Show transcript'}
              tone={showTranscript ? 'dark' : 'light'}
              onClick={() => setShowTranscript(!showTranscript)}
            >
              <Captions className="size-5" />
            </RoundButton>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-6 flex max-w-md items-start gap-2 rounded-2xl border border-red-200 bg-white/80 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
      )}
      {missing.length > 0 && phase === 'idle' && (
        <p className="mt-6 flex max-w-md items-start gap-2 rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          Missing in .env: {missing.map((k) => KEY_NAMES[k as keyof typeof KEY_NAMES]).join(', ')}. Add them and restart.
        </p>
      )}

      {/* live captions / transcript */}
      {phase !== 'idle' && (showTranscript || phase === 'ended') && lines.length > 0 ? (
        <div
          ref={scroller}
          className="scroll-thin mt-8 max-h-80 w-full max-w-xl space-y-3 overflow-y-auto rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm backdrop-blur"
        >
          {lines.map((l) => (
            <div key={l.id} className={clsx('flex', l.me ? 'justify-end' : 'justify-start')}>
              <p
                className={clsx(
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                  l.me ? 'rounded-br-md bg-slate-900 text-white' : 'rounded-bl-md bg-teal-50 text-slate-800',
                )}
              >
                {l.text}
              </p>
            </div>
          ))}
        </div>
      ) : phase === 'live' ? (
        <div className="mt-8 min-h-24 w-full max-w-xl space-y-2 text-center">
          {lastCaller && <p className="text-sm text-slate-500">“{lastCaller.text}”</p>}
          {lastAgent && <p className="text-lg leading-relaxed text-slate-800">{lastAgent.text}</p>}
        </div>
      ) : phase === 'idle' ? (
        <div className="mt-10 w-full max-w-xl text-center">
          <p className="font-mono text-[11px] tracking-[0.14em] text-slate-500 uppercase">Try asking</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <span key={s} className="rounded-full border border-slate-200 bg-white/70 px-3.5 py-1.5 text-sm text-slate-700">
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  )
}

/**
 * The only part of the page that follows the live voice level (~60 updates a second).
 * Kept separate so the rest of the call screen doesn't re-render with it - on slower laptops
 * that extra work competes with audio playback.
 */
function LiveOrb({
  mode,
  agentTrack,
  micTrack,
  micEnabled,
  className,
}: {
  mode: OrbMode
  agentTrack: TrackReference | undefined
  micTrack: LocalAudioTrack | undefined
  micEnabled: boolean
  className?: string
}) {
  const agentLevel = useTrackVolume(agentTrack)
  const micLevel = useTrackVolume(micTrack)
  const raw = mode === 'speaking' ? agentLevel * 1.6 : mode === 'listening' && micEnabled ? micLevel * 1.1 : 0
  const level = Math.round(Math.min(1, raw) * 25) / 25 // coarse steps = fewer style changes
  return <MemoOrb mode={mode} level={level} className={className} />
}

const MemoOrb = memo(Orb)

function RoundButton({
  label,
  tone,
  size = 'md',
  onClick,
  children,
}: {
  label: string
  tone: 'light' | 'dark' | 'danger'
  size?: 'md' | 'lg'
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={clsx(
        'grid place-items-center rounded-full shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600',
        size === 'lg' ? 'size-16' : 'size-12',
        tone === 'light' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        tone === 'dark' && 'bg-slate-900 text-white hover:bg-slate-800',
        tone === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
      )}
    >
      {children}
    </button>
  )
}
