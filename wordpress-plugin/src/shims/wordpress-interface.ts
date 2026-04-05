/**
 * Shim for @wordpress/interface that re-exports only PinnedItems.
 *
 * The real @wordpress/interface package registers the "core/interface"
 * data store on import. Since @wordpress/scripts bundles this package
 * (it's in BUNDLED_PACKAGES), and WordPress core already registers the
 * same store, importing it directly produces a "Store already registered"
 * console warning.
 *
 * PinnedItems is a thin Fill/Slot wrapper around @wordpress/components.
 * We inline the implementation here to avoid importing the store module.
 */

/**
 * WordPress dependencies
 */
import { Fill } from '@wordpress/components';
import { createElement } from '@wordpress/element';

/**
 * PinnedItems Fill component — renders children into the PinnedItems
 * slot for the given scope.
 *
 * @param props          Component props.
 * @param props.scope    Slot scope identifier.
 * @param props.children Children to render in the slot.
 */
function PinnedItems({
	scope,
	...props
}: {
	scope: string;
	children?: React.ReactNode;
}) {
	return createElement(Fill, { name: `PinnedItems/${scope}`, ...props });
}

export { PinnedItems };
