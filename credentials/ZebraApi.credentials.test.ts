/**
 * Suite for the zebra node credential mapper (FR-19, FR-19.1, FR-19.2, NFR-5).
 *
 * `credentialToClientOptions` maps a decrypted n8n credential to the shared
 * `InstrumentApiClientOptions = {baseUrl, bearerToken}` at execute time (FR-19.1). Every assertion is
 * pure and offline. The bearer token flows from the credential into the returned options only; it is
 * referenced, never logged or embedded elsewhere (FR-19.2, NFR-5).
 */
import type { ICredentialDataDecryptedObject } from 'n8n-workflow';

import {
  ZEBRA_API_CREDENTIAL,
  credentialToClientOptions,
} from './ZebraApi.credentials';

const SENTINEL_TOKEN = 'zebra-sentinel-bearer-DEADBEEF'; // pragma: allowlist secret

describe('ZEBRA_API_CREDENTIAL (FR-19)', () => {
  it('is the "zebraApi" name the node references', () => {
    expect(ZEBRA_API_CREDENTIAL).toBe('zebraApi');
  });
});

describe('credentialToClientOptions (FR-19.1, FR-19.2)', () => {
  it('maps baseUrl and bearerToken onto the shared client options', () => {
    const credential: ICredentialDataDecryptedObject = {
      baseUrl: 'https://zebra-api-abc123-uw.a.run.app',
      bearerToken: SENTINEL_TOKEN,
    };
    const options = credentialToClientOptions(credential);

    expect(options).toEqual({
      baseUrl: 'https://zebra-api-abc123-uw.a.run.app',
      bearerToken: SENTINEL_TOKEN,
    });
  });

  it('coerces missing fields to empty strings (no undefined leaks into the options)', () => {
    const options = credentialToClientOptions({} as ICredentialDataDecryptedObject);
    expect(options).toEqual({ baseUrl: '', bearerToken: '' });
  });

  it('adds no field beyond baseUrl and bearerToken', () => {
    const options = credentialToClientOptions({
      baseUrl: 'https://h',
      bearerToken: SENTINEL_TOKEN,
      extra: 'ignored',
    } as ICredentialDataDecryptedObject);
    expect(Object.keys(options).sort()).toEqual(['baseUrl', 'bearerToken']);
  });
});
