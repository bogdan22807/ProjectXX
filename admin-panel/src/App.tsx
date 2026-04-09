import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

/** Matches Vite `base` so routing works on GitHub Pages (`/repo-name/`). */
const routerBasename =
  (import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL.slice(0, -1)
    : import.meta.env.BASE_URL) || undefined
import { AppStateProvider } from './context/AppState'
import { MainLayout } from './components/layout/MainLayout'
import { DashboardPage } from './pages/DashboardPage'
import { ProxiesPage } from './pages/ProxiesPage'
import { BrowserProfilesPage } from './pages/BrowserProfilesPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <AppStateProvider>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="proxies" element={<ProxiesPage />} />
            <Route path="profiles" element={<BrowserProfilesPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppStateProvider>
    </BrowserRouter>
  )
}
