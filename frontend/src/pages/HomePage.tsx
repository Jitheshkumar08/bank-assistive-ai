import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandMark } from '@/components/brand/BrandMark';
import { SiteHeader } from '@/components/site/SiteHeader';
import {
  CheckTile,
  LanguagesCard,
  MicTile,
  NoteCard,
  StepCard,
  TasksCard,
} from '@/components/showcase/ShowcaseCards';
import { LinkButton } from '@/components/ui/LinkButton';
import { useAuth } from '@/context/useAuth';

interface Item {
  title: string;
  body: ReactNode;
  icon: ReactNode;
}

const STEPS: Item[] = [
  {
    title: 'Scan the code',
    body: 'Scan the QR code at your counter, and the assistant knows which branch you are in.',
    icon: <QrIcon />,
  },
  {
    title: 'Ask in your own words',
    body: 'Type it or say it: deposit money, apply for a loan, or ask about a service.',
    icon: <ChatIcon />,
  },
  {
    title: 'Follow each step',
    body: 'One clear instruction at a time, read aloud if you like, until you are done.',
    icon: <StepsIcon />,
  },
];

const FEATURES: Item[] = [
  {
    title: 'Your language, your choice',
    body: (
      <>
        Choose English, <span lang="kn">ಕನ್ನಡ</span> or <span lang="hi">हिन्दी</span> when you
        sign up, and change it any time in settings.
      </>
    ),
    icon: <GlobeIcon />,
  },
  {
    title: 'Voice or text',
    body: 'Speak your request or type it. Turn voice on and every answer is read aloud.',
    icon: <WaveIcon />,
  },
  {
    title: 'Private by design',
    body: 'Voice recordings are never kept, and closing the tab signs you out of a shared device.',
    icon: <LockIcon />,
  },
];

/**
 * The public home page.
 *
 * One headline, one decision, and three short sections that answer the
 * questions a first-time visitor actually has: how does it work, and is
 * it for me. Everything described is something the product does today.
 */
export function HomePage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-dvh bg-white">
      <a href="#main" className="sr-only-focusable">
        Skip to main content
      </a>

      <SiteHeader />

      <main id="main">
        <Hero isAuthenticated={isAuthenticated} />
        <HowItWorks />
        <Features />
        <CallToAction isAuthenticated={isAuthenticated} />
      </main>

      <SiteFooter />
    </div>
  );
}

/** Places an illustration and sets it drifting, out of step with its neighbours. */
function Floating({
  className,
  delay,
  children,
}: {
  className: string;
  delay: string;
  children: ReactNode;
}) {
  return (
    <div className={`absolute animate-float ${className}`} style={{ animationDelay: delay }}>
      {children}
    </div>
  );
}

function Hero({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <section aria-labelledby="hero-heading" className="px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="relative mx-auto max-w-[84rem] overflow-hidden rounded-[2rem] bg-ink-50 ring-1 ring-ink-200/60">
        <div
          aria-hidden="true"
          className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_85%)]"
        />

        {/* Wide screens: the product arranged around the headline. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden xl:block">
          <Floating className="top-[9%] left-[4%]" delay="0s">
            <NoteCard className="-rotate-6" />
          </Floating>
          <Floating className="top-[37%] left-[13%]" delay="-3s">
            <CheckTile className="rotate-6" />
          </Floating>
          <Floating className="top-[8%] right-[20%]" delay="-4s">
            <MicTile className="-rotate-6" />
          </Floating>
          <Floating className="top-[14%] right-[4%]" delay="-1.5s">
            <StepCard className="rotate-3" />
          </Floating>
          <Floating className="-bottom-10 left-[5%]" delay="-2s">
            <TasksCard className="rotate-2" />
          </Floating>
          <Floating className="right-[6%] -bottom-12" delay="-5s">
            <LanguagesCard className="-rotate-3" />
          </Floating>
        </div>

        <div className="relative mx-auto flex max-w-4xl animate-rise flex-col items-center px-6 pt-16 pb-16 text-center sm:pt-20 sm:pb-20 xl:min-h-[46rem] xl:justify-center xl:pb-28">
          <BrandMark size="xl" elevated />

          <h1
            id="hero-heading"
            className="mt-8 text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.04em] text-ink-900 sm:text-6xl lg:text-7xl"
          >
            Scan, ask, and bank{' '}
            <span className="block text-ink-500">with guidance at every step</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-600 sm:text-lg">
            Step-by-step help at your branch for deposits, withdrawals and loans &mdash; by voice or
            text, in your language.
          </p>

          <div className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            {isAuthenticated ? (
              <LinkButton to="/scan" fullWidth={false} className="w-full sm:w-auto sm:min-w-44">
                Open assistant
              </LinkButton>
            ) : (
              <>
                <LinkButton to="/register" fullWidth={false} className="w-full sm:w-auto sm:min-w-44">
                  Get started
                </LinkButton>
                <LinkButton
                  to="/login"
                  variant="secondary"
                  fullWidth={false}
                  className="w-full sm:w-auto sm:min-w-44"
                >
                  Sign in
                </LinkButton>
              </>
            )}
          </div>
        </div>

        {/* Tablets: two of the illustrations, set beneath the call to action
            rather than around it. Phones get the headline alone. */}
        <div aria-hidden="true" className="relative hidden justify-center gap-5 px-6 pb-14 md:flex xl:hidden">
          <StepCard />
          <LanguagesCard />
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  id,
  eyebrow,
  title,
  muted,
}: {
  id: string;
  eyebrow: string;
  title: string;
  muted: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold text-brand-700">{eyebrow}</p>
      <h2
        id={id}
        className="mt-3 text-3xl leading-tight font-semibold tracking-[-0.03em] text-ink-900 sm:text-[2.75rem]"
      >
        {title} <span className="text-ink-500">{muted}</span>
      </h2>
    </div>
  );
}

