import { api } from './client';
import type {
  AuthResult,
  AuthenticatedUser,
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from '@/types/auth';

export const authApi = {
  login: (payload: LoginRequest) => api.post<AuthResult>('/auth/login', payload),
  register: (payload: RegisterRequest) => api.post<AuthResult>('/auth/register', payload),
  me: (signal?: AbortSignal) => api.get<AuthenticatedUser>('/auth/me', signal),
  updateProfile: (payload: UpdateProfileRequest) => api.patch<AuthResult>('/auth/me', payload),
  changePassword: (payload: ChangePasswordRequest) =>
    api.patch<AuthResult>('/auth/me/password', payload),
};
