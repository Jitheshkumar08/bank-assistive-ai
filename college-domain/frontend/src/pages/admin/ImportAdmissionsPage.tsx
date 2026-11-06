import { Download, FileSpreadsheet, Info, Upload, X } from 'lucide-react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useServices } from '../../app/services'
import { Card, Notice, PageHeading } from '../../components/admin/AdminUi'
import ImportStepper from '../../components/admin/ImportStepper'
import { useAsync } from '../../lib/useAsync'
import { errorMessage, ServiceError } from '../../services/errors'

const MAX_BYTES = 5 * 1024 * 1024
const thisYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 8 }, (_, index) => thisYear + 1 - index)

function checkFile(file: File): string | null {
  if (!/\.(xlsx|csv)$/i.test(file.name)) return /\.xls$/i.test(file.name) ? 'Old .xls files are not supported. Save it as .xlsx or .csv first.' : 'Choose an .xlsx or .csv file.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > MAX_BYTES) return 'This file is larger than 5 MB. Split it into smaller files.'
  return null
}

/** Step 1 of the import: choose the admission year and the official spreadsheet; the server validates it. */
export default function ImportAdmissionsPage() {
  const { admin } = useServices()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const columns = useAsync(() => admin.importColumns(), [admin])
  const requestedYear = Number(params.get('year'))
  const [year, setYear] = useState(yearOptions.includes(requestedYear) ? requestedYear : thisYear)
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [details, setDetails] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const hintId = useId()

  const choose = (candidate: File | undefined | null) => {
    setDetails([])
    if (!candidate) return
    const error = checkFile(candidate)
    setProblem(error)
    setFile(error ? null : candidate)
  }
  const onDrop = (event: DragEvent) => { event.preventDefault(); setOver(false); choose(event.dataTransfer.files?.[0]) }

  async function validate() {
    if (!file || uploading) return
    setUploading(true)
    setProblem(null)
    setDetails([])
    try {
      const batch = await admin.previewImport(file, year)
      navigate(`/admin/imports/${batch.id}`, { state: { justValidated: true } })
    } catch (error) {
      setProblem(errorMessage(error, 'The file could not be validated. Please try again.'))
      if (error instanceof ServiceError) setDetails(error.details?.flatMap((detail) => detail.messages) ?? [])
    } finally {
      setUploading(false)
    }
  }

  const info = columns.state.status === 'ready' ? columns.state.data : null
  return (
    <>
      <PageHeading title="Import Admissions" subtitle="Upload and validate admission data from Excel/CSV" crumbs={[{ label: 'Import History', to: '/admin/imports' }, { label: 'New import' }]} />
      <ImportStepper current={1} />
      <div className="adm-stack">
        <Card>
          <div className="adm-form" style={{ paddingTop: 16 }}>
            <div className="adm-field" style={{ maxWidth: 260 }}>
              <label htmlFor="import-year">Admission year</label>
              <select id="import-year" value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {yearOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              <span className="adm-field__hint">Every row in the file must belong to this year. Other years are never changed.</span>
            </div>

            <div className={`adm-drop${over ? ' is-over' : ''}`} onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              <Upload className="adm-drop__icon" size={30} aria-hidden="true" />
              <strong>Drag and drop your Excel or CSV file here</strong>
              <p>or</p>
              <button type="button" className="adm-btn" onClick={() => input.current?.click()} aria-describedby={hintId}>Choose File</button>
              <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = '' }} data-testid="import-file-input" />
              <p id={hintId}>Supported formats: .xlsx, .csv · Maximum file size: 5 MB · Up to 10,000 rows</p>
            </div>

            {file && (
              <div className="adm-notice adm-notice--info" role="status">
                <FileSpreadsheet size={18} aria-hidden="true" />
                <div style={{ flex: 1 }}><strong>{file.name}</strong> · {(file.size / 1024).toLocaleString('en-IN', { maximumFractionDigits: 1 })} KB · admission year {year}</div>
                <button type="button" className="adm-icon-btn" onClick={() => setFile(null)} aria-label="Remove selected file"><X size={16} /></button>
              </div>
            )}
            {problem && (
              <Notice tone="error" title="This file can’t be imported.">
                {problem}
                {details.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
              </Notice>
            )}
            <div>
              <button type="button" className="adm-btn adm-btn--navy" onClick={validate} disabled={!file || uploading} aria-busy={uploading || undefined}>
                {uploading ? 'Validating…' : 'Validate file'}
              </button>
              <span className="adm-field__hint" style={{ marginLeft: 12 }}>Validation does not change any admission records.</span>
            </div>
          </div>
        </Card>

        <Card title="Expected columns in your file" actions={<button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => admin.downloadTemplate().catch((error: unknown) => setProblem(errorMessage(error)))}><Download size={14} aria-hidden="true" /> Download CSV template</button>}>
          {columns.state.status === 'error' ? <Notice tone="error">{columns.state.message}</Notice> : !info ? <p role="status">Loading column list…</p> : (
            <div className="adm-stack" style={{ gap: 12 }}>
              <div className="adm-chips">
                {info.columns.map((column) => <span key={column.field} className={`adm-chip${column.required ? ' adm-chip--required' : ''}`} title={column.description}>{column.label}{column.required ? ' *' : ''}</span>)}
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--adm-ink-soft)', fontSize: '0.8125rem' }}>
                {info.rules.map((rule) => <li key={rule}>{rule}</li>)}
              </ul>
              <div className="adm-notice adm-notice--info"><Info size={16} aria-hidden="true" />
                <div>* Required. Headers are matched by name (case and punctuation ignored), e.g. {info.columns[0]?.aliases.slice(0, 3).join(', ')}. The official spreadsheet layout still needs confirmation — unrecognised columns are listed after validation, never guessed.</div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
