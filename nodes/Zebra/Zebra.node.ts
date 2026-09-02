/**
 * The `n8n-nodes-zebra` node (FR-14, FR-18, FR-19, FR-20, FR-23).
 *
 * It exposes exactly seven synchronous operations — Print, Get Status, List Printers, Resume, Print
 * Template, Print Raw, List Templates — each mapped to one zebra api route (FR-14, FR-14.2). There is
 * no polling, streaming, or async job model (FR-23). The node reaches the api only over HTTP: it
 * composes each request through the shared builders in `transport/requests.ts` and performs the
 * transport with the n8n request helper; the Print / Print Template bodies are attached here by the
 * concrete node, and Print Raw sends its opaque ZPL string through a distinct `json:false`
 * `text/plain` path (FR-19, DD-8). The `methods` block sources the Template dropdown and the
 * resourceMapper fields live from `GET /templates` at edit time (FR-15, FR-16, FR-17). Non-2xx
 * responses and non-HTTP failures are mapped to n8n's error types at the boundary (see
 * `transport/errors.ts`), and no error message carries the bearer token (FR-22).
 */

import {
  NodeConnectionTypes,
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestMethods,
  type IHttpRequestOptions,
  type ILoadOptionsFunctions,
  type INodeExecutionData,
  type INodePropertyOptions,
  type INodeType,
  type INodeTypeDescription,
  type ResourceMapperField,
  type ResourceMapperFields,
  type ResourceMapperValue,
} from 'n8n-workflow';

import { ZEBRA_API_CREDENTIAL, credentialToClientOptions } from '../../credentials/ZebraApi.credentials';
import {
  InstrumentApiError,
  toNodeError,
} from '../../transport/errors';
import type { ApiRequest, InstrumentApiClientOptions } from '../../transport/client';
import {
  getStatusRequest,
  listPrintersRequest,
  listTemplatesRequest,
  printRawRequest,
  printRequest,
  printTemplateRequest,
  resumeRequest,
} from '../../transport/requests';

/** The seven operations the node exposes, and no more (FR-14, FR-14.1, FR-14.2). */
type ZebraOperation =
  | 'print'
  | 'getStatus'
  | 'listPrinters'
  | 'resume'
  | 'printTemplate'
  | 'printRaw'
  | 'listTemplates';

/**
 * The one template field summary the node reads from `GET /templates` (FR-4.1). Only `name` and
 * `required` are consumed by the `methods` block; `min_length`/`max_length` stay server-authoritative
 * (DD-7), so they are not modelled here.
 */
interface TemplateFieldSummary {
  name: string;
  required: boolean;
}

/** One template entry from the discovery payload (`GET /templates`). */
interface TemplateSummary {
  name: string;
  fields: TemplateFieldSummary[];
}

/** The `GET /templates` discovery response shape the node consumes. */
interface ListTemplatesResponse {
  templates: TemplateSummary[];
}

/** Coerce an unknown value into an `IDataObject` for an n8n item's `json` payload. */
function toDataObject(value: unknown): IDataObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as IDataObject;
  }
  return { data: value } as IDataObject;
}

/** Extract a safe message from an api `ErrorBody` without exposing anything else. */
function extractApiMessage(body: unknown): string {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const message = record.message || record.error;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  }
  return '';
}

/**
 * Fetch the template discovery payload for the `methods` block (FR-15, FR-16, FR-17).
 *
 * It reads the credential, composes `GET /templates` through the shared builder, and performs it with
 * the load-options request helper. A non-2xx status is raised as `InstrumentApiError` so the caller
 * maps it to a node error at the boundary — no bearer token leaks (FR-22, NFR-1).
 */
async function fetchTemplateSummaries(ctx: ILoadOptionsFunctions): Promise<TemplateSummary[]> {
  const credential = await ctx.getCredentials(ZEBRA_API_CREDENTIAL);
  const options: InstrumentApiClientOptions = credentialToClientOptions(credential);
  const request = listTemplatesRequest(options);

  const httpOptions: IHttpRequestOptions = {
    method: request.method as IHttpRequestMethods,
    url: request.url,
    headers: request.headers,
    timeout: request.timeoutMs,
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };

  const response = await ctx.helpers.httpRequest(httpOptions);
  const status = Number(response.statusCode);
  if (status < 200 || status >= 300) {
    const detail = extractApiMessage(response.body);
    throw new InstrumentApiError(
      status,
      detail === ''
        ? `zebra api request failed (HTTP ${status})`
        : `zebra api error (HTTP ${status}): ${detail}`,
    );
  }

  const payload = response.body as ListTemplatesResponse;
  return Array.isArray(payload.templates) ? payload.templates : [];
}

