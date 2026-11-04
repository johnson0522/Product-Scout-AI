export type SearchProviderErrorKind =
  | 'unauthorized'
  | 'rate_limited'
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'response_too_large'
  | 'upstream';

/** Messages contain no provider response body, credentials, or request URL. */
export class SearchProviderError extends Error {
  public readonly retryable: boolean;

  public constructor(
    public readonly kind: SearchProviderErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SearchProviderError';
    this.retryable = kind === 'rate_limited' || kind === 'network' || kind === 'timeout'
      || (kind === 'upstream' && status !== undefined && status >= 500);
  }
}
