import { api } from './client';
import type {
  AdminBranch,
  AdminOverview,
  CreateBranchRequest,
  UpdateBranchRequest,
} from '@/types/admin';

/** The staff screen's calls. Every one needs an admin account. */
export const adminApi = {
  overview: (signal?: AbortSignal) => api.get<AdminOverview>('/admin/overview', signal),
  listBranches: (signal?: AbortSignal) => api.get<AdminBranch[]>('/admin/branches', signal),
  getBranch: (id: string, signal?: AbortSignal) =>
    api.get<AdminBranch>(`/admin/branches/${id}`, signal),
  createBranch: (payload: CreateBranchRequest) =>
    api.post<AdminBranch>('/admin/branches', payload),
  updateBranch: (id: string, payload: UpdateBranchRequest) =>
    api.patch<AdminBranch>(`/admin/branches/${id}`, payload),
  deleteBranch: (id: string) => api.delete<void>(`/admin/branches/${id}`),
};
