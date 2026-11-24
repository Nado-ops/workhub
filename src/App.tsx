import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, isTeam, useAuth } from './auth/AuthProvider'
import { setPasswordFlow } from './lib/supabase'
import { FullScreenMessage, RequireRole } from './auth/RequireRole'
import AdminLayout from './layouts/AdminLayout'
import ClientLayout from './layouts/ClientLayout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import ComingSoon from './pages/ComingSoon'
import Overview from './pages/admin/Overview'
import Tickets from './pages/admin/Tickets'
import TicketDetail from './pages/admin/TicketDetail'
import Clients from './pages/admin/Clients'
import Team from './pages/admin/Team'
import Projects from './pages/admin/Projects'
import Finance from './pages/admin/Finance'
import ClientDashboard from './pages/client/ClientDashboard'
import MyTickets from './pages/client/MyTickets'
import ClientTicket from './pages/client/ClientTicket'
import ClientProjects from './pages/client/ClientProjects'
import ClientInvoices from './pages/client/ClientInvoices'

/** Sends each person to the right home page for their role. */
function Home() {
  const { session, profile, loading } = useAuth()
  if (loading) return <FullScreenMessage title="Loading…" />
  if (!session) return <Navigate to="/login" replace />
  if (setPasswordFlow.pending) return <Navigate to="/reset-password" replace />
  return <Navigate to={isTeam(profile) ? '/app' : '/portal'} replace />
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Admin & staff */}
          <Route path="/app" element={<RequireRole roles={['admin', 'staff']}><AdminLayout /></RequireRole>}>
            <Route index element={<Overview />} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="clients" element={<Clients />} />
            <Route path="projects" element={<Projects />} />
            <Route path="pipeline" element={<ComingSoon title="CRM pipeline" />} />
            <Route path="reports" element={<ComingSoon title="Reports" />} />
            <Route path="hr" element={<ComingSoon title="HR & people" />} />
            <Route path="finance" element={<RequireRole roles={['admin']}><Finance /></RequireRole>} />
            <Route path="study" element={<RequireRole roles={['admin']}><ComingSoon title="Study reminders" /></RequireRole>} />
            <Route path="team" element={<RequireRole roles={['admin']}><Team /></RequireRole>} />
          </Route>

          {/* Clients */}
          <Route path="/portal" element={<RequireRole roles={['client']}><ClientLayout /></RequireRole>}>
            <Route index element={<ClientDashboard />} />
            <Route path="tickets" element={<MyTickets />} />
            <Route path="tickets/:id" element={<ClientTicket />} />
            <Route path="projects" element={<ClientProjects />} />
            <Route path="invoices" element={<ClientInvoices />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
