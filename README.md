# n8n-nodes-zebra

This is an [n8n](https://n8n.io) community node package. It lets you print ZPL
labels and manage **Zebra** printers from your n8n workflows via the zebra REST
API, an HTTP control plane in front of the printer fleet.

[n8n](https://n8n.io) is a [fair-code](https://docs.n8n.io/reference/license/)
licensed workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Node & operations](#node--operations)
[Template discovery](#template-discovery)
[Compatibility](#compatibility)
[Development](#development)
[Resources](#resources)

## Installation

Follow the
[community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n documentation.

In n8n: **Settings → Community Nodes → Install**, then enter the package name:

```
n8n-nodes-zebra
```

## Credentials

The node authenticates against a zebra REST API server with a single credential
type, **Zebra API**:

| Field        | Description                                                                          |
| ------------ | ------------------------------------------------------------------------------------ |
| Base URL     | HTTP base URL of the target server, no trailing slash (e.g. `https://zebra-api-<hash>-uw.a.run.app`). |
| Bearer Token | The bearer token for the zebra api. Stored encrypted; supplied at runtime, never committed. |

Every request is sent with an `Authorization: Bearer <token>` header. The token
lives only in the header value — it never appears in a URL, query string, or
error message.

## Node & operations

### Zebra (action node)

| Operation      | Route                          | Notes |
| -------------- | ------------------------------ | ----- |
| Print          | `POST /print`                  | Sends a label batch document as the JSON body. Optional `printer`/`force`/`resume` query. |
| Get Status     | `GET /printers/{name}/status`  | Reads a single printer's status. |
| List Printers  | `GET /printers`                | Lists the registered printers. |
| Resume         | `POST /printers/{name}/resume` | Clears a pause on a printer. |
| Print Template | `POST /print/template`         | Renders a named template with mapped field values (`{ template, fields }`). |
| Print Raw      | `POST /print/raw`              | Sends an opaque ZPL string verbatim as a `text/plain` body. |
| List Templates | `GET /templates`               | Returns the template discovery payload. |

A non-2xx response is mapped to an n8n `NodeApiError` (carrying the HTTP status
as `httpCode`); a transport failure maps to a `NodeOperationError`. **Continue
On Fail** is honored. No mapped error carries the bearer token.

## Template discovery

**Print Template** sources its inputs live from `GET /templates` at edit time:

- The **Template Name or ID** dropdown is populated from the discovered
  template names (`loadOptions.getTemplates`).
- The **Template Fields** resource mapper builds one input per field of the
  selected template, with `required` taken from the template manifest
  (`resourceMapping.getTemplateFields`). Length bounds stay
  server-authoritative and are enforced by the api.

Auto-map is disabled on the field mapper (**Define Below** only), so the mapped
values are never silently dropped.

## Compatibility

- Requires n8n with Node.js `>=22`.
- Built and tested against `n8n-workflow@2.22.x`.
- Targets the zebra REST API with Bearer authentication.

## Development

```bash
npm install
npm run build   # tsc + copy the node icon into dist/
npm run lint    # eslint
npm test        # jest
```

The package layout mirrors the sibling community-node packages: `credentials/`,
`transport/` (the pure request builders + inlined HTTP/error helpers), and
`nodes/Zebra/` (the node and its icon). n8n loads the compiled entries declared
in the `n8n` block of `package.json`.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Zebra ZPL](https://www.zebra.com/us/en/support-downloads/knowledge-articles/evm/zebra-programming-language-zpl.html)

## License

[MIT](LICENSE)