export class Zebra implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Zebra',
    name: 'zebra',
    icon: 'file:zebra.svg',
    group: ['output'],
    version: 1,
    subtitle: '={{ $parameter["operation"] }}',
    description: 'Print ZPL labels and manage Zebra printers through the paired zebra api.',
    defaults: { name: 'Zebra' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: ZEBRA_API_CREDENTIAL, required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'print',
        options: [
          { name: 'Print', value: 'print', action: 'Print a label batch', description: 'POST /print' },
          {
            name: 'Get Status',
            value: 'getStatus',
            action: 'Get a printer status',
            description: 'GET /printers/{name}/status',
          },
          {
            name: 'List Printers',
            value: 'listPrinters',
            action: 'List printers',
            description: 'GET /printers',
          },
          {
            name: 'Resume',
            value: 'resume',
            action: 'Resume a paused printer',
            description: 'POST /printers/{name}/resume',
          },
          {
            name: 'Print Template',
            value: 'printTemplate',
            action: 'Print a named template',
            description: 'POST /print/template',
          },
          {
            name: 'Print Raw',
            value: 'printRaw',
            action: 'Print raw ZPL',
            description: 'POST /print/raw',
          },
          {
            name: 'List Templates',
            value: 'listTemplates',
            action: 'List templates',
            description: 'GET /templates',
          },
        ],
      },
      {
        displayName: 'Printer Name',
        name: 'printerName',
        type: 'string',
        default: '',
        required: true,
        description: 'Registry name of the target printer.',
        displayOptions: { show: { operation: ['getStatus', 'resume'] } },
      },
      {
        displayName: 'Batch Body',
        name: 'body',
        type: 'json',
        default: '{}',
        description: 'The label batch document sent as the JSON request body.',
        displayOptions: { show: { operation: ['print'] } },
      },
      {
        displayName: 'Template Name or ID',
        name: 'templateName',
        type: 'options',
        default: '',
        required: true,
        description:
          'Named template to render, sourced live from the paired zebra api. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
        typeOptions: { loadOptionsMethod: 'getTemplates' },
        displayOptions: { show: { operation: ['printTemplate'] } },
      },
      {
        displayName: 'Template Fields',
        name: 'templateFields',
        type: 'resourceMapper',
        default: { mappingMode: 'defineBelow', value: null },
        description: 'Values for the selected template fields; bounds are enforced by the api.',
        typeOptions: {
          loadOptionsDependsOn: ['templateName'],
          resourceMapper: {
            resourceMapperMethod: 'getTemplateFields',
            mode: 'add',
            addAllFields: true,
            fieldWords: { singular: 'field', plural: 'fields' },
            // Only "Define Below" is offered: the execute arm reads `mapper.value`, which n8n sets to
            // `null` in "Map Automatically" mode, so auto-map would silently drop the user's fields.
            supportAutoMap: false,
          },
        },
        displayOptions: { show: { operation: ['printTemplate'] } },
      },
      {
        displayName: 'Raw ZPL',
        name: 'rawZpl',
        type: 'string',
        default: '',
        required: true,
        description: 'The raw ZPL payload sent verbatim as a text/plain body.',
        typeOptions: { rows: 6 },
        displayOptions: { show: { operation: ['printRaw'] } },
      },
      {
        displayName: 'Printer (Override)',
        name: 'printer',
        type: 'string',
        default: '',
        description: 'Optional registry name to override the batch target (query parameter).',
        displayOptions: { show: { operation: ['print', 'printTemplate', 'printRaw'] } },
      },
      {
        displayName: 'Force',
        name: 'force',
        type: 'boolean',
        default: false,
        description: 'Whether to print even when the printer reports a blocking status.',
        displayOptions: { show: { operation: ['print', 'printTemplate', 'printRaw'] } },
      },
      {
        displayName: 'Resume',
        name: 'resume',
        type: 'boolean',
        default: false,
        description: 'Whether to clear a pause before printing.',
        displayOptions: { show: { operation: ['print', 'printTemplate', 'printRaw'] } },
      },
    ],
  };

  methods = {
    loadOptions: {
      /**
       * Source the Template dropdown from `GET /templates`, mapping each template to a
       * `{ name, value }` option (FR-15, FR-15.1, FR-17).
       */
      async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        try {
          const templates = await fetchTemplateSummaries(this);
          return templates.map((template) => ({ name: template.name, value: template.name }));
        } catch (error) {
          throw toNodeError(this.getNode(), error);
        }
      },
    },
    resourceMapping: {
      /**
       * Map the currently selected template's ordered fields to `ResourceMapperFields` (FR-16,
       * FR-16.1, FR-17). The manifest `required` drives `ResourceMapperField.required`; the length
       * bounds stay server-authoritative (DD-7), so every field is a plain `string`.
       */
      async getTemplateFields(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
        try {
          const templates = await fetchTemplateSummaries(this);
          const selected =
            (this.getNodeParameter('templateName', '') as string) ||
            (this.getCurrentNodeParameter('templateName') as string | undefined) ||
            '';
          const template = templates.find((entry) => entry.name === selected);
          const fields: ResourceMapperField[] = (template?.fields ?? []).map((field) => ({
            id: field.name,
            displayName: field.name,
            required: field.required,
            defaultMatch: false,
            display: true,
            type: 'string',
          }));
          return { fields };
        } catch (error) {
          throw toNodeError(this.getNode(), error);
        }
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter('operation', i) as ZebraOperation;
        const credential = await this.getCredentials(ZEBRA_API_CREDENTIAL, i);
        const options: InstrumentApiClientOptions = credentialToClientOptions(credential);

        let request: ApiRequest;
        let body: IDataObject | undefined;
        // Set only by Print Raw: the opaque ZPL string sent through the distinct `json:false`
        // `text/plain` path, never the JSON-object path the other arms use (FR-19, DD-8).
        let rawBody: string | undefined;

        switch (operation) {
          case 'print': {
            const printer = this.getNodeParameter('printer', i, '') as string;
            const force = this.getNodeParameter('force', i, false) as boolean;
            const resume = this.getNodeParameter('resume', i, false) as boolean;
            request = printRequest(options, { printer, force, resume });
            // The `type: 'json'` property yields a raw JSON *string* for literal input; `ensureType`
            // makes n8n parse it into the real batch object (e.g. `{ labels: [...] }`) so the request
            // body is the batch document itself, not a `{ data: "<json string>" }` wrapper. Malformed
            // JSON throws here and is mapped to a clean node error by the surrounding catch.
            body = this.getNodeParameter('body', i, {}, { ensureType: 'object' }) as IDataObject;
            break;
          }
          case 'getStatus': {
            const name = this.getNodeParameter('printerName', i) as string;
            request = getStatusRequest(options, name);
            break;
          }
          case 'listPrinters': {
            request = listPrintersRequest(options);
            break;
          }
          case 'resume': {
            const name = this.getNodeParameter('printerName', i) as string;
            request = resumeRequest(options, name);
            break;
          }
          case 'printTemplate': {
            const templateName = this.getNodeParameter('templateName', i) as string;
            const printer = this.getNodeParameter('printer', i, '') as string;
            const force = this.getNodeParameter('force', i, false) as boolean;
            const resume = this.getNodeParameter('resume', i, false) as boolean;
            // The resourceMapper value carries the mapped fields under `.value`; an unmapped mapper
            // yields `null`, which becomes an empty `fields` map (the api validates required fields).
            const mapper = this.getNodeParameter('templateFields', i, {}) as ResourceMapperValue;
            const fields: IDataObject = (mapper.value ?? {}) as IDataObject;
            request = printTemplateRequest(options, { printer, force, resume });
            body = { template: templateName, fields };
            break;
          }
          case 'printRaw': {
            const printer = this.getNodeParameter('printer', i, '') as string;
            const force = this.getNodeParameter('force', i, false) as boolean;
            const resume = this.getNodeParameter('resume', i, false) as boolean;
            request = printRawRequest(options, { printer, force, resume });
            // Distinct path: the raw ZPL is sent as a text/plain string body, not a JSON object.
            rawBody = this.getNodeParameter('rawZpl', i) as string;
            break;
          }
          case 'listTemplates': {
            request = listTemplatesRequest(options);
            break;
          }
          default: {
            // Exhaustiveness guard: an eighth operation is a compile-time error here (FR-14.1).
            const unhandled: never = operation;
            throw new InstrumentApiError(400, `unknown operation: ${String(unhandled)}`);
          }
        }

        // Print Raw takes the distinct `json:false` + string-body path (its request descriptor already
        // carries the `text/plain` Content-Type via `printRawRequest`, DD-8); every other arm sends a
        // JSON body. `returnFullResponse`/`ignoreHttpStatusErrors` are shared so the status check below
        // maps a non-2xx uniformly (FR-19, FR-22).
        const isRaw = rawBody !== undefined;
        const httpOptions: IHttpRequestOptions = {
          method: request.method as IHttpRequestMethods,
          url: request.url,
          headers: request.headers,
          timeout: request.timeoutMs,
          json: !isRaw,
          returnFullResponse: true,
          ignoreHttpStatusErrors: true,
        };
        if (isRaw) {
          httpOptions.body = rawBody;
        } else if (body !== undefined) {
          httpOptions.body = body;
        }

        const response = await this.helpers.httpRequest(httpOptions);
        const status = Number(response.statusCode);
        if (status < 200 || status >= 300) {
          const detail = extractApiMessage(response.body);
          throw new InstrumentApiError(
            status,
            detail === ''
              ? `zebra api request failed (HTTP ${status})`
              : `zebra api error (HTTP ${status}): ${detail}`,
          );
        }

        // The raw path uses `json:false`, so n8n also skips RESPONSE parsing and hands back the body
        // as an unparsed string. The api returns a JSON RawPrintResponse, so parse it here to return
        // the same `{ printer, bytes_sent }` object shape as the other print ops; a parse failure
        // falls back to the raw string via `toDataObject`.
        let payload: unknown = response.body;
        if (isRaw && typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            payload = response.body;
          }
        }

        returnData.push({ json: toDataObject(payload), pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          const mapped = toNodeError(this.getNode(), error);
          returnData.push({ json: { error: mapped.message }, pairedItem: { item: i } });
          continue;
        }
        throw toNodeError(this.getNode(), error);
      }
    }

    return [returnData];
  }
}
