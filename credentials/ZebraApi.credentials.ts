/**
 * The n8n credential for the Zebra node (FR-19).
 *
 * It carries a base URL and a bearer token and maps at execute time to the shared
 * `InstrumentApiClientOptions = {baseUrl, bearerToken}` (FR-19.1). The bearer token is supplied at
 * runtime from the credential and is referenced, never hard-coded, logged, or committed (FR-19.2,
 * NFR-5). The `bearerToken` field is marked `typeOptions.password = true` so n8n stores and renders
 * it as a secret.
 */

import type { ICredentialDataDecryptedObject, ICredentialType, INodeProperties } from 'n8n-workflow';
import type { InstrumentApiClientOptions } from '../transport/client';

/** The credential name referenced by the node (`credentials: [{ name: 'zebraApi' }]`). */
export const ZEBRA_API_CREDENTIAL = 'zebraApi';

/** n8n credential type: base URL of the paired zebra api plus its bearer token. */
export class ZebraApi implements ICredentialType {
  name = ZEBRA_API_CREDENTIAL;

  displayName = 'Zebra API';

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://zebra-api-<hash>-uw.a.run.app',
      description: 'Base URL of the paired zebra api.',
      required: true,
    },
    {
      displayName: 'Bearer Token',
      name: 'bearerToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Bearer token for the zebra api. Supplied at runtime; never committed.',
      required: true,
    },
  ];
}

/**
 * Map a decrypted credential to the shared client options at execute time (FR-19.1).
 *
 * The token flows from the credential into the returned options only; it is never logged or embedded
 * elsewhere (FR-19.2, NFR-5).
 */
export function credentialToClientOptions(
  credential: ICredentialDataDecryptedObject,
): InstrumentApiClientOptions {
  return {
    baseUrl: String(credential.baseUrl ?? ''),
    bearerToken: String(credential.bearerToken ?? ''),
  };
}
