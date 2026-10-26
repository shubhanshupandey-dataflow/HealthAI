import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { addDays, format, parseISO } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppointmentUI } from '../components/appointments'
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Segmented,
  Select,
  SourceBadge,
  StatusBadge,
  Table,
  Td,
  Th,
} from '../components/ui'
import { errorMessage, get } from '../lib/api'
import { clinicNow, clinicToday, fmtDate, fmtMoney, fmtTime, isClinicToday, isoDate, minutesOf } from '../lib/format'
import { useClinic, useDebounced, useDoctors } from '../lib/hooks'
import type { Appointment, CalendarDay } from '../lib/types'

const PX_PER_MIN = 1.25

export default function Appointments() {
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as 'calendar' | 'list') || 'calendar'
  const date = params.get('date') || clinicToday()
  const { openNew } = useAppointmentUI()

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) next.set(k, v)
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        description="See every booking across doctors, move things around and book new patients in."
        actions={
          <>
            <Segmented
              value={view}
              onChange={(v) => update({ view: v })}
              options={[
                { value: 'calendar', label: 'Calendar', icon: <CalendarDays className="size-4" /> },
                { value: 'list', label: 'List', icon: <List className="size-4" /> },
              ]}
            />
            <Button icon={<Plus className="size-4" />} onClick={() => openNew({ date })}>
              New appointment
            </Button>
          </>
        }
      />
      {view === 'calendar' ? <CalendarView date={date} onDate={(d) => update({ date: d })} /> : <ListView />}
    </>
  )
}

/* ------------------------------------------------------------------ calendar */

