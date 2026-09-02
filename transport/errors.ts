/**
 * The error hierarchy for the Zebra node, plus the node-boundary error mapper (FR-22).
 *
 * The first two classes are the standalone inline of the monorepo's `n8n-node-core` error
 * hierarchy; `toNodeError` is the migrated node-boundary mapper. After the transport call, a
 * non-2xx api status is raised as {@link InstrumentApiError}; any other (non-HTTP) failure surfaces
 * as {@link NodeCoreError}. `toNodeError` maps them to n8n's error types at the node boundary:
 *
 * - `InstrumentApiError` (non-2xx HTTP)  → `NodeApiError`
 * - `NodeCoreError` (non-HTTP failure)   → `NodeOperationError`
 * - any other unexpected error           → `NodeOperationError`
 *
 * No error message here ever carries a credential value: the node's bearer token comes from an n8n
 * credential at runtime and is referenced, never logged or embedded (FR-22.1, NFR-5).
 */

import { NodeApiError, NodeOperationError, type INode } from 'n8n-workflow';

/** Base for every error raised by the Zebra node's transport layer. */
export class NodeCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeCoreError';
  }
}

/**
 * A call to the paired zebra api returned a non-success HTTP status.
 *
 * Carries the numeric `statusCode` and a safe message. It never carries the request's
 * `Authorization` header or any credential value (NFR-5).
 */
export class InstrumentApiError extends NodeCoreError {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'InstrumentApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Map a caught error to the correct n8n error for `node`.
 *
 * `InstrumentApiError` extends `NodeCoreError`, so it is checked first to route non-2xx HTTP failures
 * to `NodeApiError` (carrying the numeric status as `httpCode`). Every other core failure — and any
 * unexpected error — becomes a `NodeOperationError`.
 */
export function toNodeError(node: INode, error: unknown): NodeApiError | NodeOperationError {
  if (error instanceof InstrumentApiError) {
    return new NodeApiError(
      node,
      { message: error.message },
      { httpCode: String(error.statusCode), message: error.message },
    );
  }
  if (error instanceof NodeCoreError) {
    return new NodeOperationError(node, error.message);
  }
  if (error instanceof Error) {
    return new NodeOperationError(node, error.message);
  }
  return new NodeOperationError(node, String(error));
}
