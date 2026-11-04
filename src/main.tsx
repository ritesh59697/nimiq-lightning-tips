import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Dev-only: `import.meta.env.DEV` keeps this out of production bundles.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK_BACKEND === 'true') {
  const { installMockBackend } = await import('./lib/mock-backend')
  installMockBackend()
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root element')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
