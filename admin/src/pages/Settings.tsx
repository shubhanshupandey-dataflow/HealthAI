import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Bot, Building2, CheckCircle2, CircleDashed, Clock, KeyRound, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmButton,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Switch,
  Tabs,
  Textarea,
} from '../components/ui'
import { STT_ENGINES, VoiceCard } from '../components/VoiceSettings'
import { del, errorMessage, get, post, put } from '../lib/api'
import { fmtDate } from '../lib/format'
import type { AgentSettings, ClinicSettings, Closure, OpeningHours, SystemStatus } from '../lib/types'

type Tab = 'agent' | 'clinic' | 'hours' | 'system'

export default function Settings() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'agent'
  return (
    <>
      <PageHeader title="Settings" description="Control how the clinic runs and how the AI receptionist behaves." />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { value: 'agent', label: 'AI receptionist', icon: <Bot className="size-4" /> },
          { value: 'clinic', label: 'Clinic & booking rules', icon: <Building2 className="size-4" /> },
          { value: 'hours', label: 'Opening hours & holidays', icon: <Clock className="size-4" /> },
          { value: 'system', label: 'System & account', icon: <KeyRound className="size-4" /> },
        ]}
      />
      <div className="mt-6">
        {tab === 'agent' && <AgentTab />}
        {tab === 'clinic' && <ClinicTab />}
        {tab === 'hours' && <HoursTab />}
        {tab === 'system' && <SystemTab />}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ AI receptionist */

const MODELS = [
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite ★ (free)', hint: 'Free tier. Fastest replies - recommended for calls.' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (free)', hint: 'Free tier. Smarter, a little slower to answer.' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (free)', hint: 'Free tier. Balanced speed and quality.' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (paid)', hint: 'Paid. Needs ANTHROPIC_API_KEY in .env.' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (paid)', hint: 'Paid and slower. Needs ANTHROPIC_API_KEY.' },
  { id: 'gpt-4.1-mini', label: 'OpenAI GPT-4.1 mini (paid)', hint: 'Paid. Needs OPENAI_API_KEY in .env.' },
]

const LANGUAGES = [
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en', label: 'English (any accent)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'en-AU', label: 'English (Australia)' },
  { id: 'multi', label: 'Multilingual (auto-detect)' },
]

