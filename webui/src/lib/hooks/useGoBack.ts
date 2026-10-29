import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/** navigate(-1) only works with in-app history; direct loads fall back to `to`. */
export function useGoBack() {
  const navigate = useNavigate()
  return useCallback(
    (to: string) => {
      if ((window.history.state?.idx ?? 0) > 0) navigate(-1)
      else navigate(to)
    },
    [navigate],
  )
}
