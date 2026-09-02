/**
 * Execute-path suite for the zebra node (FR-20, FR-20.1..FR-20.4, FR-22, FR-25).
 *
 * The colocated builder / error / credential suites assert the PURE units in isolation, so the
 * node's own `execute()` — the layer that retrieves parameters, attaches the Print body, performs the
 * transport, and maps the boundary errors — is exercised here. The Print body is a `type: 'json'`
 * property, so `getNodeParameter('body', …)` returns a JSON *string*; the node parses it via
 * `ensureType: 'object'` so it ships the real batch document, not a `{ data: "<json>" }` wrapper. This
 * suite drives `execute()` with a mocked `IExecuteFunctions` context and captures the exact
 * `httpRequest` options, so the body composition, method/path, and error mapping are all locked.
 *
 * Everything here is pure and offline: `this.helpers.httpRequest` is a `jest.fn()` — no socket opens.
 */
import {
  NodeApiError,
  NodeOperationError,
  type IExecuteFunctions,
  type IHttpRequestOptions,
  type ILoadOptionsFunctions,
  type INode,
  type INodePropertyOptions,
  type ResourceMapperFields,
} from 'n8n-workflow';

import { Zebra } from './Zebra.node';

/** A sentinel token: distinctive, so a leak into any non-header field is unmistakable. */
const SENTINEL_TOKEN = 'zebra-sentinel-bearer-DEADBEEF'; // pragma: allowlist secret
const BASE_URL = 'https://zebra-api-abc123-uw.a.run.app';

