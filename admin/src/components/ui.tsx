import clsx from 'clsx'
import { CalendarClock, Frown, Loader2, MessageCircle, Sparkles, UserRound, Wrench, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { initials } from '../lib/format'
import type { AppointmentStatus, MessageCategory } from '../lib/types'

/* ------------------------------------------------------------------ buttons */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md'

// Adele Care style: navy pill primary buttons (like "Join the pilot" on adelecare.co.uk), teal accents.
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-slate-950 text-white hover:bg-slate-800 shadow-sm disabled:bg-slate-950/50',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 shadow-sm',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
  subtle: 'bg-teal-50 text-teal-800 hover:bg-teal-100',
}

/** Button look for links (e.g. "open in a new tab" actions). */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors whitespace-nowrap',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600',
    size === 'sm' ? 'h-8 px-3.5 text-sm' : 'h-10 px-5 text-sm',
    buttonStyles[variant],
    className,
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(buttonClass(variant, size), 'disabled:cursor-not-allowed disabled:opacity-60', className)}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}

/** Two-step destructive action: first click arms it, second click within 3s confirms. */
export function ConfirmButton({
  onConfirm,
  children,
  confirmText = 'Click again to confirm',
  size = 'sm',
  variant = 'ghost',
  icon,
  loading,
  className,
}: {
  onConfirm: () => void
  children: ReactNode
  confirmText?: string
  size?: ButtonSize
  variant?: ButtonVariant
  icon?: ReactNode
  loading?: boolean
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Button
      size={size}
      variant={armed ? 'danger' : variant}
      icon={icon}
      loading={loading}
      className={clsx(!armed && variant === 'ghost' && 'text-red-600 hover:bg-red-50 hover:text-red-700', className)}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? confirmText : children}
    </Button>
  )
}

/* ------------------------------------------------------------------ form controls */

const controlBase =
  'rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm ' +
  'focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50 disabled:text-slate-500'

/** Default width/height only when the caller didn't pass their own (Tailwind can't resolve w-full vs w-40). */
function sized(className: string | undefined, height: string | null) {
  const c = className ?? ''
  return clsx(!/(^|\s)w-/.test(c) && 'w-full', height && !/(^|\s)h-/.test(c) && height)
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(controlBase, sized(className, 'h-10'), className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(controlBase, sized(className, 'h-10'), 'pr-8', className)} {...props}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(controlBase, sized(className, null), 'py-2 leading-relaxed', className)} rows={3} {...props} />
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  description?: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      {(label || description) && (
        <span>
          {label && <span className="block text-sm font-medium text-slate-800">{label}</span>}
          {description && <span className="block text-xs text-slate-500">{description}</span>}
        </span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-teal-600' : 'bg-slate-300',
        )}
      >
        <span
          className={clsx(
            'inline-block size-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  )
}

/* ------------------------------------------------------------------ layout bits */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-serif text-[30px] leading-tight font-medium tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  icon,
  hint,
  accent = 'teal',
}: {
  label: string
  value: ReactNode
  icon: ReactNode
  hint?: ReactNode
  accent?: 'teal' | 'violet' | 'amber' | 'slate' | 'emerald'
}) {
  const accents = {
    teal: 'bg-teal-50 text-teal-700',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    slate: 'bg-slate-100 text-slate-700',
    emerald: 'bg-emerald-50 text-emerald-700',
  }
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
        </div>
        <span className={clsx('grid size-10 shrink-0 place-items-center rounded-lg', accents[accent])}>{icon}</span>
      </div>
      {hint && <p className="mt-3 text-xs text-slate-500">{hint}</p>}
    </Card>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-full bg-slate-100 text-slate-400">{icon}</div>}
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-slate-400', className)} />
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  )
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
      {message}
    </div>
  )
}

/* ------------------------------------------------------------------ badges */

type Tone = 'slate' | 'teal' | 'blue' | 'green' | 'red' | 'amber' | 'violet'
const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
}

export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export const STATUS_META: Record<AppointmentStatus, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'slate' },
  confirmed: { label: 'Confirmed', tone: 'teal' },
  completed: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'red' },
  no_show: { label: 'No-show', tone: 'amber' },
}

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'slate' as Tone }
  return <Badge tone={meta.tone}>{meta.label}</Badge>
}

export const MESSAGE_CATEGORIES: {
  value: MessageCategory
  label: string
  tone: Tone
  dot: string
  icon: ReactNode
  hint: string
}[] = [
  {
    value: 'appointment',
    label: 'Appointment',
    tone: 'teal',
    dot: 'bg-teal-600',
    icon: <CalendarClock className="size-3" />,
    hint: 'Bookings: missing, wrong, no suitable time, wants to change',
  },
  {
    value: 'complaint',
    label: 'Complaint',
    tone: 'amber',
    dot: 'bg-amber-500',
    icon: <Frown className="size-3" />,
    hint: 'Unhappy with the clinic, staff or treatment',
  },
  {
    value: 'issue',
    label: 'Issue',
    tone: 'violet',
    dot: 'bg-violet-600',
    icon: <Wrench className="size-3" />,
    hint: 'Billing, payments, insurance, records, a problem after treatment',
  },
  {
    value: 'general',
    label: 'General',
    tone: 'slate',
    dot: 'bg-slate-400',
    icon: <MessageCircle className="size-3" />,
    hint: 'Questions and other call-back requests',
  },
]

export function CategoryBadge({ category }: { category: string }) {
  const meta = MESSAGE_CATEGORIES.find((c) => c.value === category) ?? MESSAGE_CATEGORIES[3]
  return (
    <Badge tone={meta.tone}>
      {meta.icon} {meta.label}
    </Badge>
  )
}

export function SourceBadge({ source }: { source: string }) {
  if (source === 'ai_agent')
    return (
      <Badge tone="violet">
        <Sparkles className="size-3" /> AI
      </Badge>
    )
  return (
    <Badge tone="slate">
      <UserRound className="size-3" /> Staff
    </Badge>
  )
}

export function Avatar({ name, color, size = 'md' }: { name: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-14 text-lg' }
  return (
    <span
      className={clsx('grid shrink-0 place-items-center rounded-full font-semibold text-white', sizes[size])}
      style={{ backgroundColor: color || '#64748b' }}
      aria-hidden
    >
      {initials(name) || '?'}
    </span>
  )
}

/* ------------------------------------------------------------------ modal / drawer */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  side = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  side?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div
        className={clsx(
          'absolute flex flex-col bg-white shadow-xl outline-none',
          side
            ? 'inset-y-0 right-0 w-full sm:max-w-xl'
            : clsx('inset-x-4 top-[6vh] mx-auto max-h-[88vh] rounded-xl', widths[size]),
        )}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ tabs */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="scroll-thin -mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors',
            value === t.value
              ? 'border-teal-600 text-teal-700'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
            value === o.value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('scroll-thin overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  )
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={clsx(
        'border-b border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs font-medium tracking-wide text-slate-500 uppercase',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx('border-b border-slate-100 px-4 py-3 align-middle', className)}>{children}</td>
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} of {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
