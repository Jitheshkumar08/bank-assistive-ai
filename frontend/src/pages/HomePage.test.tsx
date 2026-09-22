import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { HomePage } from './HomePage';
import type { AuthenticatedUser } from '@/types/auth';

const USER: AuthenticatedUser = {
  id: 'u1',
  email: 'anita@example.com',
  fullName: 'Anita Rao',
  preferredLanguage: 'en',
  role: 'CUSTOMER',
};

function auth(user: AuthenticatedUser | null): AuthContextValue {
  return {
    user,
    isAuthenticated: user !== null,
    isRestoring: false,
    login: async () => USER,
    register: async () => {},
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
  };
}

function renderHome(user: AuthenticatedUser | null = null) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <HomePage /> },
      { path: '/login', element: <p>login screen</p> },
      { path: '/register', element: <p>register screen</p> },
      { path: '/scan', element: <p>scan screen</p> },
    ],
    { initialEntries: ['/'] },
  );

  return render(
    <AuthContext.Provider value={auth(user)}>
      <RouterProvider router={router} />
    </AuthContext.Provider>,
  );
}

describe('HomePage', () => {
  it('leads with what the assistant does, as a single heading', () => {
    renderHome();

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/scan, ask, and bank/i);
    expect(heading).toHaveTextContent(/with guidance at every step/i);
    // Both halves are one sentence, so they belong to one heading.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  describe('for a visitor', () => {
    it('points every "Get started" at registration', () => {
      renderHome();

      const links = screen.getAllByRole('link', { name: /get started/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute('href', '/register');
    });

    it('points every "Sign in" at the sign-in form', () => {
      renderHome();

      const links = screen.getAllByRole('link', { name: /^sign in$/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute('href', '/login');
    });

    it('takes them on to create an account', async () => {
      renderHome();

      const main = screen.getByRole('main');
      await userEvent.click(within(main).getAllByRole('link', { name: /get started/i })[0]);

      expect(await screen.findByText('register screen')).toBeInTheDocument();
    });
  });

  describe('for a signed-in customer', () => {
    it('offers the way back into the assistant instead of a sign-in', () => {
      renderHome(USER);

      const links = screen.getAllByRole('link', { name: /open assistant/i });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute('href', '/scan');

      expect(screen.queryByRole('link', { name: /^sign in$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /get started/i })).not.toBeInTheDocument();
    });
  });

  it('links only to sections that exist on the page', () => {
    const { container } = renderHome();

    const nav = screen.getByRole('navigation', { name: /sections/i });
    const links = within(nav).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      const target = link.getAttribute('href') ?? '';
      expect(target.startsWith('#')).toBe(true);
      // A header link to a section that is not there is a dead end.
      expect(container.querySelector(target)).not.toBeNull();
    }
  });

  it('keeps the illustrative product cards away from screen readers', () => {
    renderHome();

    const illustrations = screen.getAllByText('Fill in your account number');
    expect(illustrations.length).toBeGreaterThan(0);

    // Read aloud, they would sound like a visit already under way.
    for (const element of illustrations) {
      expect(element.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
