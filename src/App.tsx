import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, isTeam, useAuth } from './auth/AuthProvider'
import { setPasswordFlow } from './lib/supabase'
import { FullScreenMessage, RequireRole } from './auth/RequireRole'
import AdminLayout from './layouts/AdminLayout'
import ClientLayout from './layouts/ClientLayout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Overview from './pages/admin/Overview'
import Tickets from './pages/admin/Tickets'
import TicketDetail from './pages/admin/TicketDetail'
import Clients from './pages/admin/Clients'
import Team from './pages/admin/Team'
import Projects from './pages/admin/Projects'
import Finance from './pages/admin/Finance'
import Pipeline from './pages/admin/Pipeline'
import Reports from './pages/admin/Reports'
import HR from './pages/admin/HR'
import Study from './pages/admin/Study'
import Vendors from './pages/admin/Vendors'
import MyWork from './pages/admin/MyWork'
import Tasks from './pages/admin/Tasks'
import Knowledge from './pages/admin/Knowledge'
import Announcements from './pages/admin/Announcements'
import Calendar from './pages/admin/Calendar'
import ActivityLog from './pages/admin/ActivityLog'
import PrintDocument from './pages/PrintDocument'
import MonthlyReport from './pages/MonthlyReport'
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
          <Route path="/print/doc/:id" element={<RequireRole roles={['admin', 'client']}><PrintDocument /></RequireRole>} />
          <Route path="/app/report" element={<RequireRole roles={['admin', 'staff']}><MonthlyReport /></RequireRole>} />
          <Route path="/portal/report" element={<RequireRole roles={['client']}><MonthlyReport /></RequireRole>} />
          <Route path="/app" element={<RequireRole roles={['admin', 'staff']}><AdminLayout /></RequireRole>}>
            <Route index element={<Overview />} />
            <Route path="my-work" element={<MyWork />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="knowledge" element={<Knowledge />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="activity" element={<RequireRole roles={['admin']}><ActivityLog /></RequireRole>} />
            <Route path="tickets" element={<Tickets />} />
            <Route path="tickets/:id" element={<TicketDetail />} />
            <Route path="clients" element={<Clients />} />
            <Route path="projects" element={<Projects />} />
            <Route path="pipeline" element={<Pipeline />} />
            <Route path="reports" element={<Reports />} />
            <Route path="hr" element={<HR />} />
            <Route path="finance" element={<RequireRole roles={['admin']}><Finance /></RequireRole>} />
            <Route path="study" element={<RequireRole roles={['admin']}><Study /></RequireRole>} />
            <Route path="vendors" element={<RequireRole roles={['admin']}><Vendors /></RequireRole>} />
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
