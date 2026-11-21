import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'

export default function Layout() {
  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#F8F8F6' }}>
      <Sidebar />
      <main className="flex-1 ml-60 min-h-screen overflow-y-auto">
        <div className="w-full max-w-[1520px] mx-auto px-8 py-7">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
