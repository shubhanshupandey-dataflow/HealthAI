import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CalendarOff, Plus, Stethoscope } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Table,
  Td,
  Th,
} from '../components/ui'
import { errorMessage, post } from '../lib/api'
import { fmtDateShort, WEEKDAYS_SHORT } from '../lib/format'
import { useDoctors, useServices } from '../lib/hooks'
import type { Doctor } from '../lib/types'

// Calendar colours that sit well with the Adele Care palette (teal, logo blue, logo orange, navy...).
export const DOCTOR_COLORS = ['#0d9298', '#1b5e96', '#e0752a', '#34495f', '#2f9e6e', '#7a5fc2', '#c2417a', '#0e7c9e', '#b58a1b', '#5b7a99']

export function shiftsFor(doctor: Doctor, weekday: number) {
  return doctor.schedule.filter((s) => s.weekday === weekday)
}

export default function Doctors() {
  const navigate = useNavigate()
  const { data: doctors, isLoading, error } = useDoctors()
  const { data: services = [] } = useServices()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader
        title="Doctors & working hours"
        description="Your clinical team, the treatments they offer and when they work. The AI only offers times inside these hours."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add doctor
          </Button>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : error || !doctors ? (
        <ErrorBlock message={errorMessage(error)} />
      ) : doctors.length === 0 ? (
        <Card>
          <EmptyState icon={<Stethoscope className="size-5" />} title="No doctors yet" description="Add your first doctor to start taking bookings." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {doctors.map((d) => {
              const days = [...new Set(d.schedule.map((s) => s.weekday))].sort()
              const nextOff = d.time_off[0]
              return (
                <button
                  key={d.id}
                  onClick={() => navigate(`/doctors/${d.id}`)}
                  className={clsx(
                    'rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-teal-300 hover:shadow-md',
                    !d.is_active && 'opacity-60',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={d.name} color={d.color} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{d.name}</p>
                      <p className="truncate text-sm text-slate-500">{d.title}</p>
                    </div>
                    {!d.is_active && <Badge tone="slate">Inactive</Badge>}
                  </div>
                  <div className="mt-4 flex gap-1">
                    {WEEKDAYS_SHORT.map((label, i) => (
                      <span
                        key={label}
                        className={clsx(
                          'grid h-7 flex-1 place-items-center rounded-md text-[11px] font-medium',
                          days.includes(i) ? 'bg-teal-50 text-teal-800' : 'bg-slate-50 text-slate-300',
                        )}
                      >
                        {label.slice(0, 2)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{d.service_ids.length} treatments</span>
                    <span>·</span>
                    <span>{d.upcoming_count} upcoming</span>
                    {nextOff && (
                      <Badge tone="amber" className="ml-auto">
                        <CalendarOff className="size-3" /> Off {fmtDateShort(nextOff.start_date)}
                      </Badge>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <Card className="mt-6">
            <CardHeader title="Weekly rota" description="Working hours for every doctor at a glance. Click a doctor to change them." />
            <Table>
              <thead>
                <tr>
                  <Th>Doctor</Th>
                  {WEEKDAYS_SHORT.map((d) => (
                    <Th key={d} className="text-center">
                      {d}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {doctors
                  .filter((d) => d.is_active)
                  .map((d) => (
                    <tr key={d.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/doctors/${d.id}`)}>
                      <Td>
                        <span className="inline-flex items-center gap-2 font-medium text-slate-900">
                          <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                          {d.name}
                        </span>
                      </Td>
                      {WEEKDAYS_SHORT.map((_, wd) => {
                        const shifts = shiftsFor(d, wd)
                        return (
                          <Td key={wd} className="text-center text-xs text-slate-600 tabular-nums">
                            {shifts.length ? (
                              shifts.map((s) => (
                                <div key={s.start_time}>
                                  {s.start_time}–{s.end_time}
                                </div>
                              ))
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </Td>
                        )
                      })}
                    </tr>
                  ))}
              </tbody>
            </Table>
          </Card>
          <p className="mt-3 text-xs text-slate-500">
            {services.length} treatments configured. Treatments without a doctor can't be booked by the AI.
          </p>
        </>
      )}
      {adding && <AddDoctorModal onClose={() => setAdding(false)} onCreated={(d) => navigate(`/doctors/${d.id}`)} />}
    </>
  )
}

function AddDoctorModal({ onClose, onCreated }: { onClose: () => void; onCreated: (d: Doctor) => void }) {
  const qc = useQueryClient()
  const { data: services = [] } = useServices()
  const [name, setName] = useState('Dr ')
  const [title, setTitle] = useState('General Dentist')
  const [color, setColor] = useState(DOCTOR_COLORS[Math.floor(Math.random() * DOCTOR_COLORS.length)])
  const [serviceIds, setServiceIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (name.trim().length < 3) return setError('Enter the doctor’s name.')
    setSaving(true)
    try {
      const d = await post<Doctor>('/doctors', { name: name.trim(), title, color, service_ids: serviceIds })
      toast.success('Doctor added - now set their working hours')
      qc.invalidateQueries()
      onCreated(d)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add doctor"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Add & set hours
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Role / specialty">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
        <Field label="Calendar colour">
          <div className="flex flex-wrap gap-2">
            {DOCTOR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={clsx('size-7 rounded-full ring-offset-2', color === c && 'ring-2 ring-slate-900')}
                style={{ background: c }}
              />
            ))}
          </div>
        </Field>
        <Field label="Treatments offered">
          <div className="grid gap-2 sm:grid-cols-2">
            {services
              .filter((s) => s.is_active)
              .map((s) => (
                <label key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-teal-600"
                    checked={serviceIds.includes(s.id)}
                    onChange={(e) =>
                      setServiceIds(e.target.checked ? [...serviceIds, s.id] : serviceIds.filter((x) => x !== s.id))
                    }
                  />
                  {s.name}
                </label>
              ))}
          </div>
        </Field>
        {error && <ErrorBlock message={error} />}
      </div>
    </Modal>
  )
}
