import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'
import { syncClinicClock } from './lib/format'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
  },
})

async function start() {
  try {
    // Use the clinic's clock for "today" and "5 minutes ago", whatever timezone this browser is in.
    const res = await fetch('/api/health')
    syncClinicClock((await res.json()).time)
  } catch {
    /* backend not reachable yet - fall back to the browser clock */
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <Toaster position="top-right" richColors closeButton />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

start()
