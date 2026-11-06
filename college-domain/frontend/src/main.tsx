import '@fontsource-variable/inter'
import '@fontsource-variable/fraunces'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'
import './styles/app-tokens.css'
import './components/ui/ui.css'
import './components/app/app-components.css'
import './components/content/content.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
