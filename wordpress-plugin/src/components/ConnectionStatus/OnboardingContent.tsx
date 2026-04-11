/**
 * Onboarding content shown in the ConnectionStatus popover when disconnected.
 *
 * Presents two setup paths: Claudaborative Cloud (hosted) and local
 * setup via Claude Code CLI.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Button, ExternalLink, Icon } from '@wordpress/components';
import { cloud, code } from '@wordpress/icons';

/**
 * Internal dependencies
 */
import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard';
// Styles are imported via ConnectionStatus/style.scss to ensure
// they land in the extracted style-index.css stylesheet.

const SETUP_COMMAND = 'npx claudaborative-editing start';

/**
 * OnboardingContent component.
 *
 * Renders two setup option cards: hosted cloud service and local CLI setup.
 *
 * @return Rendered onboarding content.
 */
export default function OnboardingContent() {
	const { copied, handleCopy } = useCopyToClipboard(SETUP_COMMAND);

	return (
		<div className="wpce-onboarding">
			<div className="wpce-onboarding-heading">
				{__(
					'Get started with one of these options:',
					'claudaborative-editing'
				)}
			</div>

			<div className="wpce-onboarding-option wpce-onboarding-option-cloud">
				<div className="wpce-onboarding-option-header">
					<Icon icon={cloud} size={20} />
					<span className="wpce-onboarding-option-title">
						{__('Claudaborative Cloud', 'claudaborative-editing')}
					</span>
				</div>
				<p className="wpce-onboarding-option-description">
					{__(
						'The fastest way to get started. No local setup required.',
						'claudaborative-editing'
					)}
				</p>
				<ExternalLink
					className="wpce-onboarding-cloud-link"
					href="https://claudaborative.cloud"
				>
					{__(
						'Sign up at claudaborative.cloud',
						'claudaborative-editing'
					)}
				</ExternalLink>
			</div>

			<div className="wpce-onboarding-option">
				<div className="wpce-onboarding-option-header">
					<Icon icon={code} size={20} />
					<span className="wpce-onboarding-option-title">
						{__('Set up locally', 'claudaborative-editing')}
					</span>
				</div>
				<p className="wpce-onboarding-option-description">
					{__(
						'Use Claude Code on your own computer.',
						'claudaborative-editing'
					)}
				</p>
				<div className="wpce-onboarding-command-row">
					<code className="wpce-onboarding-command">
						{SETUP_COMMAND}
					</code>
					<Button
						className="wpce-onboarding-copy-button"
						variant="tertiary"
						size="small"
						onClick={handleCopy}
					>
						{copied
							? __('Copied!', 'claudaborative-editing')
							: __('Copy', 'claudaborative-editing')}
					</Button>
				</div>
			</div>
		</div>
	);
}
