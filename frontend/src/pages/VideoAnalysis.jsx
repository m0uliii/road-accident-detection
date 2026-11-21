import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  UploadCloud,
  FileVideo,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  ArrowRight,
  RefreshCw,
  Clock,
  Layers,
  Car,
  AlertTriangle,
  Gauge,
  Film,
  XCircle,
  X,
} from 'lucide-react'
import { api } from '../services/api.js'
import { setActiveSession, getActiveSession } from '../services/session.js'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatDate(isoStr) {
  if (!isoStr) return '—'
  try {
    const d = new Date(isoStr)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoStr
  }
}

export default function VideoAnalysis() {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)

  const [selectedFile, setSelectedFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  // Current active job being tracked / viewed
  const [activeJobId, setActiveJobId] = useState(null)
  const [activeJob, setActiveJob] = useState(null)
  const [jobAnalysis, setJobAnalysis] = useState(null)

  // List of all previous jobs
  const [previousJobs, setPreviousJobs] = useState([])
  const [loadingJobs, setLoadingJobs] = useState(false)

  // Cancellation confirmation modal state
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [jobToCancel, setJobToCancel] = useState(null)
  const [isCancelling, setIsCancelling] = useState(false)

  // Fetch previous jobs
  const fetchJobs = useCallback(async () => {
    try {
      setLoadingJobs(true)
      const res = await api.listJobs()
      if (res && res.jobs) {
        setPreviousJobs(res.jobs)
      }
    } catch (err) {
      console.error('Failed to load previous jobs:', err)
    } finally {
      setLoadingJobs(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  // Poll active job while it is queued or processing
  useEffect(() => {
    if (!activeJobId) return

    let isMounted = true
    let pollTimeout = null

    const poll = async () => {
      try {
        const res = await api.getJob(activeJobId)
        if (!isMounted) return

        if (res && res.job) {
          setActiveJob(res.job)

          if (res.job.status === 'completed') {
            // Fetch analysis summary
            try {
              const anaRes = await api.getJobAnalysis(activeJobId)
              if (isMounted && anaRes && anaRes.data) {
                setJobAnalysis(anaRes.data)
              }
            } catch (aErr) {
              console.error('Failed to fetch job analysis:', aErr)
            }
            fetchJobs()
            return // Stop polling
          } else if (res.job.status === 'failed' || res.job.status === 'cancelled') {
            fetchJobs()
            return // Stop polling
          }
        }
      } catch (err) {
        console.error('Polling error:', err)
      }

      if (isMounted) {
        pollTimeout = setTimeout(poll, 1200)
      }
    }

    poll()

    return () => {
      isMounted = false
      if (pollTimeout) clearTimeout(pollTimeout)
    }
  }, [activeJobId, fetchJobs])

  // File selection handlers
  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith('.mp4')) {
        setUploadError('Only .mp4 video files are accepted.')
        setSelectedFile(null)
        return
      }
      setSelectedFile(file)
      setUploadError(null)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith('.mp4')) {
        setUploadError('Only .mp4 video files are accepted.')
        setSelectedFile(null)
        return
      }
      setSelectedFile(file)
      setUploadError(null)
    }
  }

  // Upload and analyze trigger
  const handleUploadAndAnalyze = async () => {
    if (!selectedFile || isUploading) return

    try {
      setIsUploading(true)
      setUploadError(null)
      setActiveJob(null)
      setJobAnalysis(null)

      const res = await api.uploadVideo(selectedFile)
      if (res && res.job_id) {
        setActiveJobId(res.job_id)
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      } else {
        throw new Error(res.message || 'Failed to create analysis job')
      }
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please check backend connection.')
    } finally {
      setIsUploading(false)
    }
  }

  // Set this job as the active session in Overview and navigate
  const handleOpenInOverview = (jobId) => {
    setActiveSession(jobId)
    navigate('/')
  }

  // Cancellation modal handlers
  const handleOpenCancelModal = (job) => {
    if (!job) return
    setJobToCancel(job)
    setShowCancelModal(true)
  }

  const handleCloseCancelModal = () => {
    if (isCancelling) return
    setShowCancelModal(false)
    setJobToCancel(null)
  }

  const handleConfirmCancel = async () => {
    if (!jobToCancel) return
    try {
      setIsCancelling(true)
      const res = await api.cancelJob(jobToCancel.job_id)
      if (res && res.job) {
        if (activeJob && activeJob.job_id === jobToCancel.job_id) {
          setActiveJob(res.job)
        }
      }
      setShowCancelModal(false)
      setJobToCancel(null)
      await fetchJobs()
    } catch (err) {
      console.error('Failed to cancel job:', err)
      alert(err.message || 'Failed to cancel processing.')
    } finally {
      setIsCancelling(false)
    }
  }

  const isProcessing = activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing' || activeJob.status === 'cancelling')

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-[#888888] uppercase mb-1">
            TRAFFIC MONITORING SYSTEM
          </p>
          <div className="flex items-center flex-wrap gap-4">
            <h1 className="text-3xl lg:text-[2.5rem] font-extrabold tracking-tight text-[#181818] leading-none">
              Video Analysis
            </h1>
            <div className="hidden md:block h-8 w-px bg-[#D6D6D2]" />
            <p className="text-xs text-[#666666] leading-snug font-normal max-w-xs">
              YOLO11n + ByteTrack automated vehicle detection & risk scoring
            </p>
          </div>
        </div>

        {/* Right Status Badge */}
        <div className="flex items-center gap-3 self-start sm:self-center">
          <div className="flex items-center gap-2 bg-white border border-[#E2E2DE] px-3.5 py-1.5 rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-[#181818]" />
            <span className="text-xs font-semibold text-[#181818]">
              YOLO11n · ByteTrack
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ── Left Column: Upload & Live Processing (7 cols) ── */}
        <div className="lg:col-span-7 space-y-6">
          {/* Upload Card */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] p-6 shadow-xs">
            <div className="pb-4 border-b border-[#F0F0EC] mb-5">
              <h2 className="text-base font-bold text-[#181818]">
                Upload Traffic Video
              </h2>
              <p className="text-xs text-[#888888] mt-0.5">
                Select an MP4 video to run frame-by-frame vehicle tracking and risk assessment
              </p>
            </div>

            {/* Dropzone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-150 flex flex-col items-center justify-center gap-3 ${
                isDragging
                  ? 'border-[#181818] bg-[#F5F5F3]'
                  : selectedFile
                  ? 'border-[#181818] bg-[#FAFAF8]'
                  : 'border-[#E0E0DC] hover:border-[#888888] hover:bg-[#FAFAF8]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,video/mp4"
                className="hidden"
                onChange={handleFileChange}
                disabled={isProcessing || isUploading}
              />

              <div className="w-12 h-12 rounded-full bg-[#F5F5F3] flex items-center justify-center text-[#181818]">
                {selectedFile ? <FileVideo size={24} /> : <UploadCloud size={24} />}
              </div>

              {selectedFile ? (
                <div>
                  <p className="text-sm font-bold text-[#181818] break-all">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-[#888888] mt-0.5">
                    {formatBytes(selectedFile.size)} · Click to change file
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-[#181818]">
                    Click to select or drag and drop video
                  </p>
                  <p className="text-xs text-[#888888] mt-1">
                    MP4 video format (max 200 MB)
                  </p>
                </div>
              )}
            </div>

            {/* Upload Error display */}
            {uploadError && (
              <div className="mt-4 p-3 rounded-lg bg-[#FEE2E2] border border-[#FCA5A5] flex items-start gap-2.5 text-xs text-[#C92A2A]">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Action Button */}
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[11px] text-[#888888]">
                Classes detected: Cars, Motorcycles, Buses, Trucks
              </span>

              <button
                type="button"
                onClick={handleUploadAndAnalyze}
                disabled={!selectedFile || isUploading || isProcessing}
                className={`px-5 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                  !selectedFile || isUploading || isProcessing
                    ? 'bg-[#EAEAE7] text-[#888888] cursor-not-allowed'
                    : 'bg-[#181818] text-white hover:bg-black shadow-sm'
                }`}
              >
                {isUploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Uploading Video…
                  </>
                ) : (
                  <>
                    <Play size={13} fill="currentColor" />
                    Upload & Run YOLO11n Analysis
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Active Job Processing Card */}
          {activeJob && (
            <div className="bg-white rounded-xl border border-[#E5E5E2] p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#F0F0EC]">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      activeJob.status === 'completed'
                        ? 'bg-[#16A34A]'
                        : activeJob.status === 'failed' || activeJob.status === 'cancelled'
                        ? 'bg-[#C92A2A]'
                        : activeJob.status === 'cancelling'
                        ? 'bg-[#D97706] animate-pulse'
                        : 'bg-[#C92A2A] animate-pulse'
                    }`}
                  />
                  <div>
                    <h3 className="text-sm font-bold text-[#181818]">
                      Job: {activeJob.job_id}
                    </h3>
                    <p className="text-xs text-[#888888]">
                      {activeJob.filename} ({formatBytes(activeJob.filesize_bytes)})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <span
                    className={`text-xs font-bold px-3 py-1 rounded-md uppercase tracking-wider ${
                      activeJob.status === 'completed'
                        ? 'bg-[#DCFCE7] text-[#16A34A]'
                        : activeJob.status === 'failed'
                        ? 'bg-[#FEE2E2] text-[#C92A2A]'
                        : activeJob.status === 'cancelling'
                        ? 'bg-[#FEF3C7] text-[#D97706]'
                        : activeJob.status === 'cancelled'
                        ? 'bg-[#F5F5F3] text-[#888888]'
                        : 'bg-[#F5F5F3] text-[#181818]'
                    }`}
                  >
                    {activeJob.status}
                  </span>

                  {/* Cancel Processing Button beside progress indicator */}
                  {activeJob.status === 'processing' && (
                    <button
                      type="button"
                      onClick={() => handleOpenCancelModal(activeJob)}
                      className="px-3 py-1 border border-[#C92A2A] text-[#C92A2A] hover:bg-[#FEE2E2] rounded-md text-xs font-bold transition-colors flex items-center gap-1.5"
                    >
                      <XCircle size={13} />
                      Cancel Processing
                    </button>
                  )}

                  {activeJob.status === 'queued' && (
                    <button
                      type="button"
                      onClick={() => handleOpenCancelModal(activeJob)}
                      className="px-3 py-1 border border-[#C92A2A] text-[#C92A2A] hover:bg-[#FEE2E2] rounded-md text-xs font-bold transition-colors flex items-center gap-1.5"
                    >
                      <XCircle size={13} />
                      Cancel Job
                    </button>
                  )}

                  {activeJob.status === 'cancelling' && (
                    <button
                      type="button"
                      disabled
                      className="px-3 py-1 border border-[#D6D6D2] bg-[#F5F5F3] text-[#888888] rounded-md text-xs font-semibold flex items-center gap-1.5 cursor-not-allowed"
                    >
                      <Loader2 size={13} className="animate-spin text-[#C92A2A]" />
                      Stopping analysis...
                    </button>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-xs font-medium text-[#666666] mb-1.5">
                  <span>
                    {activeJob.status === 'completed'
                      ? 'Analysis completed'
                      : activeJob.status === 'failed'
                      ? 'Processing halted'
                      : activeJob.status === 'cancelling'
                      ? 'Stopping analysis...'
                      : activeJob.status === 'cancelled'
                      ? 'Processing cancelled.'
                      : activeJob.status === 'queued'
                      ? 'Waiting in queue…'
                      : 'Tracking vehicles & analyzing motion…'}
                  </span>
                  <span className="font-bold text-[#181818]">
                    {activeJob.status === 'cancelled' ? '0%' : `${activeJob.progress}%`}
                  </span>
                </div>
                <div className="w-full bg-[#EAEAE7] h-2.5 rounded-full overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-300 ${
                      activeJob.status === 'completed'
                        ? 'bg-[#16A34A]'
                        : activeJob.status === 'failed' || activeJob.status === 'cancelled'
                        ? 'bg-[#C92A2A]'
                        : 'bg-[#C92A2A]'
                    }`}
                    style={{ width: activeJob.status === 'cancelled' ? '0%' : `${activeJob.progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-[#888888] mt-1.5">
                  <span>
                    Processed: <strong>{activeJob.processed_frames || 0}</strong> /{' '}
                    {activeJob.total_frames || '—'} frames
                  </span>
                  <span>
                    {activeJob.duration_seconds ? `${activeJob.duration_seconds}s video` : ''}
                  </span>
                </div>
              </div>

              {/* Cancelled message banner */}
              {activeJob.status === 'cancelled' && (
                <div className="p-3 bg-[#F5F5F3] border border-[#E5E5E2] rounded-lg text-xs text-[#555555] flex items-center gap-2">
                  <AlertCircle size={15} className="text-[#888888] flex-shrink-0" />
                  <span>Processing cancelled. Incomplete analysis results were discarded.</span>
                </div>
              )}

              {/* Error if failed */}
              {activeJob.status === 'failed' && (
                <div className="p-3 bg-[#FEE2E2] border border-[#FCA5A5] rounded-lg text-xs text-[#C92A2A]">
                  <strong>Error:</strong> {activeJob.error || 'Processing failed.'}
                </div>
              )}

              {/* Completed action banner */}
              {activeJob.status === 'completed' && (
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-xs text-[#16A34A] font-semibold flex items-center gap-1.5">
                    <CheckCircle2 size={15} /> Annotated video and analysis data ready
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenInOverview(activeJob.job_id)}
                    className="px-4 py-2 bg-[#181818] text-white hover:bg-black text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
                  >
                    Open in Overview Dashboard <ArrowRight size={13} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right Column: Annotated Video Player & Summary (5 cols) ── */}
        <div className="lg:col-span-5 space-y-6">
          {/* Annotated Video Player */}
          <div className="bg-white rounded-xl border border-[#E5E5E2] p-5 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#F0F0EC] mb-4">
              <div>
                <h3 className="text-sm font-bold text-[#181818]">
                  Annotated Output Player
                </h3>
                <p className="text-xs text-[#888888]">
                  {activeJob?.has_video
                    ? `Job ${activeJob.job_id} output`
                    : 'Awaiting video processing'}
                </p>
              </div>
              <span className="text-[10px] font-bold text-[#888888] uppercase tracking-wider border border-[#E0E0DC] px-2 py-0.5 rounded">
                H.264
              </span>
            </div>

            {activeJob?.has_video ? (
              <div className="space-y-3">
                <div className="bg-black rounded-lg overflow-hidden border border-[#222225] flex items-center justify-center">
                  <video
                    key={activeJob.job_id}
                    src={api.getJobVideoUrl(activeJob.job_id)}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[320px] object-contain mx-auto"
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
                <div className="flex justify-between items-center text-xs text-[#888888]">
                  <span>Resolution: {activeJob.resolution || 'Auto'}</span>
                  <button
                    type="button"
                    onClick={() => handleOpenInOverview(activeJob.job_id)}
                    className="font-bold text-[#181818] hover:text-[#C92A2A] transition-colors flex items-center gap-1"
                  >
                    Analyze in Dashboard <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-64 rounded-lg bg-[#F5F5F3] border border-dashed border-[#D6D6D2] flex flex-col items-center justify-center text-center p-6 text-[#888888]">
                <Film size={32} className="mb-2 opacity-40 text-[#181818]" />
                <p className="text-xs font-semibold text-[#181818]">
                  No processed video active
                </p>
                <p className="text-[11px] text-[#888888] mt-1 max-w-xs">
                  Upload an MP4 traffic video on the left or select a previously completed job below to inspect its annotated playback.
                </p>
              </div>
            )}
          </div>

          {/* Quick Analysis Summary (if job completed) */}
          {jobAnalysis && (
            <div className="bg-white rounded-xl border border-[#E5E5E2] p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-[#181818] uppercase tracking-wider pb-2 border-b border-[#F0F0EC]">
                Job Analysis Summary
              </h3>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-[#F8F8F6] rounded-lg border border-[#EFEFEA]">
                  <p className="text-[#888888] text-[10px] uppercase font-bold">Vehicles Analysed</p>
                  <p className="text-xl font-extrabold text-[#181818] mt-0.5">
                    {jobAnalysis.vehicles_analyzed}
                  </p>
                  <p className="text-[10px] text-[#888888] mt-0.5">
                    {(() => {
                      const assessable = jobAnalysis.vehicles_assessable ?? jobAnalysis.vehicles?.filter(v => v.observation_quality === 'sufficient').length ?? 0
                      const unassessable = jobAnalysis.vehicles_analyzed - assessable
                      return unassessable > 0 ? `${assessable} assessable · ${unassessable} insufficient` : 'All assessable'
                    })()}
                  </p>
                </div>

                <div className="p-3 bg-[#F8F8F6] rounded-lg border border-[#EFEFEA]">
                  <p className="text-[#888888] text-[10px] uppercase font-bold">Motion Anomalies</p>
                  <p className="text-xl font-extrabold text-[#181818] mt-0.5">
                    {jobAnalysis.events?.length || 0}
                  </p>
                  <p className="text-[10px] text-[#888888] mt-0.5">
                    Kinematic shifts (≥2 abrupt shifts)
                  </p>
                </div>

                <div className="p-3 bg-[#F8F8F6] rounded-lg border border-[#EFEFEA]">
                  <p className="text-[#888888] text-[10px] uppercase font-bold">Duration / Frames</p>
                  <p className="text-sm font-bold text-[#181818] mt-1">
                    {jobAnalysis.duration_seconds}s · {jobAnalysis.frames_processed}f
                  </p>
                  <p className="text-[10px] text-[#888888] mt-0.5">
                    Analysis timeline
                  </p>
                </div>

                <div className="p-3 bg-[#F8F8F6] rounded-lg border border-[#EFEFEA]">
                  <p className="text-[#888888] text-[10px] uppercase font-bold">Peak Risk Score</p>
                  <p className="text-sm font-bold text-[#C92A2A] mt-1">
                    {(() => {
                      const assessable = jobAnalysis.vehicles?.filter(
                        v => v.observation_quality === 'sufficient' && v.risk_score !== null && v.risk_score !== undefined
                      ) || []
                      if (assessable.length === 0) {
                        return 'N/A'
                      }
                      const peak = Math.max(...assessable.map(v => v.risk_score))
                      return `${peak}/100`
                    })()}
                  </p>
                  <p className="text-[10px] text-[#888888] mt-0.5">
                    {(() => {
                      const assessable = jobAnalysis.vehicles?.filter(
                        v => v.observation_quality === 'sufficient' && v.risk_score !== null && v.risk_score !== undefined
                      ) || []
                      return assessable.length === 0 ? 'Insufficient observations' : 'Across assessable tracks'
                    })()}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom Section: Analysis Sessions / Job History ── */}
      <div className="bg-white rounded-xl border border-[#E5E5E2] p-6 shadow-xs">
        <div className="flex items-center justify-between pb-4 border-b border-[#F0F0EC] mb-4">
          <div>
            <h2 className="text-base font-bold text-[#181818]">
              Analysis Sessions History
            </h2>
            <p className="text-xs text-[#888888]">
              Previous automated video processing jobs. Completed runs persist across server restarts.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchJobs}
            disabled={loadingJobs}
            className="text-xs font-semibold text-[#555555] hover:text-[#181818] flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={12} className={loadingJobs ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#ECECE8] text-[10px] font-bold text-[#888888] tracking-wider uppercase">
                <th className="py-2.5 px-3">Session / Job ID</th>
                <th className="py-2.5 px-3">Filename</th>
                <th className="py-2.5 px-3">Frames</th>
                <th className="py-2.5 px-3">Duration</th>
                <th className="py-2.5 px-3">Created</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5F5F2]">
              {/* Row for default sample Colab analysis */}
              <tr className="hover:bg-[#FAFAF8] transition-colors">
                <td className="py-3 px-3 font-mono font-bold text-[#181818]">
                  default (Sample Colab)
                </td>
                <td className="py-3 px-3 text-[#555555]">
                  traffic_15sec.mp4
                </td>
                <td className="py-3 px-3 tabular-nums">225</td>
                <td className="py-3 px-3 tabular-nums">15.0s</td>
                <td className="py-3 px-3 text-[#888888]">Baseline Sample</td>
                <td className="py-3 px-3">
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#DCFCE7] text-[#16A34A]">
                    COMPLETED
                  </span>
                </td>
                <td className="py-3 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleOpenInOverview('default')}
                    className="text-xs font-bold text-[#181818] hover:text-[#C92A2A] transition-colors"
                  >
                    View in Overview →
                  </button>
                </td>
              </tr>

              {/* Dynamic Job Rows */}
              {previousJobs.map((j) => (
                <tr key={j.job_id} className="hover:bg-[#FAFAF8] transition-colors">
                  <td className="py-3 px-3 font-mono font-bold text-[#181818]">
                    {j.job_id}
                  </td>
                  <td className="py-3 px-3 text-[#555555] max-w-[200px] truncate" title={j.filename}>
                    {j.filename}
                  </td>
                  <td className="py-3 px-3 tabular-nums">
                    {j.processed_frames || j.total_frames || '—'}
                  </td>
                  <td className="py-3 px-3 tabular-nums">
                    {j.duration_seconds ? `${j.duration_seconds}s` : '—'}
                  </td>
                  <td className="py-3 px-3 text-[#888888]">
                    {formatDate(j.created_at)}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        j.status === 'completed'
                          ? 'bg-[#DCFCE7] text-[#16A34A]'
                          : j.status === 'failed'
                          ? 'bg-[#FEE2E2] text-[#C92A2A]'
                          : j.status === 'cancelling'
                          ? 'bg-[#FEF3C7] text-[#D97706]'
                          : j.status === 'cancelled'
                          ? 'bg-[#F5F5F3] text-[#888888]'
                          : 'bg-[#F5F5F3] text-[#181818]'
                      }`}
                    >
                      {j.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right space-x-3">
                    {j.status === 'cancelled' ? (
                      <span className="text-xs text-[#AAAAAA] italic">Cancelled</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveJobId(j.job_id)
                            setActiveJob(j)
                          }}
                          className="text-xs font-medium text-[#555555] hover:text-[#181818] transition-colors"
                        >
                          Load
                        </button>
                        {j.status === 'completed' && (
                          <button
                            type="button"
                            onClick={() => handleOpenInOverview(j.job_id)}
                            className="text-xs font-bold text-[#181818] hover:text-[#C92A2A] transition-colors"
                          >
                            View in Overview →
                          </button>
                        )}
                        {(j.status === 'processing' || j.status === 'queued') && (
                          <button
                            type="button"
                            onClick={() => handleOpenCancelModal(j)}
                            className="text-xs font-bold text-[#C92A2A] hover:underline transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                        {j.status === 'cancelling' && (
                          <span className="text-xs text-[#D97706] italic">Stopping...</span>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Cancellation Confirmation Modal ── */}
      {showCancelModal && jobToCancel && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-[#E5E5E2] shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#FEE2E2] flex items-center justify-center text-[#C92A2A]">
                  <AlertTriangle size={18} />
                </div>
                <h3 className="text-base font-bold text-[#181818]">
                  Stop processing this video?
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseCancelModal}
                disabled={isCancelling}
                className="text-[#888888] hover:text-[#181818] p-1 rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-[#666666] leading-relaxed">
              Processing will stop and incomplete analysis results will be discarded. This action cannot be undone.
            </p>

            <div className="bg-[#FAFAF8] border border-[#ECECE8] rounded-lg p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-[#888888]">Job ID:</span>
                <span className="font-mono font-bold text-[#181818]">{jobToCancel.job_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#888888]">File:</span>
                <span className="text-[#181818] max-w-[220px] truncate">{jobToCancel.filename}</span>
              </div>
              {jobToCancel.processed_frames !== undefined && jobToCancel.total_frames ? (
                <div className="flex justify-between">
                  <span className="text-[#888888]">Progress:</span>
                  <span className="text-[#181818] font-semibold">
                    {jobToCancel.processed_frames} / {jobToCancel.total_frames} frames ({jobToCancel.progress}%)
                  </span>
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleCloseCancelModal}
                disabled={isCancelling}
                className="px-4 py-2 border border-[#E5E5E2] text-xs font-bold text-[#555555] hover:text-[#181818] hover:bg-[#F5F5F3] rounded-lg transition-colors"
              >
                Keep Processing
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                className="px-4 py-2 bg-[#C92A2A] hover:bg-[#A61E1E] text-white text-xs font-bold rounded-lg shadow-sm transition-colors flex items-center gap-1.5"
              >
                {isCancelling ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    Stopping...
                  </>
                ) : (
                  'Stop Processing'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
