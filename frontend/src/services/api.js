/**
 * RoadWatch API service — Phase 4A
 * All requests route through the Vite proxy to http://127.0.0.1:8000
 */

const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    let errText
    try {
      const text = await res.text()
      try {
        const errJson = JSON.parse(text)
        errText = errJson.detail || JSON.stringify(errJson)
      } catch {
        errText = text || res.statusText
      }
    } catch {
      errText = res.statusText
    }
    throw new Error(`API ${res.status}: ${errText}`)
  }
  return res.json()
}

export const api = {
  health:   () => request('/health'),

  // Analytics endpoints (accepts optional params like job_id)
  analysis: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ).toString()
    return request(`/analysis${qs ? `?${qs}` : ''}`)
  },

  summary:  (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ).toString()
    return request(`/summary${qs ? `?${qs}` : ''}`)
  },

  vehicles: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ).toString()
    return request(`/vehicles${qs ? `?${qs}` : ''}`)
  },

  events:   (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    ).toString()
    return request(`/events${qs ? `?${qs}` : ''}`)
  },

  // Job management endpoints (Phase 4A)
  uploadVideo: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return request('/jobs', {
      method: 'POST',
      body: formData,
    })
  },

  listJobs: () => request('/jobs'),

  getJob: (jobId) => request(`/jobs/${encodeURIComponent(jobId)}`),

  cancelJob: (jobId) => request(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }),

  getJobAnalysis: (jobId) => request(`/jobs/${encodeURIComponent(jobId)}/analysis`),

  getJobVideoUrl: (jobId) => `${BASE}/jobs/${encodeURIComponent(jobId)}/video`,
}
