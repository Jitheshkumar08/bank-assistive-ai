/**
 * What the staff screen works with.
 *
 * Mirrors the API's admin responses. A branch is the record plus how
 * used it is, because "can I delete this?" and "is this one live?" are
 * the questions the screen exists to answer.
 */
export interface AdminBranch {
  id: string;
  /** Printed under the QR, and the only thing inside it. */
  code: string;
  name: string;
  city: string | null;
  address: string | null;
  isActive: boolean;
  totalVisits: number;
  activeVisits: number;
  /** ISO timestamp, or null when nobody has visited yet. */
  lastVisitAt: string | null;
}

export interface AdminOverview {
  branches: { total: number; active: number };
  customers: number;
  visits: { active: number; today: number };
}

export interface CreateBranchRequest {
  code: string;
  name: string;
  city?: string;
  address?: string;
}

/**
 * Everything optional: a form sends only what it changed.
 *
 * No code: it is printed on every sticker already on a counter, so the
 * API refuses to change it.
 */
export interface UpdateBranchRequest {
  name?: string;
  city?: string;
  address?: string;
  isActive?: boolean;
}
