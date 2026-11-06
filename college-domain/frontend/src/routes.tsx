import { Navigate, type RouteObject } from 'react-router'
import AppLayout from './components/app/AppLayout'
import AdminShell from './components/admin/AdminShell'
import RequireAuth, { RoleHomeRedirect } from './components/auth/RequireAuth'
import ActivatePage from './pages/ActivatePage'
import AdminDashboardPage from './pages/admin/AdminDashboardPage'
import AdmissionYearsPage from './pages/admin/AdmissionYearsPage'
import ImportAdmissionsPage from './pages/admin/ImportAdmissionsPage'
import ImportDetailPage from './pages/admin/ImportDetailPage'
import ImportHistoryPage from './pages/admin/ImportHistoryPage'
import QrCodesPage from './pages/admin/QrCodesPage'
import StaffProfilePage from './pages/admin/StaffProfilePage'
import StudentDetailPage from './pages/admin/StudentDetailPage'
import StudentRecordsPage from './pages/admin/StudentRecordsPage'
import AdmissionDashboardPage from './pages/app/AdmissionDashboardPage'
import AdmissionProcessPage from './pages/app/AdmissionProcessPage'
import AssistantPage from './pages/app/AssistantPage'
import DocumentsPage from './pages/app/DocumentsPage'
import FeesPage from './pages/app/FeesPage'
import HelpPage from './pages/app/HelpPage'
import HomePage from './pages/app/HomePage'
import ProfilePage from './pages/app/ProfilePage'
import ResourcesPage from './pages/app/ResourcesPage'
import ResultPage from './pages/app/ResultPage'
import ScanPage from './pages/app/ScanPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SignUpPage from './pages/SignUpPage'
import AuditLogPage from './pages/superAdmin/AuditLogPage'
import CollegeAdminsPage from './pages/superAdmin/CollegeAdminsPage'
import QrManagementPage from './pages/superAdmin/QrManagementPage'
import SuperAdminDashboardPage from './pages/superAdmin/SuperAdminDashboardPage'
import VerifyEmailPage from './pages/VerifyEmailPage'

/** Application routes; shared by the browser router and tests. Emailed links land on /verify-email and /reset-password. */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/home" replace /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/signup', element: <SignUpPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/activate', element: <ActivatePage /> },
  // Common entry after login: each account goes to its own portal (role from the server).
  { path: '/dashboard', element: <RoleHomeRedirect /> },
  { path: '/scan', element: <ScanPage /> },
  {
    element: <AppLayout />,
    children: [
      { path: '/home', element: <HomePage /> },
      // Personalised, QR-context pages: student login required (the backend also authorises every result request).
      { path: '/admission', element: <RequireAuth roles={['STUDENT']}><AdmissionDashboardPage /></RequireAuth> },
      { path: '/resources', element: <ResourcesPage /> },
      { path: '/documents', element: <DocumentsPage /> },
      { path: '/admission-process', element: <AdmissionProcessPage /> },
      { path: '/fees', element: <FeesPage /> },
      { path: '/assistant', element: <RequireAuth roles={['STUDENT']}><AssistantPage /></RequireAuth> },
      // Student-only pages; everything else (documents, process, fees…) stays public by design.
      { path: '/result', element: <RequireAuth roles={['STUDENT']}><ResultPage /></RequireAuth> },
      { path: '/profile', element: <RequireAuth roles={['STUDENT']}><ProfilePage /></RequireAuth> },
      { path: '/help', element: <HelpPage /> },
    ],
  },
  {
    // College Admin portal (the backend enforces COLLEGE_ADMIN on every /api/admin call).
    path: '/admin',
    element: <RequireAuth roles={['COLLEGE_ADMIN']}><AdminShell portal="college" /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/admin/dashboard" replace /> },
      { path: 'dashboard', element: <AdminDashboardPage /> },
      { path: 'students', element: <StudentRecordsPage /> },
      { path: 'students/:id', element: <StudentDetailPage /> },
      { path: 'imports', element: <ImportHistoryPage /> },
      { path: 'imports/new', element: <ImportAdmissionsPage /> },
      { path: 'imports/:id', element: <ImportDetailPage /> },
      { path: 'admission-years', element: <AdmissionYearsPage /> },
      { path: 'qr-codes', element: <QrCodesPage /> },
      { path: 'profile', element: <StaffProfilePage /> },
    ],
  },
  {
    // Super Admin portal (the backend enforces SUPER_ADMIN on every /api/super-admin call).
    path: '/super-admin',
    element: <RequireAuth roles={['SUPER_ADMIN']}><AdminShell portal="super" /></RequireAuth>,
    children: [
      { index: true, element: <Navigate to="/super-admin/dashboard" replace /> },
      { path: 'dashboard', element: <SuperAdminDashboardPage /> },
      { path: 'college-admins', element: <CollegeAdminsPage /> },
      { path: 'qr-codes', element: <QrManagementPage /> },
      { path: 'audit-log', element: <AuditLogPage /> },
      { path: 'profile', element: <StaffProfilePage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
