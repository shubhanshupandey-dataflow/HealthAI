import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Clock,
  Pencil,
  Phone,
  Plus,
  Sparkles,
  Stethoscope,
  Trash2,
  UserRound,
  XCircle,
} from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { del, errorMessage, get, post, put } from '../lib/api'
import { clinicToday, fmtDate, fmtDateTime, fmtMoney, fmtTime } from '../lib/format'
import { useClinic, useDebounced, useDoctors, useServices } from '../lib/hooks'
import type { Appointment, AppointmentStatus, Paged, Patient, Slot } from '../lib/types'
import {
  Badge,
  Button,
  ConfirmButton,
  ErrorBlock,
  Field,
  Input,
  Modal,
  Select,
  SourceBadge,
  Spinner,
  StatusBadge,
  Switch,
  Textarea,
} from './ui'

/* ------------------------------------------------------------------ context */

export interface NewAppointmentDefaults {
  patient?: PickedPatient
  date?: string
  time?: string
  doctor_id?: number
  service_id?: number
}

interface AppointmentUI {
  openNew: (defaults?: NewAppointmentDefaults) => void
  openEdit: (appt: Appointment) => void
  openDetails: (appt: Appointment) => void
}

const Ctx = createContext<AppointmentUI>({ openNew: () => {}, openEdit: () => {}, openDetails: () => {} })
export const useAppointmentUI = () => useContext(Ctx)

export function AppointmentProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<{ appt?: Appointment; defaults?: NewAppointmentDefaults } | null>(null)
  const [details, setDetails] = useState<Appointment | null>(null)
  const value = useMemo<AppointmentUI>(
    () => ({
      openNew: (defaults) => setForm({ defaults }),
      openEdit: (appt) => setForm({ appt }),
      openDetails: (appt) => setDetails(appt),
    }),
    [],
  )
  return (
    <Ctx.Provider value={value}>
      {children}
      {form && <AppointmentForm appt={form.appt} defaults={form.defaults} onClose={() => setForm(null)} />}
      {details && (
        <AppointmentDetails
          appt={details}
          onClose={() => setDetails(null)}
          onEdit={(a) => {
            setDetails(null)
            setForm({ appt: a })
          }}
        />
      )}
    </Ctx.Provider>
  )
}

/* ------------------------------------------------------------------ patient picker */

export interface PickedPatient {
  id: number
  name: string
  phone: string
}

