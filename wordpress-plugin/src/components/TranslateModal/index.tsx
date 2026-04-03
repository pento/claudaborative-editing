/**
 * Translate modal.
 *
 * Prompts the user to enter a target language for translation using
 * explanatory text, a text input, and a submit button.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Modal, TextControl, Button } from '@wordpress/components';
import { useState } from '@wordpress/element';

import './style.scss';

interface TranslateModalProps {
	onSubmit: (language: string) => void;
	onRequestClose: () => void;
}

export default function TranslateModal({
	onSubmit,
	onRequestClose,
}: TranslateModalProps) {
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
			title={__('Translate', 'claudaborative-editing')}
			onRequestClose={onRequestClose}
			focusOnMount="firstElement"
			className="wpce-translate-modal"
		>
			<p>
				{__(
					'Enter the target language for translation (e.g., "French", "Spanish", "German").',
					'claudaborative-editing'
				)}
			</p>
			<p>
				{__(
					"That's not all, you can try some fun languages, too! Ever wondered what your post would sound like in Pirate Speak or Shakespearean English? Give it a try!",
					'claudaborative-editing'
				)}
			</p>
			<p>
				{__(
					'Please remember that LLM-based translations will vary in accuracy, depending on the language and context. All translations should be reviewed by a native speaker.',
					'claudaborative-editing'
				)}
			</p>
			<TextControl
				label={__('Target language', 'claudaborative-editing')}
				hideLabelFromVision
				value={value}
				onChange={setValue}
				onKeyDown={(e: React.KeyboardEvent) => {
					if (e.key === 'Enter') {
						handleSubmit();
					}
				}}
			/>
			<Button
				variant="primary"
				disabled={value.trim().length === 0}
				onClick={handleSubmit}
				className="wpce-translate-submit"
			>
				{__('Submit', 'claudaborative-editing')}
			</Button>
		</Modal>
	);
}
