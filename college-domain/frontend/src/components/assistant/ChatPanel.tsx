import { Bot, Info, Languages, LoaderCircle, MicOff, RefreshCcw, SendHorizontal, Volume2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useCollegeContext } from '../../app/collegeContext'
import { useServices } from '../../app/services'
import { config } from '../../config'
import type { AssistantStudentContext, ChatTurn } from '../../services/assistant/assistantService'
import { suggestedQuestions } from '../../content/assistant'
import { languages, useI18n } from '../../i18n/I18nProvider'
import './chat.css'


type Message = { id: number; role: 'user' | 'assistant'; text: string; failed?: boolean; steps?: string[] | null; studentContext?: AssistantStudentContext | null }

/**
 * The signed-in student's own admission details, exactly as the backend sent them (Phase 6). Labels follow the selected
 * language; values are shown as officially recorded. Anything the backend has no trusted source for reads "Not available
 * yet" — nothing is computed or guessed here.
 */
function StudentContextCard({ details }: { details: AssistantStudentContext }) {
  const { t } = useI18n()
  const missing = t('chat.details.notAvailable')
  const rows: [string, string][] = [
    [t('result.rank'), details.rank !== null ? String(details.rank) : t('result.notPublished')],
    [t('result.branch'), details.allocatedBranch ?? t('result.notAllocated')],
    [t('result.status'), details.admissionStatus ?? missing],
    [t('chat.details.category'), details.category ?? missing],
    [t('chat.details.batch'), details.assignedBatch ?? missing],
    [t('chat.details.hall'), details.assignedHall ?? missing],
    [t('chat.details.nextStep'), details.nextStep ?? missing],
  ]
  if (details.admissionYear !== null) rows.push([t('result.year'), String(details.admissionYear)])
  return (
    <section className="chat__details" aria-label={t('chat.details.title')}>
      <h3 className="chat__details-title">{t('chat.details.title')}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="chat__details-row"><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p className="chat__details-source">{t('chat.details.source')}</p>
    </section>
  )
}

