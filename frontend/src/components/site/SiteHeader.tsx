import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { LinkButton } from '@/components/ui/LinkButton';
import { useAuth } from '@/context/useAuth';

const SECTIONS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#features', label: 'Features' },
] as const;

/**
 * The public site's header: the name, the sections of the page, and the
 * one action that matters for whoever is looking.
 *
 * A customer who is already signed in is offered the way back into the
 * assistant, not a sign-in they do not need.
 */
export function SiteHeader() {
  const { isAuthenticated } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/60 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-lg text-[0.95rem] font-semibold tracking-tight text-ink-900"
        >
          <BrandMark size="sm" />
          Banking Assistant
        </Link>

        {/* The sections are a short scroll away on a phone, so the links
            are kept for wider screens rather than hidden in a menu. */}
        <nav aria-label="Sections" className="hidden items-center gap-8 md:flex">
          {SECTIONS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="rounded-md text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2">
          {isAuthenticated ? (
            <LinkButton to="/scan" variant="secondary" size="md" fullWidth={false}>
              Open assistant
            </LinkButton>
          ) : (
            <>
              <Link
                to="/login"
                className="hidden h-10 items-center rounded-lg px-3 text-sm font-medium text-ink-700 transition-colors hover:text-ink-900 sm:inline-flex"
              >
                Sign in
              </Link>
              <LinkButton to="/register" variant="secondary" size="md" fullWidth={false}>
                Get started
              </LinkButton>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
