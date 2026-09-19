/**
 * Notice shown when real-time collaboration (RTC) is not enabled on the
 * site, so the companion plugin cannot connect regardless of whether the
 * MCP server itself is reachable.
 *
 * Never force-enables the experiment and never writes to the site's
 * settings — it only guides the user (or, if they can't act on it, tells
 * them to ask an administrator) to Settings → Experiments.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Notice, ExternalLink } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { getCollaborationState } from '../../sync/collaboration';
// Styles are imported via ConnectionStatus/style.scss to ensure
// they land in the extracted style-index.css stylesheet.

/**
 * CollaborationNotice component.
 *
 * Renders nothing when the collaboration state hasn't been localised
 * (older plugin/PHP builds) or when RTC is already enabled. Otherwise
 * renders a warning notice with guidance tailored to whether Gutenberg is
 * active and whether the current user can manage options.
 *
 * @return Rendered notice, or null.
 */
export default function CollaborationNotice() {
	const state = getCollaborationState();

	if (!state || state.collaborationEnabled) {
		return null;
	}

	const { gutenbergActive, canManageOptions, experimentsUrl } = state;

	let guidance;
	if (gutenbergActive && canManageOptions && experimentsUrl) {
		guidance = (
			<ExternalLink href={experimentsUrl}>
				{__(
					'Turn on “Enable real-time collaboration” under Settings → Experiments',
					'claudaborative-editing'
				)}
			</ExternalLink>
		);
	} else if (gutenbergActive) {
		guidance = __(
			'Ask an administrator to turn on “Enable real-time collaboration” under Settings → Experiments.',
			'claudaborative-editing'
		);
	} else if (canManageOptions) {
		guidance = __(
			'Install and activate the Gutenberg plugin (23.8 or later), then turn on “Enable real-time collaboration” under Settings → Experiments.',
			'claudaborative-editing'
		);
	} else {
		guidance = __(
			'Ask an administrator to install the Gutenberg plugin (23.8 or later) and turn on “Enable real-time collaboration” under Settings → Experiments.',
			'claudaborative-editing'
		);
	}

	return (
		<Notice
			status="warning"
			isDismissible={false}
			className="wpce-collaboration-notice"
		>
			<p>
				{__(
					'Real-time collaboration is not enabled on this site, so Claudaborative Editing cannot connect.',
					'claudaborative-editing'
				)}
			</p>
			<p>{guidance}</p>
		</Notice>
	);
}
