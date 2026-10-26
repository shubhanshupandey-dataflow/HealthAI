import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertCircle, Pause, Play, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { errorMessage, get, getToken } from '../lib/api'
import { useDebounced } from '../lib/hooks'
import type { AgentSettings, CartesiaVoice, SystemStatus } from '../lib/types'
import { Button, Card, CardHeader, Field, Input, Select, Spinner, Switch } from './ui'

export const DEEPGRAM_VOICES = [
  { id: 'aura-2-pandora-en', label: 'Pandora · British female ★', hint: 'Calm, smooth, made for phone lines.' },
  { id: 'aura-2-theia-en', label: 'Theia · Australian female', hint: 'Expressive and polite.' },
  { id: 'aura-2-draco-en', label: 'Draco · British male', hint: 'Warm and trustworthy.' },
  { id: 'aura-2-hyperion-en', label: 'Hyperion · Australian male', hint: 'Caring and empathetic.' },
  { id: 'aura-2-thalia-en', label: 'Thalia · American female', hint: 'Clear and energetic.' },
  { id: 'aura-2-helena-en', label: 'Helena · American female', hint: 'Caring and friendly.' },
]

export const STT_ENGINES = [
  {
    id: 'deepgram-flux',
    label: 'Deepgram Flux ★',
    hint: 'Built for phone conversations: hears short phrases well and knows when the caller has finished.',
    key: 'deepgram' as const,
  },
  {
    id: 'cartesia-ink-2',
    label: 'Cartesia Ink-2',
    hint: 'Very accurate on names, numbers and dates, with built-in end-of-turn detection.',
    key: 'cartesia' as const,
  },
  {
    id: 'deepgram-nova-3',
    label: 'Deepgram Nova-3',
    hint: 'Classic model, paired with LiveKit’s cloud turn detector.',
    key: 'deepgram' as const,
  },
]

/* ------------------------------------------------------------------ audio helpers */

let playing: HTMLAudioElement | null = null

function playAudio(src: string, onEnd?: () => void) {
  playing?.pause()
  playing = new Audio(src)
  playing.onended = () => onEnd?.()
  void playing.play()
  return playing
}

// Each preview costs a little voice credit, so a clip is made once per voice/speed/text and replayed.
const previewCache = new Map<string, string>()

async function fetchPreview(body: { provider: string; voice: string; model: string; speed: number; text: string }) {
  const key = JSON.stringify(body)
  const cached = previewCache.get(key)
  if (cached) return cached
  const res = await fetch('/api/voices/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken() ?? ''}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Preview failed')
  }
  const url = URL.createObjectURL(await res.blob())
  previewCache.set(key, url)
  return url
}

/* ------------------------------------------------------------------ voice card */

