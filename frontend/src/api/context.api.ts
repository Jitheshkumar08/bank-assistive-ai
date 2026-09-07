import { api } from './client';
import type { Branch, ResolvedContext } from '@/types/context';

export const contextApi = {
  listBranches: (signal?: AbortSignal) => api.get<Branch[]>('/branches', signal),
  resolve: (branchCode: string) => api.post<ResolvedContext>('/context/resolve', { branchCode }),
};
