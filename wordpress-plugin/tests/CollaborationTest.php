<?php
/**
 * Tests for the Collaboration class.
 */

namespace Claudaborative_Editing;

/**
 * Test Gutenberg real-time collaboration (RTC) enablement detection.
 */
class CollaborationTest extends \WP_UnitTestCase {

	/**
	 * Administrator user ID (for manage_options tests).
	 *
	 * @var int
	 */
	private static $admin_id;

	/**
	 * Subscriber user ID (for permission-denied tests).
	 *
	 * @var int
	 */
	private static $subscriber_id;

	/**
	 * Create shared fixtures once for all tests in this class.
	 *
	 * @param \WP_UnitTest_Factory $factory The factory instance.
	 * @return void
	 */
	public static function wpSetUpBeforeClass( \WP_UnitTest_Factory $factory ) {
		/** @var int $admin_id */
		$admin_id       = $factory->user->create( [ 'role' => 'administrator' ] );
		self::$admin_id = $admin_id;

		/** @var int $subscriber_id */
		$subscriber_id       = $factory->user->create( [ 'role' => 'subscriber' ] );
		self::$subscriber_id = $subscriber_id;
	}

	/**
	 * Clear the experiments option between tests, since Playground has no
	 * Gutenberg and is_collaboration_enabled() falls back to reading it.
	 */
	public function tear_down() {
		delete_option( Collaboration::EXPERIMENTS_OPTION );
		parent::tear_down();
	}

	// -------------------------------------------------------------------------
	// is_collaboration_enabled()
	// -------------------------------------------------------------------------

	/**
	 * No experiments option at all means the experiment is off.
	 */
	public function test_is_collaboration_enabled_false_without_option() {
		delete_option( Collaboration::EXPERIMENTS_OPTION );

		$this->assertFalse( Collaboration::is_collaboration_enabled() );
	}

	/**
	 * A boolean true value in the experiments option enables it.
	 */
	public function test_is_collaboration_enabled_true_with_bool_true() {
		update_option( Collaboration::EXPERIMENTS_OPTION, array( Collaboration::EXPERIMENT_ID => true ) );

		$this->assertTrue( Collaboration::is_collaboration_enabled() );
	}

	/**
	 * The Settings → Experiments page stores enabled experiments as the
	 * string '1', not a boolean.
	 */
	public function test_is_collaboration_enabled_true_with_string_one() {
		update_option( Collaboration::EXPERIMENTS_OPTION, array( Collaboration::EXPERIMENT_ID => '1' ) );

		$this->assertTrue( Collaboration::is_collaboration_enabled() );
	}

	/**
	 * An explicit false value in the experiments option keeps it off.
	 */
	public function test_is_collaboration_enabled_false_with_bool_false() {
		update_option( Collaboration::EXPERIMENTS_OPTION, array( Collaboration::EXPERIMENT_ID => false ) );

		$this->assertFalse( Collaboration::is_collaboration_enabled() );
	}

	/**
	 * A non-array option value (e.g. left over from a misbehaving plugin)
	 * is treated as the experiment being off, not a fatal error.
	 */
	public function test_is_collaboration_enabled_false_with_non_array_option() {
		update_option( Collaboration::EXPERIMENTS_OPTION, 'not-an-array' );

		$this->assertFalse( Collaboration::is_collaboration_enabled() );
	}

	// -------------------------------------------------------------------------
	// is_sync_route_registered()
	// -------------------------------------------------------------------------

	/**
	 * Nothing registers wp-sync/v1 in this plugin's own test suite, so a
	 * fresh REST server should not have the route.
	 */
	public function test_is_sync_route_registered_false_by_default() {
		$GLOBALS['wp_rest_server'] = null;
		rest_get_server();

		$this->assertFalse( Collaboration::is_sync_route_registered() );
	}

	/**
	 * With a stub route registered under wp-sync/v1, the route is found;
	 * once unregistered, a fresh server no longer has it.
	 */
	public function test_is_sync_route_registered_true_with_stub_route() {
		$register_stub_route = function () {
			register_rest_route(
				'wp-sync/v1',
				'/updates',
				array(
					'methods'             => 'POST',
					'callback'            => '__return_empty_array',
					'permission_callback' => '__return_true',
				)
			);
		};

		add_action( 'rest_api_init', $register_stub_route );

		$GLOBALS['wp_rest_server'] = null;
		rest_get_server();

		$this->assertTrue( Collaboration::is_sync_route_registered() );

		remove_action( 'rest_api_init', $register_stub_route );

		$GLOBALS['wp_rest_server'] = null;
		rest_get_server();

		$this->assertFalse( Collaboration::is_sync_route_registered() );
	}

	// -------------------------------------------------------------------------
	// build_status()
	// -------------------------------------------------------------------------

	/**
	 * build_status() with an active Gutenberg version reports the version
	 * and an experiments URL.
	 */
	public function test_build_status_gutenberg_active() {
		$status = Collaboration::build_status( '24.0.0', false, false, true );

		$this->assertTrue( $status['gutenberg_active'] );
		$this->assertSame( '24.0.0', $status['gutenberg_version'] );
		$this->assertFalse( $status['collaboration_enabled'] );
		$this->assertFalse( $status['sync_endpoint_registered'] );
		$this->assertTrue( $status['can_manage_options'] );
		$this->assertSame( admin_url( Collaboration::EXPERIMENTS_PAGE ), $status['experiments_url'] );
	}

	/**
	 * build_status() with no Gutenberg version reports everything as
	 * inactive/unavailable.
	 */
	public function test_build_status_gutenberg_inactive() {
		$status = Collaboration::build_status( null, false, false, false );

		$this->assertFalse( $status['gutenberg_active'] );
		$this->assertNull( $status['gutenberg_version'] );
		$this->assertNull( $status['experiments_url'] );
		$this->assertFalse( $status['can_manage_options'] );
	}

	// -------------------------------------------------------------------------
	// get_editor_state()
	// -------------------------------------------------------------------------

	/**
	 * A subscriber, on a site without Gutenberg, sees everything off/null.
	 */
	public function test_get_editor_state_subscriber_without_gutenberg() {
		delete_option( Collaboration::EXPERIMENTS_OPTION );
		wp_set_current_user( self::$subscriber_id );

		$this->assertSame(
			array(
				'gutenbergActive'      => false,
				'collaborationEnabled' => false,
				'canManageOptions'     => false,
				'experimentsUrl'       => null,
			),
			Collaboration::get_editor_state()
		);
	}

	/**
	 * An administrator, with the experiment enabled, sees the enabled and
	 * can-manage-options flags flip to true.
	 */
	public function test_get_editor_state_administrator_with_experiment_enabled() {
		update_option( Collaboration::EXPERIMENTS_OPTION, array( Collaboration::EXPERIMENT_ID => true ) );
		wp_set_current_user( self::$admin_id );

		$state = Collaboration::get_editor_state();

		$this->assertTrue( $state['collaborationEnabled'] );
		$this->assertTrue( $state['canManageOptions'] );
	}
}
