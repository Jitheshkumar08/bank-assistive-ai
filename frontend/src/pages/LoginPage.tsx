import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/context/useAuth';
import { ApiError } from '@/types/api';

interface LocationState {
  from?: string;
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 20 20 4" />}
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

/**
 * Signing in.
 *
 * Shown inside AccountLayout's card, beneath the toggle that switches to
 * registration -- which is why this page carries no link of its own to
 * the other form.
 */
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where they were heading before being sent here, if anywhere.
  const destination = (location.state as LocationState | null)?.from ?? '/scan';

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const account = await login({ email: email.trim(), password });

      // Staff have no branch to scan into; their screen is the one that
      // manages branches.
      navigate(account.role === 'ADMIN' ? '/admin' : destination, { replace: true });
    } catch (caught) {
      // The API already returns one message for every bad sign-in, so
      // this never reveals whether the email exists.
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Something went wrong. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink-900">Welcome back</h1>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
        Sign in to get step-by-step help with your banking task.
      </p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <Alert tone="error">{error}</Alert>}

        <Field
          label="Email"
          type="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          // Announced as required without the visual asterisk: on a form of
          // two fields that are both plainly needed, the marks are clutter.
          aria-required="true"
          disabled={submitting}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Field
          label="Password"
          type={showPassword ? 'text' : 'password'}
          name="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          aria-required="true"
          disabled={submitting}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          trailing={
            <button
              // Explicitly not a submit button: inside a form a button
              // defaults to submitting it, and checking what you typed would
              // sign you in before you had finished checking.
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              // The label names the action. A changing label with
              // aria-pressed as well would say contradictory things.
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              disabled={submitting}
              className="flex size-9 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50"
            >
              <EyeIcon crossed={showPassword} />
            </button>
          }
        />

        <Button type="submit" loading={submitting} className="group mt-2">
          {submitting ? (
            'Signing in'
          ) : (
            <>
              Sign in
              <ArrowRightIcon />
            </>
          )}
        </Button>
      </form>
    </div>
  );
}
