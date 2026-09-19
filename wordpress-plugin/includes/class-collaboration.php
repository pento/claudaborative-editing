<?php
/**
 * Collaboration — detects Gutenberg real-time collaboration (RTC) enablement.
 *
 * @package Claudaborative_Editing
 */

namespace Claudaborative_Editing;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Reports whether Gutenberg's real-time collaboration experiment is active
 * on this site, for the status REST endpoint and the block editor.
 *
 * Real-time collaboration is a Gutenberg experiment (since 23.8, PR #80658),
 * off by default. WordPress core has never shipped it. See
 * is_collaboration_enabled() for how enablement is detected.
 */
final class Collaboration {

	/**
	 * Gutenberg experiment id for real-time collaboration.
	 */
	const EXPERIMENT_ID = 'gutenberg-real-time-collaboration';

	/**
	 * Site option storing which Gutenberg experiments are enabled.
	 */
	const EXPERIMENTS_OPTION = 'gutenberg-experiments';

	/**
	 * Admin page (relative to wp-admin/) where experiments are toggled.
	 */
	const EXPERIMENTS_PAGE = 'options-general.php?page=experiments-wp-admin';

	/**
	 * REST namespace Gutenberg registers the sync endpoint under.
	 */
	const SYNC_NAMESPACE = 'wp-sync/v1';

	/**
	 * REST route the MCP server polls for collaborative updates.
	 */
	const SYNC_ROUTE = '/wp-sync/v1/updates';

	/**
	 * Get the active Gutenberg plugin version, if any.
	 *
	 * @return string|null Gutenberg version, or null if the plugin is not active.
	 */
	public static function get_gutenberg_version(): ?string {
		// constant() avoids a PHPStan "constant not found" without a Gutenberg stub.
		return defined( 'GUTENBERG_VERSION' ) ? (string) constant( 'GUTENBERG_VERSION' ) : null;
	}

	/**
	 * Whether the real-time collaboration experiment is enabled.
	 *
	 * Prefers Gutenberg's own gate when it exists, so this stays correct if
	 * the gate ever changes upstream (including graduation out of the
	 * experiments system). Falls back to mirroring
	 * gutenberg_is_experiment_enabled() by reading the experiments option
	 * directly, which is what runs in this plugin's own test suite (no
	 * Gutenberg in Playground).
	 *
	 * @return bool True if real-time collaboration is enabled.
	 */
	public static function is_collaboration_enabled(): bool {
		if ( function_exists( 'wp_is_collaboration_enabled' ) ) {
			return (bool) wp_is_collaboration_enabled();
		}

		$experiments = get_option( self::EXPERIMENTS_OPTION );

		return is_array( $experiments ) && ! empty( $experiments[ self::EXPERIMENT_ID ] );
	}

	/**
	 * Whether the sync endpoint route is registered on this request.
	 *
	 * Call only from within a REST request: outside one, rest_get_server()
	 * would boot the entire route table.
	 *
	 * @return bool True if /wp-sync/v1/updates is registered.
	 */
	public static function is_sync_route_registered(): bool {
		$routes = rest_get_server()->get_routes( self::SYNC_NAMESPACE );

		return isset( $routes[ self::SYNC_ROUTE ] );
	}

	/**
	 * Build the Settings → Experiments admin URL.
	 *
	 * @param string|null $gutenberg_version Active Gutenberg version, or null.
	 * @return string|null Admin URL, or null if Gutenberg is not active.
	 */
	public static function get_experiments_url( ?string $gutenberg_version ): ?string {
		return null === $gutenberg_version ? null : admin_url( self::EXPERIMENTS_PAGE );
	}

	/**
	 * Build the collaboration status for the /wpce/v1/status REST response.
	 *
	 * @return array<string, mixed> Collaboration status, snake_case keys.
	 */
	public static function get_status(): array {
		return self::build_status(
			self::get_gutenberg_version(),
			self::is_collaboration_enabled(),
			self::is_sync_route_registered(),
			current_user_can( 'manage_options' )
		);
	}

	/**
	 * Build the collaboration state localised for the block editor.
	 *
	 * Never touches the REST server, so it is safe to call from
	 * enqueue_block_editor_assets().
	 *
	 * @return array<string, mixed> Collaboration state, camelCase keys.
	 */
	public static function get_editor_state(): array {
		$v = self::get_gutenberg_version();

		return array(
			'gutenbergActive'      => null !== $v,
			'collaborationEnabled' => self::is_collaboration_enabled(),
			'canManageOptions'     => current_user_can( 'manage_options' ),
			'experimentsUrl'       => self::get_experiments_url( $v ),
		);
	}

	/**
	 * Assemble the collaboration status array from its component values.
	 *
	 * Public so the Gutenberg-active branch is unit-testable: once
	 * GUTENBERG_VERSION is defined by a test, it cannot be un-defined.
	 *
	 * @internal
	 *
	 * @param string|null $v          Active Gutenberg version, or null.
	 * @param bool        $enabled    Whether the experiment is enabled.
	 * @param bool        $registered Whether the sync route is registered.
	 * @param bool        $can_manage Whether the current user can manage options.
	 * @return array<string, mixed> Collaboration status, snake_case keys.
	 */
	public static function build_status( ?string $v, bool $enabled, bool $registered, bool $can_manage ): array {
		return array(
			'gutenberg_active'         => null !== $v,
			'gutenberg_version'        => $v,
			'collaboration_enabled'    => $enabled,
			'sync_endpoint_registered' => $registered,
			'can_manage_options'       => $can_manage,
			'experiments_url'          => self::get_experiments_url( $v ),
		);
	}
}
