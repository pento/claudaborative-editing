jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));

jest.mock('@wordpress/editor', () => {
	const { createElement } = require('react');
	return {
		PluginPrePublishPanel: ({ children, title }: any) =>
			createElement(
				'div',
				{ 'data-testid': 'pre-publish-panel', 'aria-label': title },
				children
			),
		PostFeaturedImage: () =>
			createElement(
				'div',
				{ 'data-testid': 'post-featured-image' },
				'Featured Image'
			),
		PostFeaturedImageCheck: ({ children }: any) =>
			createElement(
				'div',
				{ 'data-testid': 'featured-image-check' },
				children
			),
	};
});

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Button: ({
			children,
			onClick,
			className,
			disabled,
			isBusy,
			variant: _v,
			...props
		}: any) =>
			createElement(
				'button',
				{
					onClick,
					className,
					disabled,
					'data-busy': isBusy,
					...props,
				},
				children
			),
		Spinner: () => createElement('span', { 'data-testid': 'spinner' }),
		Icon: ({ icon, className }: any) =>
			createElement('span', {
				className,
				'data-testid': `icon-${icon}`,
			}),
		TextareaControl: ({
			value,
			onChange,
			__nextHasNoMarginBottom: _,
			...props
		}: any) =>
			createElement('textarea', {
				value,
				onChange: (e: any) => onChange(e.target.value),
				'data-testid': 'textarea-control',
				...props,
			}),
	};
});

jest.mock('@wordpress/icons', () => ({
	check: 'check-icon',
}));

jest.mock('@wordpress/api-fetch', () => {
	const fn = jest.fn();
	fn.mockResolvedValue([]);
	return {
		__esModule: true,
		default: fn,
	};
});

jest.mock('../../../store', () => ({
	__esModule: true,
	default: { name: 'wpce/ai-actions' },
}));

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../hooks/use-commands', () => ({
	useCommands: jest.fn(),
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import { useCommands } from '../../../hooks/use-commands';
import PrePublishPanel from '..';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;
const mockedUseMcpStatus = useMcpStatus as jest.Mock;
const mockedUseCommands = useCommands as jest.Mock;
const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const defaultMcpStatus = {
	mcpConnected: true,
	mcpLastSeenAt: null,
	isLoading: false,
	error: null,
};

const defaultCommands = {
	activeCommand: null,
	isSubmitting: false,
	error: null,
	history: [],
	submit: jest.fn(),
	cancel: jest.fn(),
};

const defaultEditorState = {
	postId: 123,
	currentSlug: 'my-post',
	currentExcerpt: '' as string,
	hasFeaturedImage: true,
	currentCategoryIds: [] as number[],
	currentTagIds: [] as number[],
};

function setupMocks(
	overrides: {
		editorState?: Partial<typeof defaultEditorState>;
		editPost?: jest.Mock;
		invalidateResolutionForStoreSelector?: jest.Mock;
	} = {}
) {
	const editorState = { ...defaultEditorState, ...overrides.editorState };
	const editPost = overrides.editPost ?? jest.fn();
	const invalidateResolutionForStoreSelector =
		overrides.invalidateResolutionForStoreSelector ?? jest.fn();

	mockedUseSelect.mockImplementation((selector: any) => {
		const select = (store: unknown) => {
			if (store === 'core/editor') {
				return {
					getCurrentPostId: () => editorState.postId,
					getEditedPostSlug: () => editorState.currentSlug,
					getEditedPostAttribute: (attr: string) => {
						switch (attr) {
							case 'featured_media':
								return editorState.hasFeaturedImage ? 42 : 0;
							case 'categories':
								return editorState.currentCategoryIds;
							case 'tags':
								return editorState.currentTagIds;
							case 'excerpt':
								return editorState.currentExcerpt;
							default:
								return undefined;
						}
					},
				};
			}
			return {};
		};
		return selector(select);
	});

	mockedUseDispatch.mockImplementation((store: unknown) => {
		if (store === 'core/editor') {
			return { editPost };
		}
		if (store === 'core') {
			return { invalidateResolutionForStoreSelector };
		}
		return {};
	});

	return { editPost, invalidateResolutionForStoreSelector, editorState };
}

