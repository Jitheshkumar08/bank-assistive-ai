import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { SessionContext, type SessionContextValue } from '@/context/SessionContext';
import { RequireAdmin } from '@/routes/RequireAdmin';
import { AdminOverviewPage } from './AdminOverviewPage';
import { AdminNewBranchPage } from './AdminNewBranchPage';
import { AdminBranchPage } from './AdminBranchPage';
import { ApiError } from '@/types/api';
import type { AdminBranch } from '@/types/admin';
import type { AuthenticatedUser } from '@/types/auth';
import type { Session } from '@/types/session';

const overview = vi.fn();
const listBranches = vi.fn();
const getBranch = vi.fn();
const createBranch = vi.fn();
const updateBranch = vi.fn();
const deleteBranch = vi.fn();

vi.mock('@/api/admin.api', () => ({
  adminApi: {
    overview: (...args: unknown[]) => overview(...args),
    listBranches: (...args: unknown[]) => listBranches(...args),
    getBranch: (...args: unknown[]) => getBranch(...args),
    createBranch: (...args: unknown[]) => createBranch(...args),
    updateBranch: (...args: unknown[]) => updateBranch(...args),
    deleteBranch: (...args: unknown[]) => deleteBranch(...args),
  },
}));

// The QR library draws to a canvas, which jsdom has no engine for. The
// payload it is handed is the part that matters, and it is asserted on
// directly through branchQrPayload.
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,stub'),
    toString: vi.fn().mockResolvedValue('<svg role="img"></svg>'),
  },
}));

const ADMIN: AuthenticatedUser = {
  id: 'a1',
  email: 'admin@bankassist.local',
  fullName: 'Administrator',
  preferredLanguage: 'en',
  role: 'ADMIN',
  suggestionsEnabled: true,
};

const CUSTOMER: AuthenticatedUser = { ...ADMIN, id: 'u1', fullName: 'Anita Rao', role: 'CUSTOMER' };

const BRANCH: AdminBranch = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'BR001',
  name: 'Surathkal Branch',
  city: 'Mangaluru',
  address: null,
  isActive: true,
  totalVisits: 4,
  activeVisits: 1,
  lastVisitAt: new Date().toISOString(),
};

const UNUSED_BRANCH: AdminBranch = {
  ...BRANCH,
  id: '22222222-2222-4222-8222-222222222222',
  code: 'BR002',
  name: 'City Centre Branch',
  totalVisits: 0,
  activeVisits: 0,
  lastVisitAt: null,
};

function auth(user: AuthenticatedUser | null): AuthContextValue {
  return {
    user,
    isAuthenticated: user !== null,
    isRestoring: false,
    login: async () => user ?? ADMIN,
    register: async () => {},
    updateProfile: async () => {},
    changePassword: async () => {},
    logout: () => {},
  };
}

const session: SessionContextValue = {
  session: null,
  isLoading: false,
  hasContext: false,
  error: null,
  refresh: async () => {},
  establish: async () => ({}) as Session,
  endSession: async () => {},
  arrivalAt: null,
  acknowledgeArrival: () => {},
};

function renderAdmin(path: string, user: AuthenticatedUser | null = ADMIN) {
  const router = createMemoryRouter(
    [
      {
        element: <RequireAdmin />,
        children: [
          { path: '/admin', element: <AdminOverviewPage /> },
          { path: '/admin/branches/new', element: <AdminNewBranchPage /> },
          { path: '/admin/branches/:id', element: <AdminBranchPage /> },
        ],
      },
      { path: '/scan', element: <p>scan screen</p> },
    ],
    { initialEntries: [path] },
  );

  return render(
    <AuthContext.Provider value={auth(user)}>
      <SessionContext.Provider value={session}>
        <RouterProvider router={router} />
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  overview.mockReset().mockResolvedValue({
    branches: { total: 2, active: 2 },
    customers: 7,
    visits: { active: 1, today: 3 },
  });
  listBranches.mockReset().mockResolvedValue([BRANCH, UNUSED_BRANCH]);
  getBranch.mockReset().mockResolvedValue(BRANCH);
  createBranch.mockReset().mockResolvedValue(UNUSED_BRANCH);
  updateBranch.mockReset().mockResolvedValue(BRANCH);
  deleteBranch.mockReset().mockResolvedValue(undefined);
});

