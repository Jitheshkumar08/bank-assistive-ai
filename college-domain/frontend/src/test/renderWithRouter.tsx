import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import AppProviders from '../app/AppProviders'
import type { Services } from '../app/services'
import type { CollegeContext } from '../services/qr/qrContext'
import { routes as appRoutes } from '../routes'

export const nmamitContext: CollegeContext = {
  collegeId: 'nmamit', collegeName: 'NMAM Institute of Technology', area: 'admissions-desk', validatedAt: new Date().toISOString(), validatedBy: 'format',
}

/** Renders the real routes (or one element at /login) with the app providers inside an in-memory router. */
export function renderWithRouter(options: { path?: string; element?: ReactElement; services?: Partial<Services>; collegeContext?: CollegeContext | null } = {}) {
  const routes: RouteObject[] = options.element
    ? [{ path: '/login', element: options.element }, ...appRoutes.filter((route) => route.path !== '/login')]
    : appRoutes
  const router = createMemoryRouter(routes, { initialEntries: [options.path ?? '/login'] })
  return {
    router,
    ...render(
      <AppProviders services={options.services} initialCollegeContext={options.collegeContext ?? null}>
        <RouterProvider router={router} />
      </AppProviders>,
    ),
  }
}
