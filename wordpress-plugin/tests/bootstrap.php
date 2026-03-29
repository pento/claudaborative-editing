<?php
/**
 * PHPUnit bootstrap file.
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// Determine the WordPress tests directory.
$_tests_dir = getenv( 'WP_TESTS_DIR' );

if ( ! $_tests_dir ) {
	// Default for wp-env.
	$_tests_dir = '/tmp/wordpress-tests-lib';

	if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
		// Try the system-level path used by wp-env.
		$_tests_dir = rtrim( sys_get_temp_dir(), '/\\' ) . '/wordpress-tests-lib';
	}
}

if ( ! file_exists( $_tests_dir . '/includes/functions.php' ) ) {
	echo "Could not find {$_tests_dir}/includes/functions.php\n";
	exit( 1 );
}

// Give access to tests_add_filter() function.
require_once $_tests_dir . '/includes/functions.php';

/**
 * Manually load the plugin being tested.
 *
 * @return void
 */
function _manually_load_plugin() {
	require dirname( __DIR__ ) . '/claudaborative-editing.php';
}

tests_add_filter( 'muplugins_loaded', '_manually_load_plugin' );

// Start up the WP testing environment.
require $_tests_dir . '/includes/bootstrap.php';