/** Screen 8 chat. Replies come only from the assistant service; nothing is generated in the browser. */
export default function ChatPanel() {
  const { assistant } = useServices()
  const { context } = useCollegeContext()
  const { t, err, language } = useI18n()
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [speaking, setSpeaking] = useState<number | null>(null)
  const [listenFailed, setListenFailed] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const nextId = useRef(1)
  const logRef = useRef<HTMLDivElement>(null)
  const inputId = useId()

  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, pending])

  async function ask(text: string, history: ChatTurn[]) {
    setPending(true)
    try {
      // The selected Student Portal language travels with every question so the assistant can answer in it.
      // Only the QR context (college + placement) travels with the question; identity comes from the session cookie.
      const reply = await assistant.send({ message: text, history, collegeId: context?.collegeId ?? null, area: context?.area ?? null, language, inputMode: 'text' })
      setMessages((current) => [...current, { id: nextId.current++, role: 'assistant', text: reply.text, steps: reply.steps, studentContext: reply.studentContext ?? null }])
    } catch (error) {
      setMessages((current) => [...current, { id: nextId.current++, role: 'assistant', failed: true, text: err(error, 'chat.failed') }])
    } finally {
      setPending(false)
    }
  }

  function send(text: string) {
    const question = text.trim()
    if (!question || pending) return
    const history: ChatTurn[] = messages.filter((message) => !message.failed).map(({ role, text: body }) => ({ role, text: body }))
    setMessages((current) => [...current, { id: nextId.current++, role: 'user', text: question }])
    setDraft('')
    void ask(question, history)
  }

  useEffect(() => () => { audioRef.current?.pause() }, [])

  /** Reads one reply aloud through the backend (the language is the one the reply was given in). */
  async function listen(message: Message) {
    if (!assistant.speak || speaking !== null) return
    setSpeaking(message.id)
    setListenFailed(null)
    try {
      const blob = await assistant.speak(message.text)
      audioRef.current?.pause()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      const release = () => URL.revokeObjectURL(url)
      audio.addEventListener('ended', release, { once: true })
      audio.addEventListener('error', release, { once: true })
      await audio.play()
    } catch {
      setListenFailed(message.id)
    } finally {
      setSpeaking(null)
    }
  }

  function retryLast() {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUser || pending) return
    setMessages((current) => current.filter((message, index) => !(message.failed && index === current.length - 1)))
    void ask(lastUser.text, messages.filter((message) => !message.failed && message.id !== lastUser.id).map(({ role, text }) => ({ role, text })))
  }

  return (
    <div className="chat">
      {!config.apiBaseUrl && (
        <p className="chat__status" role="status"><Info size={15} aria-hidden="true" /> {t('chat.preview')}</p>
      )}
      <div className="chat__log" ref={logRef} role="log" aria-live="polite" aria-label={t('chat.log')}>
        <div className="chat__intro">
          <span className="chat__bot" aria-hidden="true"><Bot size={22} /></span>
          <div className="chat__bubble chat__bubble--assistant">
            <p>{t('chat.intro')}</p>
            <ul className="chat__suggestions">
              {suggestedQuestions.map((question) => (
                <li key={question}><button type="button" className="chat__chip" onClick={() => send(t(question))} disabled={pending}>{t(question)}</button></li>
              ))}
            </ul>
          </div>
        </div>
        {messages.map((message, index) => (
          <div key={message.id} className={`chat__row chat__row--${message.role}`}>
            {message.role === 'assistant' && <span className="chat__bot chat__bot--small" aria-hidden="true"><Bot size={16} /></span>}
            <div className={`chat__bubble chat__bubble--${message.role}${message.failed ? ' chat__bubble--failed' : ''}`}>
              <span className="visually-hidden">{message.role === 'user' ? t('chat.youSaid') : t('chat.botSaid')}</span>
              <p>{message.text}</p>
              {message.steps?.length ? <ol className="chat__steps">{message.steps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
              {message.studentContext ? <StudentContextCard details={message.studentContext} /> : null}
              {message.role === 'assistant' && !message.failed && assistant.speak ? (
                <button type="button" className="chat__listen" onClick={() => void listen(message)} disabled={speaking !== null} aria-label={`${t('chat.listen')}: ${message.text.slice(0, 60)}`}>
                  {speaking === message.id ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Volume2 size={14} aria-hidden="true" />} {t('chat.listen')}
                </button>
              ) : null}
              {listenFailed === message.id && <p className="chat__listen-failed" role="status">{t('chat.listenFailed')}</p>}
              {message.failed && index === messages.length - 1 && (
                <button type="button" className="chat__retry" onClick={retryLast} disabled={pending}><RefreshCcw size={14} aria-hidden="true" /> {t('chat.retry')}</button>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <div className="chat__row chat__row--assistant" role="status">
            <span className="chat__bot chat__bot--small" aria-hidden="true"><Bot size={16} /></span>
            <div className="chat__bubble chat__bubble--assistant chat__typing"><span /><span /><span /><span className="visually-hidden">{t('chat.typing')}</span></div>
          </div>
        )}
      </div>

      <div className="chat__modes">
        <span className="chat__language"><Languages size={14} aria-hidden="true" /> {t('language.active', { language: languages.find((option) => option.code === language)!.name })}</span>
        {/* Spoken answers come from the backend (Listen). Voice INPUT is not wired up yet, so it is reported as unavailable, never faked. */}
        <span className="chat__voice" role="note"><MicOff size={14} aria-hidden="true" /> {t(assistant.speak ? 'chat.voiceInputUnavailable' : 'chat.voiceUnavailable')}</span>
      </div>
      <form className="chat__composer" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); send(draft) }}>
        <label htmlFor={inputId} className="visually-hidden">{t('chat.inputLabel')}</label>
        <input id={inputId} lang={language} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('chat.placeholder')} maxLength={500} autoComplete="off" />
        <button type="submit" className="chat__send" disabled={pending || !draft.trim()} aria-label={t('chat.send')}><SendHorizontal size={20} /></button>
      </form>
      <p className="chat__footnote"><Info size={16} aria-hidden="true" /> {t('chat.footnote')}</p>
    </div>
  )
}