const CARD =
  'rounded-2xl bg-white p-6 ring-1 ring-ink-200/70 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_8px_24px_-12px_rgb(16_24_40/0.08)]';

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className="scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="how-heading"
          eyebrow="How it works"
          title="From the door to done,"
          muted="in three steps"
        />

        <ol className="mt-12 grid gap-4 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, index) => (
            <li key={step.title} className={CARD}>
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
                  {step.icon}
                </span>
                <span aria-hidden="true" className="text-sm font-semibold text-ink-300">
                  0{index + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">{step.title}</h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-600">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section
      id="features"
      aria-labelledby="features-heading"
      className="scroll-mt-20 border-t border-ink-200/60 bg-ink-50/60 px-5 py-20 sm:px-8 sm:py-28"
    >
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          id="features-heading"
          eyebrow="Features"
          title="Designed for everyone"
          muted="who walks through the door"
        />

        <ul className="mt-12 grid gap-4 md:grid-cols-3 md:gap-6">
          {FEATURES.map((feature) => (
            <li key={feature.title} className={CARD}>
              <span className="flex size-11 items-center justify-center rounded-xl bg-ink-900 text-white">
                {feature.icon}
              </span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-600">{feature.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CallToAction({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <section aria-labelledby="cta-heading" className="px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="relative mx-auto max-w-[84rem] overflow-hidden rounded-[2rem] bg-ink-900 px-6 py-16 text-center sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(42rem_22rem_at_50%_-10%,rgb(36_128_122/0.45),transparent_70%)]"
        />

        <div className="relative mx-auto max-w-2xl">
          <h2
            id="cta-heading"
            className="text-3xl leading-tight font-semibold tracking-[-0.03em] text-white sm:text-[2.75rem]"
          >
            Ready when you are. <span className="text-ink-400">Your next visit, made simple.</span>
          </h2>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {isAuthenticated ? (
              <LinkButton
                to="/scan"
                variant="inverse"
                fullWidth={false}
                className="w-full focus-visible:outline-white sm:w-auto sm:min-w-44"
              >
                Open assistant
              </LinkButton>
            ) : (
              <>
                <LinkButton
                  to="/register"
                  variant="inverse"
                  fullWidth={false}
                  className="w-full focus-visible:outline-white sm:w-auto sm:min-w-44"
                >
                  Get started
                </LinkButton>
                <Link
                  to="/login"
                  className="inline-flex min-h-touch w-full items-center justify-center rounded-xl px-5 text-base font-semibold text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-white sm:w-auto"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="px-5 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-ink-600 sm:flex-row">
        <span className="flex items-center gap-2.5 font-semibold tracking-tight text-ink-900">
          <BrandMark size="sm" />
          Banking Assistant
        </span>
        <p>Branch assistance &middot; demonstration build</p>
      </div>
    </footer>
  );
}

function IconBase({ children }: { children: ReactNode }) {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function QrIcon() {
  return (
    <IconBase>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.25" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1.25" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1.25" />
      <path d="M14.5 14.5h2.5v2.5M20.5 14.5v.01M14.5 20.5h.01M17 20.5h3.5V17" />
    </IconBase>
  );
}

function ChatIcon() {
  return (
    <IconBase>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V16h-.5A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 9h7M8.5 12h4" />
    </IconBase>
  );
}

function StepsIcon() {
  return (
    <IconBase>
      <path d="M5 19v-4M10 19v-8M15 19V8M20 19V4" />
    </IconBase>
  );
}

function GlobeIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 3.75 5.4 3.75 8.5S14.5 17.9 12 20.5C9.5 17.9 8.25 15.1 8.25 12S9.5 6.1 12 3.5Z" />
    </IconBase>
  );
}

function WaveIcon() {
  return (
    <IconBase>
      <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
    </IconBase>
  );
}

function LockIcon() {
  return (
    <IconBase>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </IconBase>
  );
}
