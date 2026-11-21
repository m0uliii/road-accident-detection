import React, { useRef, useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown, Info, Layers } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
} from 'recharts'
import { useApi } from '../hooks/useApi.js'
import { api } from '../services/api.js'
import { getActiveSession, setActiveSession } from '../services/session.js'
import { LoadingState, ErrorState, MissingDataState } from '../components/DataStates.jsx'

function fmtTimestamp(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function Overview() {
  const [currentSession, setCurrentSession] = useState(getActiveSession())
  const [availableJobs, setAvailableJobs] = useState([])

  // Listen to session switch events from VideoAnalysis or header
  useEffect(() => {
    const handler = (e) => {
      setCurrentSession(e.detail || 'default')
    }
    window.addEventListener('roadwatch_session_change', handler)
    return () => window.removeEventListener('roadwatch_session_change', handler)
  }, [])

  // Fetch available completed jobs for session selector
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

  const summaryReq  = useApi(() => api.summary(queryParams), [currentSession])
  const vehiclesReq = useApi(() => api.vehicles({ ...queryParams, sort_by: 'risk_score', order: 'desc' }), [currentSession])
  const eventsReq   = useApi(() => api.events(queryParams), [currentSession])

  const videoRef = useRef(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)

  const sd       = summaryReq.data?.summary
  const vehicles = vehiclesReq.data?.vehicles ?? []
  const events   = eventsReq.data?.events ?? []

  const isLoading = summaryReq.loading || vehiclesReq.loading || eventsReq.loading
  const fetchErr  = summaryReq.error  || vehiclesReq.error  || eventsReq.error
  const isMissing = !summaryReq.loading && summaryReq.data?.status === 'missing'

  // Default to highest-risk vehicle (first vehicle since sorted desc)
  const activeVehicle = useMemo(() => {
    if (!vehicles.length) return null
    if (selectedVehicleId !== null) {
      const found = vehicles.find((v) => v.id === selectedVehicleId)
      if (found) return found
    }
    return vehicles[0]
  }, [vehicles, selectedVehicleId])

  // High-Risk Tracks: score >= 65/100 or risk_level == 'High' (only assessable tracks)
  const highRiskCount = useMemo(() => {
    if (!vehicles.length) return 0
    return vehicles.filter(
      (v) => v.risk_score !== null && (v.risk_score >= 65 || v.risk_level === 'High')
    ).length
  }, [vehicles])

  // Chart data: progression of peak risk score (0-100 scale) across duration
  const riskTrendData = useMemo(() => {
    if (!sd || !vehicles.length) return []
    const duration = sd.duration_seconds || 15
    const steps = 6
    const stepDuration = duration / (steps - 1)
    const points = []

    // Only consider assessable vehicles with a valid numeric risk score
    const assessableVehicles = vehicles.filter(
      (v) => v.risk_score !== null && v.risk_score !== undefined
    )

    for (let i = 0; i < steps; i++) {
      const time = i * stepDuration
      const activeAtTime = assessableVehicles.filter(
        (v) => v.first_seen <= time + stepDuration && v.last_seen >= time - stepDuration
      )
      const maxRisk = activeAtTime.length
        ? Math.max(...activeAtTime.map((v) => v.risk_score))
        : 0
      points.push({
        time: fmtTimestamp(time),
        timestamp: time,
        score: maxRisk,
      })
    }
    return points
  }, [sd, vehicles])

  const peakPoint = useMemo(() => {
    if (!riskTrendData.length) return null
    return riskTrendData.reduce((max, p) => (p.score > max.score ? p : max), riskTrendData[0])
  }, [riskTrendData])

  // Check if active vehicle has sufficient observations for risk & motion analysis
  const isVehicleAssessable = Boolean(
    activeVehicle &&
    activeVehicle.observation_quality !== 'insufficient' &&
    activeVehicle.risk_score !== null &&
    activeVehicle.risk_score !== undefined
  )

  // Circular gauge calculations (0-100 scale)
  const riskVal = isVehicleAssessable ? (activeVehicle.risk_score ?? 0) : 0
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = isVehicleAssessable
    ? circumference - (riskVal / 100) * circumference
    : circumference

  // Video source based on active session
  const videoSrc = currentSession !== 'default'
    ? api.getJobVideoUrl(currentSession)
    : '/videos/processed_video.mp4'

  return (
    <div className="space-y-6">
      {/* ── 1. Page Header (Editorial Layout matching reference) ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-[#888888] uppercase mb-1">
            TRAFFIC MONITORING SYSTEM
          </p>
          <div className="flex items-center flex-wrap gap-4">
            <h1 className="text-3xl lg:text-[2.5rem] font-extrabold tracking-tight text-[#181818] leading-none">
              Traffic Intelligence
            </h1>
            <div className="hidden md:block h-8 w-px bg-[#D6D6D2]" />
            <p className="text-xs text-[#666666] leading-snug font-normal max-w-xs">
              Road accident and dangerous-driving analysis
            </p>
          </div>
        </div>

        {/* Right Status & Session Selector */}
        <div className="flex items-center flex-wrap gap-3 self-start sm:self-center">
          {/* Analysis Session Switcher */}
          <div className="relative inline-flex items-center bg-white border border-[#E2E2DE] rounded-full px-3 py-1 shadow-xs text-xs">
            <Layers size={13} className="text-[#888888] mr-1.5" />
            <span className="text-[10px] uppercase font-bold text-[#888888] mr-1.5 hidden md:inline">Session:</span>
            <select
              aria-label="Select analysis session"
              value={currentSession}
              onChange={(e) => {
                const val = e.target.value
                setActiveSession(val)
                setCurrentSession(val)
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

          {/* Recorded Analysis Pill */}
          <div className="flex items-center gap-2 bg-white border border-[#E2E2DE] px-3.5 py-1.5 rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#C92A2A] animate-pulse" />
            <span className="text-xs font-semibold text-[#181818]">
              Recorded Analysis
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
      {isLoading && <LoadingState message="Loading traffic intelligence data…" />}
      {!isLoading && fetchErr && <ErrorState message={fetchErr} />}
      {!isLoading && !fetchErr && isMissing && (
        <MissingDataState message={summaryReq.data?.message} />
      )}

      {/* ── Main Dashboard Content ── */}
      {!isLoading && !fetchErr && !isMissing && sd && (
        <div className="space-y-6">

          {/* ── 2. KPI Section (Unified card with thin vertical dividers, no percentage changes) ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs px-2 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#ECECE8]">
              {/* Metric 1: Vehicles Analyzed */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Vehicles Analyzed
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {sd.vehicles_analyzed}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">tracks</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  {sd.vehicles_unassessable > 0
                    ? `${sd.vehicles_assessable ?? 0} assessable · ${sd.vehicles_unassessable} insufficient`
                    : 'Tracked vehicle records'}
                </p>
              </div>

              {/* Metric 2: High-Risk Tracks (Threshold >= 65/100) */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  High-Risk Tracks
                </p>
                <div className="flex items-baseline">
                  <span
                    className={`text-3xl lg:text-4xl font-extrabold tracking-tight ${
                      highRiskCount > 0 ? 'text-[#C92A2A]' : 'text-[#181818]'
                    }`}
                  >
                    {highRiskCount}
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Threshold: ≥ 65/100 (Peak: {sd.max_risk_score !== null && sd.max_risk_score !== undefined ? `${sd.max_risk_score}/100` : 'N/A'})
                </p>
              </div>

              {/* Metric 3: Motion Anomalies */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Motion Anomalies
                </p>
                <div className="flex items-baseline">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {sd.total_events}
                  </span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Unverified movement events
                </p>
              </div>

              {/* Metric 4: Average Risk Score (0-100 scale) */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Avg. Risk Score
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {sd.vehicles_assessable === 0 && sd.vehicles_unassessable > 0
                      ? 'N/A'
                      : (sd.average_risk_score !== null && sd.average_risk_score !== undefined ? sd.average_risk_score : 'N/A')}
                  </span>
                  {(sd.average_risk_score !== null && sd.average_risk_score !== undefined && (sd.vehicles_assessable > 0 || !sd.vehicles_unassessable)) && (
                    <span className="text-base font-bold text-[#888888]">/100</span>
                  )}
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  {sd.vehicles_unassessable > 0 && sd.vehicles_assessable === 0
                    ? 'Insufficient observations'
                    : 'Across assessable tracks'}
                </p>
              </div>
            </div>
          </div>

          {/* ── 3. Main Monitoring Section (Two-Column Layout ~62% : ~38%) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

            {/* Left: CCTV Video Player Canvas (~62%) */}
            <div className="lg:col-span-7 xl:col-span-8 bg-[#0F0F12] rounded-xl border border-[#26262B] overflow-hidden flex flex-col justify-between shadow-xs relative">
              {/* CCTV Overlay Top Bar */}
              <div className="absolute top-0 inset-x-0 z-20 px-4 py-3 flex items-center justify-between bg-gradient-to-b from-black/80 via-black/40 to-transparent pointer-events-none">
                <div className="flex items-center gap-2">
                  <span className="text-[#C92A2A] font-black text-sm italic">//</span>
                  <span className="text-xs font-mono font-medium tracking-wider text-white">
                    CCTV — {sd.video || 'traffic_footage.mp4'} (YOLO11n + ByteTrack)
                  </span>
                </div>
                <div className="bg-[#C92A2A] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-sm uppercase tracking-wider">
                  RECORDED
                </div>
              </div>

              {/* Video Monitor Canvas with Blurred Duplicate Background */}
              <div className="relative w-full h-[390px] sm:h-[420px] bg-[#0A0A0C] flex items-center justify-center overflow-hidden">
                <video
                  key={`bg_${videoSrc}`}
                  src={videoSrc}
                  muted
                  autoPlay
                  loop
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover filter blur-xl opacity-20 scale-110 pointer-events-none"
                />

                {/* Main Foreground Crisp Video */}
                <video
                  key={`fg_${videoSrc}`}
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  autoPlay
                  muted
                  loop
                  preload="auto"
                  playsInline
                  className="relative z-10 max-h-full max-w-full h-[390px] sm:h-[420px] w-auto object-contain mx-auto shadow-2xl"
                >
                  Your browser does not support the video element.
                </video>
              </div>

              {/* CCTV Bottom Status Bar */}
              <div className="px-4 py-2.5 bg-[#141418] border-t border-[#222228] flex items-center justify-between text-xs text-[#999999] z-20">
                <div className="flex items-center gap-4">
                  <span>Source: {sd.video}</span>
                  <span>Frames: {sd.frames_processed}</span>
                </div>
                <Link
                  to="/analysis"
                  className="text-white hover:text-[#C92A2A] font-medium flex items-center gap-1 transition-colors text-xs"
                >
                  Upload New Video <ArrowRight size={12} />
                </Link>
              </div>
            </div>

            {/* Right: Selected Vehicle Panel (~38%) */}
            <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-xl border border-[#E5E5E2] p-6 shadow-xs flex flex-col justify-between">
              <div>
                {/* Top: Selected Vehicle Header & Switcher */}
                <div className="flex items-start justify-between pb-4 border-b border-[#F0F0EC]">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#888888]">
                      Selected Vehicle
                    </p>
                    <div className="relative inline-block mt-0.5">
                      <select
                        aria-label="Select analyzed vehicle"
                        value={activeVehicle ? activeVehicle.id : ''}
                        onChange={(e) => setSelectedVehicleId(Number(e.target.value))}
                        className="text-2xl font-black text-[#181818] tracking-tight bg-transparent pr-6 cursor-pointer outline-none appearance-none hover:text-[#C92A2A] transition-colors"
                      >
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            V-{v.id} ({v.type}) — {v.risk_score !== null ? `Risk: ${v.risk_score}/100` : 'Insufficient Data'}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={16}
                        className="absolute right-0 top-1/2 -translate-y-1/2 text-[#888888] pointer-events-none"
                      />
                    </div>
                  </div>

                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-md border ${
                      !isVehicleAssessable
                        ? 'bg-[#F3F4F6] text-[#6B7280] border-[#D1D5DB]'
                        : activeVehicle?.risk_level === 'High'
                        ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                        : activeVehicle?.risk_level === 'Medium'
                        ? 'bg-[#FEF2F2] text-[#C92A2A] border-[#FECACA]'
                        : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                    }`}
                  >
                    {!isVehicleAssessable ? 'Insufficient Data' : `${activeVehicle?.risk_level ?? 'Low'} Risk`}
                  </span>
                </div>

                {/* Middle: Risk Score (0-100 scale) & Circular Donut Gauge */}
                <div className="py-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-[#666666] mb-1">
                      Risk Score
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className={`text-5xl font-black tracking-tight ${isVehicleAssessable ? 'text-[#C92A2A]' : 'text-[#888888]'}`}>
                        {isVehicleAssessable ? riskVal : '—'}
                      </span>
                      {isVehicleAssessable && (
                        <span className="text-2xl font-bold text-[#888888]">/100</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#888888] mt-1">
                      {isVehicleAssessable
                        ? 'Heuristic relative risk'
                        : 'Single detection (< 2 frames observed)'}
                    </p>
                  </div>

                  {/* Circular SVG Donut Gauge showing risk percentage */}
                  <div className="relative w-24 h-24 flex items-center justify-center">
                    <svg className="w-24 h-24 transform -rotate-90">
                      <circle
                        cx="48"
                        cy="48"
                        r={radius}
                        stroke="#EAEAE7"
                        strokeWidth="8"
                        fill="transparent"
                      />
                      <circle
                        cx="48"
                        cy="48"
                        r={radius}
                        stroke={isVehicleAssessable ? '#C92A2A' : '#D1D5DB'}
                        strokeWidth="8"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        fill="transparent"
                        className="transition-all duration-500 ease-out"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-base font-black text-[#181818]">
                        {isVehicleAssessable ? `${riskVal}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom: Risk Factors & Motion Profile */}
                <div className="space-y-3.5 pt-4 border-t border-[#F0F0EC]">
                  <p className="text-xs font-bold text-[#181818] uppercase tracking-wider">
                    Risk Factors & Motion Profile
                  </p>

                  {/* Factor 1: Average Motion */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#666666]">Average Motion</span>
                      <span className="font-semibold text-[#181818]">
                        {activeVehicle && activeVehicle.average_motion_px_s !== null
                          ? `${activeVehicle.average_motion_px_s.toFixed(2)} px/s`
                          : '— (Unavailable)'}
                      </span>
                    </div>
                    <div className="w-full bg-[#EAEAE7] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#181818] h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            (((activeVehicle?.average_motion_px_s) || 0) / 300) * 100
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-[#888888] mt-1">
                      2D image scale (0–300 px/s). Uncalibrated for camera perspective.
                    </p>
                  </div>

                  {/* Factor 2: Abrupt Motion Changes */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#666666]">Abrupt Motion Changes</span>
                      <span className="font-semibold text-[#181818]">
                        {isVehicleAssessable ? `${activeVehicle.abrupt_motion_changes} changes` : '—'}
                      </span>
                    </div>
                    <div className="w-full bg-[#EAEAE7] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#C92A2A] h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            ((activeVehicle?.abrupt_motion_changes || 0) / 20) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Factor 3: Frames Tracked */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#666666]">Frames Tracked</span>
                      <span className="font-semibold text-[#181818]">
                        {activeVehicle ? `${activeVehicle.frames_tracked} frames` : '—'}
                      </span>
                    </div>
                    <div className="w-full bg-[#EAEAE7] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#181818] h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            ((activeVehicle?.frames_tracked || 0) / (sd.frames_processed || 225)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Factor 4: Observation Duration */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-[#666666]">Observation Duration</span>
                      <span className="font-semibold text-[#181818]">
                        {activeVehicle
                          ? (activeVehicle.last_seen === activeVehicle.first_seen
                              ? '<0.1s (Single detection)'
                              : `${(activeVehicle.last_seen - activeVehicle.first_seen).toFixed(1)}s`)
                          : '—'}
                      </span>
                    </div>
                    <div className="w-full bg-[#EAEAE7] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#555555] h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            (((activeVehicle?.last_seen || 0) - (activeVehicle?.first_seen || 0)) / (sd.duration_seconds || 15)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  {!isVehicleAssessable && (
                    <div className="p-2.5 rounded-lg bg-[#F8F8F6] border border-[#ECECE8] text-[11px] text-[#666666] flex items-start gap-2">
                      <Info size={13} className="text-[#888888] shrink-0 mt-0.5" />
                      <span>
                        Track observed in 1 frame. Velocity and risk calculations require at least 2 consecutive detections and are marked unavailable.
                      </span>
                    </div>
                  )}

                  {isVehicleAssessable && activeVehicle?.frames_tracked === 2 && (
                    <div className="p-2.5 rounded-lg bg-[#F8F8F6] border border-[#ECECE8] text-[11px] text-[#666666] flex items-start gap-2">
                      <Info size={13} className="text-[#888888] shrink-0 mt-0.5" />
                      <span>
                        Observed across 2 frames: instantaneous velocity is mathematically computable, but acceleration and abrupt shifts require ≥3 frames.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick switch helper */}
              <div className="mt-4 pt-3 border-t border-[#F0F0EC] flex items-center justify-between text-[11px] text-[#888888]">
                <span>Type: <strong className="text-[#181818] capitalize">{activeVehicle?.type}</strong></span>
                <span>Track ID: <strong className="text-[#181818]">#{activeVehicle?.id}</strong></span>
                <Link to="/vehicles" className="text-[#181818] hover:text-[#C92A2A] font-medium flex items-center gap-1">
                  All Vehicles <ArrowRight size={10} />
                </Link>
              </div>
            </div>
          </div>

          {/* ── 4. Bottom Section: Recent Incidents & Risk Analytics ── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

            {/* Left: Recent Motion Anomalies Table (~62%) */}
            <div className="lg:col-span-7 xl:col-span-8 bg-white rounded-xl border border-[#E5E5E2] p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-[#F0F0EC]">
                  <div>
                    <h2 className="text-base font-bold text-[#181818]">
                      Recent Incidents
                    </h2>
                    <p className="text-xs text-[#888888]">
                      Unverified motion anomalies detected during tracking
                    </p>
                  </div>
                  <Link
                    to="/incidents"
                    className="text-xs font-semibold text-[#555555] hover:text-[#181818] flex items-center gap-1 transition-colors"
                  >
                    View All <ArrowRight size={12} />
                  </Link>
                </div>

                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[#ECECE8] text-[10px] font-bold text-[#888888] tracking-wider uppercase">
                        <th className="py-2.5 px-3">Time</th>
                        <th className="py-2.5 px-3">Event</th>
                        <th className="py-2.5 px-3">Vehicle(s)</th>
                        <th className="py-2.5 px-3">Severity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F5F5F2] text-xs">
                      {events.map((ev, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-[#FAFAF8] transition-colors cursor-pointer"
                          onClick={() => setSelectedVehicleId(ev.vehicle_id)}
                          title="Click to view vehicle risk details"
                        >
                          <td className="py-3 px-3 font-mono text-[#555555] tabular-nums">
                            {fmtTimestamp(ev.timestamp)}
                          </td>
                          <td className="py-3 px-3 font-medium text-[#181818]">
                            {ev.type}
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-semibold text-[#181818] hover:text-[#C92A2A] transition-colors">
                              V-{ev.vehicle_id}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded ${
                                ev.severity === 'High'
                                  ? 'bg-[#FEE2E2] text-[#C92A2A]'
                                  : ev.severity === 'Medium'
                                  ? 'bg-[#FEF2F2] text-[#C92A2A]'
                                  : 'bg-[#F3F4F6] text-[#4B5563]'
                              }`}
                            >
                              {ev.severity}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[11px] text-[#888888] italic pt-3 border-t border-[#F0F0EC] mt-3">
                Click any incident row to inspect the corresponding vehicle profile.
              </p>
            </div>

            {/* Right: Risk Analytics Area Chart (0-100 scale) (~38%) */}
            <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-xl border border-[#E5E5E2] p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-[#F0F0EC]">
                  <h2 className="text-base font-bold text-[#181818]">
                    Risk Trend <span className="text-xs font-normal text-[#888888]">(Footage Timeline)</span>
                  </h2>
                  <span className="text-xs font-bold text-[#C92A2A]">
                    Peak {peakPoint ? `${peakPoint.score}/100` : (sd.max_risk_score !== null && sd.max_risk_score !== undefined ? `${sd.max_risk_score}/100` : 'N/A')}
                  </span>
                </div>

                <p className="text-xs text-[#888888] mt-1 mb-4">
                  Progression of peak heuristic risk scores across video duration (0–100 scale)
                </p>

                {/* Editorial Area Chart with Recharts (0-100 scale) */}
                <div className="w-full h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={riskTrendData}
                      margin={{ top: 18, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="riskAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#888888" stopOpacity={0.25} />
                          <stop offset="95%" stopColor="#CCCCCC" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: '#888888' }}
                        tickLine={false}
                        axisLine={{ stroke: '#E5E5E2' }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        ticks={[0, 25, 50, 75, 100]}
                        tick={{ fontSize: 10, fill: '#888888' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="bg-white border border-[#E5E5E2] p-2 text-xs shadow-md rounded-md">
                              <p className="text-[#888888]">Time: {d.time}</p>
                              <p className="font-bold text-[#181818]">
                                Risk Score: {d.score}/100
                              </p>
                            </div>
                          )
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="score"
                        stroke="#181818"
                        strokeWidth={2}
                        fill="url(#riskAreaGrad)"
                      />
                      {peakPoint && (
                        <ReferenceDot
                          x={peakPoint.time}
                          y={peakPoint.score}
                          r={4}
                          fill="#C92A2A"
                          stroke="#FFFFFF"
                          strokeWidth={2}
                          label={{
                            value: `${peakPoint.score}/100`,
                            position: 'top',
                            fill: '#FFFFFF',
                            fontSize: 10,
                            fontWeight: 'bold',
                            className: 'px-1 bg-[#C92A2A]',
                          }}
                        />
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Peak risk indicator note */}
              <div className="pt-3 border-t border-[#F0F0EC] flex items-center justify-between text-xs text-[#666666]">
                <span>Risk Distribution:</span>
                <span className="font-semibold text-[#181818]">
                  {sd.risk_distribution?.low || 0} Low · {sd.risk_distribution?.medium || 0} Medium · {sd.risk_distribution?.high || 0} High
                </span>
              </div>
            </div>
          </div>

          {/* ── 5. Data Integrity Notice (Compact bottom footer) ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] px-5 py-3.5 flex items-center gap-3">
            <Info size={14} className="text-[#888888] flex-shrink-0" strokeWidth={2} />
            <p className="text-xs text-[#666666] leading-relaxed">
              Risk scores are heuristic indicators derived from image motion. They are not accident probabilities.
              Motion anomalies require review. Proximity analysis, calibrated speed estimation and accident confirmation
              are not implemented in this dataset.
            </p>
          </div>

        </div>
      )}
    </div>
  )
}
