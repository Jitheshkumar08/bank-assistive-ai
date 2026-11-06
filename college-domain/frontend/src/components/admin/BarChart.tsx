/** Simple accessible column chart (reference: "Students by Admission Year"). The table equivalent is in the caption. */
export default function BarChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const max = niceMax(Math.max(0, ...data.map((item) => item.value)))
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0]
  return (
    <figure style={{ margin: 0 }}>
      <div className="adm-bars" role="img" aria-label={`${label}: ${data.map((item) => `${item.label} ${item.value.toLocaleString('en-IN')}`).join(', ')}`}>
        <div className="adm-bars__axis" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{Math.round(tick).toLocaleString('en-IN')}</span>)}</div>
        <div className="adm-bars__plot" aria-hidden="true">
          {data.map((item) => (
            <div key={item.label} className="adm-bars__col">
              <span className="adm-bars__value">{item.value.toLocaleString('en-IN')}</span>
              <span className="adm-bars__bar" style={{ height: `${max ? (item.value / max) * 100 : 0}%` }} />
              <span className="adm-bars__label">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="visually-hidden">{label}</figcaption>
    </figure>
  )
}

function niceMax(value: number) {
  if (value <= 4) return 4
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value / 4 * 1.0001) ?? 10
  return Math.ceil(value / (step * magnitude)) * step * magnitude
}
