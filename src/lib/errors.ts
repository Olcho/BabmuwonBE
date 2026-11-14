export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
    this.name = 'ApiError';
  }
}
export const invalid = () => new ApiError(400, 'INVALID_REQUEST');
export const blocked = () => new ApiError(400, 'BLOCKED_BY_PRIVACY_POLICY');
