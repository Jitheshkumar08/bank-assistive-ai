import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { LanguagesCard, NoteCard, StepCard, TasksCard } from '@/components/showcase/ShowcaseCards';

interface AuthShellProps {
  children: ReactNode;
  /** Arrange a few product illustrations around the content on wide screens. */
  showcase?: boolean;
}

/**
 * The frame for public screens other than the home page: the same dotted
 * canvas as the home hero, the name linking back home, and one centred
 * piece of content.
 */
export function AuthShell({ children, showcase = false }: AuthShellProps) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-ink-50">
      <div
        aria-hidden="true"
        className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]"
      />

      <header className="relative z-10 mx-auto flex h-14 w-full max-w-6xl shrink-0 items-center px-5 sm:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-lg text-[0.95rem] font-semibold tracking-tight text-ink-900"
        >
          <BrandMark size="sm" />
          Banking Assistant
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-2 sm:px-6">
        {showcase && (
          // Wide screens only, and hidden from assistive technology: the
          // content in the middle is the whole task.
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden xl:block">
            {/* Top-left: sticky-note style */}
            <div className="absolute top-[12%] left-[5%] animate-float">
              <NoteCard className="-rotate-6" />
            </div>
            {/* Top-right: current step */}
            <div className="absolute top-[8%] right-[5%] animate-float" style={{ animationDelay: '-2s' }}>
              <StepCard className="rotate-3" />
            </div>
            {/* Bottom-left: languages */}
            <div className="absolute bottom-[12%] left-[6%] animate-float" style={{ animationDelay: '-4s' }}>
              <LanguagesCard className="rotate-2" />
            </div>
            {/* Bottom-right: guided tasks */}
            <div className="absolute bottom-[8%] right-[5%] animate-float" style={{ animationDelay: '-6s' }}>
              <TasksCard className="-rotate-3" />
            </div>
          </div>
        )}

        {children}
      </main>

      <footer className="relative z-10 shrink-0 px-5 pb-2 text-center text-xs text-ink-600">
        Branch assistance &middot; demonstration build &middot; Need help? Ask any member of branch staff.
      </footer>
    </div>
  );
}