/** A minimal but realistic `INode`, enough for the n8n error constructors on the catch path. */
const node: INode = {
  id: 'zebra-1',
  name: 'Zebra',
  type: 'n8n-nodes-zebra.zebra',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

/** A resolved `httpRequest` result (the node reads `statusCode` + `body` off `returnFullResponse`). */
interface HttpResult {
  statusCode: number;
  body: unknown;
}

/** How `helpers.httpRequest` should behave for a given test: resolve a result, or reject (network). */
type Transport =
  | { kind: 'resolve'; result: HttpResult }
  | { kind: 'reject'; error: unknown };

/**
 * Build a mocked `IExecuteFunctions` context that drives one input item through `execute()`.
 *
 * `params` supplies the node parameter values by name. The `body` entry is stored as the RAW json
 * STRING that n8n's `type: 'json'` property yields; the mocked `getNodeParameter` parses it only when
 * the caller passes `ensureType: 'object'` — mirroring n8n and making the Print-body test a real
 * regression guard against the `{ data: "<json>" }` bug.
 */
function makeContext(params: Record<string, unknown>, transport: Transport) {
  const httpRequest = jest.fn(async () => {
    if (transport.kind === 'reject') {
      throw transport.error;
    }
    return transport.result;
  });

  const getNodeParameter = (
    name: string,
    _itemIndex: number,
    fallback?: unknown,
    options?: { ensureType?: string },
  ): unknown => {
    if (name === 'body') {
      const raw = params.body;
      // n8n returns the raw json STRING unless ensureType:'object' asks it to parse. If execute()
      // ever forgot the ensureType option, this returns the string and the body assertion breaks.
      if (options?.ensureType === 'object' && typeof raw === 'string') {
        return JSON.parse(raw) as unknown;
      }
      return raw;
    }
    if (name in params) {
      return params[name];
    }
    return fallback;
  };

  const ctx = {
    getInputData: () => [{ json: {} }],
    getNodeParameter,
    getCredentials: jest.fn(async () => ({ baseUrl: BASE_URL, bearerToken: SENTINEL_TOKEN })),
    continueOnFail: () => false,
    getNode: () => node,
    helpers: { httpRequest },
  };

  return { ctx: ctx as unknown as IExecuteFunctions, httpRequest };
}

/** Read back the single captured `httpRequest` options object (the composed request). */
function sentOptions(httpRequest: ReturnType<typeof jest.fn>): IHttpRequestOptions {
  expect(httpRequest).toHaveBeenCalledTimes(1);
  return httpRequest.mock.calls[0]?.[0] as IHttpRequestOptions;
}

/** Invoke the node's `execute()` under the mocked context. */
async function runExecute(ctx: IExecuteFunctions) {
  return new Zebra().execute.call(ctx);
}

describe('execute() — Print body composition (FR-20.1, FR-25) [regression guard]', () => {
  it('sends the parsed batch OBJECT as the body — not a { data: "<json>" } wrapper, not a string', async () => {
    // n8n hands the `type: 'json'` property to the node as a raw JSON string literal.
    const rawBatch = '{"labels":[{"zpl":"^XA^FDhello^FS^XZ"}]}';
    const { ctx, httpRequest } = makeContext(
      { operation: 'print', body: rawBatch },
      { kind: 'resolve', result: { statusCode: 200, body: { printed: 1 } } },
    );

    await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    // The body is the real batch document, structurally.
    expect(sent.body).toEqual({ labels: [{ zpl: '^XA^FDhello^FS^XZ' }] });
    // It is NOT the old malformed wrapper, and NOT a bare string.
    expect(sent.body).not.toHaveProperty('data');
    expect(typeof sent.body).toBe('object');
    expect(typeof sent.body).not.toBe('string');
  });

  it('composes POST /print with printer/force/resume on the query, json transport enabled', async () => {
    const { ctx, httpRequest } = makeContext(
      {
        operation: 'print',
        body: '{"labels":[]}',
        printer: 'zt410',
        force: true,
        resume: false,
      },
      { kind: 'resolve', result: { statusCode: 200, body: { ok: true } } },
    );

    await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${BASE_URL}/print?printer=zt410&force=true&resume=false`);
    expect(sent.json).toBe(true);
    // The credential's bearer flows through into the request header (and only the header).
    expect((sent.headers as Record<string, string>)?.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
  });

  it('still emits force=false&resume=false when the node passes its boolean defaults', async () => {
    const { ctx, httpRequest } = makeContext(
      { operation: 'print', body: '{}' },
      { kind: 'resolve', result: { statusCode: 200, body: {} } },
    );

    await runExecute(ctx);
    expect(sentOptions(httpRequest).url).toBe(`${BASE_URL}/print?force=false&resume=false`);
  });
});

describe('execute() — the other three operations issue the right method + path (FR-20.2..FR-20.4)', () => {
  it('Get Status → GET /printers/{name}/status (name url-encoded), body mapped through toDataObject', async () => {
    const statusBody = { name: 'bench 1/A', status: 'READY' };
    const { ctx, httpRequest } = makeContext(
      { operation: 'getStatus', printerName: 'bench 1/A' },
      { kind: 'resolve', result: { statusCode: 200, body: statusBody } },
    );

    const result = await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/printers/bench%201%2FA/status`);
    expect(sent.body).toBeUndefined();
    // Happy 2xx: the object response is returned as the item json unchanged (toDataObject pass-through).
    expect(result[0]?.[0]?.json).toEqual(statusBody);
  });

  it('List Printers → GET /printers; an array response is wrapped by toDataObject as { data: [...] }', async () => {
    const printers = [{ name: 'zt410' }, { name: 'zt230' }];
    const { ctx, httpRequest } = makeContext(
      { operation: 'listPrinters' },
      { kind: 'resolve', result: { statusCode: 200, body: printers } },
    );

    const result = await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/printers`);
    // An array is not a plain object, so toDataObject wraps it under `data`.
    expect(result[0]?.[0]?.json).toEqual({ data: printers });
  });

  it('Resume → POST /printers/{name}/resume (name url-encoded), no body attached', async () => {
    const { ctx, httpRequest } = makeContext(
      { operation: 'resume', printerName: 'bench 1/A' },
      { kind: 'resolve', result: { statusCode: 200, body: { resumed: true } } },
    );

    await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${BASE_URL}/printers/bench%201%2FA/resume`);
    expect(sent.body).toBeUndefined();
  });
});

