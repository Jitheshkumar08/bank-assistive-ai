import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { LanguageChoice } from '@/components/auth/LanguageChoice';
import type { LanguageCode } from '@/components/auth/LanguageChoice';
import { useAuth } from '@/context/useAuth';
import { ApiError } from '@/types/api';

/** Mirrors the API's own rules, so a mistake is caught before a round trip. */
const MIN_NAME = 2;
const MIN_PASSWORD = 8;
const PHONE_PATTERN = /^[0-9+\-\s()]{6,20}$/;

type FieldErrors = Partial<Record<'fullName' | 'email' | 'password' | 'phone', string>>;

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState<LanguageCode>('en');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validate(): FieldErrors {
    const problems: FieldErrors = {};

    if (fullName.trim().length < MIN_NAME) {
      problems.fullName = 'Enter your full name.';
    }

    // Deliberately loose. The API is the authority on what an address
    // is; this only catches the obvious slip before a round trip.
    if (!email.includes('@') || email.trim().length < 3) {
      problems.email = 'Enter a valid email address.';
    }

    if (password.length < MIN_PASSWORD) {
      problems.password = `Password must be at least ${MIN_PASSWORD} characters.`;
    }

    if (phone.trim() && !PHONE_PATTERN.test(phone.trim())) {
      problems.phone = 'Enter a valid phone number, or leave it blank.';
    }

    return problems;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting) return;

    const problems = validate();
    setFieldErrors(problems);

    if (Object.keys(problems).length > 0) {
      setError(null);
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await register({
        email: email.trim(),
        fullName: fullName.trim(),
        password,
        // Omitted rather than sent empty: the API validates the shape of
        // a phone number it is given, and "" is not a valid one.
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        preferredLanguage: language,
      });

      // Registering signs them in, so the next step is the same one a
      // returning customer takes.
      navigate('/scan', { replace: true });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Something went wrong. Please try again.',
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Create your account</h1>
        <p className="mt-1 text-base text-ink-600">
          It takes a minute, and the assistant will greet you by name.
        </p>
      </div>

      <Card>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field
            label="Full name"
            name="fullName"
            autoComplete="name"
            placeholder="Anita Rao"
            required
            disabled={submitting}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            error={fieldErrors.fullName}
            hint="This is how the assistant will address you."
          />

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
            error={fieldErrors.email}
          />

          <Field
            label="Password"
            type="password"
            name="password"
            // new-password, not current-password: this tells a password
            // manager to offer a generated one instead of autofilling
            // the account they already have.
            autoComplete="new-password"
            placeholder="At least 8 characters"
            required
            disabled={submitting}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
          />

          <Field
            label="Phone"
            type="tel"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            placeholder="Optional"
            disabled={submitting}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={fieldErrors.phone}
            hint="Optional. Branch staff may use it to reach you."
          />

          <LanguageChoice value={language} onChange={setLanguage} disabled={submitting} />

          <Button type="submit" loading={submitting}>
            {submitting ? 'Creating your account' : 'Create account'}
          </Button>
        </form>
      </Card>

      <p className="text-center text-sm text-ink-500">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-700 underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
