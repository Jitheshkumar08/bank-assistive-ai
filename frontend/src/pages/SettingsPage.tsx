import { useCallback, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { cn } from '@/lib/cn';
import { LinkButton } from '@/components/ui/LinkButton';
import { activitiesApi } from '@/api/activities.api';
import { LanguageChoice } from '@/components/auth/LanguageChoice';
import type { LanguageCode } from '@/components/auth/LanguageChoice';
import { useAuth } from '@/context/useAuth';
import { ApiError } from '@/types/api';
import type { UpdateProfileRequest } from '@/types/auth';

const MIN_NAME = 2;
const MIN_PASSWORD = 8;

function isLanguage(value: string): value is LanguageCode {
  return value === 'en' || value === 'kn' || value === 'hi';
}

/**
 * The customer's own account.
 *
 * Two forms rather than one, because they are two different acts with
 * two different risks. Details are a convenience; a password is a
 * credential, and burying it in the same submit button as a language
 * choice would mean typing a password to switch to Kannada.
 */
export function SettingsPage() {
  const { user, updateProfile, changePassword } = useAuth();

  // Owned here, not inside the form. Saving changes the account, which
  // re-keys the form below and remounts it -- so a banner the form kept
  // for itself would be destroyed by the very save it was reporting.
  const [profileSaved, setProfileSaved] = useState(false);

  const saveProfile = useCallback(
    async (changes: UpdateProfileRequest): Promise<void> => {
      setProfileSaved(false);
      await updateProfile(changes);
      setProfileSaved(true);
    },
    [updateProfile],
  );

  // RequireAuth already guarantees this; the guard is for the day it
  // does not.
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Your settings</h1>
        <p className="mt-1 text-base text-ink-600">
          Change how the assistant addresses you and which language it speaks.
        </p>
      </div>

      <ProfileForm
        key={`${user.fullName}:${user.email}:${user.preferredLanguage}`}
        initialName={user.fullName}
        initialEmail={user.email}
        initialLanguage={isLanguage(user.preferredLanguage) ? user.preferredLanguage : 'en'}
        onSave={saveProfile}
        saved={profileSaved}
      />

      <RememberedPayments
        enabled={user.suggestionsEnabled}
        onToggle={(suggestionsEnabled) => saveProfile({ suggestionsEnabled })}
      />

      <PasswordForm onSave={changePassword} />

      <LinkButton to="/scan" variant="secondary">
        Back
      </LinkButton>
    </div>
  );
}

/**
 * Name, email and language.
 *
 * Only changed fields are sent. A form that resends everything it
 * rendered will happily overwrite a value changed elsewhere with the
 * copy it loaded minutes ago.
 */
function ProfileForm({
  initialName,
  initialEmail,
  initialLanguage,
  onSave,
  saved,
}: {
  initialName: string;
  initialEmail: string;
  initialLanguage: LanguageCode;
  onSave: (changes: UpdateProfileRequest) => Promise<void>;
  saved: boolean;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [language, setLanguage] = useState<LanguageCode>(initialLanguage);
  const [currentPassword, setCurrentPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== initialEmail.toLowerCase();
  const nothingChanged =
    !emailChanged && fullName.trim() === initialName && language === initialLanguage;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setNameError(null);

    if (fullName.trim().length < MIN_NAME) {
      setNameError('Enter your full name.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await onSave({
        ...(fullName.trim() !== initialName ? { fullName: fullName.trim() } : {}),
        ...(emailChanged ? { email: email.trim(), currentPassword } : {}),
        ...(language !== initialLanguage ? { preferredLanguage: language } : {}),
      });

      setCurrentPassword('');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <h2 className="text-lg font-semibold text-ink-900">Your details</h2>

        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Your details have been saved.</Alert>}

        <Field
          label="Full name"
          name="fullName"
          autoComplete="name"
          required
          disabled={submitting}
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          error={nameError ?? undefined}
          hint="This is how the assistant will address you."
        />

        <Field
          label="Email"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={submitting}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        {/* Appears only when the address actually changes. An email is
            the account's identity, so changing it has to prove who is
            asking -- but demanding a password to rename yourself would
            be friction with nothing behind it. */}
        {emailChanged && (
          <Field
            // Not "Current password": the password form below has a
            // field by that name, and two identically labelled password
            // boxes on one screen is a way to get the wrong one filled.
            label="Confirm your password"
            type="password"
            name="currentPassword"
            autoComplete="current-password"
            required
            disabled={submitting}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            hint="Needed to change the email address on your account."
          />
        )}

        <LanguageChoice value={language} onChange={setLanguage} disabled={submitting} />

        <Button type="submit" loading={submitting} disabled={nothingChanged}>
          {submitting ? 'Saving' : 'Save changes'}
        </Button>
      </form>
    </Card>
  );
}

/**
 * Remembered payments: the switch, and the way to erase them.
 *
 * Both belong to the customer rather than to the branch. "Forget" is a
 * real delete -- the activities and the offers go, not a flag that
 * hides them -- so someone who asks to be forgotten on a shared device
 * actually is.
 */
function RememberedPayments({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgot, setForgot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(): Promise<void> {
    setSaving(true);
    setError(null);

    try {
      await onToggle(!enabled);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function handleForget(): Promise<void> {
    setForgetting(true);
    setError(null);
    setForgot(null);

    try {
      const result = await activitiesApi.forget();
      setForgot(result.deleted);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'That could not be deleted.');
    } finally {
      setForgetting(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink-900">Remembered payments</h2>
      <p className="mt-1 text-sm text-ink-600">
        When this is on, the welcome screen can offer you a payment you have made before. It never
        pays anyone on its own.
      </p>

      {error && (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      )}

      {forgot !== null && (
        <Alert tone="success" className="mt-4">
          {forgot === 0
            ? 'There was nothing left to forget.'
            : `Deleted ${forgot} remembered ${forgot === 1 ? 'item' : 'items'}.`}
        </Alert>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-busy={saving || undefined}
          disabled={saving}
          onClick={() => void handleToggle()}
          className="flex min-h-touch items-center justify-between gap-4 rounded-xl px-1 text-left"
        >
          <span className="text-sm font-medium text-ink-900">Suggest my recent payments</span>
          <span
            aria-hidden="true"
            className={cn(
              'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
              enabled ? 'bg-brand-600' : 'bg-ink-200',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-5 rounded-full bg-white transition-[left]',
                enabled ? 'left-[1.375rem]' : 'left-0.5',
              )}
            />
          </span>
        </button>

        <Button
          variant="secondary"
          loading={forgetting}
          onClick={() => void handleForget()}
        >
          {forgetting ? 'Forgetting' : 'Forget my payment history'}
        </Button>
      </div>
    </Card>
  );
}

function PasswordForm({
  onSave,
}: {
  onSave: (change: { currentPassword: string; newPassword: string }) => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;

    setSaved(false);
    setNewError(null);

    if (newPassword.length < MIN_PASSWORD) {
      setNewError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await onSave({ currentPassword, newPassword });

      setSaved(true);
      // Never leave a password sitting in a form field after it has
      // been used.
      setCurrentPassword('');
      setNewPassword('');
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <h2 className="text-lg font-semibold text-ink-900">Password</h2>

        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Your password has been changed.</Alert>}

        <Field
          label="Current password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          disabled={submitting}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />

        <Field
          label="New password"
          type="password"
          name="newPassword"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          disabled={submitting}
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          error={newError ?? undefined}
        />

        <Button type="submit" loading={submitting}>
          {submitting ? 'Changing password' : 'Change password'}
        </Button>
      </form>
    </Card>
  );
}
