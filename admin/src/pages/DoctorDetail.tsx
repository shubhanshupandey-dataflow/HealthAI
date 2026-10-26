import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, CalendarOff, CalendarPlus, Copy, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AppointmentList, useAppointmentUI } from '../components/appointments'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmButton,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Switch,
  Tabs,
  Textarea,
} from '../components/ui'
import { del, errorMessage, get, post, put } from '../lib/api'
import { fmtDate, WEEKDAYS } from '../lib/format'
import { useServices } from '../lib/hooks'
import type { Doctor, OpeningHours, ScheduleBlock } from '../lib/types'
import { DOCTOR_COLORS } from './Doctors'

type Tab = 'hours' | 'profile' | 'timeoff' | 'upcoming'

export default function DoctorDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { openNew } = useAppointmentUI()
  const [tab, setTab] = useState<Tab>('hours')
  const { data: doctor, isLoading, error } = useQuery({
    queryKey: ['doctor', id],
    queryFn: () => get<Doctor>(`/doctors/${id}`),
  })

  if (isLoading) return <LoadingBlock />
  if (error || !doctor) return <ErrorBlock message={errorMessage(error)} />

  return (
    <>
      <Link to="/doctors" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> All doctors
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={doctor.name} color={doctor.color} size="lg" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{doctor.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
              {doctor.title}
              {doctor.is_active ? <Badge tone="green">Taking bookings</Badge> : <Badge tone="slate">Inactive</Badge>}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <ConfirmButton
            icon={<Trash2 className="size-4" />}
            onConfirm={async () => {
              try {
                const res = await del<{ deactivated: boolean }>(`/doctors/${doctor.id}`)
                toast.success(res.deactivated ? 'Doctor deactivated (history kept)' : 'Doctor deleted')
                qc.invalidateQueries()
                navigate('/doctors')
              } catch (err) {
                toast.error(errorMessage(err))
              }
            }}
          >
            Remove
          </ConfirmButton>
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => openNew({ doctor_id: doctor.id })}>
            Book with {doctor.name.split(' ').slice(-1)[0]}
          </Button>
        </div>
      </div>

      <Card>
        <div className="px-5 pt-2">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'hours', label: 'Working hours' },
              { value: 'profile', label: 'Profile & treatments' },
              { value: 'timeoff', label: `Time off (${doctor.time_off.length})` },
              { value: 'upcoming', label: `Upcoming (${doctor.upcoming_count})` },
            ]}
          />
        </div>
        {tab === 'hours' && <ScheduleEditor doctor={doctor} />}
        {tab === 'profile' && <ProfileEditor doctor={doctor} />}
        {tab === 'timeoff' && <TimeOffEditor doctor={doctor} />}
        {tab === 'upcoming' && <AppointmentList items={doctor.upcoming ?? []} showDoctor={false} empty="No upcoming appointments" />}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ schedule */

type Week = Record<number, { start_time: string; end_time: string }[]>

function toWeek(schedule: ScheduleBlock[]): Week {
  const week: Week = {}
  for (let i = 0; i < 7; i++) week[i] = []
  for (const s of schedule) week[s.weekday].push({ start_time: s.start_time, end_time: s.end_time })
  return week
}

