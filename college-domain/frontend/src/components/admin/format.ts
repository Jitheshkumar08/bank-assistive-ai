export const formatDate = (iso: string | null | undefined, withTime = false) => {
  if (!iso) return '—'
  const date = new Date(iso)
  return withTime
    ? date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const formatNumber = (value: number | null | undefined) => (value === null || value === undefined ? '—' : value.toLocaleString('en-IN'))
