/**
 * Unit tests for the test-hatch module.
 *
 * The hatch exposes command-sync internals on window.__wpceTest__. We mock
 * `../sync/command-sync` so we can control what the hatch sees and assert
 * its public surface without booting the real collection sync.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

jest.mock('@wordpress/sync', () => ({
	Y: { Doc: class MockYDoc {} },
	Awareness: class MockAwareness {},
}));

const mockGetInternals = jest.fn<
	{ commandDoc: unknown; commandAwareness: unknown },
	[]
>();

jest.mock('../sync/command-sync', () => ({
	__getInternals_UNSAFE_FOR_TESTS: () => mockGetInternals(),
}));

import { installTestHatch } from '../test-hatch';

describe('installTestHatch', () => {
	beforeEach(() => {
		mockGetInternals.mockReset();
		delete (window as unknown as { __wpceTest__?: unknown }).__wpceTest__;
	});

	// Some tests below switch on fake timers and then run assertions that can
	// throw before their inline cleanup; restoring real timers here keeps a
	// failure from leaking fake timers into the next test.
	afterEach(() => {
		jest.useRealTimers();
	});

	it('attaches window.__wpceTest__ with the expected keys', () => {
		mockGetInternals.mockReturnValue({
			commandDoc: null,
			commandAwareness: null,
		});

		installTestHatch();

		expect(window.__wpceTest__).toBeDefined();
		const hatch = window.__wpceTest__!;
		expect(typeof hatch.getCommandDoc).toBe('function');
		expect(typeof hatch.getCommandAwareness).toBe('function');
		expect(typeof hatch.waitForCommandDoc).toBe('function');
		expect(hatch.fakeMcpAttached).toBe(false);

		// The Yjs/awareness primitives are the hatch's reason to exist — a
		// fake peer is constructed from them — and the source comments warn
		// that @wordpress/sync could narrow the y-protocols transitive to
		// `undefined`. Assert each is present so that regression can't pass.
		expect(hatch.Y).toBeDefined();
		expect(typeof hatch.Awareness).toBe('function');
		expect(typeof hatch.encodeAwarenessUpdate).toBe('function');
		expect(typeof hatch.applyAwarenessUpdate).toBe('function');
	});

	it('fakeMcpAttached defaults to false', () => {
		mockGetInternals.mockReturnValue({
			commandDoc: null,
			commandAwareness: null,
		});

		installTestHatch();

		expect(window.__wpceTest__!.fakeMcpAttached).toBe(false);
	});

	it('getCommandDoc / getCommandAwareness return null before command-sync initializes, and real instances after', () => {
		mockGetInternals.mockReturnValue({
			commandDoc: null,
			commandAwareness: null,
		});

		installTestHatch();
		const hatch = window.__wpceTest__!;

		expect(hatch.getCommandDoc()).toBeNull();
		expect(hatch.getCommandAwareness()).toBeNull();

		const fakeDoc = { __doc: true } as unknown;
		const fakeAwareness = { __awareness: true } as unknown;
		mockGetInternals.mockReturnValue({
			commandDoc: fakeDoc,
			commandAwareness: fakeAwareness,
		});

		expect(hatch.getCommandDoc()).toBe(fakeDoc);
		expect(hatch.getCommandAwareness()).toBe(fakeAwareness);
	});

	it('waitForCommandDoc stays pending until BOTH refs are non-null, then resolves', async () => {
		jest.useFakeTimers();

		mockGetInternals.mockReturnValue({
			commandDoc: null,
			commandAwareness: null,
		});

		installTestHatch();
		const hatch = window.__wpceTest__!;

		let settled = false;
		const pending = hatch.waitForCommandDoc(5000).then((value) => {
			settled = true;
			return value;
		});

		// Fully null — keeps polling.
		await jest.advanceTimersByTimeAsync(200);
		expect(settled).toBe(false);

		// Only the doc is ready. command-sync assigns commandDoc before
		// commandAwareness, so this half-initialized window is real and the
		// hatch must NOT resolve on the doc alone.
		const fakeDoc = { __doc: true } as unknown;
		mockGetInternals.mockReturnValue({
			commandDoc: fakeDoc,
			commandAwareness: null,
		});
		await jest.advanceTimersByTimeAsync(200);
		expect(settled).toBe(false);

		// Awareness arrives — now it resolves with both.
		const fakeAwareness = { __awareness: true } as unknown;
		mockGetInternals.mockReturnValue({
			commandDoc: fakeDoc,
			commandAwareness: fakeAwareness,
		});
		await jest.advanceTimersByTimeAsync(100);

		const result = await pending;
		expect(settled).toBe(true);
		expect(result.doc).toBe(fakeDoc);
		expect(result.awareness).toBe(fakeAwareness);
	});

	it('is idempotent: second install does not reset the hatch or fakeMcpAttached', () => {
		mockGetInternals.mockReturnValue({
			commandDoc: null,
			commandAwareness: null,
		});

		installTestHatch();
		const first = window.__wpceTest__!;

		// Simulate attaching a fake MCP.
		first.fakeMcpAttached = true;

		installTestHatch();
		const second = window.__wpceTest__!;

		// The second call must not reset the flag nor replace the object.
		expect(second).toBe(first);
		expect(second.fakeMcpAttached).toBe(true);
	});

	it('waitForCommandDoc rejects at the timeout deadline (>= boundary)', async () => {
		jest.useFakeTimers();

		mockGetInternals.mockReturnValue({
			commandDoc: null,
			commandAwareness: null,
		});

		installTestHatch();
		const hatch = window.__wpceTest__!;

		let rejected = false;
		const pending = hatch.waitForCommandDoc(200);
		// Record settlement here so the rejection is handled (no unhandled
		// rejection) and we can assert exactly when it fires.
		pending.catch(() => {
			rejected = true;
		});
		const assertion = expect(pending).rejects.toThrow(/timed out/);

		// One poll before the deadline (t=150): still waiting.
		await jest.advanceTimersByTimeAsync(150);
		expect(rejected).toBe(false);

		// The deadline tick (t=200) must reject — proves the check is
		// `elapsed >= timeoutMs`, not `>` (which would skip this tick and only
		// reject at t=250).
		await jest.advanceTimersByTimeAsync(50);
		expect(rejected).toBe(true);

		await assertion;
	});
});

describe('index.ts test-hatch guard', () => {
	// Webpack's DefinePlugin only dead-code-eliminates the hatch when its
	// dynamic import is wrapped in a direct `===` comparison between
	// `process.env.WPCE_TEST_HATCH` and a string literal AND that import lives
	// inside the guard body. We assert both: a refactor that loosens the
	// operator, drops into a variable, or hoists `import('./test-hatch')` out
	// of the guard (shipping the hatch to production) is the regression we
	// must catch.
	const indexPath = path.resolve(__dirname, '..', 'index.ts');

	function parseIndex(): ts.SourceFile {
		const source = fs.readFileSync(indexPath, 'utf8');
		return ts.createSourceFile(
			'index.ts',
			source,
			ts.ScriptTarget.Latest,
			/* setParentNodes */ true,
			ts.ScriptKind.TS
		);
	}

	// `process.env.WPCE_TEST_HATCH === '<literal>'` in either operand order —
	// DCE folds the comparison regardless of which side the env ref is on, so
	// we accept the yoda form rather than false-failing a safe refactor.
	function isHatchEnvGuard(
		expression: ts.Expression,
		sourceFile: ts.SourceFile
	): boolean {
		if (
			!ts.isBinaryExpression(expression) ||
			expression.operatorToken.kind !==
				ts.SyntaxKind.EqualsEqualsEqualsToken
		) {
			return false;
		}
		const sides = [expression.left, expression.right];
		const hasEnvRef = sides.some(
			(side) => side.getText(sourceFile) === 'process.env.WPCE_TEST_HATCH'
		);
		const hasStringLiteral = sides.some((side) => ts.isStringLiteral(side));
		return hasEnvRef && hasStringLiteral;
	}

	// Every dynamic `import('<specifier>')` call anywhere under `node`.
	function findDynamicImports(
		node: ts.Node,
		specifier: string
	): ts.CallExpression[] {
		const found: ts.CallExpression[] = [];
		const visit = (n: ts.Node): void => {
			if (
				ts.isCallExpression(n) &&
				n.expression.kind === ts.SyntaxKind.ImportKeyword
			) {
				const [firstArg] = n.arguments;
				if (
					firstArg &&
					ts.isStringLiteral(firstArg) &&
					firstArg.text === specifier
				) {
					found.push(n);
				}
			}
			ts.forEachChild(n, visit);
		};
		visit(node);
		return found;
	}

	function findGuard(sourceFile: ts.SourceFile): ts.IfStatement | undefined {
		return sourceFile.statements.find(
			(node): node is ts.IfStatement =>
				ts.isIfStatement(node) &&
				isHatchEnvGuard(node.expression, sourceFile)
		);
	}

	it('wraps the hatch import in a DCE-friendly `process.env.WPCE_TEST_HATCH === "<literal>"` guard', () => {
		expect(findGuard(parseIndex())).toBeDefined();
	});

	it('keeps every `import("./test-hatch")` inside the guard body so production DCE strips it', () => {
		const sourceFile = parseIndex();
		const guard = findGuard(sourceFile);
		expect(guard).toBeDefined();

		const allHatchImports = findDynamicImports(sourceFile, './test-hatch');
		const guardedHatchImports = findDynamicImports(
			guard!.thenStatement,
			'./test-hatch'
		);

		// At least one hatch import must exist, and all of them must sit inside
		// the guard body — none hoisted out where it would load unconditionally
		// in production.
		expect(allHatchImports.length).toBeGreaterThan(0);
		expect(guardedHatchImports.length).toBe(allHatchImports.length);
	});
});
