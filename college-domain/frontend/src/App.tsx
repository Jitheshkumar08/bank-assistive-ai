import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import AppProviders from './app/AppProviders'
import { routes } from './routes'

const router = createBrowserRouter(routes)

export default function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}
