import { useState, useEffect, useCallback } from 'react'

/**
 * Generic API data-fetching hook.
 *
 * @param {Function} fetcher  — async function that calls api.*()
 * @param {Array}    deps     — dependency array (re-fetches when changed)
 *
 * Returns { data, loading, error, refetch }
 */
export function useApi(fetcher, deps = []) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetcher()
      setData(result)
    } catch (err) {
      setError(err.message ?? 'Unknown error')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { run() }, [run])

  return { data, loading, error, refetch: run }
}