describe('execute() — boundary error mapping (FR-22, FR-25.2)', () => {
  it('maps a non-2xx api response to NodeApiError carrying the status as httpCode', async () => {
    const { ctx } = makeContext(
      { operation: 'resume', printerName: 'zt410' },
      { kind: 'resolve', result: { statusCode: 409, body: { message: 'printer is not paused' } } },
    );

    await expect(runExecute(ctx)).rejects.toBeInstanceOf(NodeApiError);
    // Re-run to inspect the mapped error's httpCode without relying on a caught reference.
    const { ctx: ctx2 } = makeContext(
      { operation: 'resume', printerName: 'zt410' },
      { kind: 'resolve', result: { statusCode: 409, body: { message: 'printer is not paused' } } },
    );
    const mapped = await runExecute(ctx2).catch((e: unknown) => e);
    expect((mapped as NodeApiError).httpCode).toBe('409');
  });

  it('detects a non-2xx even when the body carries no message (generic status-only failure)', async () => {
    const { ctx } = makeContext(
      { operation: 'listPrinters' },
      { kind: 'resolve', result: { statusCode: 503, body: {} } },
    );

    const mapped = await runExecute(ctx).catch((e: unknown) => e);
    expect(mapped).toBeInstanceOf(NodeApiError);
    expect((mapped as NodeApiError).httpCode).toBe('503');
  });

  it('maps a transport (network/timeout) throw to NodeOperationError — no unhandled throw', async () => {
    const { ctx } = makeContext(
      { operation: 'getStatus', printerName: 'zt410' },
      { kind: 'reject', error: new Error('ETIMEDOUT: socket hang up') },
    );

    const mapped = await runExecute(ctx).catch((e: unknown) => e);
    expect(mapped).toBeInstanceOf(NodeOperationError);
    expect(mapped).not.toBeInstanceOf(NodeApiError);
  });

  it('a mapped api error carries neither the bearer token value nor the Authorization header (NFR-5)', async () => {
    const { ctx } = makeContext(
      { operation: 'resume', printerName: 'zt410' },
      { kind: 'resolve', result: { statusCode: 401, body: { message: 'unauthorized' } } },
    );

    const mapped = await runExecute(ctx).catch((e: unknown) => e);
    const text = JSON.stringify(mapped) + String((mapped as Error).message);
    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain(`Bearer ${SENTINEL_TOKEN}`);
    expect(text).not.toContain('Authorization');
  });
});

/*
 * ---------------------------------------------------------------------------
 * The three template/raw execute arms and the two `methods` (FR-23.2, FR-23.3).
 * Everything stays mocked and offline: `helpers.httpRequest` is a `jest.fn()`,
 * so no socket opens.
 * ---------------------------------------------------------------------------
 */

describe('execute() — Print Template arm (FR-23.2)', () => {
  it('sends a JSON { template, fields } body via the json:true path to /print/template', async () => {
    const { ctx, httpRequest } = makeContext(
      {
        operation: 'printTemplate',
        templateName: 'cable-tag',
        templateFields: { mappingMode: 'defineBelow', value: { asset_id: 'ARC-42', port: 'A1' } },
      },
      { kind: 'resolve', result: { statusCode: 200, body: { printer: 'zt410', labels_sent: 1 } } },
    );

    await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('POST');
    // The template route is the target; query params trail the path, so match the prefix.
    expect(sent.url.startsWith(`${BASE_URL}/print/template`)).toBe(true);
    // JSON transport path — an object body, not a raw string.
    expect(sent.json).toBe(true);
    // The body is the pure { template, fields } document, fields lifted from the mapper's `.value`.
    expect(sent.body).toEqual({
      template: 'cable-tag',
      fields: { asset_id: 'ARC-42', port: 'A1' },
    });
    expect(typeof sent.body).toBe('object');
  });

  it('composes the printer/force/resume query on the template route', async () => {
    const { ctx, httpRequest } = makeContext(
      {
        operation: 'printTemplate',
        templateName: 'cable-tag',
        templateFields: { mappingMode: 'defineBelow', value: {} },
        printer: 'zt410',
        force: true,
        resume: false,
      },
      { kind: 'resolve', result: { statusCode: 200, body: { labels_sent: 1 } } },
    );

    await runExecute(ctx);
    expect(sentOptions(httpRequest).url).toBe(
      `${BASE_URL}/print/template?printer=zt410&force=true&resume=false`,
    );
  });

  it('maps an absent/null resourceMapper value to an empty fields map', async () => {
    // An unmapped resourceMapper yields `{ ..., value: null }`; the arm must send `fields: {}`.
    const { ctx, httpRequest } = makeContext(
      {
        operation: 'printTemplate',
        templateName: '2d-tag-qr-1x1',
        templateFields: { mappingMode: 'defineBelow', value: null },
      },
      { kind: 'resolve', result: { statusCode: 200, body: { labels_sent: 1 } } },
    );

    await runExecute(ctx);
    const sent = sentOptions(httpRequest);
    expect(sent.body).toEqual({ template: '2d-tag-qr-1x1', fields: {} });
    expect((sent.body as { fields: unknown }).fields).toEqual({});
  });

  it('also yields an empty fields map when the resourceMapper value is absent entirely', async () => {
    // No `templateFields` param at all -> the node's `{}` fallback -> `.value` undefined -> `{}`.
    const { ctx, httpRequest } = makeContext(
      { operation: 'printTemplate', templateName: 'cable-tag' },
      { kind: 'resolve', result: { statusCode: 200, body: { labels_sent: 1 } } },
    );

    await runExecute(ctx);
    expect(sentOptions(httpRequest).body).toEqual({ template: 'cable-tag', fields: {} });
  });
});

