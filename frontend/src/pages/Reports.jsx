import React, { useState, useMemo, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import {
  FileText,
  Download,
  Layers,
  ChevronDown,
  AlertTriangle,
  Clock,
  Activity,
  Car,
  Truck,
  Bus,
  Bike,
  Info,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  SlidersHorizontal,
  ShieldAlert,
  X,
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
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

export default function Reports() {
  const [currentSession, setCurrentSession] = useState(getActiveSession())
  const [availableJobs, setAvailableJobs] = useState([])
  const [isExportingPDF, setIsExportingPDF] = useState(false)

  // Session listener
  useEffect(() => {
    const handler = (e) => {
      setCurrentSession(e.detail || 'default')
    }
    window.addEventListener('roadwatch_session_change', handler)
    return () => window.removeEventListener('roadwatch_session_change', handler)
  }, [])

  // Load available completed jobs
  useEffect(() => {
    api.listJobs()
      .then((res) => {
        if (res?.jobs) {
          setAvailableJobs(res.jobs.filter((j) => j.status === 'completed'))
        }
      })
      .catch(() => { })
  }, [])

  const queryParams = useMemo(() => {
    return currentSession !== 'default' ? { job_id: currentSession } : {}
  }, [currentSession])

  // Fetch API endpoints
  const summaryReq = useApi(() => api.summary(queryParams), [currentSession])
  const vehiclesReq = useApi(() => api.vehicles(queryParams), [currentSession])
  const eventsReq = useApi(() => api.events(queryParams), [currentSession])

  const sd = summaryReq.data?.summary
  const allVehicles = vehiclesReq.data?.vehicles ?? []
  const allEvents = eventsReq.data?.events ?? []

  const isLoading = summaryReq.loading || vehiclesReq.loading || eventsReq.loading
  const fetchErr = summaryReq.error || vehiclesReq.error || eventsReq.error
  const isMissing = !summaryReq.loading && summaryReq.data?.status === 'missing'

  // Filter & Search states for the vehicle table
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedRisk, setSelectedRisk] = useState('all')
  const [sortField, setSortField] = useState('risk_score')
  const [sortOrder, setSortOrder] = useState('desc')

  // Calculate risk distribution counts
  const riskCounts = useMemo(() => {
    let low = 0
    let medium = 0
    let high = 0
    let unassessable = 0
    allVehicles.forEach((v) => {
      const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
      if (!isAssessable || v.risk_level === 'Unassessable') {
        unassessable++
      } else {
        const s = v.risk_score ?? 0
        if (s >= 65 || v.risk_level === 'High') high++
        else if (s >= 35 || v.risk_level === 'Medium') medium++
        else low++
      }
    })
    return { low, medium, high, unassessable, assessable: allVehicles.length - unassessable, total: allVehicles.length }
  }, [allVehicles])

  // Chart data for Risk Distribution
  const riskChartData = useMemo(() => {
    const total = riskCounts.total || 1
    const data = [
      {
        category: 'Low (0–34)',
        count: riskCounts.low,
        pct: Math.round((riskCounts.low / total) * 100),
        color: '#181818',
      },
      {
        category: 'Medium (35–64)',
        count: riskCounts.medium,
        pct: Math.round((riskCounts.medium / total) * 100),
        color: '#555555',
      },
      {
        category: 'High (65–100)',
        count: riskCounts.high,
        pct: Math.round((riskCounts.high / total) * 100),
        color: '#C92A2A',
      },
    ]
    if (riskCounts.unassessable > 0) {
      data.push({
        category: 'Insufficient Data',
        count: riskCounts.unassessable,
        pct: Math.round((riskCounts.unassessable / total) * 100),
        color: '#888888',
      })
    }
    return data
  }, [riskCounts])

  // Chart data for Vehicle Types
  const typeChartData = useMemo(() => {
    const counts = { car: 0, truck: 0, bus: 0, motorcycle: 0 }
    allVehicles.forEach((v) => {
      const t = (v.type || 'car').toLowerCase()
      counts[t] = (counts[t] || 0) + 1
    })
    const total = allVehicles.length || 1
    return [
      { type: 'Car', count: counts.car, pct: Math.round((counts.car / total) * 100) },
      { type: 'Truck', count: counts.truck, pct: Math.round((counts.truck / total) * 100) },
      { type: 'Bus', count: counts.bus, pct: Math.round((counts.bus / total) * 100) },
      { type: 'Motorcycle', count: counts.motorcycle, pct: Math.round((counts.motorcycle / total) * 100) },
    ]
  }, [allVehicles])

  // Filtered and sorted vehicle list
  const filteredVehicles = useMemo(() => {
    let list = [...allVehicles]

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((v) => {
        const idMatch = String(v.id).includes(q) || `v-${v.id}`.includes(q)
        const typeMatch = (v.type || '').toLowerCase().includes(q)
        const levelMatch = (v.risk_level || '').toLowerCase().includes(q)
        return idMatch || typeMatch || levelMatch
      })
    }

    if (selectedType !== 'all') {
      list = list.filter((v) => (v.type || '').toLowerCase() === selectedType.toLowerCase())
    }

    if (selectedRisk !== 'all') {
      list = list.filter((v) => {
        const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
        if (selectedRisk === 'unassessable') return !isAssessable || v.risk_level === 'Unassessable'
        if (!isAssessable) return false
        const score = v.risk_score ?? 0
        const level = v.risk_level ?? (score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low')
        if (selectedRisk === 'high') return level === 'High' || score >= 65
        if (selectedRisk === 'medium') return level === 'Medium' || (score >= 35 && score < 65)
        if (selectedRisk === 'low') return level === 'Low' || score < 35
        return true
      })
    }

    list.sort((a, b) => {
      let aVal = a[sortField]
      let bVal = b[sortField]

      if (sortField === 'duration') {
        aVal = (a.last_seen || 0) - (a.first_seen || 0)
        bVal = (b.last_seen || 0) - (b.first_seen || 0)
      } else if (typeof aVal === 'string') {
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

  // Sort toggle handler
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  // ── CSV Exporter: Vehicles ──
  const exportVehiclesCSV = () => {
    if (!allVehicles.length) return
    const headers = [
      'Track_ID',
      'Vehicle_Type',
      'First_Seen_Seconds',
      'Last_Seen_Seconds',
      'Duration_Seconds',
      'Frames_Tracked',
      'Average_Motion_px_s',
      'Abrupt_Motion_Changes',
      'Risk_Score',
      'Risk_Level',
      'Observation_Quality',
    ]

    const rows = allVehicles.map((v) => {
      const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
      return [
        `V-${v.id}`,
        v.type || 'unknown',
        v.first_seen ?? 0,
        v.last_seen ?? 0,
        ((v.last_seen || 0) - (v.first_seen || 0)).toFixed(2),
        v.frames_tracked ?? 0,
        isAssessable ? (v.average_motion_px_s ?? 0.0) : 'Unavailable',
        isAssessable ? (v.abrupt_motion_changes ?? 0) : 'N/A',
        isAssessable ? (v.risk_score ?? 0) : 'N/A',
        isAssessable ? (v.risk_level || 'Low') : 'Unassessable',
        isAssessable ? 'sufficient' : 'insufficient',
      ]
    })

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    const safeName = (sd?.video || 'traffic_analysis').replace(/[^a-zA-Z0-9_-]/g, '_')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `RoadWatch_Vehicles_${safeName}_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // ── CSV Exporter: Motion Events ──
  const exportEventsCSV = () => {
    if (!allEvents.length) return
    const headers = [
      'Event_Index',
      'Timestamp_Seconds',
      'Formatted_Timestamp',
      'Track_ID',
      'Anomaly_Type',
      'Severity',
      'Description',
    ]

    const rows = allEvents.map((e, idx) => [
      idx + 1,
      e.timestamp ?? 0,
      fmtTimestamp(e.timestamp),
      `V-${e.vehicle_id}`,
      e.type || 'Abrupt motion',
      e.severity || 'Medium',
      e.description || 'Repeated abrupt changes in observed image motion',
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    const safeName = (sd?.video || 'traffic_analysis').replace(/[^a-zA-Z0-9_-]/g, '_')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `RoadWatch_Motion_Events_${safeName}_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // ── PDF Generator: Comprehensive Professional Report ──
  const generatePDF = async () => {
    try {
      setIsExportingPDF(true)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 40
      const contentWidth = pageWidth - margin * 2
      const reportDate = new Date().toLocaleString()
      const safeVideo = sd?.video || 'traffic_footage.mp4'

      // ── Header / Branding ──
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(20)
      doc.setTextColor(24, 24, 24)
      doc.text('RoadWatch', margin, 50)

      doc.setFontSize(16)
      doc.setTextColor(201, 42, 42) // #C92A2A
      doc.text('//', margin + 115, 50)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(120, 120, 120)
      doc.text('TRAFFIC SAFETY & INTELLIGENCE REPORT', margin, 65)

      // Thin Header Line
      doc.setDrawColor(220, 220, 218)
      doc.setLineWidth(1)
      doc.line(margin, 75, pageWidth - margin, 75)

      // ── Metadata Block ──
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(80, 80, 80)
      doc.text(`Generated: ${reportDate}`, margin, 92)
      doc.text(`Footage Source: ${safeVideo}`, margin, 104)
      doc.text(`Analysis Session: ${currentSession === 'default' ? 'Sample Baseline (Colab)' : currentSession}`, margin, 116)
      doc.text(`Footage Span: ${sd?.duration_seconds || 15}s (${sd?.frames_processed || 225} frames analyzed)`, margin + 280, 92)
      doc.text(`Tracking Engine: YOLO11n + ByteTrack`, margin + 280, 104)

      // ── Section 1: Executive Summary KPIs ──
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(24, 24, 24)
      doc.text('1. EXECUTIVE SUMMARY & TRACKING METRICS', margin, 140)

      const avgRisk = riskCounts.assessable > 0
        ? `${sd?.average_risk_score ?? 0} / 100`
        : '— (No assessable tracks)'

      autoTable(doc, {
        startY: 148,
        head: [['Metric', 'Value', 'Methodological Note']],
        body: [
          ['Tracking IDs Observed', String(sd?.tracking_ids_observed ?? allVehicles.length), 'Total continuous ByteTrack candidate trajectories observed'],
          ['Vehicle Tracks Analyzed', `${allVehicles.length} (${riskCounts.assessable} assessable, ${riskCounts.unassessable} insufficient)`, 'Vehicle trajectories filtered and indexed'],
          ['Motion-Anomaly Events Flagged', String(allEvents.length), 'Vehicles recording >= 2 abrupt image motion changes (>75 px/s)'],
          ['Average Vehicle Risk Score', avgRisk, 'Heuristic relative risk score based on motion and vehicle type across assessable tracks'],
          ['Peak Vehicle Risk Score', `${(sd?.max_risk_score > 0) ? `${sd.max_risk_score} / 100` : '—'}`, 'Highest individual vehicle relative risk score recorded'],
        ],
        theme: 'plain',
        headStyles: { fillColor: [24, 24, 24], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
        bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 248, 246] },
        styles: { cellPadding: 5, lineColor: [230, 230, 226], lineWidth: 0.5 },
        margin: { left: margin, right: margin },
      })

      // ── Section 2: Distribution Tables (Risk & Fleet) ──
      const nextY = doc.lastAutoTable.finalY + 18
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(24, 24, 24)
      doc.text('2. RISK LEVEL & FLEET CLASSIFICATION', margin, nextY)

      const totalVehicles = allVehicles.length || 1
      autoTable(doc, {
        startY: nextY + 8,
        head: [['Risk Classification', 'Score Range', 'Tracks', 'Share (%)'], ['Vehicle Type', 'COCO Class', 'Count', 'Share (%)']],
        body: [
          [
            'Low Risk', '0–34 / 100', String(riskCounts.low), `${Math.round((riskCounts.low / totalVehicles) * 100)}%`,
            'Car', 'Passenger Auto', String(typeChartData.find(t => t.type === 'Car')?.count || 0), `${typeChartData.find(t => t.type === 'Car')?.pct || 0}%`
          ],
          [
            'Medium Risk', '35–64 / 100', String(riskCounts.medium), `${Math.round((riskCounts.medium / totalVehicles) * 100)}%`,
            'Truck', 'Heavy Freight', String(typeChartData.find(t => t.type === 'Truck')?.count || 0), `${typeChartData.find(t => t.type === 'Truck')?.pct || 0}%`
          ],
          [
            'High Risk', '65–100 / 100', String(riskCounts.high), `${Math.round((riskCounts.high / totalVehicles) * 100)}%`,
            'Bus', 'Mass Transit', String(typeChartData.find(t => t.type === 'Bus')?.count || 0), `${typeChartData.find(t => t.type === 'Bus')?.pct || 0}%`
          ],
          [
            riskCounts.unassessable > 0 ? 'Insufficient Data' : 'Total Fleet',
            riskCounts.unassessable > 0 ? '< 2 frames' : '0–100 / 100',
            String(riskCounts.unassessable > 0 ? riskCounts.unassessable : allVehicles.length),
            `${Math.round(((riskCounts.unassessable > 0 ? riskCounts.unassessable : allVehicles.length) / totalVehicles) * 100)}%`,
            'Motorcycle', 'Two-Wheeled', String(typeChartData.find(t => t.type === 'Motorcycle')?.count || 0), `${typeChartData.find(t => t.type === 'Motorcycle')?.pct || 0}%`
          ],
        ],
        theme: 'plain',
        headStyles: { fillColor: [24, 24, 24], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 248, 246] },
        styles: { cellPadding: 4.5, lineColor: [230, 230, 226], lineWidth: 0.5 },
        margin: { left: margin, right: margin },
      })

      // ── Section 3: Motion-Anomaly Events ──
      const nextY3 = doc.lastAutoTable.finalY + 18
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(24, 24, 24)
      doc.text('3. FLAGGED MOTION-ANOMALY EVENTS', margin, nextY3)

      if (allEvents.length === 0) {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8.5)
        doc.setTextColor(120, 120, 120)
        doc.text('No motion anomaly events flagged for this footage session.', margin, nextY3 + 15)
      } else {
        const eventRows = allEvents.map((e, i) => [
          String(i + 1),
          fmtTimestamp(e.timestamp),
          `V-${e.vehicle_id}`,
          e.type || 'Abrupt motion',
          e.severity || 'Medium',
          e.description || 'Repeated abrupt changes in observed image motion',
        ])

        autoTable(doc, {
          startY: nextY3 + 8,
          head: [['#', 'Timestamp', 'Track ID', 'Anomaly Type', 'Severity', 'Description']],
          body: eventRows,
          theme: 'plain',
          headStyles: { fillColor: [24, 24, 24], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
          bodyStyles: { fontSize: 8, textColor: [40, 40, 40] },
          alternateRowStyles: { fillColor: [248, 248, 246] },
          styles: { cellPadding: 4, lineColor: [230, 230, 226], lineWidth: 0.5 },
          margin: { left: margin, right: margin },
        })
      }

      // ── Page Break for Vehicle Records & Limitations ──
      doc.addPage()

      // Header on Page 2
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(120, 120, 120)
      doc.text('ROADWATCH TRAFFIC INTELLIGENCE // VEHICLE TRACKING DATASET', margin, 40)
      doc.setDrawColor(220, 220, 218)
      doc.line(margin, 46, pageWidth - margin, 46)

      // ── Section 4: Vehicle Dataset Table ──
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(24, 24, 24)
      doc.text('4. VEHICLE TRAJECTORY RECORDS', margin, 65)

      const vehicleRows = allVehicles.map((v) => {
        const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
        return [
          `V-${v.id}`,
          v.type || 'car',
          `${v.first_seen?.toFixed(1)}s`,
          `${v.last_seen?.toFixed(1)}s`,
          v.first_seen === v.last_seen ? '<0.1s' : `${((v.last_seen || 0) - (v.first_seen || 0)).toFixed(1)}s`,
          `${v.frames_tracked || 0}`,
          isAssessable ? `${v.average_motion_px_s?.toFixed(1) || '0.0'}` : 'Unavailable',
          isAssessable ? String(v.abrupt_motion_changes || 0) : '—',
          isAssessable ? String(v.risk_score || 0) : '—',
          isAssessable ? (v.risk_level || 'Low') : 'Unassessable',
        ]
      })

      autoTable(doc, {
        startY: 72,
        head: [['ID', 'Type', 'First', 'Last', 'Dwell', 'Frames', 'Motion (px/s)', 'Abrupt', 'Risk', 'Level']],
        body: vehicleRows,
        theme: 'plain',
        headStyles: { fillColor: [24, 24, 24], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5, textColor: [40, 40, 40] },
        alternateRowStyles: { fillColor: [248, 248, 246] },
        styles: { cellPadding: 3.5, lineColor: [230, 230, 226], lineWidth: 0.5 },
        margin: { left: margin, right: margin },
      })

      // ── Section 5: Methodology & Scientific Limitations ──
      let methodY = doc.lastAutoTable.finalY + 18
      if (methodY > pageHeight - 160) {
        doc.addPage()
        methodY = 50
      }

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(24, 24, 24)
      doc.text('5. METHODOLOGY & SCIENTIFIC LIMITATIONS', margin, methodY)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(90, 90, 90)

      const limitationsText = [
        '• Object Detection: YOLO11n performs 2D bounding-box localization on COCO vehicle classes (car, motorcycle, bus, truck).',
        '• Multi-Object Tracking: ByteTrack associates detections across consecutive frames to form trajectory tracks (Track V-ID). Tracking IDs denote continuous trajectory sequences and do not guarantee unique physical vehicles across occlusions or re-entries.',
        '• Minimum Dwell Filter: Only trajectory tracks sustained for >= 8 frames are included in vehicle analysis to filter transient false detections.',
        '• Pixel-Space Motion: Motion values are calculated in camera-perspective image pixels per second (px/s). No 3D camera calibration or homography mapping is applied; values do not reflect physical ground speed (km/h).',
        '• Heuristic Risk Scoring: Risk scores (0–100) are heuristic relative screening indicators derived from motion acceleration shifts and vehicle mass weighting. They do not represent probabilities, accident liability, or legal traffic violations.',
        '• Motion Anomaly Thresholds: Motion anomalies represent localized velocity deltas > 75 px/s with >= 2 occurrences. They flag unusual kinematic behavior for operator review and do not confirm physical collisions.',
        '• Scope of Analysis: This report provides automated investigative screening and should not be used as the sole basis for legal, insurance, or emergency determinations without secondary human verification.',
      ]

      let curY = methodY + 12
      limitationsText.forEach((line) => {
        const splitLines = doc.splitTextToSize(line, contentWidth)
        doc.text(splitLines, margin, curY)
        curY += splitLines.length * 9.5
      })

      // ── Page Numbers / Footers across all pages ──
      const totalPages = doc.internal.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(140, 140, 140)
        doc.text(
          `RoadWatch Traffic Intelligence System • Report Generated: ${reportDate} • Page ${i} of ${totalPages}`,
          margin,
          pageHeight - 20
        )
      }

      const safeName = (sd?.video || 'traffic_analysis').replace(/[^a-zA-Z0-9_-]/g, '_')
      doc.save(`RoadWatch_Analysis_Report_${safeName}_${Date.now()}.pdf`)
    } catch (err) {
      console.error('Failed to generate PDF:', err)
      alert(`Could not generate PDF: ${err.message}`)
    } finally {
      setIsExportingPDF(false)
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
              Traffic Analysis Reports
            </h1>
            <div className="hidden md:block h-8 w-px bg-[#D6D6D2]" />
            <p className="text-xs text-[#666666] leading-snug font-normal max-w-xs">
              Generate evidence-based reports from recorded traffic footage.
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
      {isLoading && <LoadingState message="Compiling traffic analysis reports and statistics…" />}
      {!isLoading && fetchErr && <ErrorState message={fetchErr} />}
      {!isLoading && !fetchErr && isMissing && (
        <MissingDataState message={summaryReq.data?.message} />
      )}

      {/* ── Main Reports Content ── */}
      {!isLoading && !fetchErr && !isMissing && (
        <div className="space-y-6">
          {/* ── 2. Export Controls Toolbar ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-[#181818]">
                Export Investigation Dossier
              </p>
              <p className="text-[11px] text-[#777777]">
                Target: <strong className="text-[#181818]">{sd?.video || 'traffic_footage.mp4'}</strong> · Footage:{' '}
                {sd?.duration_seconds || 15}s ({sd?.frames_processed || 225} frames)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={generatePDF}
                disabled={isExportingPDF}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#181818] text-white hover:bg-[#333333] transition-colors shadow-xs disabled:opacity-50"
              >
                <FileText size={14} />
                <span>{isExportingPDF ? 'Generating PDF…' : 'Download PDF Report'}</span>
              </button>

              <button
                onClick={exportVehiclesCSV}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#F4F4F2] text-[#181818] hover:bg-[#EAEAE7] border border-[#E0E0DC] transition-colors"
              >
                <Download size={13} />
                <span>Vehicles CSV</span>
              </button>

              <button
                onClick={exportEventsCSV}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#F4F4F2] text-[#181818] hover:bg-[#EAEAE7] border border-[#E0E0DC] transition-colors"
              >
                <Download size={13} />
                <span>Incidents CSV</span>
              </button>
            </div>
          </div>

          {/* ── 3. Four Minimal Summary KPI Columns ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs px-2 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[#ECECE8]">
              {/* KPI 1: Tracking IDs Observed */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Tracking IDs Observed
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {sd?.tracking_ids_observed ?? allVehicles.length}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">raw IDs</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  ByteTrack candidate sequences
                </p>
              </div>

              {/* KPI 2: Vehicle Tracks Analyzed */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Vehicle Tracks Analyzed
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {allVehicles.length}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">tracks</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  {riskCounts.unassessable > 0
                    ? `${riskCounts.assessable} assessable · ${riskCounts.unassessable} insufficient`
                    : 'Tracked vehicle records'}
                </p>
              </div>

              {/* KPI 3: Total Motion-Anomaly Events */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Motion-Anomaly Events
                </p>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-3xl lg:text-4xl font-extrabold tracking-tight ${allEvents.length > 0 ? 'text-[#C92A2A]' : 'text-[#181818]'
                      }`}
                  >
                    {allEvents.length}
                  </span>
                  <span className="text-xs font-medium text-[#888888]">events</span>
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  Kinematic shifts (≥2 abrupt shifts)
                </p>
              </div>

              {/* KPI 4: Average Vehicle Risk Score */}
              <div className="px-6 py-2">
                <p className="text-xs font-medium text-[#666666] mb-1">
                  Average Vehicle Risk Score
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl lg:text-4xl font-extrabold text-[#181818] tracking-tight">
                    {riskCounts.assessable === 0 && riskCounts.unassessable > 0
                      ? 'N/A'
                      : (sd?.average_risk_score !== null && sd?.average_risk_score !== undefined ? sd.average_risk_score : 'N/A')}
                  </span>
                  {(riskCounts.assessable > 0 && sd?.average_risk_score !== null && sd?.average_risk_score !== undefined) && (
                    <span className="text-xl font-bold text-[#888888]">/100</span>
                  )}
                </div>
                <p className="text-[11px] text-[#888888] mt-1">
                  {riskCounts.unassessable > 0 && riskCounts.assessable === 0
                    ? 'No assessable motion tracks'
                    : `Peak score: ${sd?.max_risk_score !== null && sd?.max_risk_score !== undefined ? `${sd.max_risk_score}/100` : 'N/A'}`}
                </p>
              </div>
            </div>
          </div>

          {/* ── 4. Charts Section: Risk Distribution & Fleet Distribution (2 Columns) ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Chart 1: Risk Level Distribution */}
            <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[#ECECE8] pb-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#181818]">
                    Risk Level Distribution
                  </h3>
                  <p className="text-xs text-[#888888] mt-0.5">
                    Analyzed vehicle tracks grouped by heuristic risk classification
                  </p>
                </div>
                <span className="text-xs font-bold text-[#888888]">
                  {allVehicles.length} Tracks
                </span>
              </div>

              <div className="h-56 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={riskChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="category"
                      stroke="#888888"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E5E2' }}
                    />
                    <YAxis
                      stroke="#888888"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload
                          return (
                            <div className="bg-[#181818] text-white text-xs px-3 py-2 rounded-lg shadow-lg space-y-0.5">
                              <p className="font-bold">{data.category}</p>
                              <p className="text-[#AAAAAA]">
                                Count: <strong className="text-white">{data.count}</strong> tracks ({data.pct}%)
                              </p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {riskChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="pt-2 border-t border-[#F0F0EE] flex items-center justify-between text-[11px] text-[#777777]">
                <span>Low: <strong>{riskCounts.low}</strong> (0–34)</span>
                <span>Medium: <strong>{riskCounts.medium}</strong> (35–64)</span>
                <span className="text-[#C92A2A]">High: <strong>{riskCounts.high}</strong> (≥65)</span>
              </div>
            </div>

            {/* Chart 2: Vehicle Fleet Distribution */}
            <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-[#ECECE8] pb-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#181818]">
                    Vehicle Class Distribution
                  </h3>
                  <p className="text-xs text-[#888888] mt-0.5">
                    Analyzed vehicle counts categorized by detected COCO vehicle class
                  </p>
                </div>
                <span className="text-xs font-bold text-[#888888]">
                  4 Classes
                </span>
              </div>

              <div className="h-56 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={typeChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="type"
                      stroke="#888888"
                      fontSize={11}
                      tickLine={false}
                      axisLine={{ stroke: '#E5E5E2' }}
                    />
                    <YAxis
                      stroke="#888888"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload
                          return (
                            <div className="bg-[#181818] text-white text-xs px-3 py-2 rounded-lg shadow-lg space-y-0.5">
                              <p className="font-bold">{data.type}</p>
                              <p className="text-[#AAAAAA]">
                                Count: <strong className="text-white">{data.count}</strong> vehicles ({data.pct}%)
                              </p>
                            </div>
                          )
                        }
                        return null
                      }}
                    />
                    <Bar dataKey="count" fill="#181818" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="pt-2 border-t border-[#F0F0EE] flex items-center justify-between text-[11px] text-[#777777]">
                {typeChartData.map((t) => (
                  <span key={t.type}>
                    {t.type}: <strong>{t.count}</strong> ({t.pct}%)
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── 5. Motion-Anomaly Event Timeline ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#ECECE8] pb-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#181818]">
                  Motion-Anomaly Event Log
                </h3>
                <p className="text-xs text-[#888888] mt-0.5">
                  Chronological timestamps of flagged kinematic velocity shifts ({totalDuration}s footage)
                </p>
              </div>
              <span className="text-xs font-bold text-[#888888]">
                {allEvents.length} Event{allEvents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {allEvents.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#888888]">
                <p className="font-semibold text-[#181818]">No motion-anomaly events flagged in this footage session.</p>
                <p className="text-[11px] mt-1">
                  (Events require repeated abrupt image motion shifts meeting the acceleration threshold of &gt;75 px/s.)
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Visual Position Gauge */}
                <div className="relative w-full h-7 bg-[#F4F4F2] rounded-lg border border-[#EAEAE7] flex items-center px-4">
                  <div className="absolute inset-x-4 h-1 bg-[#D8D8D4] rounded-full" />
                  {allEvents.map((ev, idx) => {
                    const pct = Math.max(0, Math.min(100, ((ev.timestamp ?? 0) / totalDuration) * 100))
                    return (
                      <div
                        key={idx}
                        title={`Event @ ${fmtTimestamp(ev.timestamp)} — Track V-${ev.vehicle_id} (${ev.severity})`}
                        style={{ left: `calc(${pct}% - 6px)` }}
                        className={`absolute w-3 h-3 rounded-full border-2 border-white ${ev.severity === 'High'
                          ? 'bg-[#C92A2A]'
                          : ev.severity === 'Medium'
                            ? 'bg-[#E07A5F]'
                            : 'bg-[#888888]'
                          }`}
                      />
                    )
                  })}
                </div>

                {/* Event Table Summary */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#EAEAE7] bg-[#F7F7F5] text-[#777777] font-bold text-[11px] uppercase tracking-wider">
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Track ID</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3">Severity</th>
                        <th className="py-2.5 px-3">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F0EE]">
                      {allEvents.map((ev, idx) => (
                        <tr key={idx} className="hover:bg-[#F9F9F7] text-[#333333]">
                          <td className="py-2.5 px-3 font-mono font-bold text-[#181818]">
                            {fmtTimestamp(ev.timestamp)}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-[#181818]">
                            V-{ev.vehicle_id}
                          </td>
                          <td className="py-2.5 px-3 font-medium">
                            {ev.type || 'Abrupt motion'}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${ev.severity === 'High'
                                ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                                : ev.severity === 'Medium'
                                  ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                  : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                                }`}
                            >
                              {ev.severity || 'Medium'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[#666666] text-[11px]">
                            {ev.description || 'Repeated abrupt changes in observed image motion'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── 6. Detailed Vehicle Statistics Table with Search & Sort ── */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-xs p-5 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#ECECE8] pb-3">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-[#181818]">
                  Detailed Vehicle Dataset
                </h3>
                <p className="text-xs text-[#888888] mt-0.5">
                  Complete tracking metrics and heuristic risk evaluations for all {allVehicles.length} analyzed vehicle records
                </p>
              </div>

              {/* Table search & filter controls */}
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#888888]" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by ID or type..."
                    className="pl-8 pr-7 py-1.5 text-xs font-medium text-[#181818] bg-[#F7F7F5] border border-[#E0E0DC] rounded-lg outline-none focus:border-[#181818] transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#181818]"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                <select
                  aria-label="Filter vehicle type"
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="bg-[#F7F7F5] border border-[#E0E0DC] text-xs font-medium text-[#181818] px-2.5 py-1.5 rounded-lg outline-none cursor-pointer"
                >
                  <option value="all">All Types</option>
                  <option value="car">Car</option>
                  <option value="truck">Truck</option>
                  <option value="bus">Bus</option>
                  <option value="motorcycle">Motorcycle</option>
                </select>

                <select
                  aria-label="Filter risk level"
                  value={selectedRisk}
                  onChange={(e) => setSelectedRisk(e.target.value)}
                  className="bg-[#F7F7F5] border border-[#E0E0DC] text-xs font-medium text-[#181818] px-2.5 py-1.5 rounded-lg outline-none cursor-pointer"
                >
                  <option value="all">All Risk Levels</option>
                  <option value="high">High (≥65)</option>
                  <option value="medium">Medium (35–64)</option>
                  <option value="low">Low (0–34)</option>
                </select>

                {(searchQuery || selectedType !== 'all' || selectedRisk !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('')
                      setSelectedType('all')
                      setSelectedRisk('all')
                    }}
                    className="flex items-center gap-1 text-xs text-[#C92A2A] hover:underline font-medium"
                  >
                    <RotateCcw size={12} />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {filteredVehicles.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#888888]">
                No vehicles match your active search or filter criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#EAEAE7] bg-[#F7F7F5] text-[#777777] font-bold text-[11px] uppercase tracking-wider select-none">
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('id')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Track ID</span>
                          {sortField === 'id' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('type')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Type</span>
                          {sortField === 'type' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('duration')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Duration (Dwell)</span>
                          {sortField === 'duration' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('frames_tracked')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Frames</span>
                          {sortField === 'frames_tracked' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('average_motion_px_s')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Avg Motion</span>
                          {sortField === 'average_motion_px_s' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('abrupt_motion_changes')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Abrupt Shifts</span>
                          {sortField === 'abrupt_motion_changes' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th
                        className="py-3 px-3 cursor-pointer hover:text-[#181818]"
                        onClick={() => handleSort('risk_score')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Risk Score</span>
                          {sortField === 'risk_score' ? (
                            sortOrder === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                          ) : (
                            <ArrowUpDown size={11} className="opacity-40" />
                          )}
                        </div>
                      </th>
                      <th className="py-3 px-3">Risk Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F0F0EE]">
                    {filteredVehicles.map((v) => {
                      const isAssessable = v.observation_quality !== 'insufficient' && v.risk_score !== null && v.risk_score !== undefined
                      const score = v.risk_score ?? 0
                      const level = isAssessable
                        ? (v.risk_level ?? (score >= 65 ? 'High' : score >= 35 ? 'Medium' : 'Low'))
                        : 'Unassessable'
                      const dwell = ((v.last_seen || 0) - (v.first_seen || 0)).toFixed(1)

                      return (
                        <tr key={v.id} className="hover:bg-[#F9F9F7] text-[#333333]">
                          <td className="py-2.5 px-3 font-mono font-bold text-[#181818]">
                            V-{v.id}
                          </td>
                          <td className="py-2.5 px-3 capitalize font-medium">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[#666666]">{getVehicleIcon(v.type)}</span>
                              <span>{v.type}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[#666666]">
                            {v.first_seen === v.last_seen
                              ? `<0.1s (${v.first_seen?.toFixed(1)}s)`
                              : `${dwell}s (${v.first_seen?.toFixed(1)}s → ${v.last_seen?.toFixed(1)}s)`}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[#666666]">
                            {v.frames_tracked || 0} f
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[#181818]">
                            {isAssessable && v.average_motion_px_s !== null
                              ? `${v.average_motion_px_s.toFixed(1)} px/s`
                              : 'Unavailable'}
                          </td>
                          <td className="py-2.5 px-3 font-mono">
                            <span className={isAssessable && v.abrupt_motion_changes >= 2 ? 'text-[#C92A2A] font-bold' : 'text-[#666666]'}>
                              {isAssessable ? (v.abrupt_motion_changes || 0) : '—'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-sm">
                            {isAssessable ? (
                              <span className={level === 'High' ? 'text-[#C92A2A]' : level === 'Medium' ? 'text-[#B45309]' : 'text-[#4B5563]'}>
                                {score}/100
                              </span>
                            ) : (
                              <span className="text-[#888888] font-normal">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded border ${!isAssessable
                                ? 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]'
                                : level === 'High'
                                  ? 'bg-[#FEE2E2] text-[#C92A2A] border-[#FCA5A5]'
                                  : level === 'Medium'
                                    ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                    : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                                }`}
                            >
                              {!isAssessable ? 'Insufficient Data' : level}
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

          {/* ── 7. Scientific Limitations & Methodology Callout ── */}
          <div className="bg-[#F8F8F6] rounded-xl border border-[#E5E5E2] p-5 space-y-3 text-xs text-[#666666] leading-relaxed">
            <div className="flex items-center gap-2 text-[#181818] font-bold uppercase tracking-wider text-xs">
              <ShieldAlert size={15} className="text-[#C92A2A]" />
              <span>Methodology & Scientific Disclaimers</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <p>
                  <strong>• Object Detection:</strong> YOLO11n performs 2D bounding-box localization on COCO vehicle classes (car, motorcycle, bus, truck).
                </p>
                <p>
                  <strong>• Multi-Object Tracking:</strong> ByteTrack associates detections across consecutive frames to form trajectory tracks (Track V-ID). Tracking IDs denote continuous trajectory sequences and do not guarantee unique physical vehicles across occlusions or re-entries.
                </p>
                <p>
                  <strong>• Minimum Dwell Filter:</strong> Only trajectory tracks sustained for ≥ 8 frames are included in vehicle analysis to filter transient false detections.
                </p>
                <p>
                  <strong>• Pixel-Space Motion:</strong> Motion values are calculated in camera-perspective image pixels per second (px/s). No 3D camera calibration or homography mapping is applied; values do not reflect physical ground speed (km/h).
                </p>
              </div>

              <div className="space-y-1.5">
                <p>
                  <strong>• Heuristic Risk Scoring:</strong> Risk scores (0–100) are heuristic relative screening indicators derived from motion acceleration shifts and vehicle mass weighting. They do not represent probabilities, accident liability, or legal traffic violations.
                </p>
                <p>
                  <strong>• Motion Anomaly Thresholds:</strong> Motion anomalies represent localized velocity deltas &gt; 75 px/s with ≥ 2 occurrences. They flag unusual kinematic behavior for operator review and do not confirm physical collisions.
                </p>
                <p>
                  <strong>• Scope of Analysis:</strong> This report provides automated investigative screening and should not be used as the sole basis for legal, insurance, or emergency determinations without secondary human verification.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
