import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import Layout from './components/Layout'
import { LoadingBlock } from './components/ui'
import { getToken } from './lib/api'
import Appointments from './pages/Appointments'
import Calls from './pages/Calls'
import Dashboard from './pages/Dashboard'
import DoctorDetail from './pages/DoctorDetail'
import Doctors from './pages/Doctors'
import Login from './pages/Login'
import Messages from './pages/Messages'
import PatientDetail from './pages/PatientDetail'
import Patients from './pages/Patients'
import Services from './pages/Services'
import Settings from './pages/Settings'

// The assistant (LiveKit client SDK) is large - only loaded when someone opens it.
const Assistant = lazy(() => import('./pages/Assistant'))

/** Public call page from a share link - no sign-in. */
function TryAssistant() {
  const { token = '' } = useParams()
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Assistant shareToken={token} />
    </Suspense>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/try/:token" element={<TryAssistant />} />
      {/* full-screen call page, opened in its own tab from the sidebar */}
      <Route
        path="/assistant"
        element={
          <RequireAuth>
            <Suspense fallback={<LoadingBlock />}>
              <Assistant />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="doctors" element={<Doctors />} />
        <Route path="doctors/:id" element={<DoctorDetail />} />
        <Route path="services" element={<Services />} />
        <Route path="calls" element={<Calls />} />
        <Route path="messages" element={<Messages />} />
        <Route path="settings" element={<Settings />} />
        <Route path="test-call" element={<Navigate to="/assistant" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
