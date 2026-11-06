import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { tokenFromHash } from './formErrors'

/**
 * Captures the token from an emailed link once, then removes the fragment from the address bar so the token is not
 * left in browser history or shared by copying the URL.
 */
export function useLinkToken() {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => tokenFromHash(location.hash))
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])
  return token
}
