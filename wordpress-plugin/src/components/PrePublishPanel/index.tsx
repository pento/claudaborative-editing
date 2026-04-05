/**
 * Pre-publish checks panel.
 *
 * Renders in the pre-publish sidebar (shown when the user clicks "Publish").
 * Allows running AI-powered pre-publish checks and displays actionable
 * suggestions for excerpt, categories, tags, and slug — with buttons to
 * apply them directly to the editor state. Features a native
 * PostFeaturedImage component for setting the featured image.
 */

/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	PluginPrePublishPanel,
	PostFeaturedImage as PostFeaturedImageUntyped,
	PostFeaturedImageCheck,
} from '@wordpress/editor';
import type { ComponentType } from 'react';

// PostFeaturedImage is typed as `unknown` in @wordpress/editor.
const PostFeaturedImage = PostFeaturedImageUntyped as ComponentType<
	Record<string, never>
>;
import { useSelect, useDispatch } from '@wordpress/data';
import { Button, Spinner, Icon, TextareaControl } from '@wordpress/components';
import { check as checkIcon } from '@wordpress/icons';
import {
	useState,
	useCallback,
	useRef,
	useEffect,
	useMemo,
} from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { useCommands } from '../../hooks/use-commands';
import SparkleIcon from '../SparkleIcon';
import type { Command, PrePublishSuggestions } from '../../store/types';

import './style.scss';

/**
 * A resolved term with its new/existing status.
 */
interface ResolvedTerm {
	name: string;
	isNew: boolean;
}

/**
 * A term for display, including its source (existing on post vs. suggested).
 */
interface DisplayTerm {
	name: string;
	source: 'existing' | 'suggested';
	isNew: boolean;
}

/**
 * Resolve an array of term names to WordPress term IDs, creating any
 * terms that don't already exist.
 *
 * @param names    Array of term names to resolve.
 * @param taxonomy Which taxonomy to search/create in.
 * @return Array of resolved term IDs.
 */
async function resolveTermIds(
	names: string[],
	taxonomy: 'categories' | 'tags'
): Promise<number[]> {
	const restBase = taxonomy === 'categories' ? 'categories' : 'tags';
	const ids: number[] = [];

	for (const name of names) {
		try {
			// Split on " > " for hierarchical categories (e.g., "Tech > AI")
			const parts =
				taxonomy === 'categories'
					? name.split(' > ').map((s) => s.trim())
					: [name];
			let parentId = 0;
			let termId: number | null = null;

			for (const part of parts) {
				const searchParams = new URLSearchParams({
					search: part,
					per_page: '100',
				});
				if (parentId && taxonomy === 'categories') {
					searchParams.set('parent', String(parentId));
				}
				const results = await apiFetch<
					Array<{ id: number; name: string; parent?: number }>
				>({
					path: `/wp/v2/${restBase}?${searchParams.toString()}`,
				});
				const exact = results.find(
					(t) =>
						t.name.toLowerCase() === part.toLowerCase() &&
						(taxonomy !== 'categories' ||
							!parentId ||
							t.parent === parentId)
				);

				if (exact) {
					termId = exact.id;
					parentId = exact.id;
				} else {
					const data: Record<string, unknown> = { name: part };
					if (parentId && taxonomy === 'categories') {
						data.parent = parentId;
					}
					const created = await apiFetch<{ id: number }>({
						path: `/wp/v2/${restBase}`,
						method: 'POST',
						data,
					});
					termId = created.id;
					parentId = created.id;
				}
			}

			if (termId !== null) {
				ids.push(termId);
			}
		} catch {
			// Skip terms that fail to resolve
		}
	}

	return ids;
}

/**
 * Resolve term names to determine which already exist and which are new.
 * This is for display purposes only — it never creates terms.
 *
 * @param names    Array of term names to check.
 * @param taxonomy Which taxonomy to search in.
 * @return Array of resolved terms with new/existing status.
 */
