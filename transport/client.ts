/**
 * The HTTP contract the Zebra node uses to reach its paired zebra REST API.
 *
 * This is the standalone, dependency-free inline of the monorepo's `n8n-node-core` client helpers:
 *
 * - {@link InstrumentApiClientOptions} — how the node addresses its API (base URL + bearer token).
 * - {@link buildAuthHeader} — build the `Authorization` header with the bearer token.
 * - {@link buildApiRequest} — compose a request descriptor (method, URL, headers) from the options.
 * - {@link HEALTH_PATH} — the unauthenticated liveness path the paired API exposes.
 *
 * The bearer token is supplied at runtime from an n8n credential and is referenced, never
 * hard-coded, logged, or committed. The actual transport (the n8n request helper) is performed by
 * the concrete node; this module builds only the pure request descriptor so it is easy to unit-test
 * without a network.
 */

/** Default per-request timeout, in milliseconds, a concrete node applies to the transport. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** The unauthenticated liveness/readiness path the paired API exposes (mirrors the API core). */
export const HEALTH_PATH = '/healthz';

/** How a node addresses its paired instrument API. The token is referenced, never stored at rest. */
export interface InstrumentApiClientOptions {
  /** Base URL of the paired API, for example `https://<service>-<hash>-uw.a.run.app`. */
  baseUrl: string;
  /** Bearer token from the node's n8n credential (a runtime value, never committed). */
  bearerToken: string;
  /** Optional per-request timeout in milliseconds; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** A composed HTTP request descriptor the concrete node hands to its transport. */
export interface ApiRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

/**
 * Build the `Authorization` header for a bearer token.
 *
 * The token is placed in the header value only; it is never logged or embedded elsewhere. The
 * caller keeps the returned object out of logs.
 */
export function buildAuthHeader(bearerToken: string): Record<string, string> {
  return { Authorization: `Bearer ${bearerToken}` };
}

/**
 * Compose an {@link ApiRequest} for `method` and `path` against the client options.
 *
 * Joins `baseUrl` and `path` with exactly one slash, attaches the bearer auth header, and resolves
 * the timeout (falling back to {@link DEFAULT_TIMEOUT_MS}). This is pure: it opens no socket, so a
 * unit test can assert the descriptor without a network. The transport itself is the concrete
 * node's responsibility.
 */
export function buildApiRequest(
  options: InstrumentApiClientOptions,
  method: string,
  path: string,
): ApiRequest {
  const base = options.baseUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return {
    method,
    url: `${base}/${suffix}`,
    headers: buildAuthHeader(options.bearerToken),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}
