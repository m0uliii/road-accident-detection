import React from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

/**
 * Shared loading spinner for data-fetch states.
 */
export function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2.5 py-14 justify-center text-secondary text-sm">
      <Loader2 size={16} className="animate-spin" strokeWidth={1.8} />
      {message}
    </div>
  )
}

/**
 * Shared error display.
 */
export function ErrorState({ message }) {
  return (
    <div className="flex items-start gap-3 py-10 px-6 justify-center text-sm">
      <AlertCircle size={16} className="text-risk flex-shrink-0 mt-0.5" strokeWidth={1.8} />
      <div>
        <p className="font-medium text-primary">Could not load data</p>
        <p className="text-secondary mt-0.5 text-xs font-mono break-all">{message}</p>
      </div>
    </div>
  )
}

/**
 * Shown when the API returns status=missing (no analysis.json yet).
 */
export function MissingDataState({ message }) {
  return (
    <div className="py-14 text-center text-sm text-secondary">
      <p className="font-medium text-primary mb-1">No analysis data available</p>
      <p className="text-xs max-w-sm mx-auto text-secondary">{message}</p>
      <p className="text-xs mt-2 text-secondary">
        Place <code className="px-1 py-0.5 bg-[#F0F0EE] rounded">analysis.json</code> in{' '}
        <code className="px-1 py-0.5 bg-[#F0F0EE] rounded">backend/data/</code> and restart the server.
      </p>
    </div>
  )
}
