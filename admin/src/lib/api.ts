const TOKEN_KEY = 'ai_reception_token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable - session-only login */
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Params = Record<string, string | number | boolean | null | undefined>

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  params?: Params
}

function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => {
        const field = d.loc ? String(d.loc[d.loc.length - 1]).replace(/_/g, ' ') : ''
        return field ? `${field}: ${d.msg}` : d.msg
      })
      .join(', ')
  }
  return 'Something went wrong'
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const qs = query.toString()
  const token = getToken()
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null)
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
  }
  if (!res.ok) {
    let message = res.statusText || 'Request failed'
    try {
      const data = await res.json()
      message = formatDetail(data.detail)
    } catch {
      /* not JSON */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export const get = <T>(path: string, params?: Params) => api<T>(path, { params })
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body })
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body })
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' })

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}