describe('who the staff screen is for', () => {
  it('sends a customer back to their own screen', async () => {
    renderAdmin('/admin', CUSTOMER);

    expect(await screen.findByText('scan screen')).toBeInTheDocument();
    // The list is never even asked for.
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('opens for the admin account', async () => {
    renderAdmin('/admin');

    expect(await screen.findByRole('heading', { level: 1, name: /branches/i })).toBeInTheDocument();
  });
});

describe('the branch list', () => {
  it('shows every branch with how used it is', async () => {
    renderAdmin('/admin');

    const branch = await screen.findByRole('link', { name: /surathkal branch/i });
    expect(branch).toHaveAttribute('href', `/admin/branches/${BRANCH.id}`);
    expect(within(branch).getByText(/BR001/)).toBeInTheDocument();
    expect(within(branch).getByText(/4 visits/)).toBeInTheDocument();
  });

  it('narrows the list by a search', async () => {
    renderAdmin('/admin');
    await screen.findByRole('link', { name: /surathkal branch/i });

    await userEvent.type(screen.getByRole('searchbox', { name: /search branches/i }), 'BR002');

    expect(screen.queryByRole('link', { name: /surathkal branch/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /city centre branch/i })).toBeInTheDocument();
  });

  it('says so when the API cannot be reached', async () => {
    listBranches.mockRejectedValue(new ApiError('Cannot reach the server.', 0));

    renderAdmin('/admin');

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the server/i);
  });
});

describe('adding a branch', () => {
  it('refuses a code the scanner could not read', async () => {
    renderAdmin('/admin/branches/new');

    await userEvent.type(screen.getByLabelText(/branch code/i), 'not a code');
    await userEvent.type(screen.getByLabelText(/branch name/i), 'Test Branch');
    await userEvent.click(screen.getByRole('button', { name: /add branch/i }));

    expect(screen.getByText(/2-32 letters, digits/i)).toBeInTheDocument();
    expect(createBranch).not.toHaveBeenCalled();
  });

  it('sends the code uppercase and opens the new branch', async () => {
    // The branch page then loads the branch that was just created.
    getBranch.mockResolvedValue(UNUSED_BRANCH);
    renderAdmin('/admin/branches/new');

    await userEvent.type(screen.getByLabelText(/branch code/i), 'br002');
    await userEvent.type(screen.getByLabelText(/branch name/i), 'City Centre Branch');
    await userEvent.click(screen.getByRole('button', { name: /add branch/i }));

    await waitFor(() =>
      expect(createBranch).toHaveBeenCalledWith({ code: 'BR002', name: 'City Centre Branch' }),
    );
    expect(await screen.findByRole('heading', { name: /city centre branch/i })).toBeInTheDocument();
  });

  it('shows the reason a code was refused', async () => {
    createBranch.mockRejectedValue(new ApiError('A branch with that code already exists.', 409));

    renderAdmin('/admin/branches/new');
    await userEvent.type(screen.getByLabelText(/branch code/i), 'BR001');
    await userEvent.type(screen.getByLabelText(/branch name/i), 'Duplicate Branch');
    await userEvent.click(screen.getByRole('button', { name: /add branch/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });
});

describe('one branch', () => {
  it('keeps the code fixed, because it is already printed', async () => {
    renderAdmin(`/admin/branches/${BRANCH.id}`);
    await screen.findByRole('heading', { name: /surathkal branch/i });

    // Shown -- on the page and under the QR -- but not as something
    // that can be typed into.
    expect(screen.getAllByText('BR001').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/branch code/i)).not.toBeInTheDocument();
  });

  it('saves a rename', async () => {
    updateBranch.mockResolvedValue({ ...BRANCH, name: 'Surathkal Main Branch' });

    renderAdmin(`/admin/branches/${BRANCH.id}`);
    const name = await screen.findByLabelText(/branch name/i);

    await userEvent.clear(name);
    await userEvent.type(name, 'Surathkal Main Branch');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(updateBranch).toHaveBeenCalledWith(BRANCH.id, {
        name: 'Surathkal Main Branch',
        city: 'Mangaluru',
        address: '',
      }),
    );
    expect(await screen.findByText(/details have been saved/i)).toBeInTheDocument();
  });

  it('takes a branch out of service', async () => {
    updateBranch.mockResolvedValue({ ...BRANCH, isActive: false });

    renderAdmin(`/admin/branches/${BRANCH.id}`);
    await screen.findByRole('heading', { name: /surathkal branch/i });

    await userEvent.click(screen.getByRole('button', { name: /take out of service/i }));

    await waitFor(() => expect(updateBranch).toHaveBeenCalledWith(BRANCH.id, { isActive: false }));
    expect(await screen.findByRole('button', { name: /put back in service/i })).toBeInTheDocument();
  });

  it('offers deletion only for a branch nobody has visited', async () => {
    renderAdmin(`/admin/branches/${BRANCH.id}`);
    await screen.findByRole('heading', { name: /surathkal branch/i });

    // This one has visits recorded against it, and they are part of its
    // history.
    expect(screen.queryByRole('button', { name: /delete branch/i })).not.toBeInTheDocument();

    getBranch.mockResolvedValue(UNUSED_BRANCH);
    renderAdmin(`/admin/branches/${UNUSED_BRANCH.id}`);

    expect(await screen.findByRole('button', { name: /delete branch/i })).toBeInTheDocument();
  });
});
