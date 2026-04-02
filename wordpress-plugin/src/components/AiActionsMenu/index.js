/**
 * AI Actions dropdown menu.
 *
 * Registers a toolbar dropdown in the Gutenberg editor header containing
 * quick action buttons for AI-assisted editing.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { DropdownMenu } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { PinnedItems } from '@wordpress/interface';

/**
 * Internal dependencies
 */
import QuickActions from '../QuickActions';
import SparkleIcon from '../SparkleIcon';
import { STORE_NAME } from '../../store';

/**
 * AiActionsMenu component.
 *
 * Renders a dropdown button in the editor toolbar's pinned items area.
 *
 * @return {import('react').ReactElement} Rendered dropdown.
 */
export default function AiActionsMenu() {
	const hasActiveCommand = useSelect(
		(select) => select(STORE_NAME).getActiveCommand() !== null,
		[]
	);

	return (
		<PinnedItems scope="core">
			<DropdownMenu
				icon={<SparkleIcon size={24} processing={hasActiveCommand} />}
				label={__('Claudaborative Editing', 'claudaborative-editing')}
				popoverProps={{ placement: 'bottom-end' }}
			>
				{({ onClose }) => <QuickActions onClose={onClose} />}
			</DropdownMenu>
		</PinnedItems>
	);
}
