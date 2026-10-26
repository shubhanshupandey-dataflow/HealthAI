export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

export interface Patient {
  id: number
  first_name: string
  last_name: string
  full_name: string
  phone: string
  email: string
  date_of_birth: string | null
  gender: string
  address: string
  notes: string
  source: string
  created_at: string
  next_appointment?: string | null
  last_visit?: string | null
  total_appointments?: number
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface Appointment {
  id: number
  patient_id: number
  patient_name: string
  patient_phone: string
  doctor_id: number
  doctor_name: string
  doctor_color: string
  service_id: number
  service_name: string
  price: number
  start: string
  end: string
  status: AppointmentStatus
  notes: string
  source: string
  call_id: number | null
  cancel_reason: string
  created_at: string
}

export interface ScheduleBlock {
  weekday: number
  start_time: string
  end_time: string
}

export interface TimeOff {
  id: number
  doctor_id: number
  start_date: string
  end_date: string
  reason: string
}

export interface Doctor {
  id: number
  name: string
  title: string
  bio: string
  email: string
  phone: string
  color: string
  is_active: boolean
  created_at: string
  service_ids: number[]
  schedule: ScheduleBlock[]
  time_off: TimeOff[]
  upcoming_count: number
  upcoming?: Appointment[]
}

export interface Service {
  id: number
  name: string
  category: string
  description: string
  keywords: string
  duration_minutes: number
  price: number
  is_emergency: boolean
  is_active: boolean
  doctor_ids: number[]
  upcoming_count: number
}

export interface TranscriptTurn {
  role: 'user' | 'assistant' | string
  text: string
}

export interface CallAction {
  tool: string
  ok: boolean
  summary: string
  args?: Record<string, unknown>
}

export type MessageCategory = 'appointment' | 'complaint' | 'issue' | 'general'

export interface Message {
  id: number
  caller_name: string
  phone: string
  message: string
  category: MessageCategory | string
  urgency: 'normal' | 'urgent' | string
  status: 'new' | 'done' | string
  patient_id: number | null
  patient_name: string | null
  call_id: number | null
  created_at: string
}

export interface CallLog {
  id: number
  room_name: string
  channel: 'web' | 'phone' | string
  caller_number: string
  patient_id: number | null
  patient_name: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number
  status: string
  outcome: string
  summary: string
  actions: CallAction[]
  turns: number
  transcript?: TranscriptTurn[]
  appointments?: Appointment[]
  messages?: Message[]
}

export interface PatientDetail {
  patient: Patient
  upcoming: Appointment[]
  history: Appointment[]
  calls: CallLog[]
  messages: Message[]
  stats: { total: number; completed: number; cancelled: number; no_show: number; lifetime_value: number }
}

export interface ClinicSettings {
  id: number
  name: string
  phone: string
  email: string
  address: string
  website: string
  timezone: string
  currency_symbol: string
  slot_interval_minutes: number
  min_notice_minutes: number
  max_days_ahead: number
  emergency_info: string
  knowledge_base: string
  transfer_number: string
}

export interface AgentSettings {
  id: number
  agent_name: string
  greeting: string
  personality: string
  llm_model: string
  tts_provider: 'deepgram' | 'elevenlabs' | 'cartesia' | string
  tts_voice: string
  tts_model: string
  tts_speed: number
  stt_model: 'deepgram-flux' | 'cartesia-ink-2' | 'deepgram-nova-3' | string
  stt_language: string
  allow_booking: boolean
  allow_reschedule: boolean
  allow_cancel: boolean
  allow_registration: boolean
  allow_messages: boolean
  allow_transfer: boolean
  max_call_minutes: number
  updated_at: string | null
}

export interface CartesiaVoice {
  id: string
  name: string
  tagline: string
  description: string
  gender: string | null
  accent: string
  preview_url: string | null
}

export interface OpeningHours {
  weekday: number
  day: string
  is_open: boolean
  open_time: string
  close_time: string
}

export interface Closure {
  id: number
  date: string
  reason: string
}

export interface Slot {
  start: string
  end: string
  doctor_id: number
  doctor_name: string
}

export interface CalendarDoctor {
  id: number
  name: string
  title: string
  color: string
  off: boolean
  blocks: { start: string; end: string }[]
}

export interface CalendarDay {
  date: string
  clinic: { open: string; close: string } | null
  closure: string | null
  doctors: CalendarDoctor[]
  appointments: Appointment[]
}

export interface DashboardData {
  now: string
  stats: {
    patients_total: number
    patients_new_30d: number
    appointments_today: number
    appointments_upcoming_7d: number
    calls_today: number
    calls_30d: number
    ai_bookings_30d: number
    pending_messages: number
    cancellations_30d: number
    revenue_30d: number
  }
  daily: { date: string; label: string; is_today: boolean; ai: number; staff: number; calls: number }[]
  services: { name: string; count: number }[]
  today: Appointment[]
  recent_calls: CallLog[]
  messages: Message[]
}

export interface SystemStatus {
  keys: Record<'livekit' | 'deepgram' | 'google' | 'anthropic' | 'openai' | 'elevenlabs' | 'cartesia', boolean>
  gemini_via: string
  livekit_url: string
  agent_name: string | null
  timezone: string
  server_time: string
}

export interface User {
  id: number
  email: string
  name: string
}
