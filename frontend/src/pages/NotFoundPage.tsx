import { LinkButton } from '@/components/ui/LinkButton';

export function NotFoundPage() {
  return (
    <div className="flex flex-col gap-6 text-center">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Page not found</h1>
        <p className="mt-1 text-base text-ink-600">
          That screen does not exist. Let us get you back on track.
        </p>
      </div>
      <LinkButton to="/">Back to sign in</LinkButton>
    </div>
  );
}
