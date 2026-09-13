import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './buttonStyles';

interface LinkButtonProps {
  to: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Fills the container, as on a phone. Off for calls to action side by side. */
  fullWidth?: boolean;
  className?: string;
}

/**
 * A link that looks like a button.
 *
 * Navigation must stay an anchor: it belongs in browser history, opens
 * in a new tab on middle-click, and is announced as a link. Wrapping a
 * Link inside a <button> would break all three and is invalid HTML.
 */
export function LinkButton({
  to,
  children,
  variant = 'primary',
  size = 'lg',
  fullWidth = true,
  className,
}: LinkButtonProps) {
  return (
    <Link to={to} className={cn(buttonClasses({ variant, size, fullWidth }), className)}>
      {children}
    </Link>
  );
}
