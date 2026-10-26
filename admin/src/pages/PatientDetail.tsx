import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarPlus, Cake, Mail, MapPin, Mic, Pencil, Phone, PhoneIncoming, StickyNote, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AppointmentList, useAppointmentUI } from '../components/appointments'
import { PatientFormModal } from '../components/PatientForm'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CategoryBadge,
  ConfirmButton,
  ErrorBlock,
  LoadingBlock,
  SourceBadge,
  Tabs,
} from '../components/ui'
import { del, errorMessage, get } from '../lib/api'
import { age, fmtAgo, fmtDate, fmtDuration, fmtMoney } from '../lib/format'
import { useClinic } from '../lib/hooks'
import type { PatientDetail as PatientDetailData } from '../lib/types'

type Tab = 'upcoming' | 'history' | 'calls' | 'messages'

export default function PatientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { openNew } = useAppointmentUI()
  const { data: clinic } = useClinic()
  const [tab, setTab] = useState<Tab>('upcoming')
  const [editing, setEditing] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => get<PatientDetailData>(`/patients/${id}`),
  })

  if (isLoading) return <LoadingBlock />
  if (error || !data) return <ErrorBlock message={errorMessage(error)} />
  const p = data.patient

  return (
    <>
      <Link to="/patients" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> All patients
      </Link>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={p.full_name} color="#1b5e96" size="lg" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{p.full_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span>Patient #{p.id}</span>
              <span>·</span>
              <span>Registered {fmtDate(p.created_at)}</span>
              {p.source === 'ai_agent' && <SourceBadge source="ai_agent" />}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            icon={<Trash2 className="size-4" />}
            onConfirm={async () => {
              try {
                await del(`/patients/${p.id}`)
                toast.success('Patient deleted')
                qc.invalidateQueries()
                navigate('/patients')
              } catch (err) {
                toast.error(errorMessage(err))
              }
            }}
          >
            Delete
          </ConfirmButton>
          <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            icon={<CalendarPlus className="size-4" />}
            onClick={() => openNew({ patient: { id: p.id, name: p.full_name, phone: p.phone } })}
          >
            Book appointment
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Contact & details" />
            <dl className="space-y-4 px-5 py-4 text-sm">
              <Row icon={<Phone className="size-4" />} label="Phone">
                {p.phone ? <a href={`tel:${p.phone}`} className="text-teal-700 hover:underline">{p.phone}</a> : '—'}
              </Row>
              <Row icon={<Mail className="size-4" />} label="Email">
                {p.email ? <a href={`mailto:${p.email}`} className="break-all text-teal-700 hover:underline">{p.email}</a> : '—'}
              </Row>
              <Row icon={<Cake className="size-4" />} label="Date of birth">
                {p.date_of_birth ? `${fmtDate(p.date_of_birth)} (${age(p.date_of_birth)} years)` : '—'}
              </Row>
              <Row icon={<MapPin className="size-4" />} label="Address">
                {p.address || '—'}
              </Row>
              <Row icon={<StickyNote className="size-4" />} label="Notes">
                <span className="whitespace-pre-wrap">{p.notes || '—'}</span>
              </Row>
            </dl>
          </Card>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Visits completed" value={data.stats.completed} />
            <MiniStat label="Lifetime value" value={fmtMoney(data.stats.lifetime_value, clinic?.currency_symbol, '')} />
            <MiniStat label="Cancelled" value={data.stats.cancelled} />
            <MiniStat label="No-shows" value={data.stats.no_show} />
          </div>
        </div>

        <Card className="lg:col-span-2">
          <div className="px-5 pt-2">
            <Tabs<Tab>
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'upcoming', label: `Upcoming (${data.upcoming.length})` },
                { value: 'history', label: `Past & cancelled (${data.history.length})` },
                { value: 'calls', label: `Calls (${data.calls.length})` },
                { value: 'messages', label: `Messages (${data.messages.length})` },
              ]}
            />
          </div>
          {tab === 'upcoming' && <AppointmentList items={data.upcoming} showPatient={false} empty="No upcoming appointments" />}
          {tab === 'history' && <AppointmentList items={data.history} showPatient={false} empty="No past appointments" />}
          {tab === 'calls' &&
            (data.calls.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No calls with the AI receptionist yet</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.calls.map((c) => (
                  <li key={c.id}>
                    <Link to={`/calls?call=${c.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                      <span className="grid size-9 place-items-center rounded-full bg-violet-50 text-violet-600">
                        {c.channel === 'phone' ? <PhoneIncoming className="size-4" /> : <Mic className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">{fmtDate(c.started_at)}</p>
                        <p className="text-xs text-slate-500">
                          {fmtAgo(c.started_at)} · {fmtDuration(c.duration_seconds)}
                        </p>
                      </div>
                      <Badge tone="slate">{c.outcome || c.status}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          {tab === 'messages' &&
            (data.messages.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">No messages</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.messages.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={m.status === 'new' ? 'amber' : 'green'}>{m.status === 'new' ? 'Open' : 'Done'}</Badge>
                      <CategoryBadge category={m.category} />
                      {m.urgency === 'urgent' && <Badge tone="red">Urgent</Badge>}
                      <span className="ml-auto text-xs text-slate-400">{fmtAgo(m.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{m.message}</p>
                  </li>
                ))}
              </ul>
            ))}
        </Card>
      </div>
      {editing && <PatientFormModal patient={p} onClose={() => setEditing(false)} />}
    </>
  )
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
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

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 tabular-nums">{value}</p>
    </Card>
  )
}
