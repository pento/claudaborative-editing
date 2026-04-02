import { describe, it, expect } from 'vitest';
import { assertDefined } from '../test-utils.js';
import * as Y from 'yjs';
import {
	createSyncStep1,
	createSyncStep2,
	processIncomingUpdate,
	createUpdateFromChange,
	createCompactionUpdate,
	uint8ArrayToBase64,
	base64ToUint8Array,
} from '#yjs/sync-protocol';
import { SyncUpdateType } from '#wordpress/types';

describe('base64 encoding', () => {
	it('round-trips a Uint8Array through base64', () => {
		const original = new Uint8Array([0, 1, 2, 127, 128, 255]);
		const encoded = uint8ArrayToBase64(original);
		const decoded = base64ToUint8Array(encoded);

		expect(decoded).toEqual(original);
	});

	it('handles empty arrays', () => {
		const original = new Uint8Array([]);
		const encoded = uint8ArrayToBase64(original);
		const decoded = base64ToUint8Array(encoded);

		expect(decoded).toEqual(original);
	});
});

describe('createSyncStep1', () => {
	it('creates a sync_step1 message', () => {
		const doc = new Y.Doc();
		const step1 = createSyncStep1(doc);

		expect(step1.type).toBe(SyncUpdateType.SYNC_STEP_1);
		expect(typeof step1.data).toBe('string');
		// Base64 should be decodable
		const decoded = base64ToUint8Array(step1.data);
		expect(decoded.length).toBeGreaterThan(0);
	});
});

describe('createSyncStep2', () => {
	it('creates a sync_step2 from a step1 message', () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();

		// Add some data to docB so step2 has something to send
		docB.getMap('test').set('key', 'value');

		const step1 = createSyncStep1(docA);
		const step1Data = base64ToUint8Array(step1.data);
		const step2 = createSyncStep2(docB, step1Data);

		expect(step2.type).toBe(SyncUpdateType.SYNC_STEP_2);
		expect(typeof step2.data).toBe('string');
	});
});

describe('processIncomingUpdate', () => {
	it('responds to SYNC_STEP_1 with a SYNC_STEP_2', () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		docB.getMap('test').set('key', 'value');

		const step1 = createSyncStep1(docA);
		const response = processIncomingUpdate(docB, step1);

		assertDefined(response);
		expect(response.type).toBe(SyncUpdateType.SYNC_STEP_2);
	});

	it('applies a SYNC_STEP_2 and returns null', () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		docB.getMap('test').set('key', 'value');

		// Full step1/step2 handshake
		const step1 = createSyncStep1(docA);
		const step2 = createSyncStep2(docB, base64ToUint8Array(step1.data));

		const response = processIncomingUpdate(docA, step2);
		expect(response).toBeNull();

		// docA should now have the data from docB
		expect(docA.getMap('test').get('key')).toBe('value');
	});

	it('applies an UPDATE and returns null', () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();

		// Capture an update from docB
		let capturedUpdate: Uint8Array | undefined;
		docB.on('updateV2', (update: Uint8Array) => {
			capturedUpdate = update;
		});
		docB.getMap('data').set('foo', 'bar');

		assertDefined(capturedUpdate);
		const syncUpdate = createUpdateFromChange(capturedUpdate);

		const response = processIncomingUpdate(docA, syncUpdate);
		expect(response).toBeNull();
		expect(docA.getMap('data').get('foo')).toBe('bar');
	});

	it('applies a COMPACTION and returns null', () => {
		const docA = new Y.Doc();
		const docB = new Y.Doc();
		docB.getMap('data').set('x', 1);
		docB.getMap('data').set('y', 2);

		const compaction = createCompactionUpdate(docB);
		expect(compaction.type).toBe(SyncUpdateType.COMPACTION);

		const response = processIncomingUpdate(docA, compaction);
		expect(response).toBeNull();
		expect(docA.getMap('data').get('x')).toBe(1);
		expect(docA.getMap('data').get('y')).toBe(2);
	});

	it('returns null for unknown update types', () => {
		const doc = new Y.Doc();
		const response = processIncomingUpdate(doc, {
			type: 999 as SyncUpdateType,
			data: uint8ArrayToBase64(new Uint8Array([1, 2, 3])),
		});
		expect(response).toBeNull();
	});
});

describe('createUpdateFromChange', () => {
	it('wraps a raw update in a SyncUpdate', () => {
		const doc = new Y.Doc();
		let capturedUpdate: Uint8Array | undefined;
		doc.on('updateV2', (update: Uint8Array) => {
			capturedUpdate = update;
		});
		doc.getMap('m').set('k', 'v');

		assertDefined(capturedUpdate);
		const syncUpdate = createUpdateFromChange(capturedUpdate);
		expect(syncUpdate.type).toBe(SyncUpdateType.UPDATE);
		expect(typeof syncUpdate.data).toBe('string');

		// Verify we can decode it
		const decoded = base64ToUint8Array(syncUpdate.data);
		expect(decoded.length).toBeGreaterThan(0);
	});
});

describe('createCompactionUpdate', () => {
	it('creates a full document snapshot', () => {
		const doc = new Y.Doc();
		doc.getMap('map1').set('a', 1);
		doc.getMap('map2').set('b', 2);

		const compaction = createCompactionUpdate(doc);
		expect(compaction.type).toBe(SyncUpdateType.COMPACTION);

		// Verify it can be applied to a fresh doc
		const newDoc = new Y.Doc();
		Y.applyUpdateV2(newDoc, base64ToUint8Array(compaction.data));
		expect(newDoc.getMap('map1').get('a')).toBe(1);
		expect(newDoc.getMap('map2').get('b')).toBe(2);
	});
});
