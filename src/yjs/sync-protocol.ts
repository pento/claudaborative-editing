/**
 * Yjs sync protocol helpers for the HTTP polling transport.
 *
 * Sync steps (step1/step2) use y-protocols' standard encoding.
 * Regular updates and compactions use Yjs V1 encoding (matching Gutenberg).
 * All binary data is base64-encoded for transport.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { type SyncUpdate, SyncUpdateType } from '../wordpress/types.js';

/**
 * Create a sync_step1 message announcing our state vector.
 */
export function createSyncStep1(doc: Y.Doc): SyncUpdate {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, doc);
  const data = encoding.toUint8Array(encoder);

  return {
    type: SyncUpdateType.SYNC_STEP_1,
    data: uint8ArrayToBase64(data),
  };
}

/**
 * Process an incoming sync_step1 and create a sync_step2 response.
 *
 * Reads the remote state vector from the step1 message and encodes
 * the missing updates as a step2 reply.
 */
export function createSyncStep2(doc: Y.Doc, step1Data: Uint8Array): SyncUpdate {
  const decoder = decoding.createDecoder(step1Data);
  const encoder = encoding.createEncoder();

  // readSyncMessage reads the message type byte and the state vector,
  // then writes the appropriate response (step2) into the encoder.
  syncProtocol.readSyncMessage(decoder, encoder, doc, 'sync');

  const data = encoding.toUint8Array(encoder);

  return {
    type: SyncUpdateType.SYNC_STEP_2,
    data: uint8ArrayToBase64(data),
  };
}

/**
 * Process an incoming sync update.
 *
 * For SYNC_STEP_1: generates a SYNC_STEP_2 response.
 * For SYNC_STEP_2: applies the update via y-protocols and returns null.
 * For UPDATE / COMPACTION: applies the V1 update and returns null.
 *
 * Returns a response SyncUpdate if one is needed (e.g., step2 reply),
 * or null if no response is required.
 */
export function processIncomingUpdate(doc: Y.Doc, update: SyncUpdate): SyncUpdate | null {
  const rawData = base64ToUint8Array(update.data);

  switch (update.type) {
    case SyncUpdateType.SYNC_STEP_1: {
      // Respond with step2
      return createSyncStep2(doc, rawData);
    }

    case SyncUpdateType.SYNC_STEP_2: {
      // Apply step2 via y-protocols decoder
      const decoder = decoding.createDecoder(rawData);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, doc, 'sync');
      // step2 processing doesn't produce a response
      return null;
    }

    case SyncUpdateType.UPDATE:
    case SyncUpdateType.COMPACTION: {
      // Apply V1 update directly (Gutenberg uses V1 encoding for updates)
      Y.applyUpdate(doc, rawData, 'remote');
      return null;
    }

    default:
      return null;
  }
}

/**
 * Create an update message from a Y.Doc change (V1 encoded).
 */
export function createUpdateFromChange(update: Uint8Array): SyncUpdate {
  return {
    type: SyncUpdateType.UPDATE,
    data: uint8ArrayToBase64(update),
  };
}

/**
 * Create a compaction update containing the full document state (V1 encoded).
 */
export function createCompactionUpdate(doc: Y.Doc): SyncUpdate {
  const data = Y.encodeStateAsUpdate(doc);
  return {
    type: SyncUpdateType.COMPACTION,
    data: uint8ArrayToBase64(data),
  };
}

/**
 * Encode a Uint8Array to a base64 string.
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Decode a base64 string to a Uint8Array.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}
