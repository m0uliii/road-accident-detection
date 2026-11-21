import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Overview from './pages/Overview.jsx'
import VideoAnalysis from './pages/VideoAnalysis.jsx'
import Vehicles from './pages/Vehicles.jsx'
import Incidents from './pages/Incidents.jsx'
import Reports from './pages/Reports.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="analysis" element={<VideoAnalysis />} />
          <Route path="vehicles" element={<Vehicles />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
