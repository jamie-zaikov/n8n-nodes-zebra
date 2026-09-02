/**
 * Pure request builders for the seven zebra api operations plus a health probe (FR-21).
 *
 * Each builder composes an operation's method and path — including the `{name}` substitution and the
 * `?printer=&force=&resume=` query string for Print, Print Template, and Print Raw — and hands it to
 * the shared `buildApiRequest` (which attaches the bearer auth header via `buildAuthHeader`). These
 * builders open no socket: they return only the request descriptor, so a unit test can assert
 * method, URL, and headers without a network (FR-25.1). The concrete node performs the actual
 * transport and attaches the Print body. The Print Raw builder additionally augments the descriptor
 * headers with `Content-Type: text/plain` while preserving the bearer auth header (DD-8).
 */

import {
  buildApiRequest,
  HEALTH_PATH,
  type ApiRequest,
  type InstrumentApiClientOptions,
} from './client';

/** Optional query parameters for the Print operation (`?printer=&force=&resume=`). */
export interface PrintQuery {
  /** Override the batch's target printer by registry name. */
  printer?: string;
  /** Print even when the printer reports a blocking status (force wins over resume). */
  force?: boolean;
  /** Clear a pause before printing. */
  resume?: boolean;
}

/**
 * Compose the query string for Print, emitting only the parameters that are set. Returns an empty
 * string when no parameter is supplied, so the path stays clean.
 */
function printQueryString(query: PrintQuery): string {
  const params: string[] = [];
  if (query.printer !== undefined && query.printer !== '') {
    params.push(`printer=${encodeURIComponent(query.printer)}`);
  }
  if (query.force !== undefined) {
    params.push(`force=${String(query.force)}`);
  }
  if (query.resume !== undefined) {
    params.push(`resume=${String(query.resume)}`);
  }
  return params.length === 0 ? '' : `?${params.join('&')}`;
}

/** Print — `POST /print` (+ `?printer=&force=&resume=`); the node attaches the batch body. (FR-20.1) */
export function printRequest(
  options: InstrumentApiClientOptions,
  query: PrintQuery = {},
): ApiRequest {
  return buildApiRequest(options, 'POST', `/print${printQueryString(query)}`);
}

/** Get Status — `GET /printers/{name}/status`. (FR-20.2) */
export function getStatusRequest(
  options: InstrumentApiClientOptions,
  name: string,
): ApiRequest {
  return buildApiRequest(options, 'GET', `/printers/${encodeURIComponent(name)}/status`);
}

/** List Printers — `GET /printers`. (FR-20.3) */
export function listPrintersRequest(options: InstrumentApiClientOptions): ApiRequest {
  return buildApiRequest(options, 'GET', '/printers');
}

/** Resume — `POST /printers/{name}/resume`. (FR-20.4) */
export function resumeRequest(
  options: InstrumentApiClientOptions,
  name: string,
): ApiRequest {
  return buildApiRequest(options, 'POST', `/printers/${encodeURIComponent(name)}/resume`);
}

/**
 * Print Template — `POST /print/template` (+ `?printer=&force=&resume=`); the node attaches the
 * `{template, fields}` body. Reuses the shared `printQueryString` helper for the identical query
 * string as Print. (FR-18, FR-21)
 */
export function printTemplateRequest(
  options: InstrumentApiClientOptions,
  query: PrintQuery = {},
): ApiRequest {
  return buildApiRequest(options, 'POST', `/print/template${printQueryString(query)}`);
}

/**
 * Print Raw — `POST /print/raw` (+ `?printer=&force=&resume=`). Augments the descriptor headers with
 * `Content-Type: text/plain` while preserving the bearer auth header, so the node sends the opaque ZPL
 * string verbatim as a `text/plain` body (DD-8). The node attaches the raw string body. (FR-19, FR-21)
 */
export function printRawRequest(
  options: InstrumentApiClientOptions,
  query: PrintQuery = {},
): ApiRequest {
  const req = buildApiRequest(options, 'POST', `/print/raw${printQueryString(query)}`);
  return { ...req, headers: { ...req.headers, 'Content-Type': 'text/plain' } };
}

/** List Templates — `GET /templates`. (FR-20, FR-21) */
export function listTemplatesRequest(options: InstrumentApiClientOptions): ApiRequest {
  return buildApiRequest(options, 'GET', '/templates');
}

/** Health probe — `GET {HEALTH_PATH}` on the paired api (FR-21). */
export function healthRequest(options: InstrumentApiClientOptions): ApiRequest {
  return buildApiRequest(options, 'GET', HEALTH_PATH);
}
