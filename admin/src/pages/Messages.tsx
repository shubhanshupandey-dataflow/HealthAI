import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlertTriangle, Check, MessageSquare, Phone, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Badge,
  Button,
  Card,
  CategoryBadge,
  ConfirmButton,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  MESSAGE_CATEGORIES,
  PageHeader,
  Segmented,
  Select,
} from '../components/ui'
import { del, errorMessage, get, put } from '../lib/api'
import { fmtAgo, fmtDateTime } from '../lib/format'
import type { Message, MessageCategory } from '../lib/types'

type StatusFilter = 'new' | 'done' | 'all'
type CategoryFilter = MessageCategory | 'all'
type MessageChange = { status?: string; category?: string; urgency?: string }

// Open urgent messages first, then newest first.
const rank = (m: Message) => (m.urgency === 'urgent' && m.status === 'new' ? 0 : 1)

export default function Messages() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<StatusFilter>('new')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [urgentOnly, setUrgentOnly] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['messages', status],
    queryFn: () => get<Message[]>('/messages', { status: status === 'all' ? undefined : status }),
    refetchInterval: 20_000,
  })

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, urgent: 0 }
    for (const m of data ?? []) {
      c.all += 1
      c[m.category] = (c[m.category] ?? 0) + 1
      if (m.urgency === 'urgent') c.urgent += 1
    }
    return c
  }, [data])

  const shown = useMemo(
    () =>
      (data ?? [])
        .filter((m) => (category === 'all' || m.category === category) && (!urgentOnly || m.urgency === 'urgent'))
        .sort((a, b) => rank(a) - rank(b) || b.created_at.localeCompare(a.created_at)),
    [data, category, urgentOnly],
  )

  async function update(m: Message, change: MessageChange, done: string) {
    try {
      await put(`/messages/${m.id}`, change)
      toast.success(done)
      qc.invalidateQueries({ queryKey: ['messages'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const filtered = category !== 'all' || urgentOnly

  return (
    <>
      <PageHeader
        title="Messages & call-backs"
        description="Messages the AI receptionist took for your team, sorted into appointments, complaints, issues and general. Urgent ones stay at the top."
        actions={
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'new', label: 'To do' },
              { value: 'done', label: 'Handled' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <FilterChip active={category === 'all'} onClick={() => setCategory('all')} label="All" count={counts.all} />
        {MESSAGE_CATEGORIES.map((c) => (
          <FilterChip
            key={c.value}
            active={category === c.value}
            onClick={() => setCategory(c.value)}
            label={c.label}
            count={counts[c.value] ?? 0}
            dot={c.dot}
            title={c.hint}
          />
        ))}
        <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
        <FilterChip
          active={urgentOnly}
          onClick={() => setUrgentOnly(!urgentOnly)}
          label="Urgent"
          count={counts.urgent}
          icon={<AlertTriangle className={clsx('size-3.5', urgentOnly ? 'text-white' : 'text-red-600')} />}
          activeClass="bg-red-600 text-white border-red-600"
        />
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBlock message={errorMessage(error)} />
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageSquare className="size-5" />}
            title={filtered ? 'No messages match these filters' : status === 'new' ? 'All caught up' : 'No messages'}
            description={filtered ? undefined : 'When a caller needs a human, the AI leaves a message here.'}
            action={
              filtered ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setCategory('all')
                    setUrgentOnly(false)
                  }}
                >
                  Show all messages
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((m) => (
            <Card
              key={m.id}
              className={clsx('flex flex-col p-5', m.urgency === 'urgent' && m.status === 'new' && 'border-red-200 ring-1 ring-red-100')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{m.caller_name || 'Unknown caller'}</p>
                    <CategoryBadge category={m.category} />
                    {m.urgency === 'urgent' && (
                      <Badge tone="red">
                        <AlertTriangle className="size-3" /> Urgent
                      </Badge>
                    )}
                    {m.status === 'done' && <Badge tone="green">Handled</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500" title={fmtDateTime(m.created_at)}>
                    {fmtAgo(m.created_at)}
                    {m.patient_id && (
                      <>
                        {' · '}
                        <Link to={`/patients/${m.patient_id}`} className="text-teal-700 hover:underline">
                          {m.patient_name}
                        </Link>
                      </>
                    )}
                    {m.call_id && (
                      <>
                        {' · '}
                        <Link to={`/calls?call=${m.call_id}`} className="text-teal-700 hover:underline">
                          Call #{m.call_id}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {m.phone && (
                  <a
                    href={`tel:${m.phone}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-100"
                  >
                    <Phone className="size-3.5" /> {m.phone}
                  </a>
                )}
              </div>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-slate-700">{m.message}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="Category"
                    title="Change the category"
                    value={MESSAGE_CATEGORIES.some((c) => c.value === m.category) ? m.category : 'general'}
                    onChange={(e) => update(m, { category: e.target.value }, 'Category updated')}
                    className="h-8 w-36 text-xs"
                  >
                    {MESSAGE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<AlertTriangle className={clsx('size-4', m.urgency !== 'urgent' && 'text-red-600')} />}
                    onClick={() =>
                      update(
                        m,
                        { urgency: m.urgency === 'urgent' ? 'normal' : 'urgent' },
                        m.urgency === 'urgent' ? 'No longer urgent' : 'Marked urgent',
                      )
                    }
                  >
                    {m.urgency === 'urgent' ? 'Not urgent' : 'Mark urgent'}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <ConfirmButton
                    icon={<Trash2 className="size-4" />}
                    onConfirm={async () => {
                      await del(`/messages/${m.id}`)
                      qc.invalidateQueries({ queryKey: ['messages'] })
                      qc.invalidateQueries({ queryKey: ['dashboard'] })
                    }}
                  >
                    Delete
                  </ConfirmButton>
                  {m.status === 'new' ? (
                    <Button size="sm" variant="subtle" icon={<Check className="size-4" />} onClick={() => update(m, { status: 'done' }, 'Marked as handled')}>
                      Mark handled
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => update(m, { status: 'new' }, 'Re-opened')}>
                      Re-open
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  count,
  dot,
  icon,
  title,
  activeClass = 'bg-slate-950 text-white border-slate-950',
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  dot?: string
  icon?: ReactNode
  title?: string
  activeClass?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
        active ? activeClass : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50',
      )}
    >
      {dot && <span className={clsx('size-2 rounded-full', dot)} />}
      {icon}
      {label}
      <span className={clsx('tabular-nums', active ? 'text-white/80' : 'text-slate-400')}>{count}</span>
    </button>
  )
}
