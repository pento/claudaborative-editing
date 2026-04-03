/**
 * Edit focus modal.
 *
 * Prompts the user to describe how they want the post edited,
 * then passes the freeform text to the parent as `editingFocus`.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Modal, TextControl, Button } from '@wordpress/components';
import { useState, type KeyboardEvent } from '@wordpress/element';

import './style.scss';

interface EditFocusModalProps {
	onSubmit: (editingFocus: string) => void;
	onRequestClose: () => void;
}

export default function EditFocusModal({
	onSubmit,
	onRequestClose,
}: EditFocusModalProps) {
	const [value, setValue] = useState('');

	const handleSubmit = (): void => {
		const trimmed = value.trim();
		if (trimmed) {
			onSubmit(trimmed);
			onRequestClose();
		}
	};

	return (
		<Modal
			title={__('Automatic Post Editing', 'claudaborative-editing')}
			onRequestClose={onRequestClose}
			focusOnMount="firstElement"
			className="wpce-edit-focus-modal"
		>
			<p>
				{__(
					'This tool makes broad editorial changes to the entire post. Here are some examples of what it can do:',
					'claudaborative-editing'
				)}
			</p>
			<ul className="wpce-edit-focus-examples">
				<li>
					{__(
						'Change the tone to be more formal, casual, enthusiastic, etc.',
						'claudaborative-editing'
					)}
				</li>
				<li>
					{__(
						'Improve the structure and flow of the post',
						'claudaborative-editing'
					)}
				</li>
				<li>
					{__(
						'Condense the post by removing unnecessary details',
						'claudaborative-editing'
					)}
				</li>
				<li>
					{__(
						'Rewrite the post in a different style or for a different audience',
						'claudaborative-editing'
					)}
				</li>
			</ul>
			<p>
				{__(
					'If you want to make more specific changes, consider using the Notes tool to provide detailed instructions.',
					'claudaborative-editing'
				)}
			</p>
			<TextControl
				label={__('Editing instructions', 'claudaborative-editing')}
				hideLabelFromVision
				value={value}
				onChange={setValue}
				onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
					if (e.key === 'Enter') {
						handleSubmit();
					}
				}}
			/>
			<Button
				variant="primary"
				disabled={value.trim().length === 0}
				onClick={handleSubmit}
				className="wpce-edit-focus-submit"
			>
				{__('Submit', 'claudaborative-editing')}
			</Button>
		</Modal>
	);
}
