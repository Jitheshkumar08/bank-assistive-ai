import { createBrowserRouter } from 'react-router-dom';
import { RootLayout } from '@/routes/RootLayout';
import { RequireAuth } from '@/routes/RequireAuth';
import { RequireContext } from '@/routes/RequireContext';
import { RedirectIfAuthenticated } from '@/routes/RedirectIfAuthenticated';
import { AccountLayout } from '@/layouts/AccountLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { AppLayout, type AppRouteHandle } from '@/layouts/AppLayout';
import { HomePage } from '@/pages/HomePage';
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
      // The public home page. A signed-in customer can see it too: its
      // header offers them the way back into the assistant instead of a
      // sign-in they do not need.
      { path: '/', element: <HomePage /> },
      {
        element: <RedirectIfAuthenticated />,
        children: [
          {
            // Both forms share one frame, so the toggle between them stays
            // in place while only the form beneath it changes.
            element: <AccountLayout />,
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
              {
                path: '/scan',
                element: <ScanPage />,
                // On a wide screen the camera sits beside the ways to use
                // it, which needs more than the usual reading column.
                handle: { width: 'wide' } satisfies AppRouteHandle,
              },
              // Account settings need a signed-in customer, but not a
              // branch: someone should be able to fix their language
              // before scanning anything.
              { path: '/settings', element: <SettingsPage /> },
              {
                // Screens below need branch context, not just a session.
                element: <RequireContext />,
                children: [
                  { path: '/welcome', element: <WelcomePage /> },
                  {
                    path: '/assistant',
                    element: <AssistantPage />,
                    handle: { chat: true } satisfies AppRouteHandle,
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        element: <AuthLayout />,
        children: [{ path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
]);
