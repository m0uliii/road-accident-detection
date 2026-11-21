import React from 'react'
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/',          label: 'Overview',       end: true },
  { to: '/analysis',  label: 'Video Analysis' },
  { to: '/vehicles',  label: 'Vehicles' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/reports',   label: 'Reports' },
]

export default function Sidebar() {
  return (
    <aside
      className="fixed inset-y-0 left-0 w-60 flex flex-col border-r border-[#E8E8E5] z-20 select-none justify-between"
      style={{ backgroundColor: '#F5F5F3' }}
    >
      <div>
        {/* Brand Header */}
        <div className="px-6 pt-7 pb-6">
          <div className="flex items-center gap-1.5">
            <span className="text-[#C92A2A] font-black text-xl italic tracking-tighter">
              //
            </span>
            <span className="text-xl font-black italic tracking-tight text-[#181818]">
              RoadWatch
            </span>
          </div>
          <p className="text-[9px] font-bold tracking-[0.22em] text-[#888888] mt-1.5 uppercase">
            TRAFFIC INTELLIGENCE
          </p>
        </div>

        {/* Navigation list */}
        <nav className="px-4 py-3 space-y-1.5">
          {NAV_ITEMS.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                [
                  'block px-4 py-2.5 rounded-lg text-sm transition-all duration-150',
                  isActive
                    ? 'bg-[#181818] text-white font-semibold shadow-sm'
                    : 'text-[#4A4A4A] hover:text-[#181818] hover:bg-[#EAEAE7] font-medium',
                ].join(' ')
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Decorative Bottom Section matching target reference */}
      <div className="relative overflow-hidden border-t border-[#E8E8E5] pt-6 pb-6 px-6">
        {/* Subtle bridge / overpass architectural graphic */}
        <div className="absolute right-0 bottom-0 opacity-15 pointer-events-none w-36 h-28">
          <svg viewBox="0 0 200 150" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full object-cover">
            <path d="M0 130 C 50 110, 100 80, 200 60 L 200 150 L 0 150 Z" fill="#181818" />
            <path d="M0 100 C 60 75, 120 50, 200 35 L 200 60 C 120 75, 60 100, 0 125 Z" fill="#555" />
            <line x1="40" y1="95" x2="40" y2="150" stroke="#181818" strokeWidth="6" />
            <line x1="110" y1="65" x2="110" y2="150" stroke="#181818" strokeWidth="6" />
            <line x1="170" y1="45" x2="170" y2="150" stroke="#181818" strokeWidth="6" />
          </svg>
        </div>

        <div className="relative z-10">
          <p className="text-[10px] font-bold tracking-[0.16em] text-[#777777] uppercase leading-tight">
            ROAD SAFETY<br />
            INTELLIGENCE<br />
            MONITORING
          </p>
          <div className="text-[#C92A2A] font-black text-lg italic mt-1">/</div>
        </div>
      </div>
    </aside>
  )
}
