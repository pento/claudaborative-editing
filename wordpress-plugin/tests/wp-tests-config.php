<?php
/**
 * Test config loaded by the WordPress PHPUnit test library when the plugin
 * tests run under wp-playground-cli. Paths reference the in-VFS layout set up
 * by the mounts in the repo-root `test:plugin-php` script; the plugin-local
 * `test:php` script just delegates to it.
 *
 * SQLite is provided by Playground's SQLite integration preload; the DB_*
 * constants below are unused but are required by the test bootstrap.
 */

// These constants are normally set by Playground's boot (via defineConstant).
// Guard each with a defined() check so re-requiring this file under the WP test
// lib bootstrap doesn't re-declare them.
defined( 'ABSPATH' ) || define( 'ABSPATH', '/wordpress/' );

defined( 'WP_DEFAULT_THEME' ) || define( 'WP_DEFAULT_THEME', 'default' );

defined( 'WP_DEBUG' ) || define( 'WP_DEBUG', true );

defined( 'DB_NAME' ) || define( 'DB_NAME', 'wordpress' );
defined( 'DB_USER' ) || define( 'DB_USER', 'root' );
defined( 'DB_PASSWORD' ) || define( 'DB_PASSWORD', '' );
defined( 'DB_HOST' ) || define( 'DB_HOST', 'localhost' );
defined( 'DB_CHARSET' ) || define( 'DB_CHARSET', 'utf8mb4' );
defined( 'DB_COLLATE' ) || define( 'DB_COLLATE', '' );

defined( 'AUTH_KEY' ) || define( 'AUTH_KEY', 'claudaborative-tests auth key' );
defined( 'SECURE_AUTH_KEY' ) || define( 'SECURE_AUTH_KEY', 'claudaborative-tests secure auth key' );
defined( 'LOGGED_IN_KEY' ) || define( 'LOGGED_IN_KEY', 'claudaborative-tests logged in key' );
defined( 'NONCE_KEY' ) || define( 'NONCE_KEY', 'claudaborative-tests nonce key' );
defined( 'AUTH_SALT' ) || define( 'AUTH_SALT', 'claudaborative-tests auth salt' );
defined( 'SECURE_AUTH_SALT' ) || define( 'SECURE_AUTH_SALT', 'claudaborative-tests secure auth salt' );
defined( 'LOGGED_IN_SALT' ) || define( 'LOGGED_IN_SALT', 'claudaborative-tests logged in salt' );
defined( 'NONCE_SALT' ) || define( 'NONCE_SALT', 'claudaborative-tests nonce salt' );

// Playground already installed WordPress with the default 'wp_' prefix on every
// boot, and we skip the test library's reinstall. Using a matching prefix means
// is_blog_installed() finds the options table and skips wp_not_installed()'s
// redirect-and-die path.
$table_prefix = 'wp_';

defined( 'WP_TESTS_DOMAIN' ) || define( 'WP_TESTS_DOMAIN', 'example.org' );
defined( 'WP_TESTS_EMAIL' ) || define( 'WP_TESTS_EMAIL', 'admin@example.org' );
defined( 'WP_TESTS_TITLE' ) || define( 'WP_TESTS_TITLE', 'Claudaborative Editing Tests' );

defined( 'WP_PHP_BINARY' ) || define( 'WP_PHP_BINARY', 'php' );

defined( 'WPLANG' ) || define( 'WPLANG', '' );
