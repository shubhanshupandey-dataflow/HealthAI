import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { AlertTriangle, CalendarDays, Mic, PhoneCall, PhoneIncoming, Plus, Sparkles, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AppointmentList, useAppointmentUI } from '../components/appointments'
import {
  Badge,
  Button,
  buttonClass,
  Card,
  CardHeader,
  CategoryBadge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
} from '../components/ui'
import { errorMessage, get } from '../lib/api'
import { fmtAgo, fmtDuration, fmtMoney, toDate } from '../lib/format'
import { useClinic } from '../lib/hooks'
import type { DashboardData } from '../lib/types'

function greeting(date: Date) {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { openNew } = useAppointmentUI()
  const { data: clinic } = useClinic()
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => get<DashboardData>('/dashboard'),
    refetchInterval: 30_000,
  })

  if (isLoading) return <LoadingBlock />
  if (error || !data) return <ErrorBlock message={errorMessage(error)} />

  const s = data.stats
  const now = toDate(data.now)
  const todayLabel = data.daily.find((d) => d.is_today)?.label
  const maxService = Math.max(1, ...data.services.map((x) => x.count))

  return (
    <>
      <PageHeader
        title={greeting(now)}
        description={`${format(now, 'EEEE d MMMM yyyy')} · here's what's happening at ${clinic?.name ?? 'the clinic'}.`}
        actions={
          <>
            <a href="/assistant" target="_blank" rel="noopener noreferrer" className={buttonClass('secondary')}>
              <Mic className="size-4" /> Test call
            </a>
            <Button icon={<Plus className="size-4" />} onClick={() => openNew()}>
              New appointment
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Appointments today"
          value={s.appointments_today}
          icon={<CalendarDays className="size-5" />}
          hint={`${s.appointments_upcoming_7d} upcoming in the next 7 days`}
        />
        <StatCard
          label="AI calls · 30 days"
          value={s.calls_30d}
          icon={<PhoneCall className="size-5" />}
          accent="violet"
          hint={`${s.calls_today} today`}
        />
        <StatCard
          label="Booked by AI · 30 days"
          value={s.ai_bookings_30d}
          icon={<Sparkles className="size-5" />}
          accent="amber"
          hint={`${s.cancellations_30d} cancellations in 30 days`}
        />
        <StatCard
          label="Patients"
          value={s.patients_total}
          icon={<Users className="size-5" />}
          accent="slate"
          hint={`+${s.patients_new_30d} new · ${fmtMoney(s.revenue_30d, clinic?.currency_symbol)} completed in 30 days`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Bookings & calls" description="Last 14 days and the next 2 weeks" />
          <div className="h-72 px-2 pt-4 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.daily} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e2e9f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7b8da3' }} tickLine={false} axisLine={false} interval={2} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#7b8da3' }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: '#f4f7fa' }}
                  contentStyle={{ borderRadius: 12, borderColor: '#e2e9f0', fontSize: 12, fontFamily: 'Manrope, sans-serif' }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value: string) => <span style={{ color: '#55677e' }}>{value}</span>}
                />
                {todayLabel && <ReferenceLine x={todayLabel} stroke="#a3b3c6" strokeDasharray="4 4" />}
                <Bar dataKey="staff" name="Booked by staff" stackId="a" fill="#cdd8e4" />
                <Bar dataKey="ai" name="Booked by AI" stackId="a" fill="#0d9298" radius={[4, 4, 0, 0]} />
                <Line dataKey="calls" name="AI calls" type="monotone" stroke="#e0752a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Today's schedule"
            description={`${data.today.length} appointment${data.today.length === 1 ? '' : 's'}`}
            action={
              <Link to="/appointments" className="text-xs font-medium text-teal-700 hover:underline">
                Open calendar
              </Link>
            }
          />
          <div className="scroll-thin max-h-72 overflow-y-auto">
            <AppointmentList items={data.today} empty="Nothing booked today" />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent AI calls"
            action={
              <Link to="/calls" className="text-xs font-medium text-teal-700 hover:underline">
                All call logs
              </Link>
            }
          />
          {data.recent_calls.length === 0 ? (
            <EmptyState
              icon={<PhoneIncoming className="size-5" />}
              title="No calls yet"
              description="Calls handled by the AI receptionist will appear here."
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent_calls.map((c) => (
                <li key={c.id}>
                  <Link to={`/calls?call=${c.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                      {c.channel === 'phone' ? <PhoneIncoming className="size-4" /> : <Mic className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {c.patient_name ?? (c.caller_number || 'Web test call')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {fmtAgo(c.started_at)} · {fmtDuration(c.duration_seconds)}
                      </p>
                    </div>
                    <Badge tone={c.outcome.includes('booked') ? 'teal' : c.outcome.includes('Message') ? 'amber' : 'slate'}>
                      {c.outcome || c.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Messages for the team"
              action={
                <Link to="/messages" className="text-xs font-medium text-teal-700 hover:underline">
                  View all
                </Link>
              }
            />
            {data.messages.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-500">All caught up 🎉</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.messages.map((m) => (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      {m.urgency === 'urgent' && <AlertTriangle className="size-4 shrink-0 text-red-500" />}
                      <p className="truncate text-sm font-medium text-slate-900">{m.caller_name}</p>
                      <CategoryBadge category={m.category} />
                      <span className="ml-auto shrink-0 text-xs text-slate-400">{fmtAgo(m.created_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{m.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Popular treatments" description="Upcoming 30 days" />
            <div className="space-y-3 px-5 py-4">
              {data.services.length === 0 && <p className="text-sm text-slate-500">No upcoming bookings.</p>}
              {data.services.map((x) => (
                <div key={x.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-slate-700">{x.name}</span>
                    <span className="font-medium text-slate-900 tabular-nums">{x.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100">
                    <div className="h-1.5 rounded-full bg-teal-500" style={{ width: `${(x.count / maxService) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