function ScheduleEditor({ doctor }: { doctor: Doctor }) {
  const qc = useQueryClient()
  const [week, setWeek] = useState<Week>(() => toWeek(doctor.schedule))
  const [saving, setSaving] = useState(false)
  const { data: clinicHours } = useQuery({ queryKey: ['settings', 'hours'], queryFn: () => get<OpeningHours[]>('/settings/hours') })
  useEffect(() => setWeek(toWeek(doctor.schedule)), [doctor.schedule])

  const update = (day: number, shifts: Week[number]) => setWeek({ ...week, [day]: shifts })

  async function save() {
    const blocks: ScheduleBlock[] = []
    for (let d = 0; d < 7; d++) for (const s of week[d]) blocks.push({ weekday: d, ...s })
    setSaving(true)
    try {
      await put(`/doctors/${doctor.id}/schedule`, blocks)
      toast.success('Working hours saved - the AI will use them on the next call')
      qc.invalidateQueries()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="divide-y divide-slate-100">
        {WEEKDAYS.map((dayName, d) => {
          const shifts = week[d]
          const working = shifts.length > 0
          const clinic = clinicHours?.[d]
          return (
            <div key={d} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
              <div className="flex w-48 shrink-0 items-center gap-3">
                <Switch checked={working} onChange={(on) => update(d, on ? [{ start_time: '09:00', end_time: '17:00' }] : [])} />
                <div>
                  <p className="text-sm font-medium text-slate-900">{dayName}</p>
                  <p className="text-xs text-slate-400">
                    {clinic ? (clinic.is_open ? `Clinic ${clinic.open_time}–${clinic.close_time}` : 'Clinic closed') : ''}
                  </p>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                {!working && <p className="pt-1.5 text-sm text-slate-400">Not working</p>}
                {shifts.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="time"
                      className="h-9 w-32"
                      value={s.start_time}
                      onChange={(e) => update(d, shifts.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))}
                    />
                    <span className="text-slate-400">to</span>
                    <Input
                      type="time"
                      className="h-9 w-32"
                      value={s.end_time}
                      onChange={(e) => update(d, shifts.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))}
                    />
                    <button
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      aria-label="Remove shift"
                      onClick={() => update(d, shifts.filter((_, j) => j !== i))}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1 sm:pt-0.5">
                {working && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                      const last = shifts[shifts.length - 1]
                      update(d, [...shifts, { start_time: last?.end_time ?? '14:00', end_time: '18:00' }])
                    }}
                  >
                    Split shift
                  </Button>
                )}
                {working && d === 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy className="size-4" />}
                    onClick={() => {
                      const next = { ...week }
                      for (let x = 1; x < 5; x++) next[x] = shifts.map((s) => ({ ...s }))
                      setWeek(next)
                    }}
                  >
                    Copy to Tue–Fri
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-5 py-3">
        <p className="text-xs text-slate-500">Bookings are only offered when both the doctor and the clinic are open.</p>
        <Button icon={<Save className="size-4" />} loading={saving} onClick={save}>
          Save hours
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ profile */

function ProfileEditor({ doctor }: { doctor: Doctor }) {
  const qc = useQueryClient()
  const { data: services = [] } = useServices()
  const [form, setForm] = useState({
    name: doctor.name,
    title: doctor.title,
    email: doctor.email,
    phone: doctor.phone,
    bio: doctor.bio,
    color: doctor.color,
    is_active: doctor.is_active,
    service_ids: doctor.service_ids,
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await put(`/doctors/${doctor.id}`, form)
      toast.success('Profile saved')
      qc.invalidateQueries()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Role / specialty">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Bio" className="sm:col-span-2" hint="The AI can use this to describe the doctor to callers.">
          <Textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
        </Field>
        <Field label="Calendar colour">
          <div className="flex flex-wrap gap-2">
            {DOCTOR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setForm({ ...form, color: c })}
                className={clsx('size-7 rounded-full ring-offset-2', form.color === c && 'ring-2 ring-slate-900')}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
        <div className="pt-6">
          <Switch
            checked={form.is_active}
            onChange={(v) => setForm({ ...form, is_active: v })}
            label="Taking bookings"
            description="Inactive doctors are hidden from the AI and the calendar."
          />
        </div>
      </div>
      <Field label="Treatments this doctor provides">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => (
            <label key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-teal-600"
                checked={form.service_ids.includes(s.id)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    service_ids: e.target.checked ? [...form.service_ids, s.id] : form.service_ids.filter((x) => x !== s.id),
                  })
                }
              />
              <span className={clsx(!s.is_active && 'text-slate-400 line-through')}>{s.name}</span>
            </label>
          ))}
        </div>
      </Field>
      <div className="flex justify-end">
        <Button icon={<Save className="size-4" />} loading={saving} onClick={save}>
          Save profile
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ time off */

function TimeOffEditor({ doctor }: { doctor: Doctor }) {
  const qc = useQueryClient()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('Annual leave')
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!start) return toast.error('Choose a start date')
    setSaving(true)
    try {
      await post(`/doctors/${doctor.id}/time-off`, { start_date: start, end_date: end || start, reason })
      toast.success('Time off added - the AI won’t offer those days')
      setStart('')
      setEnd('')
      qc.invalidateQueries()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-5">
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <Field label="From">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Button icon={<Plus className="size-4" />} loading={saving} onClick={add}>
          Add
        </Button>
      </div>
      <Card className="mt-4">
        <CardHeader title="Upcoming time off" />
        {doctor.time_off.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500">No time off booked.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {doctor.time_off.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                <CalendarOff className="size-4 text-amber-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900">
                    {fmtDate(t.start_date)}
                    {t.end_date !== t.start_date && ` → ${fmtDate(t.end_date)}`}
                  </p>
                  <p className="text-xs text-slate-500">{t.reason}</p>
                </div>
                <ConfirmButton
                  icon={<Trash2 className="size-4" />}
                  onConfirm={async () => {
                    await del(`/doctors/${doctor.id}/time-off/${t.id}`)
                    qc.invalidateQueries()
                  }}
                >
                  Remove
                </ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