async function resolveTermStatus(
	names: string[],
	taxonomy: 'categories' | 'tags'
): Promise<ResolvedTerm[]> {
	const restBase = taxonomy === 'categories' ? 'categories' : 'tags';
	const resolved: ResolvedTerm[] = [];

	for (const name of names) {
		try {
			// Split on " > " for hierarchical categories (e.g., "Tech > AI")
			const parts =
				taxonomy === 'categories'
					? name.split(' > ').map((s) => s.trim())
					: [name];
			let parentId = 0;
			let leafExists = true;

			for (const part of parts) {
				const searchParams = new URLSearchParams({
					search: part,
					per_page: '100',
				});
				if (parentId && taxonomy === 'categories') {
					searchParams.set('parent', String(parentId));
				}
				const results = await apiFetch<
					Array<{ id: number; name: string; parent?: number }>
				>({
					path: `/wp/v2/${restBase}?${searchParams.toString()}`,
				});
				const exact = results.find(
					(t) =>
						t.name.toLowerCase() === part.toLowerCase() &&
						(taxonomy !== 'categories' ||
							!parentId ||
							t.parent === parentId)
				);

				if (exact) {
					parentId = exact.id;
				} else {
					leafExists = false;
					break;
				}
			}

			// Report isNew based on whether the full path resolved
			resolved.push({ name, isNew: !leafExists });
		} catch {
			// On error, assume new (conservative — better to show "(new)" than hide it)
			resolved.push({ name, isNew: true });
		}
	}

	return resolved;
}

/**
 * PrePublishPanel component.
 *
 * Renders a panel in the pre-publish sidebar with AI-powered checks.
 * Shows concrete suggestions for excerpt, categories, tags, and slug
 * with buttons to apply each suggestion directly. Also shows the native
 * PostFeaturedImage component for setting the featured image.
 *
 * @return Rendered panel.
 */
