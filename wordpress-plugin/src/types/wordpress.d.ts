/**
 * Type declarations for WordPress packages that don't ship their own types.
 */

declare module '@wordpress/interface' {
	import type { FC, ReactNode } from 'react';

	interface PinnedItemsProps {
		scope: string;
		children?: ReactNode;
	}

	export const PinnedItems: FC<PinnedItemsProps>;
}

/**
 * SCSS module imports.
 */
declare module '*.scss';