describe('PrePublishPanel', () => {
	beforeEach(() => {
		jest.clearAllMocks();

		mockedUseMcpStatus.mockReturnValue({ ...defaultMcpStatus });
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			submit: jest.fn(),
			cancel: jest.fn(),
		});
		setupMocks();
	});

	it('renders panel with title', () => {
		render(<PrePublishPanel />);
		const panel = screen.getByTestId('pre-publish-panel');
		expect(panel).toBeTruthy();
		expect(panel.getAttribute('aria-label')).toBe('Pre-Publish Checks');
	});

	it('shows disconnected message and disabled button when not connected', () => {
		mockedUseMcpStatus.mockReturnValue({
			...defaultMcpStatus,
			mcpConnected: false,
		});

		render(<PrePublishPanel />);
		expect(screen.getByText('AI assistant not connected.')).toBeTruthy();

		const button = screen.getByText('Run pre-publish checks');
		expect(button.closest('button')!.disabled).toBe(true);
	});

	it('shows enabled run button when connected and idle', () => {
		render(<PrePublishPanel />);
		const button = screen.getByText('Run pre-publish checks');
		expect(button.closest('button')!.disabled).toBe(false);
	});

	it('shows spinner and checking text when check is in progress', () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			activeCommand: {
				id: 1,
				prompt: 'pre-publish-check',
				status: 'running',
				post_id: 123,
			},
		});

		render(<PrePublishPanel />);
		expect(screen.getByTestId('spinner')).toBeTruthy();
		expect(screen.getByText('Checking\u2026')).toBeTruthy();

		const button = screen.getByText('Run pre-publish checks');
		expect(button.closest('button')!.disabled).toBe(true);
		expect(
			button.closest('button')!.getAttribute('data-busy')
		).toBeTruthy();
	});

	it('shows PostFeaturedImage via native component after checks run', async () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByTestId('post-featured-image')).toBeTruthy();
		expect(screen.getByTestId('featured-image-check')).toBeTruthy();
		expect(screen.getByText('Featured image')).toBeTruthy();
	});

	it('displays excerpt suggestion in an editable textarea', async () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { excerpt: 'A suggested excerpt.' },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Excerpt')).toBeTruthy();
		const textarea = screen.getByTestId('textarea-control');
		expect(textarea).toBeTruthy();
		expect((textarea as HTMLTextAreaElement).value).toBe(
			'A suggested excerpt.'
		);
	});

	it('allows editing excerpt before applying', async () => {
		const editPost = jest.fn();
		setupMocks({ editPost });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { excerpt: 'Original excerpt' },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		const textarea = screen.getByTestId('textarea-control');

		// Edit the text
		fireEvent.change(textarea, { target: { value: 'Edited excerpt' } });

		// Apply should use the edited value
		fireEvent.click(screen.getByText('Apply'));
		expect(editPost).toHaveBeenCalledWith({ excerpt: 'Edited excerpt' });
	});

	it('shows read-only text after applying excerpt', async () => {
		const { editorState, editPost } = setupMocks();
		editPost.mockImplementation((edits: any) => {
			if (edits.excerpt !== undefined) {
				editorState.currentExcerpt = edits.excerpt;
			}
		});

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { excerpt: 'Suggested excerpt' },
					message: null,
				},
			],
		});

		const { rerender } = await act(async () => {
			return render(<PrePublishPanel />);
		});

		// Before apply: textarea visible
		expect(screen.getByTestId('textarea-control')).toBeTruthy();

		fireEvent.click(screen.getByText('Apply'));

		// Re-render so derived state picks up the updated excerpt
		await act(async () => {
			rerender(<PrePublishPanel />);
		});

		// After apply: textarea gone, read-only text visible
		expect(screen.queryByTestId('textarea-control')).toBeNull();
		expect(screen.getByText('Suggested excerpt')).toBeTruthy();
	});

	it('shows slug suggestion with current to suggested arrow', async () => {
		setupMocks({ editorState: { currentSlug: 'old-slug' } });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'new-slug' },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Slug')).toBeTruthy();
		const slugValue = screen.getByText((_content, element) => {
			return element?.textContent === 'old-slug \u2192 new-slug';
		});
		expect(slugValue).toBeTruthy();
	});

	it('applies slug suggestion via editPost', async () => {
		const editPost = jest.fn();
		setupMocks({ editPost });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'better-slug' },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		fireEvent.click(screen.getByText('Apply'));
		expect(editPost).toHaveBeenCalledWith({ slug: 'better-slug' });
	});

	it('shows categories as term chips with new/existing indicators', async () => {
		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
		}) => {
			if (options.path.includes('/wp/v2/categories?search=')) {
				const search = decodeURIComponent(
					options.path.split('search=')[1].split('&')[0]
				);
				if (search === 'Tech') {
					return Promise.resolve([
						{ id: 5, name: 'Tech', parent: 0 },
					]);
				}
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech', 'New Category'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Categories')).toBeTruthy();
		expect(screen.getByText('Tech')).toBeTruthy();
		expect(screen.getByText('New Category')).toBeTruthy();

		// "New Category" should have a "(new)" indicator
		expect(screen.getByText('(new)')).toBeTruthy();
	});

	it('shows tags as term chips with new/existing indicators', async () => {
		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
		}) => {
			if (options.path.includes('/wp/v2/tags?search=')) {
				const search = decodeURIComponent(
					options.path.split('search=')[1].split('&')[0]
				);
				if (search === 'javascript') {
					return Promise.resolve([{ id: 10, name: 'javascript' }]);
				}
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { tags: ['javascript', 'new-tag'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Tags')).toBeTruthy();
		expect(screen.getByText('javascript')).toBeTruthy();
		expect(screen.getByText('new-tag')).toBeTruthy();
		expect(screen.getByText('(new)')).toBeTruthy();
	});

	it('resolves category names to IDs and applies via editPost', async () => {
		const editPost = jest.fn();
		const invalidateResolutionForStoreSelector = jest.fn();
		setupMocks({ editPost, invalidateResolutionForStoreSelector });

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
			data?: any;
		}) => {
			if (options.path.includes('/wp/v2/categories?search=')) {
				const search = decodeURIComponent(
					options.path.split('search=')[1].split('&')[0]
				);
				if (search === 'Tech') {
					return Promise.resolve([
						{ id: 5, name: 'Tech', parent: 0 },
					]);
				}
				return Promise.resolve([]);
			}
			if (
				options.path === '/wp/v2/categories' &&
				options.method === 'POST'
			) {
				return Promise.resolve({ id: 99 });
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech', 'New Category'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Apply'));
		});

		expect(editPost).toHaveBeenCalledWith({ categories: [5, 99] });
		expect(invalidateResolutionForStoreSelector).toHaveBeenCalledWith(
			'getEntityRecords'
		);
	});

	it('resolves tag names to IDs and applies via editPost', async () => {
		const editPost = jest.fn();
		const invalidateResolutionForStoreSelector = jest.fn();
		setupMocks({ editPost, invalidateResolutionForStoreSelector });

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
			data?: any;
		}) => {
			if (options.path.includes('/wp/v2/tags?search=')) {
				return Promise.resolve([{ id: 10, name: 'javascript' }]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { tags: ['javascript'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Apply'));
		});

		expect(editPost).toHaveBeenCalledWith({ tags: [10] });
		expect(invalidateResolutionForStoreSelector).toHaveBeenCalledWith(
			'getEntityRecords'
		);
	});

	it('shows "Everything looks good!" when no suggestions and featured image set', async () => {
		setupMocks({ editorState: { hasFeaturedImage: true } });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Everything looks good!')).toBeTruthy();
		expect(screen.queryByText('Apply all suggestions')).toBeNull();
	});

	it('does not show "Everything looks good!" when featured image is missing', async () => {
		setupMocks({ editorState: { hasFeaturedImage: false } });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Featured image section is still shown (native component)
		expect(screen.getByText('Featured image')).toBeTruthy();
		// But not "Everything looks good!" since no featured image
		expect(screen.queryByText('Everything looks good!')).toBeNull();
	});

	it('shows checkmark icon after applying a suggestion', async () => {
		const { editorState, editPost } = setupMocks();
		editPost.mockImplementation((edits: any) => {
			if (edits.slug !== undefined) {
				editorState.currentSlug = edits.slug;
			}
		});

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'better-slug' },
					message: null,
				},
			],
		});

		const { rerender } = await act(async () => {
			return render(<PrePublishPanel />);
		});

		// Before apply — Apply button visible, no checkmark
		expect(screen.getByText('Apply')).toBeTruthy();
		expect(screen.queryByTestId('icon-check-icon')).toBeNull();

		fireEvent.click(screen.getByText('Apply'));

		// Re-render so derived state picks up the updated slug
		await act(async () => {
			rerender(<PrePublishPanel />);
		});

		// After apply — slug now matches suggestion, so slug section is hidden
		// (showSlugSuggestion is false when currentSlug === suggestions.slug)
		expect(screen.queryByText('Slug')).toBeNull();
	});

	it('hides "Apply all" when all suggestions are applied', async () => {
		const { editorState, editPost } = setupMocks();
		editPost.mockImplementation((edits: any) => {
			if (edits.slug !== undefined) {
				editorState.currentSlug = edits.slug;
			}
		});

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'better-slug' },
					message: null,
				},
			],
		});

		const { rerender } = await act(async () => {
			return render(<PrePublishPanel />);
		});

		expect(screen.getByText('Apply all suggestions')).toBeTruthy();

		// Apply the only suggestion
		fireEvent.click(screen.getByText('Apply'));

		// Re-render so derived state picks up the updated slug
		await act(async () => {
			rerender(<PrePublishPanel />);
		});

		// Apply all should disappear
		expect(screen.queryByText('Apply all suggestions')).toBeNull();
	});

	it('applies all suggestions at once', async () => {
		const editPost = jest.fn();
		const invalidateResolutionForStoreSelector = jest.fn();
		setupMocks({ editPost, invalidateResolutionForStoreSelector });

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
		}) => {
			if (options.path.includes('/wp/v2/categories?search=')) {
				return Promise.resolve([{ id: 5, name: 'Tech', parent: 0 }]);
			}
			if (options.path.includes('/wp/v2/tags?search=')) {
				return Promise.resolve([{ id: 10, name: 'javascript' }]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {
						excerpt: 'Suggested excerpt',
						categories: ['Tech'],
						tags: ['javascript'],
						slug: 'better-slug',
					},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Apply all suggestions'));
		});

		expect(editPost).toHaveBeenCalledWith({
			excerpt: 'Suggested excerpt',
			slug: 'better-slug',
			categories: [5],
			tags: [10],
		});

		// Verify entity record cache was invalidated for new terms
		expect(invalidateResolutionForStoreSelector).toHaveBeenCalledWith(
			'getEntityRecords'
		);
	});

	it('run button is disabled when another command is active', () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			activeCommand: {
				id: 99,
				prompt: 'proofread',
				status: 'running',
				post_id: 123,
			},
		});

		render(<PrePublishPanel />);
		const button = screen
			.getByText('Run pre-publish checks')
			.closest('button')!;
		expect(button.disabled).toBe(true);
	});

	it('shows error message when check failed', () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'failed',
					post_id: 123,
					result_data: null,
					message: 'Something went wrong',
				},
			],
		});

		render(<PrePublishPanel />);
		expect(screen.getByText('Something went wrong')).toBeTruthy();
	});

	it('shows default error message when check failed with no message', () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'failed',
					post_id: 123,
					result_data: null,
					message: null,
				},
			],
		});

		render(<PrePublishPanel />);
		expect(screen.getByText('Check failed. Try again.')).toBeTruthy();
	});

	it('run button submits pre-publish-check command', () => {
		const mockSubmit = jest.fn();
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			submit: mockSubmit,
		});

		render(<PrePublishPanel />);
		fireEvent.click(screen.getByText('Run pre-publish checks'));
		expect(mockSubmit).toHaveBeenCalledWith('pre-publish-check');
	});

	it('rejects invalid result_data (array)', () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: [{ bad: 'data' }],
					message: null,
				},
			],
		});

		render(<PrePublishPanel />);
		// Should not render suggestions section
		expect(screen.queryByText('Excerpt')).toBeNull();
		expect(screen.queryByText('Everything looks good!')).toBeNull();
	});

	it('only shows suggestions that are present', async () => {
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { excerpt: 'Just an excerpt' },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Excerpt')).toBeTruthy();
		expect(screen.queryByText('Categories')).toBeNull();
		expect(screen.queryByText('Tags')).toBeNull();
		expect(screen.queryByText('Slug')).toBeNull();
	});

	it('displays all suggestion types together', async () => {
		const mockSuggestions = {
			excerpt: 'A suggested excerpt for the post.',
			categories: ['Tech', 'News'],
			tags: ['javascript', 'react'],
			slug: 'better-post-slug',
		};

		mockedApiFetch.mockImplementation(
			// Return empty for all searches (marks everything as new)
			(() => Promise.resolve([])) as unknown as typeof apiFetch
		);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: mockSuggestions,
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Suggestion labels
		expect(screen.getByText('Featured image')).toBeTruthy();
		expect(screen.getByText('Excerpt')).toBeTruthy();
		expect(screen.getByText('Slug')).toBeTruthy();
		expect(screen.getByText('Categories')).toBeTruthy();
		expect(screen.getByText('Tags')).toBeTruthy();

		// Apply buttons for excerpt, slug, categories, tags
		const applyButtons = screen.getAllByText('Apply');
		expect(applyButtons).toHaveLength(4);

		// Apply all button
		expect(screen.getByText('Apply all suggestions')).toBeTruthy();

		// Button text changes to re-run
		expect(screen.getByText('Re-run checks')).toBeTruthy();
	});

	it('shows new suggestion as unapplied when new results arrive', async () => {
		// With derived state, applied status is determined by comparing
		// current post state with the suggestion. A new suggestion with a
		// different value will naturally appear as unapplied.
		const { editorState, editPost } = setupMocks();
		editPost.mockImplementation((edits: any) => {
			if (edits.slug !== undefined) {
				editorState.currentSlug = edits.slug;
			}
		});

		const { rerender } = render(<PrePublishPanel />);

		// First result set
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'first-slug' },
					message: null,
				},
			],
		});

		await act(async () => {
			rerender(<PrePublishPanel />);
		});

		// Apply the slug — this changes currentSlug to 'first-slug'
		fireEvent.click(screen.getByText('Apply'));

		await act(async () => {
			rerender(<PrePublishPanel />);
		});

		// After apply, currentSlug matches suggestion, slug section hidden
		expect(screen.queryByText('Slug')).toBeNull();

		// New result with different slug suggestion
		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 20,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'second-slug' },
					message: null,
				},
			],
		});

		await act(async () => {
			rerender(<PrePublishPanel />);
		});

		// New suggestion differs from currentSlug, so it should appear unapplied
		expect(screen.getByText('Slug')).toBeTruthy();
		expect(screen.getByText('Apply')).toBeTruthy();
	});

	it('does not show featured image section before checks are run', () => {
		render(<PrePublishPanel />);
		expect(screen.queryByText('Featured image')).toBeNull();
		expect(screen.queryByTestId('post-featured-image')).toBeNull();
	});

	it('hides slug suggestion when it matches the current slug', async () => {
		setupMocks({ editorState: { currentSlug: 'same-slug' } });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { slug: 'same-slug' },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Slug section should not appear
		expect(screen.queryByText('Slug')).toBeNull();
		// With no other suggestions and featured image set, should show all-good
		expect(screen.getByText('Everything looks good!')).toBeTruthy();
	});

	it('shows "No featured image has been set." hint when no featured image', async () => {
		setupMocks({ editorState: { hasFeaturedImage: false } });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(
			screen.getByText('No featured image has been set.')
		).toBeTruthy();
	});

	it('does not show hint when featured image is set', async () => {
		setupMocks({ editorState: { hasFeaturedImage: true } });

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(
			screen.queryByText('No featured image has been set.')
		).toBeNull();
	});

	it('shows existing categories alongside suggested categories', async () => {
		setupMocks({
			editorState: { currentCategoryIds: [1] },
		});

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
		}) => {
			if (options.path.includes('/wp/v2/categories?include=1')) {
				return Promise.resolve([{ id: 1, name: 'Existing Cat' }]);
			}
			// Term status resolution for suggested categories
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['New Cat'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Existing Cat')).toBeTruthy();
		expect(screen.getByText('New Cat')).toBeTruthy();
	});

	it('filters out Uncategorized from displayed categories', async () => {
		setupMocks({
			editorState: { currentCategoryIds: [1] },
		});

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
		}) => {
			if (options.path.includes('/wp/v2/categories?include=1')) {
				return Promise.resolve([{ id: 1, name: 'Uncategorized' }]);
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.queryByText('Uncategorized')).toBeNull();
		expect(screen.getByText('Tech')).toBeTruthy();
	});

	it('shows remove buttons on term chips', async () => {
		mockedApiFetch.mockImplementation((() =>
			Promise.resolve([])) as unknown as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Remove button (multiplication sign) should be present
		const removeButton = screen.getByRole('button', {
			name: 'Remove Tech',
		});
		expect(removeButton).toBeTruthy();
	});

	it('hides suggested term when remove button is clicked', async () => {
		mockedApiFetch.mockImplementation((() =>
			Promise.resolve([])) as unknown as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech', 'News'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Tech')).toBeTruthy();
		expect(screen.getByText('News')).toBeTruthy();

		// Remove "Tech"
		fireEvent.click(screen.getByRole('button', { name: 'Remove Tech' }));

		// "Tech" should be gone, "News" should remain
		expect(screen.queryByText('Tech')).toBeNull();
		expect(screen.getByText('News')).toBeTruthy();
	});

	it('removes existing term from post via editPost when remove button is clicked', async () => {
		const editPost = jest.fn();
		setupMocks({
			editorState: { currentCategoryIds: [1, 2] },
			editPost,
		});

		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			if (options.path.includes('/wp/v2/categories?include=1,2')) {
				return Promise.resolve([
					{ id: 1, name: 'Keep' },
					{ id: 2, name: 'Remove' },
				]);
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('Keep')).toBeTruthy();
		expect(screen.getByText('Remove')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Remove Remove' }));

		expect(editPost).toHaveBeenCalledWith({ categories: [1] });
	});

	it('merges suggested category IDs with existing when applying', async () => {
		const editPost = jest.fn();
		const invalidateResolutionForStoreSelector = jest.fn();
		setupMocks({
			editorState: { currentCategoryIds: [1] },
			editPost,
			invalidateResolutionForStoreSelector,
		});

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
		}) => {
			if (options.path.includes('/wp/v2/categories?include=1')) {
				return Promise.resolve([{ id: 1, name: 'Existing' }]);
			}
			if (options.path.includes('/wp/v2/categories?search=')) {
				return Promise.resolve([{ id: 5, name: 'Tech', parent: 0 }]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Apply'));
		});

		// Should merge existing ID 1 with new ID 5
		expect(editPost).toHaveBeenCalledWith({ categories: [1, 5] });
		expect(invalidateResolutionForStoreSelector).toHaveBeenCalledWith(
			'getEntityRecords'
		);
	});

	it('handles hierarchical category resolution with parent > child format', async () => {
		const editPost = jest.fn();
		setupMocks({ editPost });

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
			data?: any;
		}) => {
			// Term status check — parent exists, child does not
			if (
				options.path.includes(
					'/wp/v2/categories?search=Technology&per_page=100'
				)
			) {
				return Promise.resolve([
					{ id: 10, name: 'Technology', parent: 0 },
				]);
			}
			if (
				options.path.includes(
					'/wp/v2/categories?search=AI&per_page=100&parent=10'
				)
			) {
				return Promise.resolve([]);
			}
			if (
				options.path.includes(
					'/wp/v2/categories?search=AI&per_page=100'
				)
			) {
				return Promise.resolve([]);
			}
			// Create child category
			if (
				options.path === '/wp/v2/categories' &&
				options.method === 'POST' &&
				options.data?.name === 'AI'
			) {
				return Promise.resolve({ id: 20 });
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Technology > AI'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Full path should be displayed
		expect(screen.getByText('Technology > AI')).toBeTruthy();
		// Should show as new since child doesn't exist
		expect(screen.getByText('(new)')).toBeTruthy();
	});

	it('shows existing tags alongside suggested tags', async () => {
		setupMocks({
			editorState: { currentTagIds: [10] },
		});

		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			if (options.path.includes('/wp/v2/tags?include=10')) {
				return Promise.resolve([{ id: 10, name: 'existing-tag' }]);
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { tags: ['new-tag'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('existing-tag')).toBeTruthy();
		expect(screen.getByText('new-tag')).toBeTruthy();
	});

	it('includes parent parameter when resolving hierarchical child categories', async () => {
		const editPost = jest.fn();
		const invalidateResolutionForStoreSelector = jest.fn();
		setupMocks({ editPost, invalidateResolutionForStoreSelector });

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
			data?: any;
		}) => {
			// resolveTermStatus: parent "Tech" exists
			if (
				options.path.includes(
					'/wp/v2/categories?search=Tech&per_page=100'
				) &&
				!options.path.includes('parent=')
			) {
				return Promise.resolve([{ id: 5, name: 'Tech', parent: 0 }]);
			}
			// resolveTermStatus: child "AI" with parent=5
			if (
				options.path.includes(
					'/wp/v2/categories?search=AI&per_page=100&parent=5'
				)
			) {
				return Promise.resolve([{ id: 15, name: 'AI', parent: 5 }]);
			}
			// resolveTermIds: parent "Tech" exists
			if (
				options.path.includes('/wp/v2/categories?search=Tech') &&
				!options.path.includes('parent=')
			) {
				return Promise.resolve([{ id: 5, name: 'Tech', parent: 0 }]);
			}
			// resolveTermIds: child "AI" with parent=5
			if (
				options.path.includes('/wp/v2/categories?search=AI') &&
				options.path.includes('parent=5')
			) {
				return Promise.resolve([{ id: 15, name: 'AI', parent: 5 }]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech > AI'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Apply'));
		});

		// Verify parent= parameter was used in the search
		const fetchCalls = mockedApiFetch.mock.calls.map(
			(c: any[]) => c[0]?.path ?? c[0]
		);
		expect(
			fetchCalls.some(
				(path: string) =>
					path.includes('search=AI') && path.includes('parent=5')
			)
		).toBe(true);

		expect(editPost).toHaveBeenCalledWith({ categories: [15] });
		expect(invalidateResolutionForStoreSelector).toHaveBeenCalledWith(
			'getEntityRecords'
		);
	});

	it('creates child category with parent ID when child does not exist', async () => {
		const editPost = jest.fn();
		const invalidateResolutionForStoreSelector = jest.fn();
		setupMocks({ editPost, invalidateResolutionForStoreSelector });

		mockedApiFetch.mockImplementation(((options: {
			path: string;
			method?: string;
			data?: any;
		}) => {
			// resolveTermStatus + resolveTermIds: parent "Tech" exists
			if (
				options.path.includes('/wp/v2/categories?search=Tech') &&
				!options.path.includes('parent=')
			) {
				return Promise.resolve([{ id: 5, name: 'Tech', parent: 0 }]);
			}
			// resolveTermStatus + resolveTermIds: child "AI" not found with parent=5
			if (
				options.path.includes('search=AI') &&
				options.path.includes('parent=5')
			) {
				return Promise.resolve([]);
			}
			// resolveTermIds: create child with parent
			if (
				options.path === '/wp/v2/categories' &&
				options.method === 'POST' &&
				options.data?.name === 'AI'
			) {
				expect(options.data.parent).toBe(5);
				return Promise.resolve({ id: 20 });
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech > AI'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		await act(async () => {
			fireEvent.click(screen.getByText('Apply'));
		});

		// Verify the child was created with the parent ID
		const postCalls = mockedApiFetch.mock.calls.filter(
			(c: any[]) =>
				(c[0]?.path ?? c[0]) === '/wp/v2/categories' &&
				c[0]?.method === 'POST'
		);
		expect(postCalls.length).toBe(1);
		expect(postCalls[0][0].data).toEqual({ name: 'AI', parent: 5 });

		expect(editPost).toHaveBeenCalledWith({ categories: [20] });
		expect(invalidateResolutionForStoreSelector).toHaveBeenCalledWith(
			'getEntityRecords'
		);
	});

	it('falls back to isNew: true when resolveTermStatus API call rejects', async () => {
		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			if (options.path.includes('search=')) {
				return Promise.reject(new Error('Network error'));
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Broken'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Term should still be shown with "(new)" indicator
		expect(screen.getByText('Broken')).toBeTruthy();
		expect(screen.getByText('(new)')).toBeTruthy();
	});

	it('handles category name fetch failure gracefully', async () => {
		setupMocks({
			editorState: { currentCategoryIds: [1, 2] },
		});

		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			// The include= fetch for category names rejects
			if (options.path.includes('/wp/v2/categories?include=')) {
				return Promise.reject(new Error('Server error'));
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { categories: ['Tech'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Existing category names should not appear (fetch failed)
		// But suggested category should still show
		expect(screen.getByText('Tech')).toBeTruthy();
	});

	it('handles tag name fetch failure gracefully', async () => {
		setupMocks({
			editorState: { currentTagIds: [10, 20] },
		});

		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			// The include= fetch for tag names rejects
			if (options.path.includes('/wp/v2/tags?include=')) {
				return Promise.reject(new Error('Server error'));
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: { tags: ['react'] },
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Existing tag names should not appear (fetch failed)
		// But suggested tag should still show
		expect(screen.getByText('react')).toBeTruthy();
	});

	it('removes existing tag from post via editPost when remove button is clicked', async () => {
		const editPost = jest.fn();
		setupMocks({
			editorState: { currentTagIds: [10, 20] },
			editPost,
		});

		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			if (options.path.includes('/wp/v2/tags?include=10,20')) {
				return Promise.resolve([
					{ id: 10, name: 'keep-tag' },
					{ id: 20, name: 'remove-tag' },
				]);
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		expect(screen.getByText('keep-tag')).toBeTruthy();
		expect(screen.getByText('remove-tag')).toBeTruthy();

		fireEvent.click(
			screen.getByRole('button', { name: 'Remove remove-tag' })
		);

		expect(editPost).toHaveBeenCalledWith({ tags: [10] });
	});

	it('does not show Apply button for categories when only existing terms are displayed', async () => {
		setupMocks({
			editorState: { currentCategoryIds: [1] },
		});

		mockedApiFetch.mockImplementation(((options: { path: string }) => {
			if (options.path.includes('/wp/v2/categories?include=1')) {
				return Promise.resolve([{ id: 1, name: 'Tech' }]);
			}
			if (options.path.includes('search=')) {
				return Promise.resolve([]);
			}
			return Promise.resolve([]);
		}) as typeof apiFetch);

		mockedUseCommands.mockReturnValue({
			...defaultCommands,
			history: [
				{
					id: 10,
					prompt: 'pre-publish-check',
					status: 'completed',
					post_id: 123,
					result_data: {},
					message: null,
				},
			],
		});

		await act(async () => {
			render(<PrePublishPanel />);
		});

		// Categories section should show (has existing term "Tech")
		expect(screen.getByText('Categories')).toBeTruthy();
		expect(screen.getByText('Tech')).toBeTruthy();
		// But no Apply button since there are no suggestions
		expect(screen.queryByText('Apply')).toBeNull();
	});
});
