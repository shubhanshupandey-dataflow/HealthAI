import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { get } from './api'
import type { ClinicSettings, Doctor, Service } from './types'

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export const useServices = () => useQuery({ queryKey: ['services'], queryFn: () => get<Service[]>('/services') })
export const useDoctors = () => useQuery({ queryKey: ['doctors'], queryFn: () => get<Doctor[]>('/doctors') })
export const useClinic = () =>
  useQuery({ queryKey: ['settings', 'clinic'], queryFn: () => get<ClinicSettings>('/settings/clinic') })
