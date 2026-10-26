import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Bot, CheckCircle2, Mic, PhoneIncoming, Search, UserRound, Wrench, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AppointmentList } from '../components/appointments'
import {
  Badge,
  Card,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui'
import { errorMessage, get } from '../lib/api'
import { fmtAgo, fmtDateTime, fmtDuration } from '../lib/format'
import { useDebounced } from '../lib/hooks'
import type { CallLog, Paged } from '../lib/types'

const PAGE_SIZE = 25

const TOOL_LABELS: Record<string, string> = {
  check_availability: 'Checked availability',
  lookup_patient: 'Looked up patient',
  register_patient: 'Registered patient',
  book_appointment: 'Booked appointment',
  get_patient_appointments: 'Read appointments',
  cancel_appointment: 'Cancelled appointment',
  reschedule_appointment: 'Rescheduled appointment',
  take_message: 'Took a message',
  transfer_to_staff: 'Transferred call',
  end_call: 'Ended call',
}

export function outcomeTone(outcome: string) {
  if (/booked|rescheduled|registered/i.test(outcome)) return 'teal' as const
  if (/cancel/i.test(outcome)) return 'red' as const
  if (/message|transfer/i.test(outcome)) return 'amber' as const
  return 'slate' as const
}

export default function Calls() {
  const [params, setParams] = useSearchParams()
  const openId = params.get('call')
  const [q, setQ] = useState('')
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const search = useDebounced(q)

  const { data, isLoading, error } = useQuery({
    queryKey: ['calls', search, channel, page],
    queryFn: () => get<Paged<CallLog>>('/calls', { search, channel, page, page_size: PAGE_SIZE }),
    refetchInterval: 10_000,
  })

  const open = (id: number | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('call', String(id))
    else next.delete('call')
    setParams(next, { replace: true })
  }

  return (
    <>
      <PageHeader
        title="AI call logs"
        description="Every conversation the receptionist has had, with full transcripts and what it did."
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search number or outcome" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select className="w-40" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
            <option value="">All channels</option>
            <option value="phone">Phone calls</option>
            <option value="web">Web test calls</option>
          </Select>
          {data && <span className="text-sm text-slate-500">{data.total} calls</span>}
        </div>
        {isLoading ? (
          <LoadingBlock />
        ) : error ? (
          <div className="p-4">
            <ErrorBlock message={errorMessage(error)} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState
            icon={<PhoneIncoming className="size-5" />}
            title="No calls yet"
            description="Make a test call from the sidebar - it will show up here with a full transcript."
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Caller</Th>
                  <Th>Patient</Th>
                  <Th>Duration</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => open(c.id)}>
                    <Td>
                      <p className="font-medium text-slate-900">{fmtDateTime(c.started_at)}</p>
                      <p className="text-xs text-slate-500">{fmtAgo(c.started_at)}</p>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2 text-slate-700">
                        {c.channel === 'phone' ? <PhoneIncoming className="size-4 text-violet-500" /> : <Mic className="size-4 text-violet-500" />}
                        {c.caller_number || (c.channel === 'web' ? 'Web test call' : 'Unknown')}
                      </span>
                    </Td>
                    <Td>{c.patient_name ?? <span className="text-slate-400">Not identified</span>}</Td>
                    <Td className="text-slate-600 tabular-nums">
                      {c.status === 'in_progress' ? (
                        <Badge tone="green">
                          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                        </Badge>
                      ) : (
                        fmtDuration(c.duration_seconds)
                      )}
                    </Td>
                    <Td>
                      <Badge tone={outcomeTone(c.outcome)}>{c.outcome || '—'}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {openId && <CallDetail id={Number(openId)} onClose={() => open(null)} />}
    </>
  )
}

function CallDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['call', id],
    queryFn: () => get<CallLog>(`/calls/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'in_progress' ? 3000 : false),
  })

  return (
    <Modal
      open
      side
      onClose={onClose}
      title={data ? `Call #${data.id}` : 'Call'}
      description={data ? `${fmtDateTime(data.started_at)} · ${fmtDuration(data.duration_seconds)}` : undefined}
    >
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : error || !data ? (
        <ErrorBlock message={errorMessage(error)} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={outcomeTone(data.outcome)}>{data.outcome || data.status}</Badge>
            <Badge tone="violet">{data.channel === 'phone' ? 'Phone call' : 'Web test call'}</Badge>
            {data.caller_number && <Badge tone="slate">{data.caller_number}</Badge>}
            {data.patient_id && (
              <Link to={`/patients/${data.patient_id}`} onClick={onClose}>
                <Badge tone="teal">
                  <UserRound className="size-3" /> {data.patient_name}
                </Badge>
              </Link>
            )}
          </div>

          {data.actions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">What the AI did</p>
              <ol className="space-y-2">
                {data.actions.map((a, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    {a.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">{TOOL_LABELS[a.tool] ?? a.tool}</p>
                      {a.summary && <p className="text-xs break-words text-slate-500">{a.summary}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {data.appointments && data.appointments.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Appointments from this call</p>
              <Card>
                <AppointmentList items={data.appointments} />
              </Card>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Transcript</p>
            {!data.transcript?.length ? (
              <p className="text-sm text-slate-500">
                {data.status === 'in_progress' ? 'Call in progress - the transcript is saved when it ends.' : 'No transcript.'}
              </p>
            ) : (
              <div className="space-y-3">
                {data.transcript.map((t, i) => {
                  const ai = t.role === 'assistant'
                  return (
                    <div key={i} className={clsx('flex gap-2', !ai && 'flex-row-reverse')}>
                      <span
                        className={clsx(
                          'grid size-7 shrink-0 place-items-center rounded-full',
                          ai ? 'bg-teal-100 text-teal-700' : 'bg-slate-200 text-slate-600',
                        )}
                      >
                        {ai ? <Bot className="size-4" /> : <UserRound className="size-4" />}
                      </span>
                      <p
                        className={clsx(
                          'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
                          ai ? 'rounded-tl-sm bg-teal-50 text-slate-800' : 'rounded-tr-sm bg-slate-100 text-slate-800',
                        )}
                      >
                        {t.text}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {data.actions.length === 0 && data.transcript && data.transcript.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Wrench className="size-3.5" /> No tools were used on this call.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
