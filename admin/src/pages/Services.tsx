import { useQueryClient } from '@tanstack/react-query'
import { ClipboardList, Pencil, Plus, Siren, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Switch,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui'
import { del, errorMessage, post, put } from '../lib/api'
import { fmtMoney } from '../lib/format'
import { useClinic, useDoctors, useServices } from '../lib/hooks'
import type { Service } from '../lib/types'

export default function Services() {
  const { data: services, isLoading, error } = useServices()
  const { data: doctors = [] } = useDoctors()
  const { data: clinic } = useClinic()
  const [editing, setEditing] = useState<Service | 'new' | null>(null)

  return (
    <>
      <PageHeader
        title="Treatments & prices"
        description="What patients can book, how long it takes and what it costs. The AI quotes these prices."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Add treatment
          </Button>
        }
      />
      <Card>
        {isLoading ? (
          <LoadingBlock />
        ) : error || !services ? (
          <div className="p-4">
            <ErrorBlock message={errorMessage(error)} />
          </div>
        ) : services.length === 0 ? (
          <EmptyState icon={<ClipboardList className="size-5" />} title="No treatments yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Treatment</Th>
                <Th>Category</Th>
                <Th>Duration</Th>
                <Th>Price</Th>
                <Th>Doctors</Th>
                <Th>Upcoming</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                  <Td className="max-w-xs">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">{s.name}</p>
                      {s.is_emergency && (
                        <Badge tone="red">
                          <Siren className="size-3" /> Emergency
                        </Badge>
                      )}
                      {!s.is_active && <Badge tone="slate">Hidden</Badge>}
                    </div>
                    <p className="truncate text-xs text-slate-500">{s.description}</p>
                  </Td>
                  <Td className="text-slate-600">{s.category}</Td>
                  <Td className="text-slate-600 tabular-nums">{s.duration_minutes} min</Td>
                  <Td className="font-medium text-slate-900 tabular-nums">{fmtMoney(s.price, clinic?.currency_symbol)}</Td>
                  <Td>
                    <div className="flex -space-x-1.5">
                      {s.doctor_ids.length === 0 && <span className="text-xs text-amber-700">No doctor assigned</span>}
                      {s.doctor_ids.map((id) => {
                        const d = doctors.find((x) => x.id === id)
                        return d ? (
                          <span key={id} title={d.name} className="rounded-full ring-2 ring-white">
                            <Avatar name={d.name} color={d.color} size="sm" />
                          </span>
                        ) : null
                      })}
                    </div>
                  </Td>
                  <Td className="text-slate-600 tabular-nums">{s.upcoming_count}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && <ServiceModal service={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function ServiceModal({ service, onClose }: { service?: Service; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: doctors = [] } = useDoctors()
  const { data: clinic } = useClinic()
  const [form, setForm] = useState({
    name: service?.name ?? '',
    category: service?.category ?? 'General',
    description: service?.description ?? '',
    keywords: service?.keywords ?? '',
    duration_minutes: service?.duration_minutes ?? 30,
    price: service?.price ?? 0,
    is_emergency: service?.is_emergency ?? false,
    is_active: service?.is_active ?? true,
    doctor_ids: service?.doctor_ids ?? [],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true)
    setError('')
    try {
      if (service) await put(`/services/${service.id}`, form)
      else await post('/services', form)
      toast.success('Treatment saved')
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
      title={service ? `Edit ${service.name}` : 'Add treatment'}
      footer={
        <>
          {service && (
            <ConfirmButton
              icon={<Trash2 className="size-4" />}
              onConfirm={async () => {
                try {
                  const res = await del<{ deactivated: boolean }>(`/services/${service.id}`)
                  toast.success(res.deactivated ? 'Treatment hidden (it has bookings)' : 'Treatment deleted')
                  qc.invalidateQueries()
                  onClose()
                } catch (err) {
                  toast.error(errorMessage(err))
                }
              }}
            >
              Delete
            </ConfirmButton>
          )}
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Category">
          <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        </Field>
        <Field label="Duration (minutes)">
          <Input
            type="number"
            min={5}
            step={5}
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
          />
        </Field>
        <Field label={`Price (${clinic?.currency_symbol ?? '£'})`} hint="0 shows as free">
          <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field
          label="What callers might say"
          className="sm:col-span-2"
          hint="Comma separated. Helps the AI match 'a clean' or 'my tooth hurts' to this treatment."
        >
          <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
        </Field>
        <Switch checked={form.is_emergency} onChange={(v) => setForm({ ...form, is_emergency: v })} label="Emergency treatment" description="Offered first for pain, swelling or breakages." />
        <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} label="Bookable" description="Hidden treatments can't be booked." />
        <Field label="Doctors who provide it" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {doctors
              .filter((d) => d.is_active)
              .map((d) => (
                <label key={d.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-teal-600"
                    checked={form.doctor_ids.includes(d.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        doctor_ids: e.target.checked ? [...form.doctor_ids, d.id] : form.doctor_ids.filter((x) => x !== d.id),
                      })
                    }
                  />
                  <span className="size-2.5 rounded-full" style={{ background: d.color }} />
                  {d.name}
                </label>
              ))}
          </div>
        </Field>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorBlock message={error} />
        </div>
      )}
    </Modal>
  )
}