export function VoiceCard({
  agent,
  setAgent,
  status,
  greeting,
}: {
  agent: AgentSettings
  setAgent: (a: AgentSettings) => void
  status?: SystemStatus
  greeting: string
}) {
  const [previewing, setPreviewing] = useState(false)
  const set = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) => setAgent({ ...agent, [key]: value })
  const provider = agent.tts_provider
  const missingKey =
    provider === 'cartesia' ? !status?.keys.cartesia : provider === 'elevenlabs' ? !status?.keys.elevenlabs : false

  async function preview() {
    setPreviewing(true)
    try {
      playAudio(
        await fetchPreview({
          provider,
          voice: agent.tts_voice,
          model: agent.tts_model,
          speed: agent.tts_speed,
          text: greeting,
        }),
      )
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Voice (text-to-speech)"
        description="How Sophie sounds. Switch this independently of speech recognition. Changes apply from the next call."
        action={
          <Button size="sm" variant="secondary" icon={<Volume2 className="size-4" />} loading={previewing} onClick={preview}>
            Hear the greeting
          </Button>
        }
      />
      <div className="space-y-4 p-5">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            { id: 'deepgram', name: 'Deepgram Aura-2', note: 'Default · included' },
            { id: 'cartesia', name: 'Cartesia Sonic 3.6', note: 'Most natural · fastest' },
            { id: 'elevenlabs', name: 'ElevenLabs', note: 'Huge voice library' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                setAgent({
                  ...agent,
                  tts_provider: p.id,
                  tts_voice: p.id === 'deepgram' ? 'aura-2-pandora-en' : p.id === provider ? agent.tts_voice : '',
                  tts_model: p.id === 'cartesia' ? 'sonic-3.6' : p.id === 'elevenlabs' ? 'eleven_flash_v2_5' : '',
                })
              }
              className={clsx(
                'rounded-xl border px-3 py-2.5 text-left transition-colors',
                provider === p.id ? 'border-teal-600 bg-teal-50 ring-1 ring-teal-600' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <span className="block text-sm font-semibold text-slate-900">{p.name}</span>
              <span className="block text-xs text-slate-500">{p.note}</span>
            </button>
          ))}
        </div>

        {missingKey && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            Add {provider === 'cartesia' ? 'CARTESIA_API_KEY' : 'ELEVEN_API_KEY'} to .env and restart. Until then Sophie
            uses the Deepgram voice.
          </p>
        )}

        {provider === 'deepgram' && (
          <Field label="Voice" hint={DEEPGRAM_VOICES.find((v) => v.id === agent.tts_voice)?.hint}>
            <Select value={agent.tts_voice} onChange={(e) => set('tts_voice', e.target.value)}>
              {DEEPGRAM_VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {provider === 'cartesia' && (
          <>
            <CartesiaVoicePicker
              value={agent.tts_voice}
              onChange={(id) => set('tts_voice', id)}
              enabled={!missingKey}
              model={agent.tts_model || 'sonic-3.6'}
              speed={agent.tts_speed}
              sample={`Hello, you're speaking with ${agent.agent_name || 'Sophie'}. How can I help you today?`}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={`Speaking speed · ${agent.tts_speed.toFixed(2)}×`} hint="1.00 is natural. Receptionists often sound best at 0.95–1.05.">
                <input
                  type="range"
                  min={0.8}
                  max={1.2}
                  step={0.05}
                  value={agent.tts_speed}
                  onChange={(e) => set('tts_speed', Number(e.target.value))}
                  className="mt-3 w-full accent-teal-600"
                />
              </Field>
              <Field label="Model" hint="sonic-3.6 always tracks Cartesia’s latest stable voice model.">
                <Input value={agent.tts_model} onChange={(e) => set('tts_model', e.target.value)} placeholder="sonic-3.6" />
              </Field>
            </div>
          </>
        )}

        {provider === 'elevenlabs' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Voice ID" hint="Copy it from the ElevenLabs Voice Library.">
              <Input value={agent.tts_voice} onChange={(e) => set('tts_voice', e.target.value)} placeholder="Voice ID" />
            </Field>
            <Field label="Model" hint="eleven_flash_v2_5 is the fastest.">
              <Input value={agent.tts_model} onChange={(e) => set('tts_model', e.target.value)} placeholder="eleven_flash_v2_5" />
            </Field>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ Cartesia voice library */

function CartesiaVoicePicker({
  value,
  onChange,
  enabled,
  model,
  speed,
  sample,
}: {
  value: string
  onChange: (id: string) => void
  enabled: boolean
  model: string
  speed: number
  sample: string
}) {
  const [q, setQ] = useState('')
  const [british, setBritish] = useState(true)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const search = useDebounced(q, 400)
  const { data, isLoading, error } = useQuery({
    queryKey: ['voices', 'cartesia', search, british],
    queryFn: () => get<CartesiaVoice[]>('/voices/cartesia', { q: search, british }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const selected = data?.find((v) => v.id === value)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // When switching to Cartesia, pick the first matching voice so a valid ID is always saved.
  useEffect(() => {
    if (data?.length && (!value || value.startsWith('aura-'))) onChangeRef.current(data[0].id)
  }, [data, value])

  async function togglePreview(v: CartesiaVoice) {
    if (playingId === v.id) {
      playing?.pause()
      setPlayingId(null)
      return
    }
    try {
      // Cartesia's own sample clip when it has one, otherwise a short line spoken by that voice
      let src = v.preview_url
      if (!src) {
        setLoadingId(v.id)
        src = await fetchPreview({ provider: 'cartesia', voice: v.id, model, speed, text: sample })
      }
      playAudio(src, () => setPlayingId(null))
      setPlayingId(v.id)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs flex-1"
          placeholder="Search voices (e.g. warm, young, receptionist)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          disabled={!enabled}
        />
        <Switch checked={british} onChange={setBritish} label="British only" />
      </div>
      <div className="scroll-thin mt-3 max-h-72 overflow-y-auto rounded-xl border border-slate-200">
        {!enabled ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Add CARTESIA_API_KEY to browse Cartesia’s voices.</p>
        ) : isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-center text-sm text-red-700">{errorMessage(error)}</p>
        ) : !data?.length ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No voices match. Try another search.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((v) => (
              <li key={v.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onChange(v.id)}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onChange(v.id)}
                  className={clsx(
                    'flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors',
                    v.id === value ? 'bg-teal-50' : 'hover:bg-slate-50',
                  )}
                >
                  <span
                    className={clsx(
                      'grid size-4 shrink-0 place-items-center rounded-full border',
                      v.id === value ? 'border-teal-600' : 'border-slate-300',
                    )}
                  >
                    {v.id === value && <span className="size-2 rounded-full bg-teal-600" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {v.name}
                      {v.tagline && <span className="font-normal text-slate-500"> · {v.tagline}</span>}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{v.accent || v.description}</span>
                  </span>
                  <button
                    type="button"
                    aria-label={playingId === v.id ? `Stop ${v.name}` : `Play ${v.name}`}
                    disabled={loadingId === v.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      void togglePreview(v)
                    }}
                    className="grid size-8 shrink-0 place-items-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  >
                    {loadingId === v.id ? (
                      <Spinner className="size-3.5" />
                    ) : playingId === v.id ? (
                      <Pause className="size-3.5" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>Selected:</span>
        <span className="font-semibold text-slate-800">{selected?.name ?? 'custom voice'}</span>
        <Input
          className="h-7 max-w-[300px] font-mono text-[11px]"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="or paste any Cartesia voice ID"
          aria-label="Cartesia voice ID"
        />
      </div>
    </div>
  )
}
