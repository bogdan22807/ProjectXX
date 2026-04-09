import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppStateProvider } from './context/AppState'
import { MainLayout } from './components/layout/MainLayout'
import { DashboardPage } from './pages/DashboardPage'
import { AccountDetailPage } from './pages/AccountDetailPage'
import { AccountsPage } from './pages/AccountsPage'
import { ProxiesPage } from './pages/ProxiesPage'
import { BrowserProfilesPage } from './pages/BrowserProfilesPage'
import { LogsPage } from './pages/LogsPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  return (
    <BrowserRouter>
      <AppStateProvider>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="accounts/:accountId" element={<AccountDetailPage />} />
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
