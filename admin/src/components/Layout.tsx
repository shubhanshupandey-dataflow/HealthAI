import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  ArrowUpRight,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PhoneCall,
  Settings,
  Stethoscope,
  Users,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { get, setToken } from '../lib/api'
import type { AgentSettings, ClinicSettings, Message, User } from '../lib/types'
import { AppointmentProvider } from './appointments'
import { BrandLogo } from './Brand'
import { Orb } from './Orb'
import { Avatar } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/appointments', label: 'Appointments', icon: CalendarDays },
  { to: '/patients', label: 'Patients', icon: Users },
  { to: '/doctors', label: 'Doctors & Hours', icon: Stethoscope },
  { to: '/services', label: 'Treatments', icon: ClipboardList },
  { to: '/calls', label: 'AI Call Logs', icon: PhoneCall },
  { to: '/messages', label: 'Messages', icon: MessageSquare, badge: 'messages' as const },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/** Opens the full-screen assistant in a new browser tab. */
export function TalkToAssistantCard({ name }: { name: string }) {
  return (
    <a
      href="/assistant"
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-2xl bg-slate-950 px-3 py-3 text-white shadow-sm transition-colors hover:bg-slate-800"
    >
      <Orb mode="idle" className="size-10 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-semibold">Talk to {name}</span>
        <span className="block text-xs text-slate-300">Opens in a new tab</span>
      </span>
      <ArrowUpRight className="size-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </a>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { data: user } = useQuery({ queryKey: ['me'], queryFn: () => get<User>('/auth/me') })
  const { data: clinic } = useQuery({
    queryKey: ['settings', 'clinic'],
    queryFn: () => get<ClinicSettings>('/settings/clinic'),
  })
  const { data: agent } = useQuery({
    queryKey: ['settings', 'agent'],
    queryFn: () => get<AgentSettings>('/settings/agent'),
  })
  const { data: newMessages } = useQuery({
    queryKey: ['messages', 'new'],
    queryFn: () => get<Message[]>('/messages', { status: 'new' }),
    refetchInterval: 30_000,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-6 pb-6">
        <BrandLogo className="h-8" />
        <p className="mt-3 truncate text-xs font-semibold text-slate-500" title={clinic?.name}>
          {clinic?.name ?? 'Dental clinic'}
        </p>
      </div>

      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-3">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
                isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
              )
            }
          >
            <item.icon className="size-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.badge === 'messages' && !!newMessages?.length && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] leading-none font-bold text-white tabular-nums">
                {newMessages.length}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-3 p-3">
        <TalkToAssistantCard name={agent?.agent_name || 'Sophie'} />

        <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5">
          <Avatar name={user?.name ?? 'Admin'} color="#34495f" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{user?.name ?? '…'}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <button
            title="Sign out"
            aria-label="Sign out"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => {
              setToken(null)
              navigate('/login')
            }}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl">
            <button
              className="absolute top-4 right-3 rounded-md p-1 text-slate-400 hover:bg-slate-100"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>
          <BrandLogo className="h-7" />
        </header>
        <main className="scroll-thin flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <AppointmentProvider>
              <Outlet />
            </AppointmentProvider>
          </div>
        </main>
      </div>
    </div>
  )
}