function CalendarView({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const { openNew, openDetails } = useAppointmentUI()
  const { data, isLoading, error } = useQuery({
    queryKey: ['calendar', date],
    queryFn: () => get<CalendarDay>('/calendar', { date }),
    refetchInterval: 30_000,
  })
  const [now, setNow] = useState(clinicNow())
  useEffect(() => {
    const t = setInterval(() => setNow(clinicNow()), 60_000)
    return () => clearInterval(t)
  }, [])

  const day = parseISO(date)
  const range = useMemo(() => {
    if (!data) return { start: 8 * 60, end: 18 * 60 }
    const starts: number[] = []
    const ends: number[] = []
    if (data.clinic) {
      starts.push(minutesOf(data.clinic.open))
      ends.push(minutesOf(data.clinic.close))
    }
    for (const d of data.doctors)
      for (const b of d.blocks) {
        starts.push(minutesOf(b.start))
        ends.push(minutesOf(b.end))
      }
    for (const a of data.appointments) {
      starts.push(minutesOf(fmtTime(a.start)))
      ends.push(minutesOf(fmtTime(a.end)))
    }
    if (!starts.length) return { start: 8 * 60, end: 18 * 60 }
    return { start: Math.floor(Math.min(...starts) / 60) * 60, end: Math.ceil(Math.max(...ends) / 60) * 60 }
  }, [data])

  const hours: number[] = []
  for (let m = range.start; m < range.end; m += 60) hours.push(m)
  const height = (range.end - range.start) * PX_PER_MIN
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = isClinicToday(day) && nowMin >= range.start && nowMin <= range.end

  function onColumnClick(e: MouseEvent<HTMLDivElement>, doctorId: number, blocks: { start: string; end: string }[]) {
    if ((e.target as HTMLElement).closest('[data-appt]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minute = range.start + Math.floor((e.clientY - rect.top) / PX_PER_MIN / 15) * 15
    const inShift = blocks.some((b) => minute >= minutesOf(b.start) && minute < minutesOf(b.end))
    const hh = String(Math.floor(minute / 60)).padStart(2, '0')
    const mm = String(minute % 60).padStart(2, '0')
    openNew({ date, time: inShift ? `${hh}:${mm}` : undefined, doctor_id: doctorId })
  }

  const counts = data
    ? {
        total: data.appointments.filter((a) => a.status !== 'cancelled').length,
        ai: data.appointments.filter((a) => a.source === 'ai_agent' && a.status !== 'cancelled').length,
      }
    : null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" aria-label="Previous day" onClick={() => onDate(isoDate(addDays(day, -1)))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onDate(clinicToday())}>
            Today
          </Button>
          <Button size="sm" variant="secondary" aria-label="Next day" onClick={() => onDate(isoDate(addDays(day, 1)))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <h2 className="text-base font-semibold text-slate-900">{format(day, 'EEEE d MMMM yyyy')}</h2>
        <Input type="date" value={date} onChange={(e) => e.target.value && onDate(e.target.value)} className="h-8 w-40" />
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          {counts && (
            <>
              <span>
                <strong className="text-slate-900">{counts.total}</strong> booked
              </span>
              <Badge tone="violet">{counts.ai} by AI</Badge>
            </>
          )}
          {data && !data.clinic && <Badge tone="red">Clinic closed{data.closure ? ` · ${data.closure}` : ''}</Badge>}
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <div className="p-4">
          <ErrorBlock message={errorMessage(error)} />
        </div>
      ) : data.doctors.length === 0 ? (
        <EmptyState title="No active doctors" description="Add a doctor and their working hours to start booking." />
      ) : (
        <div className="scroll-thin max-h-[calc(100vh-260px)] overflow-auto">
          <div className="flex min-w-fit">
            {/* time gutter */}
            <div className="sticky left-0 z-20 w-16 shrink-0 border-r border-slate-200 bg-white">
              <div className="sticky top-0 z-10 h-16 border-b border-slate-200 bg-white" />
              <div className="relative" style={{ height }}>
                {hours.map((m) => (
                  <span
                    key={m}
                    className="absolute right-2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums"
                    style={{ top: (m - range.start) * PX_PER_MIN }}
                  >
                    {m === range.start ? '' : `${String(m / 60).padStart(2, '0')}:00`}
                  </span>
                ))}
              </div>
            </div>

            {data.doctors.map((doc) => {
              const appts = data.appointments.filter((a) => a.doctor_id === doc.id)
              return (
                <div key={doc.id} className="w-56 shrink-0 border-r border-slate-200 last:border-r-0 sm:w-auto sm:min-w-56 sm:flex-1">
                  <div className="sticky top-0 z-10 flex h-16 items-center gap-2.5 border-b border-slate-200 bg-white px-3">
                    <Avatar name={doc.name} color={doc.color} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{doc.name}</p>
                      <p className="truncate text-xs text-slate-500">
                        {doc.off ? 'Away today' : doc.blocks.length ? doc.blocks.map((b) => `${b.start}–${b.end}`).join(', ') : 'Not working'}
                      </p>
                    </div>
                  </div>
                  <div
                    className="relative cursor-pointer bg-[repeating-linear-gradient(135deg,#f8fafc_0,#f8fafc_6px,#f1f5f9_6px,#f1f5f9_12px)]"
                    style={{ height }}
                    onClick={(e) => onColumnClick(e, doc.id, doc.off ? [] : doc.blocks)}
                  >
                    {!doc.off &&
                      doc.blocks.map((b) => (
                        <div
                          key={b.start}
                          className="absolute inset-x-0 bg-white"
                          style={{
                            top: (minutesOf(b.start) - range.start) * PX_PER_MIN,
                            height: (minutesOf(b.end) - minutesOf(b.start)) * PX_PER_MIN,
                          }}
                        />
                      ))}
                    {hours.map((m) => (
                      <div key={m}>
                        <div className="absolute inset-x-0 border-t border-slate-200" style={{ top: (m - range.start) * PX_PER_MIN }} />
                        <div
                          className="absolute inset-x-0 border-t border-dashed border-slate-100"
                          style={{ top: (m + 30 - range.start) * PX_PER_MIN }}
                        />
                      </div>
                    ))}
                    {appts.map((a) => (
                      <AppointmentBlock key={a.id} appt={a} rangeStart={range.start} onClick={() => openDetails(a)} />
                    ))}
                    {showNow && (
                      <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500" style={{ top: (nowMin - range.start) * PX_PER_MIN }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}

function AppointmentBlock({ appt, rangeStart, onClick }: { appt: Appointment; rangeStart: number; onClick: () => void }) {
  const start = minutesOf(fmtTime(appt.start))
  const end = minutesOf(fmtTime(appt.end))
  const h = Math.max(22, (end - start) * PX_PER_MIN - 2)
  const cancelled = appt.status === 'cancelled'
  return (
    <button
      data-appt
      onClick={onClick}
      title={`${appt.patient_name} · ${appt.service_name}`}
      className={clsx(
        'absolute inset-x-1 z-[5] overflow-hidden rounded-md border-l-4 px-2 py-1 text-left text-xs shadow-sm transition-shadow hover:shadow-md',
        cancelled && 'opacity-50',
        appt.status === 'no_show' && 'border-dashed',
      )}
      style={{
        top: (start - rangeStart) * PX_PER_MIN + 1,
        height: h,
        background: `${appt.doctor_color}1a`,
        borderLeftColor: appt.doctor_color,
      }}
    >
      <p className={clsx('truncate font-semibold text-slate-900', cancelled && 'line-through')}>
        {fmtTime(appt.start)} {appt.patient_name}
      </p>
      {h > 36 && <p className="truncate text-slate-600">{appt.service_name}</p>}
      {h > 54 && (
        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-500">
          {appt.source === 'ai_agent' && <span className="font-semibold text-violet-600">AI</span>}
          {appt.status.replace('_', '-')}
        </p>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------ list */

function ListView() {
  const { openDetails } = useAppointmentUI()
  const { data: doctors = [] } = useDoctors()
  const { data: clinic } = useClinic()
  const [from, setFrom] = useState(clinicToday())
  const [to, setTo] = useState(isoDate(addDays(clinicNow(), 30)))
  const [doctorId, setDoctorId] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [q, setQ] = useState('')
  const search = useDebounced(q)

  const { data, isLoading, error } = useQuery({
    queryKey: ['appointments', from, to, doctorId, status, source, search],
    queryFn: () =>
      get<Appointment[]>('/appointments', {
        date_from: from,
        date_to: to,
        doctor_id: doctorId,
        status,
        source,
        search,
      }),
  })

  return (
    <Card>
      <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search patient name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Doctor">
          <option value="">All doctors</option>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="scheduled,confirmed">Upcoming</option>
            <option value="scheduled">Scheduled</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No-show</option>
          </Select>
          <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Booked by">
            <option value="">AI + staff</option>
            <option value="ai_agent">AI only</option>
            <option value="admin">Staff only</option>
          </Select>
        </div>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <div className="p-4">
          <ErrorBlock message={errorMessage(error)} />
        </div>
      ) : !data?.length ? (
        <EmptyState icon={<CalendarDays className="size-5" />} title="No appointments match these filters" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Patient</Th>
              <Th>Treatment</Th>
              <Th>Doctor</Th>
              <Th>Status</Th>
              <Th>Booked by</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => openDetails(a)}>
                <Td>
                  <p className="font-medium text-slate-900">{fmtDate(a.start)}</p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {fmtTime(a.start)}–{fmtTime(a.end)}
                  </p>
                </Td>
                <Td>
                  <p className="font-medium text-slate-900">{a.patient_name}</p>
                  <p className="text-xs text-slate-500">{a.patient_phone}</p>
                </Td>
                <Td>
                  <p className="text-slate-800">{a.service_name}</p>
                  <p className="text-xs text-slate-500">{fmtMoney(a.price, clinic?.currency_symbol)}</p>
                </Td>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: a.doctor_color }} />
                    {a.doctor_name}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>
                  <SourceBadge source={a.source} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {data && data.length > 0 && (
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">{data.length} appointments</p>
      )}
    </Card>
  )
}
