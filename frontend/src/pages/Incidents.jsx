import React, { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Play,
  Clock,
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
  Info,
  Activity,
  ArrowRight,
  RotateCcw,
  SlidersHorizontal,
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

export default function Incidents() {
  const [currentSession, setCurrentSession] = useState(getActiveSession())
  const [availableJobs, setAvailableJobs] = useState([])
  const videoRef = useRef(null)

  // Listen to session switch events across pages
  useEffect(() => {
    const handler = (e) => {
      setCurrentSession(e.detail || 'default')
    }
    window.addEventListener('roadwatch_session_change', handler)
    return () => window.removeEventListener('roadwatch_session_change', handler)
  }, [])

  // Load available completed jobs for session selector
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

  // Fetch summary, events and vehicles from the existing FastAPI endpoints
  const summaryReq = useApi(() => api.summary(queryParams), [currentSession])
  const eventsReq = useApi(() => api.events(queryParams), [currentSession])
  const vehiclesReq = useApi(() => api.vehicles(queryParams), [currentSession])

  const sd = summaryReq.data?.summary
  const allEvents = eventsReq.data?.events ?? []
  const allVehicles = vehiclesReq.data?.vehicles ?? []

  const isLoading = summaryReq.loading || eventsReq.loading || vehiclesReq.loading
  const fetchErr = summaryReq.error || eventsReq.error || vehiclesReq.error
  const isMissing = !summaryReq.loading && summaryReq.data?.status === 'missing'

  // Selected event index or object
  const [selectedEventIndex, setSelectedEventIndex] = useState(0)

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSeverity, setSelectedSeverity] = useState('all')
  const [sortOrder, setSortOrder] = useState('asc') // 'asc' chronological | 'desc' reverse

  // Video source for active session
  const videoSrc = currentSession !== 'default'
    ? api.getJobVideoUrl(currentSession)
    : '/videos/processed_video.mp4'

  // Summary Metrics calculated dynamically from real events
  const metrics = useMemo(() => {
    const totalEvents = allEvents.length
    let highSeverity = 0
    let mediumSeverity = 0
    let lowSeverity = 0
    const vehicleIds = new Set()

    allEvents.forEach((e) => {
      if (e.severity === 'High') highSeverity++
      else if (e.severity === 'Medium') mediumSeverity++
      else if (e.severity === 'Low') lowSeverity++

      if (e.vehicle_id !== undefined && e.vehicle_id !== null) {
        vehicleIds.add(e.vehicle_id)
      }
    })

    return {
      total: totalEvents,
      high: highSeverity,
      medium: mediumSeverity,
      low: lowSeverity,
      distinctVehicles: vehicleIds.size,
    }
  }, [allEvents])

  // Sorted chronological events for timeline
  const chronologicalEvents = useMemo(() => {
    return [...allEvents].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  }, [allEvents])

  // Filtered and sorted events for table
  const filteredEvents = useMemo(() => {
    let list = [...allEvents]

    // 1. Text Search (by vehicle ID or event type)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((e) => {
        const idMatch = String(e.vehicle_id).includes(q) || `v-${e.vehicle_id}`.includes(q)
        const typeMatch = (e.type || '').toLowerCase().includes(q)
        const descMatch = (e.description || '').toLowerCase().includes(q)
        const sevMatch = (e.severity || '').toLowerCase().includes(q)
        return idMatch || typeMatch || descMatch || sevMatch
      })
    }

    // 2. Severity Filter
    if (selectedSeverity !== 'all') {
      list = list.filter((e) => (e.severity || '').toLowerCase() === selectedSeverity.toLowerCase())
    }

    // 3. Timestamp Sorting
    list.sort((a, b) => {
      const tA = a.timestamp ?? 0
      const tB = b.timestamp ?? 0
      return sortOrder === 'asc' ? tA - tB : tB - tA
    })

    return list
  }, [allEvents, searchQuery, selectedSeverity, sortOrder])

  // Active selected event
  const activeEvent = useMemo(() => {
    if (!allEvents.length) return null
    if (selectedEventIndex >= 0 && selectedEventIndex < allEvents.length) {
      return allEvents[selectedEventIndex]
    }
    return allEvents[0]
  }, [allEvents, selectedEventIndex])

  // Vehicle matched with active event
  const matchedVehicle = useMemo(() => {
    if (!activeEvent || !allVehicles.length) return null
    return allVehicles.find((v) => v.id === activeEvent.vehicle_id) || null
  }, [activeEvent, allVehicles])

  // Seek video to event timestamp
  const seekToTimestamp = (timestampSecs, eventObj = null) => {
    if (eventObj) {
      const idx = allEvents.indexOf(eventObj)
      if (idx !== -1) setSelectedEventIndex(idx)
    }

    if (videoRef.current && timestampSecs !== undefined && timestampSecs !== null) {
      videoRef.current.currentTime = Math.max(0, timestampSecs)
      videoRef.current.play().catch(() => {})
    }
  }

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
              Incident Intelligence
            </h1>
            <div className="hidden md:block h-8 w-px bg-[#D6D6D2]" />
            <p className="text-xs text-[#666666] leading-snug font-normal max-w-xs">
              Review motion anomalies detected during traffic analysis
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
                setSelectedEventIndex(0)
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
      {isLoading && <LoadingState message="Loading incident intelligence events…" />}
      {!isLoading && fetchErr && <ErrorState message={fetchErr} />}
      {!isLoading && !fetchErr && isMissing && (
        <MissingDataState message={summaryReq.data?.message} />
      )}

      {/* ── Main Content ── */}
      {!isLoading && !fetchErr && !isMissing && (
        <div className="space-y-6">
          {/* ── 2. Summary KPI Metrics Card (4 sections with thin dividers) ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs px-2 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#ECECE8]">
              {/* Metric 1: Total Motion-Anomaly Events */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Motion-Anomaly Events
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {metrics.total}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">events</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Flagged kinematic shifts
                </p>
              </div>

              {/* Metric 2: High-Severity Events */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  High-Severity Events
                </p>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl lg:text-4xl font-extrabold tracking-tight ${
                      metrics.high > 0 ? 'text-[#C92A2A]' : 'text-[#181818]'
                    }`}
                  >
                    {metrics.high}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">
                    ({metrics.total ? Math.round((metrics.high / metrics.total) * 100) : 0}%)
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Peak heuristic risk ≥ 65
                </p>
              </div>

              {/* Metric 3: Medium-Severity Events */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Medium-Severity Events
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {metrics.medium}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">
                    ({metrics.total ? Math.round((metrics.medium / metrics.total) * 100) : 0}%)
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Heuristic risk score 35–64
                </p>
              </div>

              {/* Metric 4: Affected Tracking IDs */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Affected Tracking IDs
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {metrics.distinctVehicles}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">tracks</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Distinct trajectory sequences
                </p>
              </div>
            </div>
          </div>

          {/* ── 3. Video Player & Selected Incident Detail Panel ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: CCTV Video Player Canvas (7 cols on lg, 8 on xl) */}
            <div className="lg:col-span-7 xl:col-span-8 bg-[#0F0F12] rounded-xl border border-[#26262B] overflow-hidden flex flex-col justify-between shadow-xs relative">
              {/* CCTV Overlay Top Bar */}
              <div className="absolute top-0 inset-x-0 z-20 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
                <div className="flex items-center gap-2">
                  <span className="text-[#C92A2A] font-black text-sm italic">//</span>
                  <span className="text-xs font-mono font-medium tracking-wider text-white">
                    CCTV — {sd?.video || 'traffic_footage.mp4'} (YOLO11n + ByteTrack)
                  </span>
                </div>
                <div className="bg-[#C92A2A] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-sm uppercase tracking-wider">
                  RECORDED
                </div>
              </div>

              {/* Video Monitor Canvas */}
              <div className="relative w-full h-[360px] sm:h-[400px] bg-[#0A0A0C] flex items-center justify-center overflow-hidden">
                <video
                  key={`bg_${videoSrc}`}
                  src={videoSrc}
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover filter blur-xl opacity-20 scale-110 pointer-events-none"
                />

                {/* Main Crisp Video Player */}
                <video
                  key={`fg_${videoSrc}`}
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  preload="metadata"
                  playsInline
                  className="relative z-10 max-h-full max-w-full h-[360px] sm:h-[400px] w-auto object-contain mx-auto shadow-2xl"
                >
                  Your browser does not support the video element.
                </video>
              </div>

              {/* CCTV Bottom Status Bar */}
              <div className="px-4 py-2.5 bg-[#141418] border-t border-[#222228] flex items-center justify-between text-xs text-[#999999] z-20">
                <div className="flex items-center gap-3">
                  <span>Source: {sd?.video || 'uploaded_video.mp4'}</span>
                  {activeEvent && (
                    <span className="text-white font-mono flex items-center gap-1.5">
                      <Clock size={12} className="text-[#C92A2A]" />
                      Event Timestamp: {fmtTimestamp(activeEvent.timestamp)}
                    </span>
                  )}
                </div>
                {activeEvent && (
                  <button
                    onClick={() => seekToTimestamp(activeEvent.timestamp)}
                    className="inline-flex items-center gap-1 text-white hover:text-[#C92A2A] text-xs font-bold transition-colors"
                  >
                    <Play size={11} fill="currentColor" /> Seek to Event
                  </button>
                )}
              </div>
            </div>

            {/* Right: Selected Incident Detail Inspector Panel (5 cols on lg, 4 on xl) */}
            <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-4">
              <div className="flex items-start justify-between pb-3.5 border-b border-[#ECECE8]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-[#FEE2E2] text-[#C92A2A]">
                      <AlertTriangle size={16} />
                    </span>
                    <div>
                      <h3 className="text-lg font-extrabold text-[#181818] tracking-tight">
                        Incident Details
                      </h3>
                      <p className="text-xs text-[#777777] font-medium">
                        {activeEvent ? `Event @ ${fmtTimestamp(activeEvent.timestamp)}` : 'No Event Selected'}
                      </p>
                    </div>
                  </div>
                </div>

                {activeEvent && (
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${
                      activeEvent.severity === 'High'
                        ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                        : activeEvent.severity === 'Medium'
                        ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                        : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                    }`}
                  >
                    {activeEvent.severity || 'Medium'} Severity
                  </span>
                )}
              </div>

              {activeEvent ? (
                <div className="space-y-4">
                  {/* Event Information Block */}
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                        Anomaly Classification
                      </p>
                      <p className="text-base font-extrabold text-[#181818] mt-0.5">
                        {activeEvent.type || 'Abrupt motion'}
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                        Description
                      </p>
                      <p className="text-xs text-[#444444] leading-relaxed mt-0.5 bg-[#F9F9F7] p-2.5 rounded-lg border border-[#EAEAE7]">
                        {activeEvent.description || 'Observed rapid velocity change in image coordinate space.'}
                      </p>
                    </div>
                  </div>

                  {/* Associated Vehicle Information Card */}
                  <div className="p-3.5 rounded-xl bg-[#F8F8F6] border border-[#ECECE8] space-y-3">
                    <div className="flex items-center justify-between border-b border-[#EAEAE7] pb-2">
                      <div className="flex items-center gap-2">
                        <span className="p-1 rounded bg-white text-[#181818] shadow-xs">
                          {getVehicleIcon(matchedVehicle?.type, 'w-3.5 h-3.5')}
                        </span>
                        <div>
                          <p className="text-xs font-bold text-[#181818]">
                            Track V-{activeEvent.vehicle_id}
                          </p>
                          <p className="text-[10px] text-[#777777] capitalize">
                            {matchedVehicle?.type || 'Vehicle'} Sequence
                          </p>
                        </div>
                      </div>
                      <Link
                        to="/vehicles"
                        className="text-[11px] font-bold text-[#181818] hover:text-[#C92A2A] flex items-center gap-0.5 transition-colors"
                      >
                        Inspect Track <ArrowRight size={11} />
                      </Link>
                    </div>

                    {/* Metrics 2x2 Grid */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded bg-white border border-[#EFEFEA]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                          Risk Score
                        </p>
                        <p className="text-base font-extrabold text-[#C92A2A] font-mono mt-0.5">
                          {matchedVehicle ? `${matchedVehicle.risk_score}/100` : '—'}
                        </p>
                      </div>

                      <div className="p-2 rounded bg-white border border-[#EFEFEA]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                          Avg Motion
                        </p>
                        <p className="text-base font-extrabold text-[#181818] font-mono mt-0.5">
                          {matchedVehicle?.average_motion_px_s !== undefined
                            ? `${matchedVehicle.average_motion_px_s.toFixed(1)} px/s`
                            : '—'}
                        </p>
                      </div>

                      <div className="p-2 rounded bg-white border border-[#EFEFEA]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                          Abrupt Shifts
                        </p>
                        <p className="text-base font-extrabold text-[#181818] font-mono mt-0.5">
                          {matchedVehicle?.abrupt_motion_changes !== undefined
                            ? matchedVehicle.abrupt_motion_changes
                            : '—'}
                        </p>
                      </div>

                      <div className="p-2 rounded bg-white border border-[#EFEFEA]">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                          Dwell Time
                        </p>
                        <p className="text-base font-extrabold text-[#181818] font-mono mt-0.5">
                          {matchedVehicle
                            ? `${((matchedVehicle.last_seen || 0) - (matchedVehicle.first_seen || 0)).toFixed(1)}s`
                            : '—'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Jump To Video Button */}
                  <button
                    onClick={() => seekToTimestamp(activeEvent.timestamp)}
                    className="w-full py-2.5 px-4 bg-[#181818] hover:bg-[#333333] text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-xs"
                  >
                    <Play size={13} fill="currentColor" />
                    Seek Video to {fmtTimestamp(activeEvent.timestamp)}
                  </button>

                  {/* Scientific Disclaimer Note */}
                  <div className="p-2.5 rounded-lg bg-[#F8F8F6] border border-[#ECECE8] text-[10px] text-[#777777] leading-relaxed flex items-start gap-1.5">
                    <Info size={12} className="flex-shrink-0 mt-0.5 text-[#888888]" />
                    <span>
                      <strong>Scientific Note:</strong> Motion anomalies are heuristic screening indicators based on localized image-plane velocity shifts (&gt;75 px/s). They do not confirm accidents, collisions, or moving violations.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-[#888888]">
                  No motion anomalies recorded in this analysis session.
                </div>
              )}
            </div>
          </div>

          {/* ── 4. Chronological Incident Timeline ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#ECECE8] pb-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#181818]">
                  Chronological Incident Timeline
                </h3>
                <p className="text-xs text-[#888888] mt-0.5">
                  Timeline of motion anomalies across the footage duration ({totalDuration}s)
                </p>
              </div>
              <span className="text-xs font-bold text-[#888888]">
                {chronologicalEvents.length} Event{chronologicalEvents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {chronologicalEvents.length === 0 ? (
              <p className="text-xs text-[#888888] py-4 text-center">
                No chronological events available to display.
              </p>
            ) : (
              <div className="space-y-3">
                {/* Visual Position Track Bar */}
                <div className="relative w-full h-8 bg-[#F4F4F2] rounded-lg border border-[#EAEAE7] flex items-center px-4">
                  <div className="absolute inset-x-4 h-1 bg-[#D8D8D4] rounded-full" />
                  {chronologicalEvents.map((ev, idx) => {
                    const pct = Math.max(0, Math.min(100, ((ev.timestamp ?? 0) / totalDuration) * 100))
                    const isSelected = activeEvent === ev

                    return (
                      <button
                        key={idx}
                        title={`Event @ ${fmtTimestamp(ev.timestamp)} — V-${ev.vehicle_id} (${ev.severity})`}
                        onClick={() => seekToTimestamp(ev.timestamp, ev)}
                        style={{ left: `calc(${pct}% - 8px)` }}
                        className={`absolute w-4 h-4 rounded-full border-2 transition-transform hover:scale-125 focus:outline-none ${
                          isSelected
                            ? 'bg-[#181818] border-white ring-2 ring-[#C92A2A] z-20 scale-125'
                            : ev.severity === 'High'
                            ? 'bg-[#C92A2A] border-white z-10'
                            : ev.severity === 'Medium'
                            ? 'bg-[#E07A5F] border-white z-10'
                            : 'bg-[#888888] border-white z-10'
                        }`}
                      />
                    )
                  })}
                </div>

                {/* Event Pills Carousel / Grid */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1">
                  {chronologicalEvents.map((ev, idx) => {
                    const isSelected = activeEvent === ev
                    const vehicle = allVehicles.find((v) => v.id === ev.vehicle_id)

                    return (
                      <button
                        key={idx}
                        onClick={() => seekToTimestamp(ev.timestamp, ev)}
                        className={`flex-shrink-0 text-left p-2.5 rounded-lg border text-xs transition-all ${
                          isSelected
                            ? 'bg-[#181818] text-white border-[#181818] shadow-xs'
                            : 'bg-[#F8F8F6] hover:bg-[#F2F2EE] text-[#333333] border-[#E8E8E5]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span
                            className={`font-mono font-bold text-[11px] ${
                              isSelected ? 'text-[#C92A2A]' : 'text-[#C92A2A]'
                            }`}
                          >
                            {fmtTimestamp(ev.timestamp)}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                              ev.severity === 'High'
                                ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                                : ev.severity === 'Medium'
                                ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                            }`}
                          >
                            {ev.severity || 'Medium'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 font-bold">
                          <span className={isSelected ? 'text-[#CCCCCC]' : 'text-[#666666]'}>
                            {getVehicleIcon(vehicle?.type, 'w-3 h-3')}
                          </span>
                          <span>V-{ev.vehicle_id}</span>
                          <span className={`text-[10px] font-normal ${isSelected ? 'text-[#AAAAAA]' : 'text-[#888888]'}`}>
                            ({ev.type || 'Abrupt motion'})
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── 5. Searchable & Filterable Incident Table ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs overflow-hidden space-y-3 p-4">
            {/* Table Filter & Search Controls */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#ECECE8]">
              {/* Search Box */}
              <div className="relative flex-1 max-w-md">
                <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#888888]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by vehicle ID (e.g. 20, V-20), type, severity..."
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

              {/* Severity Filter Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider mr-1">
                  Severity:
                </span>
                {[
                  { id: 'all', label: 'All', count: allEvents.length },
                  { id: 'high', label: 'High', count: metrics.high, color: 'text-[#C92A2A]' },
                  { id: 'medium', label: 'Medium', count: metrics.medium },
                  { id: 'low', label: 'Low', count: metrics.low },
                ].map(({ id, label, count, color }) => (
                  <button
                    key={id}
                    onClick={() => setSelectedSeverity(id)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      selectedSeverity === id
                        ? 'bg-[#181818] text-white shadow-xs'
                        : 'bg-[#F4F4F2] text-[#555555] hover:text-[#181818] hover:bg-[#EAEAE7]'
                    }`}
                  >
                    <span>{label}</span>
                    <span
                      className={`text-[10px] px-1 py-0.2 rounded ${
                        selectedSeverity === id
                          ? 'bg-[#333333] text-white'
                          : color || 'bg-[#E5E5E2] text-[#666666]'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                ))}

                <button
                  onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-[#F4F4F2] text-[#555555] hover:text-[#181818] hover:bg-[#EAEAE7] transition-all ml-1"
                  title="Toggle timestamp sort order"
                >
                  <Clock size={12} />
                  <span>{sortOrder === 'asc' ? 'Oldest First' : 'Newest First'}</span>
                  {sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                </button>

                {(searchQuery || selectedSeverity !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedSeverity('all')
                    }}
                    className="flex items-center gap-1 text-xs text-[#C92A2A] hover:underline font-medium ml-1"
                  >
                    <RotateCcw size={12} />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Table Element */}
            {filteredEvents.length === 0 ? (
              <div className="py-12 text-center">
                <div className="inline-flex p-3 rounded-full bg-[#F5F5F3] text-[#888888] mb-3">
                  <AlertTriangle size={24} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-[#181818]">
                  {allEvents.length === 0 ? 'No Motion Anomalies Detected' : 'No Matching Events'}
                </p>
                <p className="text-xs text-[#888888] mt-1 max-w-sm mx-auto">
                  {allEvents.length === 0
                    ? 'No vehicles exhibited repeated abrupt velocity shifts meeting the anomaly threshold.'
                    : 'No events match your active search and severity filters.'}
                </p>
                {allEvents.length > 0 && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedSeverity('all')
                    }}
                    className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#181818] text-white hover:bg-[#333333] transition-colors"
                  >
                    <RotateCcw size={12} />
                    Reset filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAEAE7] bg-[#F7F7F5] text-[#777777] font-bold text-[11px] uppercase tracking-wider select-none">
                      <th
                        className="py-3 px-4 cursor-pointer hover:text-[#181818] transition-colors"
                        onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                      >
                        <div className="flex items-center gap-1">
                          <span>Timestamp</span>
                          {sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                        </div>
                      </th>
                      <th className="py-3 px-3">Tracking ID</th>
                      <th className="py-3 px-3">Type</th>
                      <th className="py-3 px-3">Severity</th>
                      <th className="py-3 px-4">Description</th>
                      <th className="py-3 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0EE]">
                    {filteredEvents.map((ev, idx) => {
                      const isSelected = activeEvent === ev
                      const vehicle = allVehicles.find((v) => v.id === ev.vehicle_id)

                      return (
                        <tr
                          key={idx}
                          onClick={() => {
                            const origIdx = allEvents.indexOf(ev)
                            if (origIdx !== -1) setSelectedEventIndex(origIdx)
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#F2F2EE] font-semibold text-[#181818]'
                              : 'hover:bg-[#F9F9F7] text-[#333333]'
                          }`}
                        >
                          {/* Timestamp */}
                          <td className="py-3 px-4 font-mono font-bold text-[#181818]">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#C92A2A] font-bold">@</span>
                              <span>{fmtTimestamp(ev.timestamp)}</span>
                            </div>
                          </td>

                          {/* Tracking ID */}
                          <td className="py-3 px-3 font-mono font-bold text-[#181818]">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#666666]">
                                {getVehicleIcon(vehicle?.type, 'w-3.5 h-3.5')}
                              </span>
                              <span>V-{ev.vehicle_id}</span>
                            </div>
                          </td>

                          {/* Event Type */}
                          <td className="py-3 px-3 font-medium">
                            {ev.type || 'Abrupt motion'}
                          </td>

                          {/* Severity Badge */}
                          <td className="py-3 px-3">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                                ev.severity === 'High'
                                  ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                                  : ev.severity === 'Medium'
                                  ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                  : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                              }`}
                            >
                              {ev.severity || 'Medium'}
                            </span>
                          </td>

                          {/* Description */}
                          <td className="py-3 px-4 text-[#555555] max-w-md truncate">
                            {ev.description || 'Repeated abrupt changes in observed image motion'}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  seekToTimestamp(ev.timestamp, ev)
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#181818] text-white hover:bg-[#333333] text-[11px] font-bold transition-colors"
                              >
                                <Play size={10} fill="currentColor" />
                                <span>Seek</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
