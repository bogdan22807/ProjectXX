import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

export function MainLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    setMobileNavOpen(false)
  }, [pathname])

  return (
    <div className="flex min-h-screen bg-[#0c0e14]">
      <Sidebar className="hidden md:flex" />

      <button
        type="button"
        aria-label="Close navigation"
        onClick={() => setMobileNavOpen(false)}
        className={`fixed inset-0 z-30 bg-black/60 transition-opacity md:hidden ${
          mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <Sidebar
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] transition-transform duration-200 ease-out md:hidden ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        onNavigate={() => setMobileNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
