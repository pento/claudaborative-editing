<?php
/**
 * Plugin Name: Claudaborative Editing
 * Description: Adds AI action controls to the Gutenberg editor for use with the Claudaborative Editing MCP server.
 * Version: 0.4.1
 * Author: pento
 * Author URI: https://pento.net
 * License: GPL-2.0-or-later
 * Requires at least: 6.9
 * Requires PHP: 7.4
 * Text Domain: claudaborative-editing
 *
 * @package Claudaborative_Editing
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

spl_autoload_register(
	function ( $class_name ) {
		$prefix = 'Claudaborative_Editing\\';
		if ( 0 !== strpos( $class_name, $prefix ) ) {
			return;
		}
		$relative_class = substr( $class_name, strlen( $prefix ) );
		$file           = __DIR__ . '/includes/class-' . str_replace( '_', '-', strtolower( $relative_class ) ) . '.php';
		if ( file_exists( $file ) ) {
			require_once $file;
		}
	}
);

use Claudaborative_Editing\Command_Defs;
use Claudaborative_Editing\Command_Formatter;
use Claudaborative_Editing\Command_Store;
use Claudaborative_Editing\REST_Controller;

/**
 * Main plugin class.
 */
class Claudaborative_Editing {

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public static function register() {
		Command_Store::register_post_type();
		Command_Store::register_meta();

		register_meta(
			'comment',
			'wpce_source',
			[
				'type'              => 'string',
				'single'            => true,
				'default'           => '',
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
			]
		);
	}

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public static function register_rest_routes() {
		$controller = new REST_Controller();
		$controller->register_routes();
	}

	/**
	 * Enqueue block editor assets (JS + CSS).
	 *
	 * @return void
	 */
	public static function enqueue_editor_assets() {
		$asset_file = __DIR__ . '/build/index.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = require $asset_file;

		wp_enqueue_script(
			'claudaborative-editing-ai-actions',
			plugins_url( 'build/index.js', __FILE__ ),
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// Detect MCP connection at page load and reduce Gutenberg's solo
		// polling interval from 4s to 1s. This filter MUST run before
		// @wordpress/sync evaluates its config, so we inline it after
		// wp-hooks (which loads before wp-sync in the dependency graph).
		$mcp_connected = REST_Controller::is_mcp_connected_for_user( get_current_user_id() );
		wp_add_inline_script(
			'wp-hooks',
			'window.wpceInitialState = ' . wp_json_encode( array( 'mcpConnected' => $mcp_connected ) ) . ';' .
			( $mcp_connected
				? "wp.hooks.addFilter('sync.pollingManager.pollingInterval','claudaborative-editing/polling-interval',function(){return 1000;});"
				: ''
			)
		);

		$style_path = __DIR__ . '/build/style-index.css';

		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				'claudaborative-editing-ai-actions',
				plugins_url( 'build/style-index.css', __FILE__ ),
				[],
				$asset['version']
			);
		}

		wp_set_script_translations(
			'claudaborative-editing-ai-actions',
			'claudaborative-editing'
		);
	}

	/**
	 * Track MCP presence on sync endpoint requests.
	 *
	 * When the MCP server polls /wp-sync/v1/updates, it sends an
	 * X-WPCE-Client: mcp header. We detect this and update the
	 * last-seen transient so the editor can detect MCP on page load.
	 *
	 * @param mixed            $result  Response to replace the requested version with.
	 * @param \WP_REST_Server  $server  Server instance.
	 * @param \WP_REST_Request $request Request used to generate the response.
	 * @return mixed Unmodified $result.
	 */
	public static function track_mcp_sync( $result, $server, $request ) {
		if ( '/wp-sync/v1/updates' !== $request->get_route() ) {
			return $result;
		}
		if ( 'mcp' !== $request->get_header( 'x_wpce_client' ) ) {
			return $result;
		}
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return $result;
		}

		// Throttle transient writes — only update if stale or missing.
		if ( ! REST_Controller::is_mcp_connected_for_user( $user_id ) ) {
			set_transient(
				'wpce_mcp_last_seen_' . $user_id,
				gmdate( 'Y-m-d\TH:i:s\Z' ),
				REST_Controller::MCP_TIMEOUT_SECONDS * 2
			);
		}

		return $result;
	}

	/**
	 * Prepend an attribution label to MCP-sourced notes in REST API responses
	 * so the Gutenberg CommentBoard renders them with a visible indicator.
	 *
	 * Only applies when the request is for notes in edit context (the query
	 * Gutenberg's collaboration sidebar uses).
	 *
	 * @param WP_REST_Response $response The response object.
	 * @param WP_Comment       $comment  The comment object.
	 * @param WP_REST_Request  $request  The request object.
	 * @return WP_REST_Response
	 */
	public static function label_mcp_notes( $response, $comment, $request ) {
		if ( 'note' !== $request->get_param( 'type' ) ) {
			return $response;
		}

		if ( 'edit' !== $request->get_param( 'context' ) ) {
			return $response;
		}

		if ( 'mcp' !== get_comment_meta( (int) $comment->comment_ID, 'wpce_source', true ) ) {
			return $response;
		}

		$data = $response->get_data();

		if ( isset( $data['content']['rendered'] ) ) {
			$data['content']['rendered'] = '<p><em>' . esc_html__( '(Note generated by Claudaborative Editing)', 'claudaborative-editing' ) . '</em></p>' . $data['content']['rendered'];
			$response->set_data( $data );
		}

		return $response;
	}

	/**
	 * Plugin activation: register CPT before flushing rewrite rules.
	 *
	 * @return void
	 */
	public static function activate() {
		self::register();
		flush_rewrite_rules();
	}
}

add_action( 'init', [ 'Claudaborative_Editing', 'register' ] );
add_action( 'rest_api_init', [ 'Claudaborative_Editing', 'register_rest_routes' ] );
add_action( 'enqueue_block_editor_assets', [ 'Claudaborative_Editing', 'enqueue_editor_assets' ] );
add_filter( 'rest_prepare_comment', [ 'Claudaborative_Editing', 'label_mcp_notes' ], 10, 3 );
add_filter( 'rest_pre_dispatch', [ 'Claudaborative_Editing', 'track_mcp_sync' ], 10, 3 );

register_activation_hook( __FILE__, [ 'Claudaborative_Editing', 'activate' ] );
register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