function AgentTab() {
  const qc = useQueryClient()
  const agentQ = useQuery({ queryKey: ['settings', 'agent'], queryFn: () => get<AgentSettings>('/settings/agent') })
  const clinicQ = useQuery({ queryKey: ['settings', 'clinic'], queryFn: () => get<ClinicSettings>('/settings/clinic') })
  const { data: status } = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const [agent, setAgent] = useState<AgentSettings | null>(null)
  const [clinic, setClinic] = useState<ClinicSettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (agentQ.data) setAgent(agentQ.data)
  }, [agentQ.data])
  useEffect(() => {
    if (clinicQ.data) setClinic(clinicQ.data)
  }, [clinicQ.data])

  if (agentQ.error || clinicQ.error) return <ErrorBlock message={errorMessage(agentQ.error ?? clinicQ.error)} />
  if (!agent || !clinic) return <LoadingBlock />

  const setA = <K extends keyof AgentSettings>(key: K, value: AgentSettings[K]) => setAgent({ ...agent, [key]: value })
  const setC = <K extends keyof ClinicSettings>(key: K, value: ClinicSettings[K]) => setClinic({ ...clinic, [key]: value })
  const customModel = !MODELS.some((m) => m.id === agent.llm_model)
  const engine = STT_ENGINES.find((e) => e.id === agent.stt_model) ?? STT_ENGINES[0]
  const engineKeyMissing = status ? !status.keys[engine.key] : false
  const greetingText = agent.greeting
    .replaceAll('{clinic_name}', clinic.name)
    .replaceAll('{agent_name}', agent.agent_name)

  async function save() {
    if (!agent || !clinic) return
    setSaving(true)
    try {
      await put('/settings/agent', agent)
      await put('/settings/clinic', {
        knowledge_base: clinic.knowledge_base,
        emergency_info: clinic.emergency_info,
        transfer_number: clinic.transfer_number,
      })
      toast.success('Saved - changes apply from the next call')
      qc.invalidateQueries({ queryKey: ['settings'] })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader title="Personality" description="Who callers speak to and how she sounds." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Receptionist name">
              <Input value={agent.agent_name} onChange={(e) => setA('agent_name', e.target.value)} />
            </Field>
            <Field label="Max call length (minutes)">
              <Input
                type="number"
                min={2}
                max={60}
                value={agent.max_call_minutes}
                onChange={(e) => setA('max_call_minutes', Number(e.target.value))}
              />
            </Field>
            <Field
              label="Greeting"
              className="sm:col-span-2"
              hint="Spoken instantly when the call connects. You can use {clinic_name} and {agent_name}."
            >
              <Textarea value={agent.greeting} onChange={(e) => setA('greeting', e.target.value)} rows={2} />
            </Field>
            <Field label="Style & extra instructions" className="sm:col-span-2" hint="Tone of voice, phrases to use or avoid, house rules.">
              <Textarea value={agent.personality} onChange={(e) => setA('personality', e.target.value)} rows={4} />
            </Field>
          </div>
        </Card>

        <VoiceCard agent={agent} setAgent={setAgent} status={status} greeting={greetingText} />

        <Card>
          <CardHeader title="Knowledge" description="What the receptionist knows beyond your treatments, doctors and hours." />
          <div className="space-y-4 p-5">
            <Field label="FAQs: parking, payment, insurance, policies…" hint="Write it like notes for a new receptionist. One fact per line works best.">
              <Textarea value={clinic.knowledge_base} onChange={(e) => setC('knowledge_base', e.target.value)} rows={8} />
            </Field>
            <Field label="Emergency guidance" hint="When to send callers to 999, A&E or NHS 111, and when to offer an emergency slot.">
              <Textarea value={clinic.emergency_info} onChange={(e) => setC('emergency_info', e.target.value)} rows={4} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Listening & brain" description="How Sophie hears callers and decides what to say." />
          <div className="space-y-4 p-5">
            <Field label="Speech recognition (speech-to-text)" hint={engine.hint}>
              <Select value={engine.id} onChange={(e) => setA('stt_model', e.target.value)}>
                {STT_ENGINES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            {engineKeyMissing && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Add {engine.key === 'cartesia' ? 'CARTESIA_API_KEY' : 'DEEPGRAM_API_KEY'} to .env and restart. Until then
                Sophie uses Deepgram Flux.
              </p>
            )}
            <Field label="Language model" hint={MODELS.find((m) => m.id === agent.llm_model)?.hint}>
              <Select value={customModel ? '__custom' : agent.llm_model} onChange={(e) => setA('llm_model', e.target.value === '__custom' ? '' : e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
                <option value="__custom">Custom model ID…</option>
              </Select>
            </Field>
            {customModel && (
              <Input value={agent.llm_model} onChange={(e) => setA('llm_model', e.target.value)} placeholder="e.g. gemini-3.8-flash" />
            )}
            <Field
              label="Caller language / accent"
              hint={agent.stt_model === 'deepgram-nova-3' ? undefined : 'Flux and Ink-2 understand every English accent.'}
            >
              <Select value={agent.stt_language} onChange={(e) => setA('stt_language', e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="What the AI may do" />
          <div className="space-y-4 p-5">
            <Switch checked={agent.allow_booking} onChange={(v) => setA('allow_booking', v)} label="Book appointments" />
            <Switch checked={agent.allow_reschedule} onChange={(v) => setA('allow_reschedule', v)} label="Reschedule appointments" />
            <Switch checked={agent.allow_cancel} onChange={(v) => setA('allow_cancel', v)} label="Cancel appointments" />
            <Switch checked={agent.allow_registration} onChange={(v) => setA('allow_registration', v)} label="Register new patients" />
            <Switch checked={agent.allow_messages} onChange={(v) => setA('allow_messages', v)} label="Take messages for the team" />
            <Switch
              checked={agent.allow_transfer}
              onChange={(v) => setA('allow_transfer', v)}
              label="Transfer phone calls to staff"
              description="Phone calls only. Needs SIP transfer enabled on your trunk."
            />
            {agent.allow_transfer && (
              <Field label="Transfer to number">
                <Input value={clinic.transfer_number} onChange={(e) => setC('transfer_number', e.target.value)} placeholder="+442079460958" />
              </Field>
            )}
          </div>
        </Card>

        <Button className="w-full" icon={<Save className="size-4" />} loading={saving} onClick={save}>
          Save receptionist settings
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ clinic */

function ClinicTab() {
  const qc = useQueryClient()
  const { data, error } = useQuery({ queryKey: ['settings', 'clinic'], queryFn: () => get<ClinicSettings>('/settings/clinic') })
  const [form, setForm] = useState<ClinicSettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (data) setForm(data)
  }, [data])
  if (error) return <ErrorBlock message={errorMessage(error)} />
  if (!form) return <LoadingBlock />
  const set = <K extends keyof ClinicSettings>(key: K, value: ClinicSettings[K]) => setForm({ ...form, [key]: value })

  async function save() {
    setSaving(true)
    try {
      await put('/settings/clinic', form)
      toast.success('Clinic settings saved')
      qc.invalidateQueries()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader title="Clinic details" description="The receptionist shares these with callers." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Clinic name" className="sm:col-span-2">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => set('website', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Timezone">
              <Input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} />
            </Field>
            <Field label="Currency symbol">
              <Input value={form.currency_symbol} onChange={(e) => set('currency_symbol', e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Booking rules" description="Applied to AI bookings." />
          <div className="space-y-4 p-5">
            <Field label="Slot interval" hint="How often appointment start times are offered.">
              <Select value={form.slot_interval_minutes} onChange={(e) => set('slot_interval_minutes', Number(e.target.value))}>
                {[5, 10, 15, 20, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    Every {m} minutes
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Minimum notice (minutes)" hint="e.g. 60 = no bookings within the next hour.">
              <Input type="number" min={0} value={form.min_notice_minutes} onChange={(e) => set('min_notice_minutes', Number(e.target.value))} />
            </Field>
            <Field label="Book up to (days ahead)">
              <Input type="number" min={1} value={form.max_days_ahead} onChange={(e) => set('max_days_ahead', Number(e.target.value))} />
            </Field>
          </div>
        </Card>
        <Button className="w-full" icon={<Save className="size-4" />} loading={saving} onClick={save}>
          Save clinic settings
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ hours & closures */

function HoursTab() {
  const qc = useQueryClient()
  const hoursQ = useQuery({ queryKey: ['settings', 'hours'], queryFn: () => get<OpeningHours[]>('/settings/hours') })
  const closuresQ = useQuery({ queryKey: ['settings', 'closures'], queryFn: () => get<Closure[]>('/settings/closures') })
  const [hours, setHours] = useState<OpeningHours[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [closure, setClosure] = useState({ date: '', reason: 'Bank holiday' })
  useEffect(() => {
    if (hoursQ.data) setHours(hoursQ.data)
  }, [hoursQ.data])
  if (hoursQ.error) return <ErrorBlock message={errorMessage(hoursQ.error)} />
  if (!hours) return <LoadingBlock />

  const update = (i: number, patch: Partial<OpeningHours>) => setHours(hours.map((h, j) => (j === i ? { ...h, ...patch } : h)))

  async function save() {
    setSaving(true)
    try {
      await put('/settings/hours', hours)
      toast.success('Opening hours saved')
      qc.invalidateQueries()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function addClosure() {
    if (!closure.date) return toast.error('Choose a date')
    try {
      await post('/settings/closures', closure)
      toast.success('Closure added')
      setClosure({ date: '', reason: 'Bank holiday' })
      qc.invalidateQueries({ queryKey: ['settings', 'closures'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Weekly opening hours" description="Doctors can only be booked while the clinic is open." />
        <div className="divide-y divide-slate-100">
          {hours.map((h, i) => (
            <div key={h.weekday} className="flex flex-wrap items-center gap-4 px-5 py-3">
              <div className="flex w-40 items-center gap-3">
                <Switch checked={h.is_open} onChange={(v) => update(i, { is_open: v })} />
                <span className="text-sm font-medium text-slate-900">{h.day}</span>
              </div>
              {h.is_open ? (
                <div className="flex items-center gap-2">
                  <Input type="time" className="h-9 w-32" value={h.open_time} onChange={(e) => update(i, { open_time: e.target.value })} />
                  <span className="text-slate-400">to</span>
                  <Input type="time" className="h-9 w-32" value={h.close_time} onChange={(e) => update(i, { close_time: e.target.value })} />
                </div>
              ) : (
                <span className="text-sm text-slate-400">Closed</span>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-3">
          <Button icon={<Save className="size-4" />} loading={saving} onClick={save}>
            Save hours
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Holidays & closures" description="Whole days the clinic is shut. The AI won't offer these dates." />
        <div className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="Date">
            <Input type="date" value={closure.date} onChange={(e) => setClosure({ ...closure, date: e.target.value })} />
          </Field>
          <Field label="Reason">
            <Input value={closure.reason} onChange={(e) => setClosure({ ...closure, reason: e.target.value })} />
          </Field>
          <Button icon={<Plus className="size-4" />} onClick={addClosure}>
            Add
          </Button>
        </div>
        {closuresQ.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {closuresQ.data.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">{fmtDate(c.date)}</p>
                  <p className="text-xs text-slate-500">{c.reason}</p>
                </div>
                <ConfirmButton
                  icon={<Trash2 className="size-4" />}
                  onConfirm={async () => {
                    await del(`/settings/closures/${c.id}`)
                    qc.invalidateQueries({ queryKey: ['settings', 'closures'] })
                  }}
                >
                  Remove
                </ConfirmButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-6 text-center text-sm text-slate-500">No upcoming closures.</p>
        )}
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ system */

const KEY_INFO: { key: keyof SystemStatus['keys']; name: string; purpose: string; env: string; required?: boolean }[] = [
  { key: 'livekit', name: 'LiveKit', purpose: 'Real-time audio rooms, phone calls and test calls', env: 'LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET', required: true },
  { key: 'deepgram', name: 'Deepgram', purpose: 'Speech-to-text (Flux / Nova-3) and the Aura-2 voice', env: 'DEEPGRAM_API_KEY', required: true },
  {
    key: 'google',
    name: 'Google Gemini',
    purpose: 'The receptionist’s brain - free tier key from aistudio.google.com/apikey (or Vertex AI)',
    env: 'GOOGLE_API_KEY  (or GOOGLE_GENAI_USE_VERTEXAI + GOOGLE_CLOUD_PROJECT)',
    required: true,
  },
  { key: 'anthropic', name: 'Anthropic (Claude)', purpose: 'Optional paid alternative language model', env: 'ANTHROPIC_API_KEY' },
  { key: 'openai', name: 'OpenAI', purpose: 'Optional paid alternative language model', env: 'OPENAI_API_KEY' },
  { key: 'elevenlabs', name: 'ElevenLabs', purpose: 'Optional premium voices', env: 'ELEVEN_API_KEY' },
  { key: 'cartesia', name: 'Cartesia', purpose: 'Optional: Ink-2 speech recognition and Sonic 3.6 voices', env: 'CARTESIA_API_KEY' },
]

function SystemTab() {
  const { data, error } = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const [pw, setPw] = useState({ current_password: '', new_password: '' })
  const [saving, setSaving] = useState(false)

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader
          title="Integrations"
          description="Keys live in the .env file on the server (never in the browser). Restart the agent after changing them."
        />
        {error && (
          <div className="p-4">
            <ErrorBlock message={errorMessage(error)} />
          </div>
        )}
        <ul className="divide-y divide-slate-100">
          {KEY_INFO.map((k) => {
            const ok = data?.keys[k.key]
            return (
              <li key={k.key} className="flex items-start gap-3 px-5 py-4">
                {ok ? <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-5 text-slate-300" />}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {k.name}
                    {k.required && !ok && <Badge tone="amber">Required</Badge>}
                    {ok && <Badge tone="green">Connected</Badge>}
                  </p>
                  <p className="text-xs text-slate-500">{k.purpose}</p>
                  <code className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{k.env}</code>
                </div>
              </li>
            )
          })}
        </ul>
        {data && (
          <div className="grid gap-2 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:grid-cols-3">
            <Info label="LiveKit URL">{data.livekit_url || '—'}</Info>
            <Info label="Gemini via">{data.gemini_via}</Info>
            <Info label="Agent dispatch">{data.agent_name ? `Explicit (${data.agent_name})` : 'Automatic'}</Info>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Change password" />
        <div className="space-y-4 p-5">
          <Field label="Current password">
            <Input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            <Input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          </Field>
          <Button
            className="w-full"
            icon={<ShieldCheck className="size-4" />}
            loading={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await post('/auth/password', pw)
                toast.success('Password changed')
                setPw({ current_password: '', new_password: '' })
              } catch (err) {
                toast.error(errorMessage(err))
              } finally {
                setSaving(false)
              }
            }}
          >
            Update password
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-slate-400">{label}</p>
      <p className="truncate text-slate-700">{children}</p>
    </div>
  )
}
