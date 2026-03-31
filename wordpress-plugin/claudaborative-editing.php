<?php
/**
 * Plugin Name: Claudaborative Editing
 * Description: Adds AI action controls to the Gutenberg editor for use with the Claudaborative Editing MCP server.
 * Version: 0.1.0
 * Author: pento
 * Author URI: https://pento.net
 * License: GPL-2.0-or-later
 * Requires at least: 6.9
 * Requires PHP: 7.4
 * Text Domain: claudaborative-editing
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/includes/class-command-store.php';
require_once __DIR__ . '/includes/class-command-formatter.php';
require_once __DIR__ . '/includes/class-rest-controller.php';
require_once __DIR__ . '/includes/class-sse-handler.php';

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
		$asset_file = __DIR__ . '/build/ai-actions/index.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = require $asset_file;

		wp_enqueue_script(
			'claudaborative-editing-ai-actions',
			plugins_url( 'build/ai-actions/index.js', __FILE__ ),
			$asset['dependencies'],
			$asset['version'],
			true
		);

		$style_path = __DIR__ . '/build/ai-actions/style-index.css';

		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				'claudaborative-editing-ai-actions',
				plugins_url( 'build/ai-actions/style-index.css', __FILE__ ),
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

register_activation_hook( __FILE__, [ 'Claudaborative_Editing', 'activate' ] );
register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
