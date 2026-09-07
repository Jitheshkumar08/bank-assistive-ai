/** Error body produced by the backend's global exception filter. */
export interface ApiErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
}

/**
 * Every failure the API layer surfaces, whether it came from the server,
 * the network, or a timeout. Components handle one type, not three.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** True when the user is unauthenticated or their session expired. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** True when the request never reached the server. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}