function PatientPicker({ value, onChange }: { value: PickedPatient | null; onChange: (p: PickedPatient | null) => void }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const search = useDebounced(q)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ first_name: '', last_name: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const results = useQuery({
    queryKey: ['patients', 'picker', search],
    queryFn: () => get<Paged<Patient>>('/patients', { search, page_size: 6 }),
    enabled: !value && !creating,
  })

  if (value)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{value.name}</p>
          <p className="text-xs text-slate-500">{value.phone || 'No phone on file'}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    )

  if (creating)
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="First name" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
          <Input placeholder="Last name" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
        </div>
        <Input placeholder="Mobile number" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Back to search
          </Button>
          <Button
            size="sm"
            loading={saving}
            disabled={!draft.first_name.trim()}
            onClick={async () => {
              setSaving(true)
              try {
                const p = await post<Patient>('/patients', draft)
                qc.invalidateQueries({ queryKey: ['patients'] })
                onChange({ id: p.id, name: p.full_name, phone: p.phone })
                setCreating(false)
              } catch (err) {
                toast.error(errorMessage(err))
              } finally {
                setSaving(false)
              }
            }}
          >
            Create patient
          </Button>
        </div>
      </div>
    )

  return (
    <div>
      <Input placeholder="Search patients by name or phone…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="scroll-thin mt-2 max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {results.isLoading && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {results.data?.items.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange({ id: p.id, name: p.full_name, phone: p.phone })}
            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
          >
            <span className="truncate text-sm font-medium text-slate-800">{p.full_name}</span>
            <span className="shrink-0 text-xs text-slate-500">{p.phone}</span>
          </button>
        ))}
        {results.data && results.data.items.length === 0 && (
          <p className="px-3 py-3 text-sm text-slate-500">No patients match "{search}".</p>
        )}
        <button
          type="button"
          onClick={() => {
            const [first, ...rest] = q.trim().split(/\s+/)
            setDraft({ first_name: /\d/.test(q) ? '' : first ?? '', last_name: /\d/.test(q) ? '' : rest.join(' '), phone: /\d/.test(q) ? q : '' })
            setCreating(true)
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-teal-700 hover:bg-teal-50"
        >
          <Plus className="size-4" /> New patient
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ booking form */

function AppointmentForm({
  appt,
  defaults,
  onClose,
}: {
  appt?: Appointment
  defaults?: NewAppointmentDefaults
  onClose: () => void
}) {
  const qc = useQueryClient()
  const editing = !!appt
  const { data: services = [] } = useServices()
  const { data: doctors = [] } = useDoctors()
  const { data: clinic } = useClinic()

  const [patient, setPatient] = useState<PickedPatient | null>(
    appt ? { id: appt.patient_id, name: appt.patient_name, phone: appt.patient_phone } : defaults?.patient ?? null,
  )
  const [serviceId, setServiceId] = useState<number | ''>(appt?.service_id ?? defaults?.service_id ?? '')
  const [doctorId, setDoctorId] = useState<number | ''>(appt?.doctor_id ?? defaults?.doctor_id ?? '')
  const [date, setDate] = useState(appt ? appt.start.slice(0, 10) : defaults?.date ?? clinicToday())
  const [slot, setSlot] = useState<{ start: string; doctor_id: number } | null>(
    appt ? { start: appt.start, doctor_id: appt.doctor_id } : null,
  )
  const [custom, setCustom] = useState(false)
  const [customTime, setCustomTime] = useState(defaults?.time ?? (appt ? fmtTime(appt.start) : '09:00'))
  const [force, setForce] = useState(false)
  const [notes, setNotes] = useState(appt?.notes ?? '')
  const [status, setStatus] = useState<AppointmentStatus>(appt?.status ?? 'scheduled')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const activeServices = services.filter((s) => s.is_active || s.id === appt?.service_id)
  const eligibleDoctors = doctors.filter(
    (d) => (d.is_active || d.id === appt?.doctor_id) && (!serviceId || d.service_ids.includes(Number(serviceId))),
  )
  const service = services.find((s) => s.id === serviceId)

  const slotsQuery = useQuery({
    queryKey: ['availability', date, serviceId, doctorId, appt?.id],
    queryFn: () =>
      get<Slot[]>('/availability', {
        date,
        service_id: serviceId,
        doctor_id: doctorId || undefined,
        exclude_appointment_id: appt?.id,
      }),
    enabled: !!serviceId && !!date && !custom,
  })
  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slotsQuery.data ?? []) map.set(s.start, [...(map.get(s.start) ?? []), s])
    return [...map.entries()]
  }, [slotsQuery.data])

  // Pre-select a time when opened from an empty calendar cell
  useEffect(() => {
    if (!defaults?.time || slot || !slotsQuery.data) return
    const match = slotsQuery.data.find(
      (s) => fmtTime(s.start) === defaults.time && (!defaults.doctor_id || s.doctor_id === defaults.doctor_id),
    )
    if (match) setSlot({ start: match.start, doctor_id: match.doctor_id })
  }, [slotsQuery.data, defaults, slot])

  const slotOptions = slot ? grouped.find(([start]) => start === slot.start)?.[1] ?? [] : []

  async function save() {
    setError('')
    if (!patient) return setError('Choose a patient.')
    if (!serviceId) return setError('Choose a treatment.')
    let start: string
    let doctor: number
    if (custom) {
      if (!doctorId) return setError('Choose a doctor for a custom time.')
      start = `${date}T${customTime}:00`
      doctor = Number(doctorId)
    } else {
      if (!slot) return setError('Pick one of the available times.')
      start = slot.start
      doctor = slot.doctor_id
    }
    const body = {
      patient_id: patient.id,
      doctor_id: doctor,
      service_id: Number(serviceId),
      start,
      notes,
      status,
      force: custom && force,
    }
    setSaving(true)
    try {
      if (editing) await put(`/appointments/${appt.id}`, body)
      else await post('/appointments', body)
      toast.success(editing ? 'Appointment updated' : 'Appointment booked')
      qc.invalidateQueries()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit appointment' : 'New appointment'}
      description={editing ? `${appt.patient_name} · ${appt.service_name}` : 'Book a patient in with a doctor.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} loading={saving}>
            {editing ? 'Save changes' : 'Book appointment'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Patient">
          {editing ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{appt.patient_name}</div>
          ) : (
            <PatientPicker value={patient} onChange={setPatient} />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Treatment">
            <Select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value ? Number(e.target.value) : '')
                setSlot(null)
              }}
            >
              <option value="">Choose a treatment…</option>
              {activeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.duration_minutes} min · {fmtMoney(s.price, clinic?.currency_symbol)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Doctor">
            <Select
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value ? Number(e.target.value) : '')
                setSlot(null)
              }}
            >
              <option value="">Any available doctor</option>
              {eligibleDoctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.title}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setSlot(null)
              }}
            />
          </Field>
          {editing && (
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as AppointmentStatus)}>
                <option value="scheduled">Scheduled</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="no_show">No-show</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </Field>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Time</span>
            <button type="button" className="text-xs font-medium text-teal-700 hover:underline" onClick={() => setCustom(!custom)}>
              {custom ? 'Show available slots' : 'Enter a custom time'}
            </button>
          </div>
          {custom ? (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3">
              <Input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} className="max-w-40" />
              <Switch
                checked={force}
                onChange={setForce}
                label="Override availability checks"
                description="Allow booking outside working hours or over another appointment."
              />
            </div>
          ) : !serviceId ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              Choose a treatment to see free times.
            </p>
          ) : slotsQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : grouped.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              No free times on {fmtDate(date)}. Try another day or doctor.
            </p>
          ) : (
            <>
              <div className="scroll-thin grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
                {grouped.map(([start, list]) => {
                  const selected = slot?.start === start
                  return (
                    <button
                      key={start}
                      type="button"
                      onClick={() => setSlot({ start, doctor_id: list[0].doctor_id })}
                      className={clsx(
                        'rounded-lg border px-2 py-2 text-sm font-medium tabular-nums transition-colors',
                        selected
                          ? 'border-teal-600 bg-teal-600 text-white'
                          : 'border-slate-200 text-slate-700 hover:border-teal-400 hover:bg-teal-50',
                      )}
                    >
                      {fmtTime(start)}
                      {!doctorId && list.length > 1 && (
                        <span className={clsx('block text-[10px] font-normal', selected ? 'text-teal-100' : 'text-slate-400')}>
                          {list.length} free
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {slot && slotOptions.length > 0 && (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                  <Stethoscope className="size-4 text-slate-400" />
                  with
                  <Select
                    className="h-8 max-w-xs"
                    value={slot.doctor_id}
                    onChange={(e) => setSlot({ start: slot.start, doctor_id: Number(e.target.value) })}
                  >
                    {slotOptions.map((s) => (
                      <option key={s.doctor_id} value={s.doctor_id}>
                        {s.doctor_name}
                      </option>
                    ))}
                  </Select>
                  {service && <span className="text-slate-400">· {service.duration_minutes} min</span>}
                </div>
              )}
            </>
          )}
        </div>

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the doctor should know…" />
        </Field>
        {error && <ErrorBlock message={error} />}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ details */

function AppointmentDetails({
  appt: initial,
  onClose,
  onEdit,
}: {
  appt: Appointment
  onClose: () => void
  onEdit: (a: Appointment) => void
}) {
  const qc = useQueryClient()
  const { data: clinic } = useClinic()
  const { data: appt = initial } = useQuery({
    queryKey: ['appointment', initial.id],
    queryFn: () => get<Appointment>(`/appointments/${initial.id}`),
    initialData: initial,
  })
  const [busy, setBusy] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)

  async function setStatus(status: AppointmentStatus, extra: Record<string, string> = {}) {
    setBusy(status)
    try {
      await put(`/appointments/${appt.id}`, { status, ...extra })
      toast.success(`Marked as ${status.replace('_', '-')}`)
      qc.invalidateQueries()
      setShowCancel(false)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const upcoming = appt.status === 'scheduled' || appt.status === 'confirmed'
  return (
    <Modal
      open
      onClose={onClose}
      side
      title={appt.service_name}
      description={`${fmtDate(appt.start)} · ${fmtTime(appt.start)}–${fmtTime(appt.end)}`}
      footer={
        <>
          <ConfirmButton
            icon={<Trash2 className="size-4" />}
            loading={busy === 'delete'}
            onConfirm={async () => {
              setBusy('delete')
              try {
                await del(`/appointments/${appt.id}`)
                toast.success('Appointment deleted')
                qc.invalidateQueries()
                onClose()
              } catch (err) {
                toast.error(errorMessage(err))
                setBusy(null)
              }
            }}
          >
            Delete
          </ConfirmButton>
          <div className="flex-1" />
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => onEdit(appt)}>
            Edit / reschedule
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={appt.status} />
          <SourceBadge source={appt.source} />
          {appt.call_id && (
            <Link to={`/calls?call=${appt.call_id}`} onClick={onClose}>
              <Badge tone="violet">
                <Sparkles className="size-3" /> Booked on AI call #{appt.call_id}
              </Badge>
            </Link>
          )}
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <Detail icon={<UserRound className="size-4" />} label="Patient">
            <Link to={`/patients/${appt.patient_id}`} onClick={onClose} className="font-medium text-teal-700 hover:underline">
              {appt.patient_name}
            </Link>
          </Detail>
          <Detail icon={<Phone className="size-4" />} label="Phone">
            {appt.patient_phone ? <a href={`tel:${appt.patient_phone}`}>{appt.patient_phone}</a> : '—'}
          </Detail>
          <Detail icon={<Stethoscope className="size-4" />} label="Doctor">
            <span className="inline-flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: appt.doctor_color }} />
              {appt.doctor_name}
            </span>
          </Detail>
          <Detail icon={<Clock className="size-4" />} label="Price">
            {fmtMoney(appt.price, clinic?.currency_symbol)}
          </Detail>
          <Detail icon={<CalendarClock className="size-4" />} label="Booked">
            {fmtDateTime(appt.created_at)}
          </Detail>
        </dl>

        {appt.notes && (
          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Notes</p>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-700">{appt.notes}</p>
          </div>
        )}
        {appt.status === 'cancelled' && appt.cancel_reason && (
          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
            Cancelled: {appt.cancel_reason}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Update status</p>
          <div className="flex flex-wrap gap-2">
            {appt.status === 'scheduled' && (
              <Button size="sm" variant="subtle" loading={busy === 'confirmed'} onClick={() => setStatus('confirmed')} icon={<CheckCircle2 className="size-4" />}>
                Confirm
              </Button>
            )}
            {appt.status !== 'completed' && (
              <Button size="sm" variant="secondary" loading={busy === 'completed'} onClick={() => setStatus('completed')} icon={<CheckCircle2 className="size-4 text-emerald-600" />}>
                Completed
              </Button>
            )}
            {appt.status !== 'no_show' && (
              <Button size="sm" variant="secondary" loading={busy === 'no_show'} onClick={() => setStatus('no_show')} icon={<CircleSlash className="size-4 text-amber-600" />}>
                No-show
              </Button>
            )}
            {upcoming && (
              <Button size="sm" variant="secondary" onClick={() => setShowCancel(!showCancel)} icon={<XCircle className="size-4 text-red-600" />}>
                Cancel…
              </Button>
            )}
            {!upcoming && appt.status !== 'completed' && (
              <Button size="sm" variant="ghost" loading={busy === 'scheduled'} onClick={() => setStatus('scheduled')}>
                Re-open
              </Button>
            )}
          </div>
          {showCancel && (
            <div className="mt-3 flex gap-2">
              <Input placeholder="Reason (optional)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              <Button variant="danger" loading={busy === 'cancelled'} onClick={() => setStatus('cancelled', { cancel_reason: cancelReason || 'Cancelled by staff' })}>
                Cancel appointment
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function Detail({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="mt-0.5 text-slate-800">{children}</dd>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ list */

export function AppointmentList({
  items,
  showPatient = true,
  showDoctor = true,
  empty = 'No appointments',
}: {
  items: Appointment[]
  showPatient?: boolean
  showDoctor?: boolean
  empty?: string
}) {
  const { openDetails } = useAppointmentUI()
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-slate-500">{empty}</p>
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((a) => (
        <li key={a.id}>
          <button
            onClick={() => openDetails(a)}
            className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <div className="w-20 shrink-0 whitespace-nowrap">
              <p className="text-sm font-semibold text-slate-900 tabular-nums">{fmtTime(a.start)}</p>
              <p className="text-xs text-slate-500">{fmtDate(a.start).slice(0, -5)}</p>
            </div>
            <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: a.doctor_color }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900">
                {showPatient ? a.patient_name : a.service_name}
              </p>
              <p className="truncate text-xs text-slate-500">
                {showPatient ? a.service_name : ''}
                {showPatient && showDoctor ? ' · ' : ''}
                {showDoctor ? a.doctor_name : ''}
              </p>
            </div>
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              {a.source === 'ai_agent' && <SourceBadge source={a.source} />}
              <StatusBadge status={a.status} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}
