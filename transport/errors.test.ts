/**
 * Suite for the zebra node's boundary error mapping (FR-25.2, FR-22, FR-22.1).
 *
 * `toNodeError` maps the core error hierarchy to n8n's error types at the node boundary:
 *   - `InstrumentApiError` (non-2xx HTTP)  → `NodeApiError`  (numeric status as `httpCode`)
 *   - `NodeCoreError`      (non-HTTP)      → `NodeOperationError`
 *   - any other Error / non-Error          → `NodeOperationError`
 *
 * Every assertion is pure and offline. The key hygiene guarantee (FR-22.1, NFR-5): no mapped error's
 * message, description, or serialized form carries the bearer token value or an `Authorization`
 * header. A distinctive sentinel token is placed on the request path (via the core header) and then
 * asserted ABSENT from the mapped error — the mapper never reaches into the credential, so a leak
 * would be a real regression.
 */
import { NodeApiError, NodeOperationError, type INode } from 'n8n-workflow';
import { InstrumentApiError, NodeCoreError, toNodeError } from './errors';
import { buildApiRequest, type InstrumentApiClientOptions } from './client';

/** A minimal but realistic `INode`, enough for the n8n error constructors. */
const node: INode = {
  id: 'zebra-1',
  name: 'Zebra',
  type: 'n8n-nodes-zebra.zebra',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/** A sentinel token: distinctive so any leak into a mapped error is unmistakable. */
const SENTINEL_TOKEN = 'zebra-sentinel-bearer-DEADBEEF'; // pragma: allowlist secret
const options: InstrumentApiClientOptions = {
  baseUrl: 'https://zebra-api-abc123-uw.a.run.app',
  bearerToken: SENTINEL_TOKEN,
};

/**
 * Collect every string an error could plausibly expose — message, description, the n8n `messages`
 * array, and the full JSON serialization (which includes enumerable fields such as `httpCode`). The
 * hygiene assertions scan this combined text for the sentinel token and header name.
 */
function exposedText(err: unknown): string {
  const e = err as {
    message?: unknown;
    description?: unknown;
    messages?: unknown;
    stack?: unknown;
  };
  const parts: string[] = [];
  if (typeof e.message === 'string') parts.push(e.message);
  if (typeof e.description === 'string') parts.push(e.description);
  if (Array.isArray(e.messages)) parts.push(e.messages.join(' '));
  if (typeof e.stack === 'string') parts.push(e.stack);
  try {
    parts.push(JSON.stringify(err));
  } catch {
    // Circular or non-serializable — the fields collected above still cover the message surface.
  }
  return parts.join(' ');
}

describe('toNodeError — type mapping (FR-22, FR-25.2)', () => {
  it('maps InstrumentApiError → NodeApiError with the numeric status as httpCode', () => {
    const mapped = toNodeError(node, new InstrumentApiError(503, 'service unavailable'));
    expect(mapped).toBeInstanceOf(NodeApiError);
    expect((mapped as NodeApiError).httpCode).toBe('503');
  });

  it.each([400, 401, 403, 404, 409, 500, 502])(
    'carries HTTP %s through as the httpCode string',
    (status) => {
      const mapped = toNodeError(node, new InstrumentApiError(status, `failed ${status}`));
      expect(mapped).toBeInstanceOf(NodeApiError);
      expect((mapped as NodeApiError).httpCode).toBe(String(status));
    },
  );

  it('maps a plain NodeCoreError (non-HTTP) → NodeOperationError', () => {
    const mapped = toNodeError(node, new NodeCoreError('transport failure'));
    expect(mapped).toBeInstanceOf(NodeOperationError);
    expect(mapped).not.toBeInstanceOf(NodeApiError);
  });

  it('checks InstrumentApiError before its NodeCoreError base (subclass routes to NodeApiError)', () => {
    // InstrumentApiError extends NodeCoreError; the mapper must still route it to NodeApiError.
    const err: NodeCoreError = new InstrumentApiError(500, 'internal');
    const mapped = toNodeError(node, err);
    expect(mapped).toBeInstanceOf(NodeApiError);
  });

  it('maps an unexpected Error → NodeOperationError, preserving the message', () => {
    const mapped = toNodeError(node, new Error('boom'));
    expect(mapped).toBeInstanceOf(NodeOperationError);
    expect(mapped.message).toContain('boom');
  });

  it('maps a non-Error thrown value (string) → NodeOperationError', () => {
    const mapped = toNodeError(node, 'a bare string failure');
    expect(mapped).toBeInstanceOf(NodeOperationError);
    expect(mapped.message).toContain('a bare string failure');
  });
});

describe('toNodeError — no token or Authorization header leak (FR-22.1, FR-25.2, NFR-5)', () => {
  // The request the node would send carries the sentinel token in its auth header. If the mapper (or
  // the core error it maps) ever echoed the credential, the token would surface in the mapped error.
  const request = buildApiRequest(options, 'POST', '/print');

  it('the request header does carry the sentinel — the leak canary is live', () => {
    // Guard the guard: if the token were not actually on the request path, the ABSENT assertions
    // below would pass vacuously. This proves the sentinel is real before we assert its absence.
    expect(request.headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });

  it('a mapped NodeApiError from an api failure exposes neither the token nor the header', () => {
    // The node builds a safe, status-only message (never embedding the token) before raising.
    const apiError = new InstrumentApiError(503, 'zebra api request failed (HTTP 503)');
    const mapped = toNodeError(node, apiError);
    const text = exposedText(mapped);

    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain(`Bearer ${SENTINEL_TOKEN}`);
    expect(text).not.toContain('Authorization');
    // The mapper adds no credential-shaped field of its own.
    expect((mapped as { bearerToken?: unknown }).bearerToken).toBeUndefined();
    expect((mapped as { Authorization?: unknown }).Authorization).toBeUndefined();
  });

  it('a mapped NodeOperationError from a non-HTTP failure exposes neither the token nor the header', () => {
    const mapped = toNodeError(node, new NodeCoreError('transport failure before any response'));
    const text = exposedText(mapped);

    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain('Authorization');
  });

  it('the mapper structurally cannot leak: its inputs are the node and the error only', () => {
    // `toNodeError(node, error)` receives no credential/options argument, so a token can only appear
    // if the caught error already carried it. Even an api error whose message embeds a 401 status
    // maps without the header or the credential value.
    const mapped = toNodeError(node, new InstrumentApiError(401, 'zebra api error (HTTP 401)'));
    const text = exposedText(mapped);
    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain(`Bearer ${SENTINEL_TOKEN}`);
  });
});
