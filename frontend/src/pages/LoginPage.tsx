import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { useAuth } from '@/context/useAuth';
import { ApiError } from '@/types/api';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      await login({ email: email.trim(), password });
      navigate(destination, { replace: true });
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Welcome</h1>
        <p className="mt-1 text-base text-ink-600">
          Sign in to get step-by-step help with your banking task.
        </p>
      </div>

      <Card>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field
            label="Email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            disabled={submitting}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            required
            disabled={submitting}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <Button type="submit" loading={submitting}>
            {submitting ? 'Signing in' : 'Sign in'}
          </Button>
        </form>
      </Card>

      <p className="text-center text-base text-ink-600">
        New here?{' '}
        <Link to="/register" className="font-semibold text-brand-700 underline">
          Create an account
        </Link>
      </p>

      <p className="text-center text-sm text-ink-500">
        Need help? Ask any member of branch staff.
      </p>
    </div>
  );
}
