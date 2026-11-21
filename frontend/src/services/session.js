/**
 * RoadWatch session manager for multi-analysis session support
 */

const STORAGE_KEY = 'roadwatch_active_session'

export function getActiveSession() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'default'
  } catch {
    return 'default'
  }
}

export function setActiveSession(sessionId) {
  try {
    localStorage.setItem(STORAGE_KEY, sessionId || 'default')
    // Dispatch custom event so listeners can react immediately without page reload
    window.dispatchEvent(new CustomEvent('roadwatch_session_change', { detail: sessionId }))
  } catch {
    // Ignore storage errors in restricted environments
  }
}
