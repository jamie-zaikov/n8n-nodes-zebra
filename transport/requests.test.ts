/**
 * Suite for the zebra node's pure request builders (FR-25, FR-25.1, FR-21).
 *
 * Every assertion is pure and offline: the builders compose only a request DESCRIPTOR through the
 * shared `buildApiRequest` / `buildAuthHeader`, so nothing here opens a socket (FR-25.1). Each of the
 * seven operations — Print, Get Status, List Printers, Resume, Print Template, Print Raw, List
 * Templates — plus the health probe is asserted for its method and path (FR-20.1..FR-20.4, FR-21).
 *
 * The bearer token is a sentinel: it appears in the `Authorization` header value only, never in a
 * method, URL, path, or query (NFR-5).
 */
import {
  DEFAULT_TIMEOUT_MS,
  buildAuthHeader,
  HEALTH_PATH,
  type InstrumentApiClientOptions,
} from './client';

import {
  getStatusRequest,
  healthRequest,
  listPrintersRequest,
  listTemplatesRequest,
  printRawRequest,
  printRequest,
  printTemplateRequest,
  resumeRequest,
} from './requests';

/** A sentinel token: distinctive, so a leak into any non-header field is unmistakable. */
const SENTINEL_TOKEN = 'zebra-sentinel-bearer-DEADBEEF'; // pragma: allowlist secret
const BASE_URL = 'https://zebra-api-abc123-uw.a.run.app';

/** Base client options every builder test shares (no `timeoutMs`, so the default resolves). */
const options: InstrumentApiClientOptions = {
  baseUrl: BASE_URL,
  bearerToken: SENTINEL_TOKEN,
};

/** The exact auth header the core derives from the sentinel token (FR-21, NFR-5). */
const EXPECTED_AUTH = buildAuthHeader(SENTINEL_TOKEN);

describe('printRequest — POST /print (FR-20.1, FR-25.1)', () => {
  it('composes POST /print with no query when none is supplied', () => {
    const req = printRequest(options);
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/print`);
  });

  it('composes the printer / force / resume query in order', () => {
    const req = printRequest(options, { printer: 'zt410', force: true, resume: false });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/print?printer=zt410&force=true&resume=false`);
  });

  it('emits force / resume even when both are false (the node default path)', () => {
    // The node always passes booleans (default false); a false must still be sent, not dropped.
    const req = printRequest(options, { printer: '', force: false, resume: false });
    expect(req.url).toBe(`${BASE_URL}/print?force=false&resume=false`);
  });

  it('url-encodes a printer override that carries reserved characters', () => {
    const req = printRequest(options, { printer: 'bench 1/A&B' });
    expect(req.url).toBe(`${BASE_URL}/print?printer=bench%201%2FA%26B`);
  });

  it('omits an empty-string printer but keeps a supplied force', () => {
    const req = printRequest(options, { printer: '', force: true });
    expect(req.url).toBe(`${BASE_URL}/print?force=true`);
  });
});

describe('getStatusRequest — GET /printers/{name}/status (FR-20.2, FR-25.1)', () => {
  it('composes GET with the name substituted into the path', () => {
    const req = getStatusRequest(options, 'zt410');
    expect(req.method).toBe('GET');
    expect(req.url).toBe(`${BASE_URL}/printers/zt410/status`);
  });

  it('url-encodes a printer name with reserved characters', () => {
    const req = getStatusRequest(options, 'bench 1/A');
    expect(req.url).toBe(`${BASE_URL}/printers/bench%201%2FA/status`);
  });
});

describe('listPrintersRequest — GET /printers (FR-20.3, FR-25.1)', () => {
  it('composes GET /printers with no path parameters', () => {
    const req = listPrintersRequest(options);
    expect(req.method).toBe('GET');
    expect(req.url).toBe(`${BASE_URL}/printers`);
  });
});

