/**
 * Yjs sync protocol helpers for the HTTP polling transport.
 *
 * Gutenberg 22.8+ uses a mixed V1/V2 encoding approach:
 * - Sync step1/step2 use y-protocols' standard encoding (V1 internally).
 *   Gutenberg calls syncProtocol.readSyncMessage() for both creating and
 *   processing step2, which hardcodes Y.encodeStateAsUpdate/Y.applyUpdate (V1).
 * - Regular updates and compactions use Yjs V2 encoding.
 *   Gutenberg captures changes via doc.on('updateV2') and applies with Y.applyUpdateV2().
 *
 * All binary data is base64-encoded for transport.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { type SyncUpdate, SyncUpdateType } from '../wordpress/types.js';

/**
 * Create a sync_step1 message announcing our state vector.
 * State vectors are encoding-format-agnostic (identical for V1 and V2).
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
 *
 * Uses y-protocols' readSyncMessage which produces V1-encoded step2 data.
 * This matches Gutenberg's expectation — it also uses readSyncMessage
 * (and thus V1) for step2 processing.
 */
export function createSyncStep2(doc: Y.Doc, step1Data: Uint8Array): SyncUpdate {
  const decoder = decoding.createDecoder(step1Data);
  const encoder = encoding.createEncoder();

  // readSyncMessage reads the message type byte and the state vector,
  // then writes the appropriate response (step2) into the encoder.
  // Internally uses V1 encoding (Y.encodeStateAsUpdate), matching Gutenberg.
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
 * For SYNC_STEP_2: applies via y-protocols (V1 internally) and returns null.
 * For UPDATE / COMPACTION: applies the V2 update and returns null.
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
      // Apply step2 via y-protocols (V1 internally).
      // Gutenberg creates step2 using syncProtocol.readSyncMessage which
      // encodes with Y.encodeStateAsUpdate (V1), so we must also use
      // readSyncMessage to decode it (which calls Y.applyUpdate, V1).
      const decoder = decoding.createDecoder(rawData);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, doc, 'sync');
      return null;
    }

    case SyncUpdateType.UPDATE:
    case SyncUpdateType.COMPACTION: {
      // Apply V2 update directly (Gutenberg 22.8+ uses V2 encoding)
      Y.applyUpdateV2(doc, rawData, 'remote');
      return null;
    }

    default:
      return null;
  }
}

/**
 * Create an update message from a Y.Doc change.
 * The raw bytes come from the doc's 'updateV2' event (V2 encoded).
 */
export function createUpdateFromChange(update: Uint8Array): SyncUpdate {
  return {
    type: SyncUpdateType.UPDATE,
    data: uint8ArrayToBase64(update),
  };
}

/**
 * Create a compaction update containing the full document state (V2 encoded).
 */
export function createCompactionUpdate(doc: Y.Doc): SyncUpdate {
  const data = Y.encodeStateAsUpdateV2(doc);
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