export default function PrePublishPanel() {
	const { mcpConnected } = useMcpStatus();

	const {
		postId,
		currentSlug,
		hasFeaturedImage,
		currentCategoryIds,
		currentTagIds,
	} = useSelect((select) => {
		const editor = select('core/editor') as {
			getCurrentPostId: () => number;
			getEditedPostSlug: () => string;
			getEditedPostAttribute: (attr: string) => unknown;
		};
		return {
			postId: editor.getCurrentPostId(),
			currentSlug: editor.getEditedPostSlug(),
			hasFeaturedImage: !!(editor.getEditedPostAttribute(
				'featured_media'
			) as number),
			currentCategoryIds:
				(editor.getEditedPostAttribute('categories') as
					| number[]
					| undefined) ?? [],
			currentTagIds:
				(editor.getEditedPostAttribute('tags') as
					| number[]
					| undefined) ?? [],
		};
	}, []);

	const { activeCommand, isSubmitting, history, submit } =
		useCommands(postId);

	const { editPost } = useDispatch('core/editor') as {
		editPost: (edits: Record<string, unknown>) => void;
	};

	// Derive check results from command history.
	const lastCheck = history.find(
		(cmd: Command) => cmd.prompt === 'pre-publish-check'
	);
	const lastCheckFailed = lastCheck?.status === 'failed' ? lastCheck : null;

	// Validate result_data: must be a non-null, non-array object.
	const lastCheckResult =
		lastCheck?.status === 'completed' &&
		lastCheck.result_data !== null &&
		typeof lastCheck.result_data === 'object' &&
		!Array.isArray(lastCheck.result_data)
			? lastCheck
			: null;

	const suggestions: PrePublishSuggestions | null =
		(lastCheckResult?.result_data as PrePublishSuggestions | null) ?? null;

	const [applied, setApplied] = useState<Set<string>>(new Set());
	const [isApplying, setIsApplying] = useState(false);
	const [excerptDraft, setExcerptDraft] = useState('');
	const [resolvedCategories, setResolvedCategories] = useState<
		ResolvedTerm[]
	>([]);
	const [resolvedTags, setResolvedTags] = useState<ResolvedTerm[]>([]);
	const [currentCategoryNames, setCurrentCategoryNames] = useState<string[]>(
		[]
	);
	const [currentTagNames, setCurrentTagNames] = useState<string[]>([]);
	const [categoryIdMap, setCategoryIdMap] = useState<Map<string, number>>(
		new Map()
	);
	const [tagIdMap, setTagIdMap] = useState<Map<string, number>>(new Map());
	const [removedSuggestions, setRemovedSuggestions] = useState<Set<string>>(
		new Set()
	);

	// Track the last completed check command ID so we can reset state
	// when new results arrive.
	const lastResultIdRef = useRef<number | null>(null);

	// Reset applied set, excerpt draft, and removed suggestions on new results.
	useEffect(() => {
		if (lastCheckResult && lastCheckResult.id !== lastResultIdRef.current) {
			lastResultIdRef.current = lastCheckResult.id;
			setApplied(new Set());
			setRemovedSuggestions(new Set());
			const sug = lastCheckResult.result_data as PrePublishSuggestions;
			setExcerptDraft(sug?.excerpt ?? '');
		}
	}, [lastCheckResult]);

	// Resolve suggested term new/existing status. Keyed by the check
	// command ID + current post terms so it re-runs when terms change.
	const lastCheckId = lastCheckResult?.id ?? null;
	useEffect(() => {
		let cancelled = false;

		if (suggestions?.categories && suggestions.categories.length > 0) {
			resolveTermStatus(suggestions.categories, 'categories').then(
				(resolved) => {
					if (!cancelled) {
						setResolvedCategories(resolved);
					}
				}
			);
		} else {
			setResolvedCategories([]);
		}

		if (suggestions?.tags && suggestions.tags.length > 0) {
			resolveTermStatus(suggestions.tags, 'tags').then((resolved) => {
				if (!cancelled) {
					setResolvedTags(resolved);
				}
			});
		} else {
			setResolvedTags([]);
		}

		return () => {
			cancelled = true;
		};
		// Use stable keys: command ID changes on new results, joined IDs
		// change when the user adds/removes terms externally.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		lastCheckId,
		// eslint-disable-next-line react-hooks/exhaustive-deps
		currentCategoryIds.join(','),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		currentTagIds.join(','),
	]);

	// Fetch current category names when IDs change.
	useEffect(() => {
		if (currentCategoryIds.length > 0) {
			apiFetch<Array<{ id: number; name: string }>>({
				path: `/wp/v2/categories?include=${currentCategoryIds.join(
					','
				)}&per_page=100`,
			})
				.then((terms) => {
					setCurrentCategoryNames(terms.map((t) => t.name));
					setCategoryIdMap(
						new Map(terms.map((t) => [t.name.toLowerCase(), t.id]))
					);
				})
				.catch(() => {
					setCurrentCategoryNames([]);
					setCategoryIdMap(new Map());
				});
		} else {
			setCurrentCategoryNames([]);
			setCategoryIdMap(new Map());
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentCategoryIds.join(',')]);

	// Fetch current tag names when IDs change.
	useEffect(() => {
		if (currentTagIds.length > 0) {
			apiFetch<Array<{ id: number; name: string }>>({
				path: `/wp/v2/tags?include=${currentTagIds.join(
					','
				)}&per_page=100`,
			})
				.then((terms) => {
					setCurrentTagNames(terms.map((t) => t.name));
					setTagIdMap(
						new Map(terms.map((t) => [t.name.toLowerCase(), t.id]))
					);
				})
				.catch(() => {
					setCurrentTagNames([]);
					setTagIdMap(new Map());
				});
		} else {
			setCurrentTagNames([]);
			setTagIdMap(new Map());
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentTagIds.join(',')]);

	// Build merged display term lists (existing + suggested).
	const categoryTerms: DisplayTerm[] = useMemo(() => {
		const terms: DisplayTerm[] = [];
		for (const name of currentCategoryNames) {
			// Skip "Uncategorized" — it's the WordPress default and not useful to display.
			if (name.toLowerCase() === 'uncategorized') continue;
			terms.push({ name, source: 'existing', isNew: false });
		}
		if (suggestions?.categories) {
			for (const resolved of resolvedCategories) {
				const alreadyExists = currentCategoryNames.some(
					(n) => n.toLowerCase() === resolved.name.toLowerCase()
				);
				if (!alreadyExists) {
					terms.push({
						name: resolved.name,
						source: 'suggested',
						isNew: resolved.isNew,
					});
				}
			}
		}
		return terms;
	}, [currentCategoryNames, suggestions?.categories, resolvedCategories]);

	const tagTerms: DisplayTerm[] = useMemo(() => {
		const terms: DisplayTerm[] = [];
		for (const name of currentTagNames) {
			terms.push({ name, source: 'existing', isNew: false });
		}
		if (suggestions?.tags) {
			for (const resolved of resolvedTags) {
				const alreadyExists = currentTagNames.some(
					(n) => n.toLowerCase() === resolved.name.toLowerCase()
				);
				if (!alreadyExists) {
					terms.push({
						name: resolved.name,
						source: 'suggested',
						isNew: resolved.isNew,
					});
				}
			}
		}
		return terms;
	}, [currentTagNames, suggestions?.tags, resolvedTags]);

	// Filter out removed suggestions from display.
	const visibleCategoryTerms = categoryTerms.filter(
		(t) =>
			!(
				t.source === 'suggested' &&
				removedSuggestions.has(`cat:${t.name}`)
			)
	);
	const visibleTagTerms = tagTerms.filter(
		(t) =>
			!(
				t.source === 'suggested' &&
				removedSuggestions.has(`tag:${t.name}`)
			)
	);

	const isChecking =
		activeCommand?.prompt === 'pre-publish-check' &&
		(activeCommand.status === 'pending' ||
			activeCommand.status === 'running');
	const canRunCheck = mcpConnected && !activeCommand && !isSubmitting;

	// Only show slug suggestion if it differs from the current slug.
	const showSlugSuggestion =
		!!suggestions?.slug && suggestions.slug !== currentSlug;

	// Check whether there are any unapplied suggested terms to show.
	const hasVisibleSuggestedCategories = visibleCategoryTerms.some(
		(t) => t.source === 'suggested'
	);
	const hasVisibleSuggestedTags = visibleTagTerms.some(
		(t) => t.source === 'suggested'
	);

	const hasSuggestions = !!(
		suggestions?.excerpt ||
		hasVisibleSuggestedCategories ||
		hasVisibleSuggestedTags ||
		showSlugSuggestion
	);

	// Count how many suggestion fields exist but haven't been applied yet.
	let unappliedCount = 0;
	if (suggestions) {
		if (suggestions.excerpt && !applied.has('excerpt')) {
			unappliedCount++;
		}
		if (hasVisibleSuggestedCategories && !applied.has('categories')) {
			unappliedCount++;
		}
		if (hasVisibleSuggestedTags && !applied.has('tags')) {
			unappliedCount++;
		}
		if (showSlugSuggestion && !applied.has('slug')) {
			unappliedCount++;
		}
	}

	const applyExcerpt = useCallback(() => {
		if (excerptDraft) {
			editPost({ excerpt: excerptDraft });
			setApplied((prev) => new Set(prev).add('excerpt'));
		}
	}, [excerptDraft, editPost]);

	const applySlug = useCallback(() => {
		if (suggestions?.slug) {
			editPost({ slug: suggestions.slug });
			setApplied((prev) => new Set(prev).add('slug'));
		}
	}, [suggestions, editPost]);

	const applyCategories = useCallback(async () => {
		const suggestedNames = (suggestions?.categories ?? []).filter(
			(name) => !removedSuggestions.has(`cat:${name}`)
		);
		if (suggestedNames.length > 0) {
			setIsApplying(true);
			try {
				const newIds = await resolveTermIds(
					suggestedNames,
					'categories'
				);
				const merged = [...new Set([...currentCategoryIds, ...newIds])];
				editPost({ categories: merged });
				setApplied((prev) => new Set(prev).add('categories'));
			} finally {
				setIsApplying(false);
			}
		}
	}, [suggestions, removedSuggestions, currentCategoryIds, editPost]);

	const applyTags = useCallback(async () => {
		const suggestedNames = (suggestions?.tags ?? []).filter(
			(name) => !removedSuggestions.has(`tag:${name}`)
		);
		if (suggestedNames.length > 0) {
			setIsApplying(true);
			try {
				const newIds = await resolveTermIds(suggestedNames, 'tags');
				const merged = [...new Set([...currentTagIds, ...newIds])];
				editPost({ tags: merged });
				setApplied((prev) => new Set(prev).add('tags'));
			} finally {
				setIsApplying(false);
			}
		}
	}, [suggestions, removedSuggestions, currentTagIds, editPost]);

	const removeTerm = useCallback(
		(taxonomy: 'categories' | 'tags', term: DisplayTerm) => {
			if (term.source === 'existing') {
				if (taxonomy === 'categories') {
					const termId = categoryIdMap.get(term.name.toLowerCase());
					if (termId) {
						editPost({
							categories: currentCategoryIds.filter(
								(id) => id !== termId
							),
						});
					}
				} else {
					const termId = tagIdMap.get(term.name.toLowerCase());
					if (termId) {
						editPost({
							tags: currentTagIds.filter((id) => id !== termId),
						});
					}
				}
			} else {
				const key =
					taxonomy === 'categories'
						? `cat:${term.name}`
						: `tag:${term.name}`;
				setRemovedSuggestions((prev) => new Set(prev).add(key));
			}
		},
		[editPost, currentCategoryIds, currentTagIds, categoryIdMap, tagIdMap]
	);

	const applyAll = useCallback(async () => {
		if (!suggestions) {
			return;
		}
		setIsApplying(true);
		try {
			const edits: Record<string, unknown> = {};
			const newApplied = new Set(applied);

			if (suggestions.excerpt && !applied.has('excerpt')) {
				edits.excerpt = excerptDraft;
				newApplied.add('excerpt');
			}
			if (showSlugSuggestion && !applied.has('slug')) {
				edits.slug = suggestions.slug;
				newApplied.add('slug');
			}

			// Filter out removed suggestions before resolving.
			const suggestedCatNames = (suggestions.categories ?? []).filter(
				(name) => !removedSuggestions.has(`cat:${name}`)
			);
			const suggestedTagNames = (suggestions.tags ?? []).filter(
				(name) => !removedSuggestions.has(`tag:${name}`)
			);

			// Resolve categories and tags in parallel.
			const [categoryIds, tagIds] = await Promise.all([
				suggestedCatNames.length > 0 && !applied.has('categories')
					? resolveTermIds(suggestedCatNames, 'categories')
					: Promise.resolve(null),
				suggestedTagNames.length > 0 && !applied.has('tags')
					? resolveTermIds(suggestedTagNames, 'tags')
					: Promise.resolve(null),
			]);

			if (categoryIds) {
				edits.categories = [
					...new Set([...currentCategoryIds, ...categoryIds]),
				];
				newApplied.add('categories');
			}
			if (tagIds) {
				edits.tags = [...new Set([...currentTagIds, ...tagIds])];
				newApplied.add('tags');
			}

			if (Object.keys(edits).length > 0) {
				editPost(edits);
			}
			setApplied(newApplied);
		} finally {
			setIsApplying(false);
		}
	}, [
		suggestions,
		applied,
		excerptDraft,
		showSlugSuggestion,
		removedSuggestions,
		currentCategoryIds,
		currentTagIds,
		editPost,
	]);

	return (
		<PluginPrePublishPanel
			title={__('Pre-Publish Checks', 'claudaborative-editing')}
			initialOpen={true}
			icon={<SparkleIcon size={20} />}
		>
			<div className="wpce-pre-publish-panel">
				<p>
					{__(
						'Pre-publish checks help ensure your content is ready for publication.',
						'claudaborative-editing'
					)}
				</p>
				{!mcpConnected && (
					<p className="wpce-pre-publish-panel__notice">
						{__(
							'AI assistant not connected.',
							'claudaborative-editing'
						)}
					</p>
				)}

				{isChecking && (
					<div className="wpce-pre-publish-panel__checking">
						<Spinner />
						<span>
							{__('Checking\u2026', 'claudaborative-editing')}
						</span>
					</div>
				)}

				{lastCheckFailed && !isChecking && !suggestions && (
					<p className="wpce-pre-publish-panel__error">
						{lastCheckFailed.message ||
							__(
								'Check failed. Try again.',
								'claudaborative-editing'
							)}
					</p>
				)}

				{suggestions !== null && !isChecking && (
					<div className="wpce-pre-publish-panel__suggestions">
						{/* Featured Image — always show via native component */}
						<div className="wpce-pre-publish-panel__suggestion">
							<div className="wpce-pre-publish-panel__suggestion-header">
								<strong>
									{__(
										'Featured image',
										'claudaborative-editing'
									)}
								</strong>
							</div>
							{!hasFeaturedImage && (
								<p className="wpce-pre-publish-panel__suggestion-hint">
									{__(
										'No featured image has been set.',
										'claudaborative-editing'
									)}
								</p>
							)}
							<PostFeaturedImageCheck>
								<PostFeaturedImage />
							</PostFeaturedImageCheck>
						</div>

						{/* Excerpt suggestion */}
						{suggestions.excerpt && (
							<div className="wpce-pre-publish-panel__suggestion">
								<div className="wpce-pre-publish-panel__suggestion-header">
									<strong>
										{__(
											'Excerpt',
											'claudaborative-editing'
										)}
									</strong>
									{applied.has('excerpt') ? (
										<Icon icon={checkIcon} />
									) : (
										<Button
											variant="link"
											onClick={applyExcerpt}
											disabled={isApplying}
										>
											{__(
												'Apply',
												'claudaborative-editing'
											)}
										</Button>
									)}
								</div>
								{applied.has('excerpt') ? (
									<p className="wpce-pre-publish-panel__suggestion-value">
										{excerptDraft}
									</p>
								) : (
									<TextareaControl
										__nextHasNoMarginBottom
										value={excerptDraft}
										onChange={setExcerptDraft}
										rows={3}
										className="wpce-pre-publish-panel__excerpt-textarea"
									/>
								)}
							</div>
						)}

						{/* Slug suggestion */}
						{showSlugSuggestion && (
							<div className="wpce-pre-publish-panel__suggestion">
								<div className="wpce-pre-publish-panel__suggestion-header">
									<strong>
										{__('Slug', 'claudaborative-editing')}
									</strong>
									{applied.has('slug') ? (
										<Icon icon={checkIcon} />
									) : (
										<Button
											variant="link"
											onClick={applySlug}
											disabled={isApplying}
										>
											{__(
												'Apply',
												'claudaborative-editing'
											)}
										</Button>
									)}
								</div>
								<p className="wpce-pre-publish-panel__suggestion-value">
									{currentSlug} &rarr; {suggestions.slug}
								</p>
							</div>
						)}

						{/* Categories — show when there are visible terms (existing or suggested) */}
						{visibleCategoryTerms.length > 0 && (
							<div className="wpce-pre-publish-panel__suggestion">
								<div className="wpce-pre-publish-panel__suggestion-header">
									<strong>
										{__(
											'Categories',
											'claudaborative-editing'
										)}
									</strong>
									{hasVisibleSuggestedCategories &&
										(applied.has('categories') ? (
											<Icon icon={checkIcon} />
										) : (
											<Button
												variant="link"
												onClick={applyCategories}
												disabled={isApplying}
											>
												{__(
													'Apply',
													'claudaborative-editing'
												)}
											</Button>
										))}
								</div>
								<div className="wpce-pre-publish-panel__terms">
									{visibleCategoryTerms.map((term) => (
										<span
											key={`${term.source}:${term.name}`}
											className={`wpce-pre-publish-panel__term wpce-pre-publish-panel__term--${term.source}`}
										>
											{term.name}
											{term.isNew && (
												<span className="wpce-pre-publish-panel__term-new">
													{__(
														'(new)',
														'claudaborative-editing'
													)}
												</span>
											)}
											<button
												type="button"
												className="wpce-pre-publish-panel__term-remove"
												onClick={() =>
													removeTerm(
														'categories',
														term
													)
												}
												aria-label={sprintf(
													/* translators: %s: term name */
													__(
														'Remove %s',
														'claudaborative-editing'
													),
													term.name
												)}
											>
												{'\u00d7'}
											</button>
										</span>
									))}
								</div>
							</div>
						)}

						{/* Tags — show when there are visible terms (existing or suggested) */}
						{visibleTagTerms.length > 0 && (
							<div className="wpce-pre-publish-panel__suggestion">
								<div className="wpce-pre-publish-panel__suggestion-header">
									<strong>
										{__('Tags', 'claudaborative-editing')}
									</strong>
									{hasVisibleSuggestedTags &&
										(applied.has('tags') ? (
											<Icon icon={checkIcon} />
										) : (
											<Button
												variant="link"
												onClick={applyTags}
												disabled={isApplying}
											>
												{__(
													'Apply',
													'claudaborative-editing'
												)}
											</Button>
										))}
								</div>
								<div className="wpce-pre-publish-panel__terms">
									{visibleTagTerms.map((term) => (
										<span
											key={`${term.source}:${term.name}`}
											className={`wpce-pre-publish-panel__term wpce-pre-publish-panel__term--${term.source}`}
										>
											{term.name}
											{term.isNew && (
												<span className="wpce-pre-publish-panel__term-new">
													{__(
														'(new)',
														'claudaborative-editing'
													)}
												</span>
											)}
											<button
												type="button"
												className="wpce-pre-publish-panel__term-remove"
												onClick={() =>
													removeTerm('tags', term)
												}
												aria-label={sprintf(
													/* translators: %s: term name */
													__(
														'Remove %s',
														'claudaborative-editing'
													),
													term.name
												)}
											>
												{'\u00d7'}
											</button>
										</span>
									))}
								</div>
							</div>
						)}

						{/* Everything looks good! */}
						{!hasSuggestions && hasFeaturedImage && (
							<p className="wpce-pre-publish-panel__all-good">
								{__(
									'Everything looks good!',
									'claudaborative-editing'
								)}
							</p>
						)}

						{/* Apply all button */}
						{hasSuggestions && unappliedCount > 0 && (
							<Button
								variant="primary"
								className="wpce-pre-publish-panel__apply-all"
								onClick={applyAll}
								disabled={isApplying}
								isBusy={isApplying}
							>
								{__(
									'Apply all suggestions',
									'claudaborative-editing'
								)}
							</Button>
						)}
					</div>
				)}

				<Button
					variant="secondary"
					className="wpce-pre-publish-panel__run-button"
					disabled={!canRunCheck}
					isBusy={isChecking}
					onClick={() => submit('pre-publish-check')}
				>
					{suggestions && !isChecking
						? __('Re-run checks', 'claudaborative-editing')
						: __(
								'Run pre-publish checks',
								'claudaborative-editing'
						  )}
				</Button>
			</div>
		</PluginPrePublishPanel>
	);
}
