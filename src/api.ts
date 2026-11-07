import type { Expense } from '../shared/types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public candidates: Expense[] = []) {
    super(message);
    this.name = 'ApiError';
  }
}

/** All API calls share session cookies; every write is explicitly protected. */
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = (options.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('x-ledger-request', '1');
    if (options.body) headers.set('content-type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach your workspace. Check your connection and try again.', 0);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error ?? 'The request could not be completed. Please try again.', response.status, body?.code, body?.candidates ?? []);
  const route=path.split('?')[0];
  const qualifies=(method==='POST'&&(['/expenses','/documents','/purchases','/products','/suppliers'].includes(route)||/^\/documents\/[^/]+\/confirm$/.test(route)||/^\/purchases\/[^/]+\/receive$/.test(route)))||(method==='PUT'&&/^\/(expenses|suppliers)\//.test(route));
  if(qualifies&&typeof window!=='undefined')window.dispatchEvent(new Event('ledger-activity'));
  return body as T;
}

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
