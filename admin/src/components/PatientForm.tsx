import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { errorMessage, post, put } from '../lib/api'
import type { Patient } from '../lib/types'
import { Button, ErrorBlock, Field, Input, Modal, Select, Textarea } from './ui'

export function PatientFormModal({
  patient,
  onClose,
  onSaved,
}: {
  patient?: Patient
  onClose: () => void
  onSaved?: (p: Patient) => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    first_name: patient?.first_name ?? '',
    last_name: patient?.last_name ?? '',
    phone: patient?.phone ?? '',
    email: patient?.email ?? '',
    date_of_birth: patient?.date_of_birth ?? '',
    gender: patient?.gender ?? '',
    address: patient?.address ?? '',
    notes: patient?.notes ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value })

  async function save() {
    setError('')
    if (!form.first_name.trim()) return setError('First name is required.')
    setSaving(true)
    try {
      const body = { ...form, date_of_birth: form.date_of_birth || null }
      const saved = patient ? await put<Patient>(`/patients/${patient.id}`, body) : await post<Patient>('/patients', body)
      toast.success(patient ? 'Patient updated' : 'Patient added')
      qc.invalidateQueries()
      onSaved?.(saved)
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
      title={patient ? 'Edit patient' : 'Add patient'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {patient ? 'Save changes' : 'Add patient'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">
          <Input value={form.first_name} onChange={set('first_name')} autoFocus />
        </Field>
        <Field label="Last name">
          <Input value={form.last_name} onChange={set('last_name')} />
        </Field>
        <Field label="Mobile number" hint="Used to recognise the patient when they call.">
          <Input value={form.phone} onChange={set('phone')} placeholder="07700 900123" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Date of birth">
          <Input type="date" value={form.date_of_birth} onChange={set('date_of_birth')} />
        </Field>
        <Field label="Gender">
          <Select value={form.gender} onChange={set('gender')}>
            <option value="">Prefer not to say</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="X">Other</option>
          </Select>
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={form.address} onChange={set('address')} />
        </Field>
        <Field label="Notes" className="sm:col-span-2" hint="Allergies, preferences, anything useful for the team.">
          <Textarea value={form.notes} onChange={set('notes')} />
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
