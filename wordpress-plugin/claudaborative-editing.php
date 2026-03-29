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

/**
 * Main plugin class.
 */
class Claudaborative_Editing {

	/**
	 * Register hooks.
	 */
	public static function register() {
		Command_Store::register_post_type();
		Command_Store::register_meta();
	}

	/**
	 * Plugin activation: register CPT before flushing rewrite rules.
	 */
	public static function activate() {
		self::register();
		flush_rewrite_rules();
	}
}

add_action( 'init', [ 'Claudaborative_Editing', 'register' ] );

register_activation_hook( __FILE__, [ 'Claudaborative_Editing', 'activate' ] );
register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
