import { createBrowserRouter, Navigate } from 'react-router-dom';
import { RootLayout } from '@/routes/RootLayout';
import { RequireAuth } from '@/routes/RequireAuth';
import { RequireContext } from '@/routes/RequireContext';
import { RedirectIfAuthenticated } from '@/routes/RedirectIfAuthenticated';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AppLayout } from '@/layouts/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ScanPage } from '@/pages/ScanPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { WelcomePage } from '@/pages/WelcomePage';
import { AssistantPage } from '@/pages/AssistantPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/**
 * Route table.
 *
 * Protection is structural: everything under RequireAuth is closed, and
 * a page added there is protected without touching it. Pages never test
 * authentication themselves.
 */
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          {
            element: <AuthLayout />,
            children: [
              { path: '/login', element: <LoginPage /> },
              { path: '/register', element: <RegisterPage /> },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { path: '/scan', element: <ScanPage /> },
              // Account settings need a signed-in customer, but not a
              // branch: someone should be able to fix their language
              // before scanning anything.
              { path: '/settings', element: <SettingsPage /> },
              {
                // Screens below need branch context, not just a session.
                element: <RequireContext />,
                children: [
                  { path: '/welcome', element: <WelcomePage /> },
                  { path: '/assistant', element: <AssistantPage /> },
                ],
              },
            ],
          },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: '/', element: <Navigate to="/login" replace /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
