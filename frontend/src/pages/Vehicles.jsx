import React, { useState, useMemo, useEffect } from 'react'
import {
  Car,
  Truck,
  Bus,
  Bike,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Layers,
  ChevronDown,
  X,
  AlertTriangle,
  Info,
  Clock,
  Activity,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { api } from '../services/api.js'
import { getActiveSession, setActiveSession } from '../services/session.js'
import { LoadingState, ErrorState, MissingDataState } from '../components/DataStates.jsx'

function fmtTimestamp(secs) {
  if (secs === undefined || secs === null || isNaN(secs)) return '00:00'
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  const ms = Math.floor((secs % 1) * 10)
  return `${m}:${s}.${ms}`
}

function getVehicleIcon(type, className = 'w-3.5 h-3.5') {
  const t = (type || '').toLowerCase()
  if (t === 'truck') return <Truck className={className} strokeWidth={1.8} />
  if (t === 'bus') return <Bus className={className} strokeWidth={1.8} />
  if (t === 'motorcycle') return <Bike className={className} strokeWidth={1.8} />
  return <Car className={className} strokeWidth={1.8} />
}

export default function Vehicles() {
  const [currentSession, setCurrentSession] = useState(getActiveSession())
  const [availableJobs, setAvailableJobs] = useState([])

  // Session change synchronization across tabs and pages
  useEffect(() => {
    const handler = (e) => {
      setCurrentSession(e.detail || 'default')
    }
    window.addEventListener('roadwatch_session_change', handler)
    return () => window.removeEventListener('roadwatch_session_change', handler)
  }, [])

  // Load available jobs for session dropdown
  useEffect(() => {
    api.listJobs()
      .then((res) => {
        if (res?.jobs) {
          setAvailableJobs(res.jobs.filter((j) => j.status === 'completed'))
        }
      })
      .catch(() => {})
  }, [])

  const queryParams = useMemo(() => {
    return currentSession !== 'default' ? { job_id: currentSession } : {}
  }, [currentSession])

  // Fetch summary, vehicles and events from FastAPI
  const summaryReq = useApi(() => api.summary(queryParams), [currentSession])
  const vehiclesReq = useApi(() => api.vehicles(queryParams), [currentSession])
  const eventsReq = useApi(() => api.events(queryParams), [currentSession])

  const sd = summaryReq.data?.summary
  const allVehicles = vehiclesReq.data?.vehicles ?? []
  const allEvents = eventsReq.data?.events ?? []

  const isLoading = summaryReq.loading || vehiclesReq.loading || eventsReq.loading
  const fetchErr = summaryReq.error || vehiclesReq.error || eventsReq.error
  const isMissing = !summaryReq.loading && summaryReq.data?.status === 'missing'

  // Selected vehicle for detailed inspector panel
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)

  // Filters & Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedRisk, setSelectedRisk] = useState('all')

  // Sorting state
  const [sortField, setSortField] = useState('risk_score')
  const [sortOrder, setSortOrder] = useState('desc') // 'asc' | 'desc'

  // Calculate summary counts from actual vehicle data
  const summaryCounts = useMemo(() => {
    let high = 0
    let medium = 0
    let low = 0
    let unassessable = 0

    allVehicles.forEach((v) => {
      const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
      if (!isAssessable || v.risk_level === 'Unassessable') {
        unassessable++
      } else {
        const score = v.risk_score ?? 0
        const level = v.risk_level ?? (score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low')
        if (level === 'High' || score >= 65) high++
        else if (level === 'Medium' || score >= 35) medium++
        else low++
      }
    })

    return {
      total: allVehicles.length,
      assessable: allVehicles.length - unassessable,
      unassessable,
      high,
      medium,
      low,
    }
  }, [allVehicles])

  // Vehicle type options and counts
  const typeCounts = useMemo(() => {
    const counts = { all: allVehicles.length }
    allVehicles.forEach((v) => {
      const t = (v.type || 'car').toLowerCase()
      counts[t] = (counts[t] || 0) + 1
    })
    return counts
  }, [allVehicles])

  // Filtered & Sorted vehicle list
  const filteredVehicles = useMemo(() => {
    let list = [...allVehicles]

    // 1. Text Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((v) => {
        const idMatch = String(v.id).includes(q) || `v-${v.id}`.includes(q)
        const typeMatch = (v.type || '').toLowerCase().includes(q)
        const levelMatch = (v.risk_level || '').toLowerCase().includes(q)
        const unassessableMatch = (v.observation_quality === 'insufficient' || v.risk_score === null) && ('insufficient'.includes(q) || 'unassessable'.includes(q))
        return idMatch || typeMatch || levelMatch || unassessableMatch
      })
    }

    // 2. Type Filter
    if (selectedType !== 'all') {
      list = list.filter((v) => (v.type || '').toLowerCase() === selectedType.toLowerCase())
    }

    // 3. Risk Level Filter (Low: 0–34, Medium: 35–64, High: 65–100, Unassessable)
    if (selectedRisk !== 'all') {
      list = list.filter((v) => {
        const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
        if (selectedRisk === 'unassessable') {
          return !isAssessable || v.risk_level === 'Unassessable'
        }
        if (!isAssessable) return false
        const score = v.risk_score ?? 0
        const level = v.risk_level ?? (score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low')
        if (selectedRisk === 'high') return level === 'High' || score >= 65
        if (selectedRisk === 'medium') return level === 'Medium' || (score >= 35 && score < 65)
        if (selectedRisk === 'low') return level === 'Low' || score < 35
        return true
      })
    }

    // 4. Sorting (safely handles null)
    list.sort((a, b) => {
      let aVal = a[sortField]
      let bVal = b[sortField]

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase()
        bVal = (bVal || '').toLowerCase()
        return sortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      if (aVal === null || aVal === undefined) return 1
      if (bVal === null || bVal === undefined) return -1
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })

    return list
  }, [allVehicles, searchQuery, selectedType, selectedRisk, sortField, sortOrder])

  // Active vehicle selected in inspector
  const activeVehicle = useMemo(() => {
    if (!allVehicles.length) return null
    if (selectedVehicleId !== null) {
      const found = allVehicles.find((v) => v.id === selectedVehicleId)
      if (found) return found
    }
    // Default to the first vehicle in the filtered list or overall list
    return filteredVehicles.length ? filteredVehicles[0] : allVehicles[0]
  }, [allVehicles, filteredVehicles, selectedVehicleId])

  // Events associated with active vehicle
  const vehicleEvents = useMemo(() => {
    if (!activeVehicle || !allEvents.length) return []
    return allEvents.filter((e) => e.vehicle_id === activeVehicle.id)
  }, [activeVehicle, allEvents])

  // Toggle sort handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  // Check if active vehicle has sufficient observations for risk & motion analysis
  const isVehicleAssessable = Boolean(
    activeVehicle &&
    activeVehicle.observation_quality !== 'insufficient' &&
    activeVehicle.risk_score !== null &&
    activeVehicle.risk_score !== undefined
  )

  // Circular gauge calculations for detail panel
  const riskVal = isVehicleAssessable ? (activeVehicle?.risk_score ?? 0) : 0
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = isVehicleAssessable
    ? circumference - (riskVal / 100) * circumference
    : circumference

  // Total footage duration
  const totalDuration = sd?.duration_seconds || 15.0

  return (
    <div className="space-y-6 pb-12">
      {/* ── 1. Page Header (Editorial Layout) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-[#888888] uppercase mb-1">
            TRAFFIC MONITORING SYSTEM
          </p>
          <div className="flex items-center flex-wrap gap-4">
            <h1 className="text-3xl lg:text-[2.5rem] font-extrabold tracking-tight text-[#181818] leading-none">
              Vehicle Intelligence
            </h1>
            <div className="hidden md:block h-8 w-px bg-[#D6D6D2]" />
            <p className="text-xs text-[#666666] leading-snug font-normal max-w-xs">
              YOLO11 + ByteTrack trajectory records, image motion analytics & heuristic risk scores
            </p>
          </div>
        </div>

        {/* Right Status & Session Switcher */}
        <div className="flex items-center flex-wrap gap-3 self-start sm:self-center">
          {/* Analysis Session Switcher */}
          <div className="relative inline-flex items-center bg-white border border-[#E2E2DE] rounded-full px-3 py-1 shadow-xs text-xs">
            <Layers size={13} className="text-[#888888] mr-1.5" />
            <span className="text-[10px] uppercase font-bold text-[#888888] mr-1.5 hidden md:inline">
              Session:
            </span>
            <select
              aria-label="Select analysis session"
              value={currentSession}
              onChange={(e) => {
                const val = e.target.value
                setActiveSession(val)
                setCurrentSession(val)
                setSelectedVehicleId(null)
              }}
              className="bg-transparent font-bold text-[#181818] pr-5 cursor-pointer outline-none appearance-none hover:text-[#C92A2A] transition-colors"
            >
              <option value="default">Sample Colab (15s baseline)</option>
              {availableJobs.map((j) => (
                <option key={j.job_id} value={j.job_id}>
                  {j.filename} ({j.job_id.slice(-8)})
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2 text-[#888888] pointer-events-none" />
          </div>

          {/* Session Type Pill */}
          <div className="flex items-center gap-2 bg-white border border-[#E2E2DE] px-3.5 py-1.5 rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#C92A2A] animate-pulse" />
            <span className="text-xs font-semibold text-[#181818]">
              {currentSession === 'default' ? 'Recorded Analysis' : 'Uploaded Video Job'}
            </span>
          </div>

          <span className="text-xs text-[#888888] font-medium hidden lg:inline">
            | {sd ? `${sd.duration_seconds}s Footage` : '15s Footage'}
          </span>
          <span className="text-xs text-[#888888] font-medium hidden xl:inline">
            | {sd ? `${sd.frames_processed} Frames` : '225 Frames'}
          </span>
        </div>
      </div>

      {/* ── Global States ── */}
      {isLoading && <LoadingState message="Loading vehicle intelligence records…" />}
      {!isLoading && fetchErr && <ErrorState message={fetchErr} />}
      {!isLoading && !fetchErr && isMissing && (
        <MissingDataState message={summaryReq.data?.message} />
      )}

      {/* ── Main Content ── */}
      {!isLoading && !fetchErr && !isMissing && (
        <div className="space-y-6">
          {/* ── 2. KPI Summary Section ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs px-2 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#ECECE8]">
              {/* Metric 1: Vehicle Tracks Analyzed */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Vehicle Tracks Analyzed
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {summaryCounts.total}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">trajectories</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  {summaryCounts.unassessable > 0
                    ? `${summaryCounts.assessable} assessable · ${summaryCounts.unassessable} insufficient`
                    : 'Continuous ByteTrack ID sequences'}
                </p>
              </div>

              {/* Metric 2: High-Risk Tracks */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  High-Risk Tracks
                </p>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl lg:text-4xl font-extrabold tracking-tight ${
                      summaryCounts.high > 0 ? 'text-[#C92A2A]' : 'text-[#181818]'
                    }`}
                  >
                    {summaryCounts.high}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">
                    ({summaryCounts.total ? Math.round((summaryCounts.high / summaryCounts.total) * 100) : 0}%)
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Threshold: ≥ 65/100
                </p>
              </div>

              {/* Metric 3: Medium-Risk Tracks */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Medium-Risk Tracks
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {summaryCounts.medium}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">
                    ({summaryCounts.total ? Math.round((summaryCounts.medium / summaryCounts.total) * 100) : 0}%)
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Threshold: 35–64/100
                </p>
              </div>

              {/* Metric 4: Low-Risk Tracks */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Low-Risk Tracks
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {summaryCounts.low}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">
                    ({summaryCounts.total ? Math.round((summaryCounts.low / summaryCounts.total) * 100) : 0}%)
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Threshold: 0–34/100
                </p>
              </div>
            </div>
          </div>

          {/* ── 3. Filter & Search Toolbar ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-4 space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#888888]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by ID (e.g. 20, V-20), type, or risk level..."
                  className="w-full pl-9 pr-8 py-2 text-xs font-medium text-[#181818] bg-[#F7F7F5] border border-[#E0E0DC] rounded-lg outline-none focus:border-[#181818] transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#181818]"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Right: Quick Results Count & Reset */}
              <div className="flex items-center gap-3 text-xs text-[#888888]">
                <span>
                  Showing <strong className="text-[#181818]">{filteredVehicles.length}</strong> of{' '}
                  <strong className="text-[#181818]">{allVehicles.length}</strong> tracks
                </span>
                {(searchQuery || selectedType !== 'all' || selectedRisk !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedType('all')
                      setSelectedRisk('all')
                    }}
                    className="flex items-center gap-1 text-[#C92A2A] hover:underline font-medium"
                  >
                    <RotateCcw size={12} />
                    Reset filters
                  </button>
                )}
              </div>
            </div>

            {/* Filter Pills: Type and Risk Level */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#F0F0EE]">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider mr-1">
                Type:
              </span>
              {[
                { id: 'all', label: 'All Types', count: typeCounts.all },
                { id: 'car', label: 'Car', count: typeCounts.car || 0, icon: Car },
                { id: 'truck', label: 'Truck', count: typeCounts.truck || 0, icon: Truck },
                { id: 'bus', label: 'Bus', count: typeCounts.bus || 0, icon: Bus },
                { id: 'motorcycle', label: 'Motorcycle', count: typeCounts.motorcycle || 0, icon: Bike },
              ].map(({ id, label, count, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSelectedType(id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    selectedType === id
                      ? 'bg-[#181818] text-white shadow-xs'
                      : 'bg-[#F4F4F2] text-[#555555] hover:text-[#181818] hover:bg-[#EAEAE7]'
                  }`}
                >
                  {Icon && <Icon size={12} strokeWidth={2} />}
                  <span>{label}</span>
                  <span
                    className={`text-[10px] px-1 py-0.2 rounded ${
                      selectedType === id ? 'bg-[#333333] text-white' : 'bg-[#E5E5E2] text-[#666666]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}

              <div className="h-4 w-px bg-[#E2E2DE] mx-1 hidden sm:block" />

              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider mr-1">
                Risk:
              </span>
              {[
                { id: 'all', label: 'All Levels' },
                { id: 'high', label: 'High (≥65)', count: summaryCounts.high, color: 'text-[#C92A2A]' },
                { id: 'medium', label: 'Medium (35–64)', count: summaryCounts.medium },
                { id: 'low', label: 'Low (0–34)', count: summaryCounts.low },
                ...(summaryCounts.unassessable > 0
                  ? [{ id: 'unassessable', label: 'Insufficient Data', count: summaryCounts.unassessable, color: 'text-[#888888]' }]
                  : []),
              ].map(({ id, label, count, color }) => (
                <button
                  key={id}
                  onClick={() => setSelectedRisk(id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    selectedRisk === id
                      ? 'bg-[#181818] text-white shadow-xs'
                      : 'bg-[#F4F4F2] text-[#555555] hover:text-[#181818] hover:bg-[#EAEAE7]'
                  }`}
                >
                  <span>{label}</span>
                  {count !== undefined && (
                    <span
                      className={`text-[10px] px-1 py-0.2 rounded ${
                        selectedRisk === id
                          ? 'bg-[#333333] text-white'
                          : color || 'bg-[#E5E5E2] text-[#666666]'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* ── 4. Main Two-Column Layout: Table + Detail Inspector ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Vehicle Table (8 cols on lg) */}
            <div className="lg:col-span-7 xl:col-span-8 bg-white rounded-xl border border-[#E5E5E2] shadow-xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#ECECE8] flex items-center justify-between bg-[#FAFAF8]">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal size={14} className="text-[#888888]" />
                  <span className="text-xs font-bold uppercase tracking-wider text-[#181818]">
                    Tracked Vehicles Table
                  </span>
                </div>
                <span className="text-[11px] text-[#888888]">
                  Click row to inspect vehicle details
                </span>
              </div>

              {filteredVehicles.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="inline-flex p-3 rounded-full bg-[#F5F5F3] text-[#888888] mb-3">
                    <Car size={24} strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-semibold text-[#181818]">No matching vehicle tracks</p>
                  <p className="text-xs text-[#888888] mt-1 max-w-sm mx-auto">
                    No vehicles match your active search and filter criteria. Try adjusting the search keywords or filters.
                  </p>
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedType('all')
                      setSelectedRisk('all')
                    }}
                    className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#181818] text-white hover:bg-[#333333] transition-colors"
                  >
                    <RotateCcw size={12} />
                    Reset all filters
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#EAEAE7] bg-[#F7F7F5] text-[#777777] font-bold text-[11px] uppercase tracking-wider select-none">
                        <th
                          className="py-3 px-4 cursor-pointer hover:text-[#181818] transition-colors"
                          onClick={() => handleSort('id')}
                        >
                          <div className="flex items-center gap-1">
                            <span>ID</span>
                            {sortField === 'id' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th
                          className="py-3 px-3 cursor-pointer hover:text-[#181818] transition-colors"
                          onClick={() => handleSort('type')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Type</span>
                            {sortField === 'type' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th
                          className="py-3 px-3 cursor-pointer hover:text-[#181818] transition-colors"
                          onClick={() => handleSort('risk_score')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Risk Score</span>
                            {sortField === 'risk_score' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th
                          className="py-3 px-3 cursor-pointer hover:text-[#181818] transition-colors"
                          onClick={() => handleSort('average_motion_px_s')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Avg Motion</span>
                            {sortField === 'average_motion_px_s' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th
                          className="py-3 px-3 cursor-pointer hover:text-[#181818] transition-colors"
                          onClick={() => handleSort('abrupt_motion_changes')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Abrupt Shifts</span>
                            {sortField === 'abrupt_motion_changes' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th
                          className="py-3 px-3 cursor-pointer hover:text-[#181818] transition-colors hidden sm:table-cell"
                          onClick={() => handleSort('frames_tracked')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Frames</span>
                            {sortField === 'frames_tracked' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th
                          className="py-3 px-3 cursor-pointer hover:text-[#181818] transition-colors hidden md:table-cell"
                          onClick={() => handleSort('first_seen')}
                        >
                          <div className="flex items-center gap-1">
                            <span>Timeline</span>
                            {sortField === 'first_seen' ? (
                              sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                            ) : (
                              <ArrowUpDown size={11} className="opacity-40" />
                            )}
                          </div>
                        </th>
                        <th className="py-3 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F0EE]">
                      {filteredVehicles.map((v) => {
                        const isSelected = activeVehicle?.id === v.id
                        const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
                        const score = v.risk_score ?? 0
                        const level = isAssessable
                          ? (v.risk_level ?? (score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low'))
                          : 'Unassessable'

                        return (
                          <tr
                            key={v.id}
                            onClick={() => setSelectedVehicleId(v.id)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#F2F2EE] font-semibold text-[#181818]'
                                : 'hover:bg-[#F9F9F7] text-[#333333]'
                            }`}
                          >
                            {/* Tracking ID */}
                            <td className="py-3 px-4 font-mono font-bold text-[#181818]">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    !isAssessable
                                      ? 'bg-[#B0B0A8]'
                                      : level === 'High'
                                      ? 'bg-[#C92A2A]'
                                      : level === 'Medium'
                                      ? 'bg-[#E07A5F]'
                                      : 'bg-[#888888]'
                                  }`}
                                />
                                <span>V-{v.id}</span>
                              </div>
                            </td>

                            {/* Vehicle Type */}
                            <td className="py-3 px-3 capitalize font-medium">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[#666666]">{getVehicleIcon(v.type)}</span>
                                <span>{v.type}</span>
                              </div>
                            </td>

                            {/* Risk Score & Level */}
                            <td className="py-3 px-3">
                              {isAssessable ? (
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`font-black tracking-tight text-sm ${
                                      level === 'High'
                                        ? 'text-[#C92A2A]'
                                        : level === 'Medium'
                                        ? 'text-[#B45309]'
                                        : 'text-[#4B5563]'
                                    }`}
                                  >
                                    {score}
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                      level === 'High'
                                        ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                                        : level === 'Medium'
                                        ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                        : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                                    }`}
                                  >
                                    {level}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm text-[#888888]">—</span>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]">
                                    Insufficient Data
                                  </span>
                                </div>
                              )}
                            </td>

                            {/* Average Motion */}
                            <td className="py-3 px-3 font-mono text-[#444444]">
                              {v.average_motion_px_s !== null && v.average_motion_px_s !== undefined ? (
                                <div className="flex items-center gap-1.5">
                                  <span>{v.average_motion_px_s.toFixed(1)}</span>
                                  <span className="text-[10px] text-[#888888]">px/s</span>
                                </div>
                              ) : (
                                <span className="text-[#888888] font-sans italic text-xs" title="Insufficient observations (< 2 frames)">
                                  Unavailable
                                </span>
                              )}
                            </td>

                            {/* Abrupt Motion Changes */}
                            <td className="py-3 px-3">
                              {isAssessable ? (
                                <span
                                  className={`font-mono font-semibold ${
                                    v.abrupt_motion_changes >= 2
                                      ? 'text-[#C92A2A] font-bold'
                                      : 'text-[#666666]'
                                  }`}
                                >
                                  {v.abrupt_motion_changes ?? 0}
                                </span>
                              ) : (
                                <span className="text-[#888888]">—</span>
                              )}
                            </td>

                            {/* Frames Tracked */}
                            <td className="py-3 px-3 font-mono text-[#666666] hidden sm:table-cell">
                              {v.frames_tracked ?? 0} f
                            </td>

                            {/* Timeline: First seen → Last seen */}
                            <td className="py-3 px-3 text-[#666666] font-mono text-[11px] hidden md:table-cell">
                              {v.first_seen === v.last_seen
                                ? `${v.first_seen?.toFixed(1)}s (1 frame)`
                                : `${v.first_seen?.toFixed(1)}s → ${v.last_seen?.toFixed(1)}s`}
                            </td>

                            {/* Action Button */}
                            <td className="py-3 px-3 text-right">
                              <span
                                className={`inline-flex items-center px-2 py-1 rounded text-[11px] font-bold transition-all ${
                                  isSelected
                                    ? 'bg-[#181818] text-white'
                                    : 'text-[#888888] hover:text-[#181818]'
                                }`}
                              >
                                Inspect
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Right Column: Detailed Vehicle Inspector Panel (4 or 5 cols on lg) */}
            <div className="lg:col-span-5 xl:col-span-4 sticky top-6 space-y-4">
              {activeVehicle ? (
                <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-5">
                  {/* Panel Top Header */}
                  <div className="flex items-start justify-between pb-4 border-b border-[#ECECE8]">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-[#F5F5F3] text-[#181818]">
                          {getVehicleIcon(activeVehicle.type, 'w-4 h-4')}
                        </span>
                        <div>
                          <h3 className="text-xl font-extrabold text-[#181818] tracking-tight">
                            Track V-{activeVehicle.id}
                          </h3>
                          <p className="text-xs text-[#777777] capitalize font-medium">
                            {activeVehicle.type} sequence
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Risk Badge */}
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-md border ${
                        !isVehicleAssessable
                          ? 'bg-[#F3F4F6] text-[#6B7280] border-[#D1D5DB]'
                          : activeVehicle.risk_level === 'High'
                          ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                          : activeVehicle.risk_level === 'Medium'
                          ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                          : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                      }`}
                    >
                      {!isVehicleAssessable ? 'Insufficient Data' : `${activeVehicle.risk_level ?? 'Low'} Risk`}
                    </span>
                  </div>

                  {/* Risk Score & Gauge */}
                  <div className="py-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-[#666666] mb-1">
                        Heuristic Risk Score
                      </p>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-4xl lg:text-5xl font-black tracking-tight ${isVehicleAssessable ? 'text-[#C92A2A]' : 'text-[#888888]'}`}>
                          {isVehicleAssessable ? riskVal : '—'}
                        </span>
                        {isVehicleAssessable && (
                          <span className="text-xl font-bold text-[#888888]">/100</span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#888888] mt-1">
                        {!isVehicleAssessable
                          ? 'Track observed in 1 frame. Insufficient history for risk scoring.'
                          : activeVehicle.risk_level === 'High'
                          ? 'Elevated risk from repeated abrupt motion'
                          : activeVehicle.risk_level === 'Medium'
                          ? 'Moderate velocity fluctuations recorded'
                          : 'Nominal motion within baseline tolerances'}
                      </p>
                    </div>

                    {/* Circular Gauge */}
                    <div className="relative w-20 h-20 flex items-center justify-center">
                      <svg className="w-20 h-20 transform -rotate-90">
                        <circle
                          cx="40"
                          cy="40"
                          r={radius}
                          stroke="#EAEAE7"
                          strokeWidth="7"
                          fill="transparent"
                        />
                        <circle
                          cx="40"
                          cy="40"
                          r={radius}
                          stroke={isVehicleAssessable ? '#C92A2A' : '#D1D5DB'}
                          strokeWidth="7"
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                          fill="transparent"
                          className="transition-all duration-700 ease-out"
                        />
                      </svg>
                      <div className="absolute text-center">
                        <span className="text-sm font-black text-[#181818]">
                          {isVehicleAssessable ? `${riskVal}%` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Metrics 2x2 Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-lg bg-[#F8F8F6] border border-[#ECECE8]">
                      <div className="flex items-center gap-1 text-[#888888] mb-1">
                        <Activity size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          Avg Motion
                        </span>
                      </div>
                      <p className="text-lg font-extrabold text-[#181818] font-mono">
                        {isVehicleAssessable && activeVehicle.average_motion_px_s !== null
                          ? `${activeVehicle.average_motion_px_s.toFixed(1)}`
                          : '—'}
                        {isVehicleAssessable && activeVehicle.average_motion_px_s !== null && (
                          <span className="text-xs font-normal text-[#888888] ml-1">px/s</span>
                        )}
                      </p>
                      <p className="text-[10px] text-[#888888] mt-0.5">
                        {isVehicleAssessable ? (activeVehicle.frames_tracked === 2 ? 'Instantaneous (2 frames)' : '2D image-plane speed') : 'Unavailable (< 2 frames)'}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-[#F8F8F6] border border-[#ECECE8]">
                      <div className="flex items-center gap-1 text-[#888888] mb-1">
                        <AlertTriangle size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          Abrupt Shifts
                        </span>
                      </div>
                      <p
                        className={`text-lg font-extrabold font-mono ${
                          isVehicleAssessable && activeVehicle.abrupt_motion_changes >= 2 ? 'text-[#C92A2A]' : 'text-[#181818]'
                        }`}
                      >
                        {isVehicleAssessable ? (activeVehicle.abrupt_motion_changes ?? 0) : '—'}
                      </p>
                      <p className="text-[10px] text-[#888888] mt-0.5">
                        {isVehicleAssessable ? (activeVehicle.frames_tracked === 2 ? 'Requires ≥3 frames' : '>75 px/s acceleration') : 'Not measurable'}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-[#F8F8F6] border border-[#ECECE8]">
                      <div className="flex items-center gap-1 text-[#888888] mb-1">
                        <Clock size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          Dwell Time
                        </span>
                      </div>
                      <p className="text-lg font-extrabold text-[#181818] font-mono">
                        {activeVehicle.last_seen === activeVehicle.first_seen
                          ? '<0.1'
                          : ((activeVehicle.last_seen || 0) - (activeVehicle.first_seen || 0)).toFixed(1)}
                        <span className="text-xs font-normal text-[#888888] ml-1">sec</span>
                      </p>
                      <p className="text-[10px] text-[#888888] mt-0.5">
                        {activeVehicle.last_seen === activeVehicle.first_seen ? '1 frame presence' : 'Footage presence'}
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-[#F8F8F6] border border-[#ECECE8]">
                      <div className="flex items-center gap-1 text-[#888888] mb-1">
                        <Car size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">
                          Frames
                        </span>
                      </div>
                      <p className="text-lg font-extrabold text-[#181818] font-mono">
                        {activeVehicle.frames_tracked ?? 0}
                        <span className="text-xs font-normal text-[#888888] ml-1">f</span>
                      </p>
                      <p className="text-[10px] text-[#888888] mt-0.5">
                        {isVehicleAssessable ? 'Tracked detections' : 'Unconfirmed track'}
                      </p>
                    </div>
                  </div>

                  {!isVehicleAssessable && (
                    <div className="p-2.5 rounded-lg bg-[#F8F8F6] border border-[#ECECE8] text-[11px] text-[#666666] flex items-start gap-2">
                      <Info size={13} className="text-[#888888] shrink-0 mt-0.5" />
                      <span>
                        This track was observed in only 1 frame. Velocity and risk scoring require at least 2 consecutive positions over time and are withheld to prevent misleading scores.
                      </span>
                    </div>
                  )}

                  {/* Temporal Position in Footage */}
                  <div className="p-3 rounded-lg bg-[#F8F8F6] border border-[#ECECE8] space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-[#777777]">
                      <span className="font-semibold">Temporal Coverage</span>
                      <span className="font-mono">
                        {fmtTimestamp(activeVehicle.first_seen)} → {fmtTimestamp(activeVehicle.last_seen)}
                      </span>
                    </div>
                    {/* Visual Progress Bar */}
                    <div className="w-full bg-[#E5E5E2] h-2 rounded-full relative overflow-hidden">
                      <div
                        className="absolute h-full bg-[#181818] rounded-full"
                        style={{
                          left: `${Math.max(0, Math.min(100, ((activeVehicle.first_seen || 0) / totalDuration) * 100))}%`,
                          width: `${Math.max(
                            3,
                            Math.min(
                              100,
                              (((activeVehicle.last_seen || 0) - (activeVehicle.first_seen || 0)) / totalDuration) * 100
                            )
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Associated Events List */}
                  <div className="space-y-2 pt-1 border-t border-[#ECECE8]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-[#181818]">
                        Associated Anomaly Events
                      </span>
                      <span className="text-[11px] font-semibold text-[#888888]">
                        {vehicleEvents.length} event{vehicleEvents.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {vehicleEvents.length === 0 ? (
                      <p className="text-xs text-[#888888] bg-[#F8F8F6] p-3 rounded-lg border border-[#ECECE8]">
                        No motion anomaly events recorded for this vehicle.
                        (Events are triggered when a vehicle displays ≥ 2 abrupt image motion shifts.)
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {vehicleEvents.map((ev, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-[#C92A2A] flex items-center gap-1">
                                <AlertTriangle size={12} />
                                {ev.type || 'Abrupt Motion'}
                              </span>
                              <span className="font-mono text-[10px] text-[#888888]">
                                {fmtTimestamp(ev.timestamp)}
                              </span>
                            </div>
                            <p className="text-[#555555] text-[11px] leading-relaxed">
                              {ev.description || 'Observed rapid velocity change in image coordinate space.'}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Methodological Integrity Note */}
                  <div className="pt-2 text-[10px] text-[#888888] leading-normal border-t border-[#ECECE8] space-y-1">
                    <p className="flex items-start gap-1">
                      <Info size={11} className="mt-0.5 flex-shrink-0 text-[#888888]" />
                      <span>
                        <strong>Note:</strong> Tracking IDs represent continuous detected trajectory sequences, not guaranteed unique physical vehicles. Image motion is in px/s, not km/h.
                      </span>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-8 text-center text-secondary">
                  <p className="text-xs">Select a vehicle from the table to view detailed trajectory analytics.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