describe('description — templateFields resourceMapper disables auto-map (FR-23.2) [footgun guard]', () => {
  it('sets typeOptions.resourceMapper.supportAutoMap === false on the templateFields property', () => {
    // Auto-map sets `mapper.value` to null and would silently drop the user's fields, so the property
    // must offer only "Define Below". This guards against re-introducing that footgun.
    const property = new Zebra().description.properties.find((p) => p.name === 'templateFields');
    expect(property).toBeDefined();
    const resourceMapper = (
      property?.typeOptions as { resourceMapper?: { supportAutoMap?: boolean } } | undefined
    )?.resourceMapper;
    expect(resourceMapper).toBeDefined();
    expect(resourceMapper?.supportAutoMap).toBe(false);
  });
});

describe('execute() — Print Raw arm takes the DISTINCT text/plain path (FR-23.2, DD-8)', () => {
  it('sends the raw ZPL as a STRING body via json:false with a text/plain Content-Type to /print/raw', async () => {
    const rawZpl = '^XA^FDraw-passthrough^FS^XZ';
    // The raw path runs `json:false`, so n8n hands the RESPONSE body back UNPARSED as a string; the
    // api returns a JSON RawPrintResponse, so the mock returns that as a STRING to mirror the wire.
    const { ctx, httpRequest } = makeContext(
      { operation: 'printRaw', rawZpl },
      {
        kind: 'resolve',
        result: { statusCode: 200, body: '{"printer":"zd421","bytes_sent":24}' },
      },
    );

    const result = await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('POST');
    expect(sent.url.startsWith(`${BASE_URL}/print/raw`)).toBe(true);
    // The distinguishing traits of the raw path: json disabled, a STRING body (not an object).
    expect(sent.json).toBe(false);
    expect(typeof sent.body).toBe('string');
    expect(sent.body).toBe(rawZpl);
    // The request carries the text/plain content type from the builder (DD-8), plus the bearer auth.
    const headers = sent.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('text/plain');
    expect(headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
    // The regression guard: the string response body is JSON-parsed, so the item json is the PARSED
    // { printer, bytes_sent } object — NOT a `{ data: "<json string>" }` wrapper.
    expect(result[0]?.[0]?.json).toEqual({ printer: 'zd421', bytes_sent: 24 });
    expect(result[0]?.[0]?.json).not.toHaveProperty('data');
  });

  it('falls back to a { data: "<string>" } wrapper when a raw response body is NON-JSON (no throw)', async () => {
    // A non-JSON string body must not crash the arm: the JSON.parse fails, the catch keeps the raw
    // string, and toDataObject wraps the non-object value under `data`.
    const { ctx } = makeContext(
      { operation: 'printRaw', rawZpl: '^XA^XZ' },
      { kind: 'resolve', result: { statusCode: 200, body: 'not json' } },
    );

    const result = await runExecute(ctx);
    expect(result[0]?.[0]?.json).toEqual({ data: 'not json' });
  });

  it('does NOT send an object body on the raw path (the JSON-object path is never used)', async () => {
    const { ctx, httpRequest } = makeContext(
      { operation: 'printRaw', rawZpl: '^XA^XZ' },
      { kind: 'resolve', result: { statusCode: 200, body: { bytes_sent: 6 } } },
    );

    await runExecute(ctx);
    const sent = sentOptions(httpRequest);
    expect(typeof sent.body).not.toBe('object');
    expect(sent.json).not.toBe(true);
  });
});

describe('execute() — List Templates arm (FR-23.2)', () => {
  it('issues GET /templates with no body and returns the discovery payload as the item json', async () => {
    const discovery = {
      templates: [
        { name: 'cable-tag', description: 'cable', dpi: 300, media: '1x1', fields: [] },
        { name: '2d-tag-qr-1x1', description: 'qr', dpi: 300, media: '1x1', fields: [] },
      ],
    };
    const { ctx, httpRequest } = makeContext(
      { operation: 'listTemplates' },
      { kind: 'resolve', result: { statusCode: 200, body: discovery } },
    );

    const result = await runExecute(ctx);
    const sent = sentOptions(httpRequest);

    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/templates`);
    expect(sent.body).toBeUndefined();
    // The discovery payload is an object, so toDataObject passes it through unchanged as the item json.
    expect(result[0]?.[0]?.json).toEqual(discovery);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The `methods` block (FR-23.3): getTemplates + getTemplateFields against a
 * mocked ILoadOptionsFunctions. The methods fetch GET /templates the same way
 * the execute path does, so the mock stubs getCredentials + helpers.httpRequest,
 * plus getNodeParameter/getCurrentNodeParameter for the selected template.
 * ---------------------------------------------------------------------------
 */

/** A realistic discovery payload with two templates and ordered, typed fields. */
const DISCOVERY_PAYLOAD = {
  templates: [
    {
      name: 'cable-tag',
      description: 'A cable wrap tag',
      dpi: 300,
      media: '1x1',
      fields: [
        { name: 'asset_id', token: 'ASSET_ID', required: true, min_length: 1, max_length: 32 },
        { name: 'port', token: 'PORT', required: false, min_length: 0, max_length: 8 },
      ],
    },
    {
      name: '2d-tag-qr-1x1',
      description: 'A 1x1 QR tag',
      dpi: 300,
      media: '1x1',
      fields: [{ name: 'payload', token: 'PAYLOAD', required: true, min_length: 1, max_length: 256 }],
    },
  ],
};

/** Build a mocked `ILoadOptionsFunctions` for the `methods` block. */
function makeLoadOptionsContext(
  transport: Transport,
  selectedTemplate?: string,
) {
  const httpRequest = jest.fn(async () => {
    if (transport.kind === 'reject') {
      throw transport.error;
    }
    return transport.result;
  });

  const getNodeParameter = (name: string, fallback?: unknown): unknown => {
    if (name === 'templateName') {
      return selectedTemplate ?? fallback ?? '';
    }
    return fallback;
  };

  const getCurrentNodeParameter = (name: string): unknown => {
    if (name === 'templateName') {
      return selectedTemplate;
    }
    return undefined;
  };

  const ctx = {
    getCredentials: jest.fn(async () => ({ baseUrl: BASE_URL, bearerToken: SENTINEL_TOKEN })),
    getNodeParameter,
    getCurrentNodeParameter,
    getNode: () => node,
    helpers: { httpRequest },
  };

  return { ctx: ctx as unknown as ILoadOptionsFunctions, httpRequest };
}

/** The zebra node under test (its `methods` are plain functions bound with `.call`). */
const zebra = new Zebra();

describe('methods.loadOptions.getTemplates (FR-23.3)', () => {
  it('maps a GET /templates payload of TemplateSummary[] to { name, value } options', async () => {
    const { ctx, httpRequest } = makeLoadOptionsContext({
      kind: 'resolve',
      result: { statusCode: 200, body: DISCOVERY_PAYLOAD },
    });

    const options = (await zebra.methods.loadOptions.getTemplates.call(ctx)) as INodePropertyOptions[];

    // GET /templates was the request performed at edit time.
    const sent = sentOptions(httpRequest as unknown as ReturnType<typeof jest.fn>);
    expect(sent.method).toBe('GET');
    expect(sent.url).toBe(`${BASE_URL}/templates`);
    // Each discovered template becomes a { name, value } dropdown entry.
    expect(options).toEqual([
      { name: 'cable-tag', value: 'cable-tag' },
      { name: '2d-tag-qr-1x1', value: '2d-tag-qr-1x1' },
    ]);
  });

  it('returns an empty option list when the discovery payload carries no templates', async () => {
    const { ctx } = makeLoadOptionsContext({
      kind: 'resolve',
      result: { statusCode: 200, body: { templates: [] } },
    });

    const options = await zebra.methods.loadOptions.getTemplates.call(ctx);
    expect(options).toEqual([]);
  });
});

describe('methods.resourceMapping.getTemplateFields (FR-23.3)', () => {
  it('maps the SELECTED template ordered fields to ResourceMapperField[], required from the manifest', async () => {
    const { ctx } = makeLoadOptionsContext(
      { kind: 'resolve', result: { statusCode: 200, body: DISCOVERY_PAYLOAD } },
      'cable-tag',
    );

    const mapped = (await zebra.methods.resourceMapping.getTemplateFields.call(
      ctx,
    )) as ResourceMapperFields;

    // id/displayName both equal field.name; required propagates from the manifest; type is string.
    expect(mapped.fields).toEqual([
      {
        id: 'asset_id',
        displayName: 'asset_id',
        required: true,
        defaultMatch: false,
        display: true,
        type: 'string',
      },
      {
        id: 'port',
        displayName: 'port',
        required: false,
        defaultMatch: false,
        display: true,
        type: 'string',
      },
    ]);
  });

  it('maps only the currently selected template, not another template in the payload', async () => {
    const { ctx } = makeLoadOptionsContext(
      { kind: 'resolve', result: { statusCode: 200, body: DISCOVERY_PAYLOAD } },
      '2d-tag-qr-1x1',
    );

    const mapped = (await zebra.methods.resourceMapping.getTemplateFields.call(
      ctx,
    )) as ResourceMapperFields;

    expect(mapped.fields.map((f) => f.id)).toEqual(['payload']);
    expect(mapped.fields[0]?.required).toBe(true);
  });

  it('handles an empty/unselected template selection gracefully (no fields, no throw)', async () => {
    // No template selected: neither getNodeParameter nor getCurrentNodeParameter resolves a name.
    const { ctx } = makeLoadOptionsContext({
      kind: 'resolve',
      result: { statusCode: 200, body: DISCOVERY_PAYLOAD },
    });

    const mapped = (await zebra.methods.resourceMapping.getTemplateFields.call(
      ctx,
    )) as ResourceMapperFields;
    expect(mapped.fields).toEqual([]);
  });
});

describe('methods boundary — a non-2xx maps to a node error with no token leak (FR-23.3, FR-22)', () => {
  it('getTemplates maps a 500 discovery failure to a NodeApiError whose message hides the bearer token', async () => {
    const { ctx } = makeLoadOptionsContext({
      kind: 'resolve',
      result: { statusCode: 500, body: { message: 'service misconfigured' } },
    });

    const mapped = await zebra.methods.loadOptions.getTemplates
      .call(ctx)
      .catch((e: unknown) => e);

    expect(mapped).toBeInstanceOf(NodeApiError);
    const text = JSON.stringify(mapped) + String((mapped as Error).message);
    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain(`Bearer ${SENTINEL_TOKEN}`);
    expect(text).not.toContain('Authorization');
  });

  it('getTemplateFields maps a 401 discovery failure to a NodeApiError with no token in the message', async () => {
    const { ctx } = makeLoadOptionsContext(
      { kind: 'resolve', result: { statusCode: 401, body: { message: 'unauthorized' } } },
      'cable-tag',
    );

    const mapped = await zebra.methods.resourceMapping.getTemplateFields
      .call(ctx)
      .catch((e: unknown) => e);

    expect(mapped).toBeInstanceOf(NodeApiError);
    const text = JSON.stringify(mapped) + String((mapped as Error).message);
    expect(text).not.toContain(SENTINEL_TOKEN);
    expect(text).not.toContain('Authorization');
  });
});
