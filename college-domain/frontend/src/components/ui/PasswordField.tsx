import { Eye, EyeOff, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'
import TextField, { type TextFieldProps } from './TextField'

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'icon' | 'endAdornment'>

/** Password input with an accessible show/hide toggle. */
export default function PasswordField({ id, disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false)
  const { t } = useI18n()
  const Toggle = visible ? EyeOff : Eye
  return (
    <TextField
      {...props}
      id={id}
      disabled={disabled}
      type={visible ? 'text' : 'password'}
      icon={LockKeyhole}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      endAdornment={
        <button
          type="button"
          className="field__toggle"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
        >
          <Toggle aria-hidden="true" size={18} strokeWidth={1.8} />
        </button>
      }
    />
  )
}