describe('resumeRequest — POST /printers/{name}/resume (FR-20.4, FR-25.1)', () => {
  it('composes POST with the name substituted into the path', () => {
    const req = resumeRequest(options, 'zt410');
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/printers/zt410/resume`);
  });

  it('url-encodes a printer name with reserved characters', () => {
    const req = resumeRequest(options, 'bench 1/A');
    expect(req.url).toBe(`${BASE_URL}/printers/bench%201%2FA/resume`);
  });
});

describe('printTemplateRequest — POST /print/template (FR-18, FR-23, FR-23.1)', () => {
  it('composes POST /print/template with no query when none is supplied', () => {
    const req = printTemplateRequest(options);
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/print/template`);
    // An empty query yields a clean path with no `?`.
    expect(req.url).not.toContain('?');
  });

  it('composes the printer / force / resume query in order', () => {
    const req = printTemplateRequest(options, { printer: 'zt410', force: true, resume: false });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/print/template?printer=zt410&force=true&resume=false`);
  });

  it('emits only the set parameters (empty printer omitted, force kept)', () => {
    const req = printTemplateRequest(options, { printer: '', force: true });
    expect(req.url).toBe(`${BASE_URL}/print/template?force=true`);
  });

  it('attaches the core Bearer auth header from the credential', () => {
    const req = printTemplateRequest(options, { printer: 'zt410' });
    expect(req.headers).toEqual(EXPECTED_AUTH);
    expect(req.headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });
});

describe('printRawRequest — POST /print/raw + text/plain (FR-19, DD-8, FR-23, FR-23.1)', () => {
  it('composes POST /print/raw with no query when none is supplied', () => {
    const req = printRawRequest(options);
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/print/raw`);
    expect(req.url).not.toContain('?');
  });

  it('composes the printer / force / resume query in order', () => {
    const req = printRawRequest(options, { printer: 'zt410', force: true, resume: false });
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${BASE_URL}/print/raw?printer=zt410&force=true&resume=false`);
  });

  it('carries Content-Type text/plain AND still keeps the bearer auth header (DD-8)', () => {
    const req = printRawRequest(options, { printer: 'zt410' });
    // Both header keys must be present: the augmented content type and the preserved bearer auth.
    expect(req.headers['Content-Type']).toBe('text/plain');
    expect(req.headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
    expect(req.headers).toEqual({ ...EXPECTED_AUTH, 'Content-Type': 'text/plain' });
  });
});

describe('listTemplatesRequest — GET /templates (FR-20, FR-23, FR-23.1)', () => {
  it('composes GET /templates with no path parameters', () => {
    const req = listTemplatesRequest(options);
    expect(req.method).toBe('GET');
    expect(req.url).toBe(`${BASE_URL}/templates`);
  });

  it('attaches the core Bearer auth header from the credential', () => {
    const req = listTemplatesRequest(options);
    expect(req.headers).toEqual(EXPECTED_AUTH);
    expect(req.headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });
});

describe('healthRequest — GET HEALTH_PATH (FR-21, FR-25.1)', () => {
  it('probes liveness at the core HEALTH_PATH', () => {
    const req = healthRequest(options);
    expect(req.method).toBe('GET');
    expect(req.url).toBe(`${BASE_URL}${HEALTH_PATH}`);
  });
});

describe('auth header + timeout are composed through the core (FR-21, NFR-5)', () => {
  // One representative descriptor from every builder: the auth header is the core's Bearer header
  // built from the credential's token, and the timeout falls back to the core default.
  const cases: Array<[string, () => ReturnType<typeof printRequest>]> = [
    ['print', () => printRequest(options, { printer: 'zt410', force: true, resume: true })],
    ['getStatus', () => getStatusRequest(options, 'zt410')],
    ['listPrinters', () => listPrintersRequest(options)],
    ['resume', () => resumeRequest(options, 'zt410')],
    ['health', () => healthRequest(options)],
  ];

  it.each(cases)('%s attaches the core Bearer auth header from the credential', (_name, build) => {
    const req = build();
    expect(req.headers).toEqual(EXPECTED_AUTH);
    expect(req.headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });

  it.each(cases)('%s falls back to DEFAULT_TIMEOUT_MS (no timeoutMs in options)', (_name, build) => {
    expect(build().timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it.each(cases)('%s keeps the token in the header value only — not in method or url', (_name, build) => {
    const req = build();
    expect(req.method).not.toContain(SENTINEL_TOKEN);
    expect(req.url).not.toContain(SENTINEL_TOKEN);
  });
});
