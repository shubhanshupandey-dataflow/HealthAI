import { addDays, format, formatDistanceStrict, isSameDay, parseISO } from 'date-fns'

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Server sends clinic-local times without a timezone; parseISO keeps the wall-clock value. */
export const toDate = (value: string | Date) => (typeof value === 'string' ? parseISO(value) : value)

/*
 * The clinic's wall clock. All times from the API are clinic-local, so "now", "today" and
 * "2 hours ago" must use the clinic's clock, not the browser's (they differ when you
 * manage a London clinic from another timezone).
 */
let clockOffsetMs = 0
export function syncClinicClock(serverNow: string) {
  clockOffsetMs = parseISO(serverNow).getTime() - Date.now()
}
export const clinicNow = () => new Date(Date.now() + clockOffsetMs)
export const clinicToday = () => format(clinicNow(), 'yyyy-MM-dd')
const isToday = (d: Date) => isSameDay(d, clinicNow())
const isTomorrow = (d: Date) => isSameDay(d, addDays(clinicNow(), 1))
const isYesterday = (d: Date) => isSameDay(d, addDays(clinicNow(), -1))
export const isClinicToday = isToday

export const fmtDate = (v: string | Date) => format(toDate(v), 'EEE d MMM yyyy')
export const fmtDateShort = (v: string | Date) => format(toDate(v), 'd MMM')
export const fmtTime = (v: string | Date) => format(toDate(v), 'HH:mm')
export const fmtDateTime = (v: string | Date) => format(toDate(v), 'EEE d MMM, HH:mm')
export const isoDate = (d: Date) => format(d, 'yyyy-MM-dd')
export const isoLocal = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm:ss")

export function fmtDayLabel(v: string | Date) {
  const d = toDate(v)
  if (isToday(d)) return 'Today'
  if (isTomorrow(d)) return 'Tomorrow'
  if (isYesterday(d)) return 'Yesterday'
  return format(d, 'EEE d MMM')
}

export const fmtAgo = (v: string | Date) => formatDistanceStrict(toDate(v), clinicNow(), { addSuffix: true })

export function fmtDuration(seconds: number) {
  if (!seconds) return '0s'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m ? `${m}m ${s.toString().padStart(2, '0')}s` : `${s}s`
}

export function fmtMoney(amount: number, symbol = '£', zeroLabel = 'Free') {
  if (!amount) return zeroLabel || `${symbol}0`
  return `${symbol}${amount.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`
}

export function age(dob: string | null) {
  if (!dob) return null
  const d = parseISO(dob)
  const now = clinicNow()
  let years = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--
  return years
}

export function initials(name: string) {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + (m || 0)
}
