<?php
/**
 * PHPUnit bootstrap file.
 *
 * Runs under wp-playground-cli. Playground has already installed WordPress against a
 * fresh SQLite DB by the time this bootstrap fires, so we skip the WP test library's
 * default install path — which forks a child PHP worker via system() that Playground
 * cannot currently satisfy (mount propagation + file-lock contention). Between-run
 * isolation relies on the test library's _delete_all_posts() call during setup, and
 * wp-tests-config.php matches the default 'wp_' table prefix so is_blog_installed()
 * is happy.
 */

putenv( 'WP_TESTS_SKIP_INSTALL=1' );

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Determine the WordPress tests directory.
$_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $_tests_dir && defined( 'WP_TESTS_DIR' ) ) {
	$_tests_dir = WP_TESTS_DIR;
}

if ( ! $_tests_dir ) {
	// Default mount point used by `npm run test:plugin-php`.
	$_tests_dir = '/wordpress-phpunit';

	if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
		$_tests_dir = rtrim( sys_get_temp_dir(), '/\\' ) . '/wordpress-tests-lib';
	}
}

if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
	echo "Could not find {$_tests_dir}/includes/functions.php\n";
	exit( 1 );
}

// Give access to tests_add_filter() function.
require_once $_tests_dir . '/includes/functions.php';

// Start up the WP testing environment. The plugin is activated via
// playground/phpunit.blueprint.json, so the test library's wp-settings.php
// load picks it up on the regular plugins_loaded sequence.
require $_tests_dir . '/includes/bootstrap.php';
