import { useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandLogo } from '../components/Brand'
import { Orb } from '../components/Orb'
import { Button, ErrorBlock, Field, Input } from '../components/ui'
import { errorMessage, post, setToken } from '../lib/api'
import type { User } from '../lib/types'

export default function Login() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [email, setEmail] = useState('admin@clinic.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await post<{ token: string; user: User }>('/auth/login', { email, password })
      setToken(res.token)
      qc.clear()
      navigate('/')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-full bg-white lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <BrandLogo className="h-9" />
          <h1 className="mt-10 font-serif text-[34px] leading-tight font-medium tracking-tight text-slate-900">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage patients, appointments, doctors and your AI receptionist.
          </p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
              />
            </Field>
            {error && <ErrorBlock message={error} />}
            <Button type="submit" className="w-full" loading={loading}>
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-xs text-slate-500">Default login is set in .env (ADMIN_EMAIL / ADMIN_PASSWORD).</p>
        </div>
      </div>
      <div className="brand-backdrop relative hidden overflow-hidden border-l border-slate-200 lg:flex lg:flex-col lg:items-center lg:justify-center">
        <Orb mode="idle" className="w-64" />
        <p className="mt-14 max-w-sm text-center font-serif text-[28px] leading-snug text-slate-900">
          “Hello, thank you for calling - how can I help?”
        </p>
        <p className="mt-3 max-w-sm text-center text-sm text-slate-600">
          Adele Care answers every call, books appointments and passes clinical questions to your team.
        </p>
        <span className="mt-8 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/70 px-3 py-1 text-xs font-semibold text-teal-800">
          <ShieldCheck className="size-3.5" /> AI front desk for UK dental practices
        </span>
      </div>
    </div>
  )
}
