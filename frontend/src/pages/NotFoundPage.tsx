import { LinkButton } from '@/components/ui/LinkButton';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center text-center">
      <p className="text-sm font-semibold text-brand-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-[-0.02em] text-ink-900">Page not found</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">
        That screen does not exist. Let us get you back on track.
      </p>
      <LinkButton to="/" className="mt-7">
        Back to home
      </LinkButton>
    </div>
  );
}
