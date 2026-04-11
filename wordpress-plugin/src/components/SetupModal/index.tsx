/**
 * Setup modal.
 *
 * A polished modal presenting two paths for getting started with
 * Claudaborative Editing: the hosted cloud service or local CLI setup.
 * Triggered from the AiActionsMenu when the MCP server is disconnected.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Modal, Button, ExternalLink, Icon } from '@wordpress/components';
import { cloud, code } from '@wordpress/icons';

/**
 * Internal dependencies
 */
import { useCopyToClipboard } from '../../hooks/use-copy-to-clipboard';
import SparkleIcon from '../SparkleIcon';

import './style.scss';

const SETUP_COMMAND = 'npx claudaborative-editing start';

interface SetupModalProps {
	onRequestClose: () => void;
}

/**
 * SetupModal component.
 *
 * Renders a modal with two setup option cards: hosted cloud service
 * and local CLI setup via Claude Code.
 *
 * @param props                Component props.
 * @param props.onRequestClose Callback to close the modal.
 * @return Rendered modal.
 */
export default function SetupModal({ onRequestClose }: SetupModalProps) {
	const { copied, handleCopy } = useCopyToClipboard(SETUP_COMMAND);

	return (
		<Modal
			title={__('Get Started', 'claudaborative-editing')}
			onRequestClose={onRequestClose}
			className="wpce-setup-modal"
			icon={<SparkleIcon size={24} />}
		>
			<p className="wpce-setup-modal-intro">
				{__(
					'Choose how you want to connect Claudaborative Editing to your site:',
					'claudaborative-editing'
				)}
			</p>

			<div className="wpce-setup-modal-options">
				<div className="wpce-setup-modal-card wpce-setup-modal-card-cloud">
					<div className="wpce-setup-modal-card-header">
						<Icon icon={cloud} size={24} />
						<h3>
							{__(
								'Claudaborative Cloud',
								'claudaborative-editing'
							)}
						</h3>
						<span className="wpce-setup-modal-badge">
							{__('Recommended', 'claudaborative-editing')}
						</span>
					</div>
					<p>
						{__(
							'The fastest way to get started. Sign up for the hosted service and connect your site in minutes, no local software needed.',
							'claudaborative-editing'
						)}
					</p>
					<ul>
						<li>
							{__(
								'No installation required',
								'claudaborative-editing'
							)}
						</li>
						<li>
							{__(
								'Works from any device',
								'claudaborative-editing'
							)}
						</li>
						<li>
							{__('Automatic updates', 'claudaborative-editing')}
						</li>
					</ul>
					<div className="wpce-setup-modal-card-action">
						<ExternalLink href="https://claudaborative.cloud">
							{__(
								'Sign up at claudaborative.cloud',
								'claudaborative-editing'
							)}
						</ExternalLink>
					</div>
				</div>

				<div className="wpce-setup-modal-card wpce-setup-modal-card-local">
					<div className="wpce-setup-modal-card-header">
						<Icon icon={code} size={24} />
						<h3>
							{__('Set up locally', 'claudaborative-editing')}
						</h3>
					</div>
					<p>
						{__(
							'Run Claudaborative Editing on your own computer using Claude Code. Best for developers who prefer full control.',
							'claudaborative-editing'
						)}
					</p>
					<ul>
						<li>
							{__(
								'Runs on your machine',
								'claudaborative-editing'
							)}
						</li>
						<li>
							{__(
								'Full control over the connection',
								'claudaborative-editing'
							)}
						</li>
						<li>
							{__(
								'Requires Claude Code',
								'claudaborative-editing'
							)}
						</li>
					</ul>
					<div className="wpce-setup-modal-card-action">
						<div className="wpce-setup-modal-command-row">
							<code className="wpce-setup-modal-command">
								{SETUP_COMMAND}
							</code>
							<Button
								variant="tertiary"
								size="small"
								className="wpce-setup-modal-copy-button"
								onClick={handleCopy}
							>
								{copied
									? __('Copied!', 'claudaborative-editing')
									: __('Copy', 'claudaborative-editing')}
							</Button>
						</div>
					</div>
				</div>
			</div>
		</Modal>
	);
}
