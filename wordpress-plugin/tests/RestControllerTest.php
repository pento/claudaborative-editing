<?php
/**
 * Tests for the REST_Controller class.
 */

namespace Claudaborative_Editing;

/**
 * Test the wpce/v1 REST API endpoints.
 */
class RestControllerTest extends \WP_UnitTestCase {

	/**
	 * Editor user ID (primary test user).
	 *
	 * @var int
	 */
	private static $editor_id;

	/**
	 * Second editor user ID (for user-scoping tests).
	 *
	 * @var int
	 */
	private static $editor2_id;

	/**
	 * Subscriber user ID (for permission-denied tests).
	 *
	 * @var int
	 */
	private static $subscriber_id;

	/**
	 * A sample post ID that commands target.
	 *
	 * @var int
	 */
	private static $target_post_id;

	/**
	 * Create shared fixtures once for all tests in this class.
	 *
	 * @param \WP_UnitTest_Factory $factory The factory instance.
	 * @return void
	 */
	public static function wpSetUpBeforeClass( \WP_UnitTest_Factory $factory ) {
		/** @var int $editor_id */
		$editor_id       = $factory->user->create( [ 'role' => 'editor' ] );
		self::$editor_id = $editor_id;

		/** @var int $editor2_id */
		$editor2_id       = $factory->user->create( [ 'role' => 'editor' ] );
		self::$editor2_id = $editor2_id;

		/** @var int $subscriber_id */
		$subscriber_id       = $factory->user->create( [ 'role' => 'subscriber' ] );
		self::$subscriber_id = $subscriber_id;

		/** @var int $target_post_id */
		$target_post_id       = $factory->post->create(
			[
				'post_author' => self::$editor_id,
				'post_status' => 'draft',
			]
		);
		self::$target_post_id = $target_post_id;
	}

	/**
	 * Set up each test.
	 */
	public function set_up() {
		parent::set_up();
		Command_Store::register_meta();
		wp_set_current_user( self::$editor_id );
	}

	// -------------------------------------------------------------------------
	// Helper methods
	// -------------------------------------------------------------------------

	/**
	 * Create a command via the REST API and return the response.
	 *
	 * @param array<string, mixed> $params Override default command parameters.
	 * @return \WP_REST_Response The response.
	 */
	private function create_command( $params = [] ) {
		$defaults = [
			'post_id' => self::$target_post_id,
			'prompt'  => 'review',
		];

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/commands' );
		$request->set_body_params( array_merge( $defaults, $params ) );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Create a command post directly in the database and return its ID.
	 *
	 * @param array<string, mixed> $overrides Override defaults for the command.
	 * @return int The command post ID.
	 */
	private function create_command_directly( $overrides = [] ) {
		$defaults = [
			'author'     => self::$editor_id,
			'post_id'    => self::$target_post_id,
			'prompt'     => 'review',
			'arguments'  => '{}',
			'status'     => 'pending',
			'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() + REST_Controller::EXPIRY_MINUTES * MINUTE_IN_SECONDS ),
		];

		$opts = array_merge( $defaults, $overrides );

		/** @var int $command_id */
		$command_id = self::factory()->post->create(
			[
				'post_type'   => Command_Store::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => $opts['author'],
				'post_parent' => $opts['post_id'],
			]
		);

		update_post_meta( $command_id, 'wpce_prompt', $opts['prompt'] );
		update_post_meta( $command_id, 'wpce_arguments', $opts['arguments'] );
		update_post_meta( $command_id, 'wpce_command_status', $opts['status'] );
		update_post_meta( $command_id, 'wpce_expires_at', $opts['expires_at'] );

		return $command_id;
	}

	// -------------------------------------------------------------------------
	// POST /wpce/v1/commands
	// -------------------------------------------------------------------------

	/**
	 * Creating a command returns 201 with the correct shape.
	 */
	public function test_create_command_success() {
		$response = $this->create_command();

		$this->assertSame( 201, $response->get_status() );

		$data = $response->get_data();
		$this->assertArrayHasKey( 'id', $data );
		$this->assertSame( self::$target_post_id, $data['post_id'] );
		$this->assertSame( 'review', $data['prompt'] );
		$this->assertSame( 'pending', $data['status'] );
		$this->assertSame( self::$editor_id, $data['user_id'] );
		$this->assertNull( $data['claimed_by'] );
		$this->assertNull( $data['message'] );
		$this->assertIsObject( $data['arguments'] );
		$this->assertArrayHasKey( 'created_at', $data );
		$this->assertArrayHasKey( 'updated_at', $data );
		$this->assertArrayHasKey( 'expires_at', $data );
	}

	/**
	 * The default arguments should be an empty object, not an array.
	 */
	public function test_create_command_default_arguments_is_object() {
		$response = $this->create_command();
		$data     = $response->get_data();

		$this->assertIsObject( $data['arguments'] );
		$this->assertEquals( new \stdClass(), $data['arguments'] );
	}

	/**
	 * The expires_at field should be approximately 10 minutes in the future.
	 */
	public function test_create_command_sets_expiry() {
		$response   = $this->create_command();
		$data       = $response->get_data();
		$expires_at = strtotime( $data['expires_at'] );

		// Allow 5-second tolerance for test execution time.
		$expected = time() + ( REST_Controller::EXPIRY_MINUTES * 60 );
		$this->assertEqualsWithDelta( $expected, $expires_at, 5 );
	}

	/**
	 * Each allowed prompt value should be accepted.
	 */
	public function test_create_command_accepts_all_valid_prompts() {
		foreach ( Command_Defs::ALLOWED_PROMPTS as $prompt ) {
			$response = $this->create_command( [ 'prompt' => $prompt ] );
			$this->assertSame( 201, $response->get_status(), "Prompt '{$prompt}' should be accepted." );
		}
	}

	/**
	 * Custom arguments should be stored and returned.
	 */
	public function test_create_command_with_arguments() {
		$args     = [ 'editingFocus' => 'tone' ];
		$response = $this->create_command(
			[
				'prompt'    => 'edit',
				'arguments' => $args,
			]
		);

		$data = $response->get_data();
		$this->assertEquals( (object) $args, $data['arguments'] );
	}

	/**
	 * An invalid prompt value should be rejected with 400.
	 */
	public function test_create_command_invalid_prompt() {
		$response = $this->create_command( [ 'prompt' => 'hack' ] );
		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * A nonexistent target post should be rejected with 403.
	 */
	public function test_create_command_nonexistent_post() {
		$response = $this->create_command( [ 'post_id' => 999999 ] );
		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * A subscriber cannot create commands.
	 */
	public function test_create_command_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$response = $this->create_command();
		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * An unauthenticated request cannot create commands.
	 */
	public function test_create_command_unauthenticated() {
		wp_set_current_user( 0 );
		$response = $this->create_command();
		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// GET /wpce/v1/commands
	// -------------------------------------------------------------------------

	/**
	 * Listing commands returns only the current user's commands.
	 */
	public function test_list_commands_returns_own_commands() {
		$this->create_command_directly();
		$this->create_command_directly();

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertCount( 2, $response->get_data() );
	}

	/**
	 * Commands from another user should not appear in the listing.
	 */
	public function test_list_commands_excludes_other_users() {
		$this->create_command_directly();
		$this->create_command_directly( [ 'author' => self::$editor2_id ] );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$response = rest_get_server()->dispatch( $request );

		$data = $response->get_data();
		$this->assertCount( 1, $data );
		$this->assertSame( self::$editor_id, $data[0]['user_id'] );
	}

	/**
	 * Filtering by post_id should only return commands for that post.
	 */
	public function test_list_commands_filter_by_post_id() {
		$other_post = self::factory()->post->create( [ 'post_author' => self::$editor_id ] );

		$this->create_command_directly();
		$this->create_command_directly( [ 'post_id' => $other_post ] );

		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$request->set_param( 'post_id', self::$target_post_id );
		$response = rest_get_server()->dispatch( $request );

		$data = $response->get_data();
		$this->assertCount( 1, $data );
		$this->assertSame( self::$target_post_id, $data[0]['post_id'] );
	}

	/**
	 * Filtering by status should only return commands with that status.
	 */
	public function test_list_commands_filter_by_status() {
		$this->create_command_directly( [ 'status' => 'pending' ] );
		$this->create_command_directly( [ 'status' => 'completed' ] );

		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$request->set_param( 'status', 'completed' );
		$response = rest_get_server()->dispatch( $request );

		$data = $response->get_data();
		$this->assertCount( 1, $data );
		$this->assertSame( 'completed', $data[0]['status'] );
	}

	/**
	 * Expired pending commands should be lazily transitioned to "expired".
	 */
	public function test_list_commands_expires_stale() {
		$command_id = $this->create_command_directly(
			[ 'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) ]
		);

		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		rest_get_server()->dispatch( $request );

		$this->assertSame(
			'expired',
			get_post_meta( $command_id, 'wpce_command_status', true )
		);
	}

	/**
	 * A subscriber cannot list commands.
	 */
	public function test_list_commands_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// PATCH /wpce/v1/commands/{id}
	// -------------------------------------------------------------------------

	/**
	 * Transitioning running → completed should succeed, with a message.
	 */
	public function test_running_to_completed_with_message() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'  => 'completed',
				'message' => 'Review complete.',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 'completed', $data['status'] );
		$this->assertSame( 'Review complete.', $data['message'] );
	}

	/**
	 * Transitioning running → failed should succeed.
	 */
	public function test_running_to_failed() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'  => 'failed',
				'message' => 'Something went wrong.',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'failed', $response->get_data()['status'] );
	}

	/**
	 * Transitioning pending → running should succeed (atomic claim+run).
	 */
	public function test_pending_to_running() {
		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 'running', $data['status'] );
		$this->assertSame( self::$editor_id, $data['claimed_by'] );
	}

	/**
	 * A second pending → running request after one has already succeeded
	 * should return 409 (command is no longer pending).
	 */
	public function test_pending_to_running_rejects_after_already_running() {
		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		// First transition succeeds
		$request1 = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request1->set_body_params( [ 'status' => 'running' ] );
		$response1 = rest_get_server()->dispatch( $request1 );
		$this->assertSame( 200, $response1->get_status() );

		// Second attempt fails — command is no longer pending
		$request2 = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request2->set_body_params( [ 'status' => 'running' ] );
		$response2 = rest_get_server()->dispatch( $request2 );
		$this->assertSame( 409, $response2->get_status() );
	}

	/**
	 * An invalid transition (completed → running) should be rejected.
	 */
	public function test_invalid_transition_completed_to_running() {
		$command_id = $this->create_command_directly( [ 'status' => 'completed' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Updating a nonexistent command should return 404.
	 */
	public function test_update_nonexistent_command() {
		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/999999' );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 404, $response->get_status() );
	}

	/**
	 * A user cannot update another user's command.
	 */
	public function test_update_other_users_command() {
		$command_id = $this->create_command_directly( [ 'author' => self::$editor2_id ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * The atomic conditional update returns 409 when the DB status has
	 * changed since the meta cache was populated (simulates a concurrent
	 * transition by another process).
	 */
	public function test_pending_to_running_atomic_conflict() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		// Populate the WP object cache with 'pending'
		get_post_meta( $command_id, 'wpce_command_status', true );

		// Directly change the DB to 'running', bypassing the object cache.
		// This simulates another process winning the race.
		$wpdb->update(
			$wpdb->postmeta,
			[ 'meta_value' => 'running' ],
			[
				'post_id'    => $command_id,
				'meta_key'   => 'wpce_command_status',
				'meta_value' => 'pending',
			]
		);

		// The PATCH handler reads 'pending' from cache, passes the
		// transition check, but the atomic DB update finds 0 rows.
		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Running an expired command should return 409.
	 */
	public function test_run_expired_command() {
		$command_id = $this->create_command_directly(
			[ 'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) ]
		);

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// DELETE /wpce/v1/commands/{id}
	// -------------------------------------------------------------------------

	/**
	 * The atomic cancel returns 409 when the DB status changed since the
	 * meta cache was populated (simulates a concurrent run transition).
	 */
	public function test_cancel_atomic_conflict() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		// Populate the WP object cache with 'pending'
		get_post_meta( $command_id, 'wpce_command_status', true );

		// Directly change the DB to 'running', bypassing the object cache.
		$wpdb->update(
			$wpdb->postmeta,
			[ 'meta_value' => 'running' ],
			[
				'post_id'    => $command_id,
				'meta_key'   => 'wpce_command_status',
				'meta_value' => 'pending',
			]
		);

		// The DELETE handler reads 'pending' from cache, passes the check,
		// but the atomic DB update finds 0 rows.
		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Cancelling a pending command should set status to "cancelled".
	 */
	public function test_cancel_pending_command() {
		$command_id = $this->create_command_directly();

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'cancelled', $response->get_data()['status'] );
	}

	/**
	 * Cancelling a command that has already transitioned to running
	 * should fail (no longer pending).
	 */
	public function test_cancel_after_run_transition_fails() {
		$command_id = $this->create_command_directly();

		// Transition pending → running
		$run_request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$run_request->set_body_params( [ 'status' => 'running' ] );
		$run_response = rest_get_server()->dispatch( $run_request );
		$this->assertSame( 200, $run_response->get_status() );

		// Cancel should fail — command is no longer pending
		$cancel_request = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response       = rest_get_server()->dispatch( $cancel_request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * Cancelling a running command should fail with 400.
	 */
	public function test_cancel_running_command_fails() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * Cancelling a completed command should fail with 400.
	 */
	public function test_cancel_completed_command_fails() {
		$command_id = $this->create_command_directly( [ 'status' => 'completed' ] );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * A user cannot cancel another user's command.
	 */
	public function test_cancel_other_users_command() {
		$command_id = $this->create_command_directly( [ 'author' => self::$editor2_id ] );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * Cancelling a nonexistent command should return 404.
	 */
	public function test_cancel_nonexistent_command() {
		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/999999' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 404, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// GET /wpce/v1/status
	// -------------------------------------------------------------------------

	/**
	 * The status endpoint returns the expected shape.
	 */
	public function test_status_returns_expected_shape() {
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertArrayHasKey( 'version', $data );
		$this->assertArrayHasKey( 'protocol_version', $data );
		$this->assertArrayHasKey( 'mcp_connected', $data );
		$this->assertArrayHasKey( 'mcp_last_seen_at', $data );
	}

	/**
	 * MCP should not be connected initially.
	 */
	public function test_mcp_not_connected_initially() {
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$data = $response->get_data();
		$this->assertFalse( $data['mcp_connected'] );
		$this->assertNull( $data['mcp_last_seen_at'] );
	}

	/**
	 * MCP should show as connected after running a command.
	 */
	public function test_mcp_connected_after_running() {
		$command_id = $this->create_command_directly();

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		rest_get_server()->dispatch( $request );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertTrue( $response->get_data()['mcp_connected'] );
	}

	/**
	 * MCP should show as disconnected after the timeout elapses.
	 */
	public function test_mcp_disconnected_after_timeout() {
		$stale_time = gmdate( 'Y-m-d\TH:i:s\Z', time() - REST_Controller::MCP_TIMEOUT_SECONDS - 1 );
		set_transient( 'wpce_mcp_last_seen_' . self::$editor_id, $stale_time, 120 );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertFalse( $response->get_data()['mcp_connected'] );
	}

	/**
	 * A subscriber cannot access the status endpoint.
	 */
	public function test_status_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// GET /wpce/v1/commands/stream
	// -------------------------------------------------------------------------

	/**
	 * The stream route should be registered.
	 */
	public function test_stream_route_is_registered() {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/wpce/v1/commands/stream', $routes );
	}

	/**
	 * A subscriber cannot access the stream endpoint.
	 */
	public function test_stream_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/commands/stream' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// SSE_Handler::query_pending_commands (SSE poll loop query)
	// -------------------------------------------------------------------------

	/**
	 * The SSE query should find a pending command for the correct user.
	 */
	public function test_sse_query_finds_pending_command() {
		$command_id = $this->create_command_directly();

		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 1, $results );
		$this->assertSame( $command_id, $results[0]->ID );
	}

	/**
	 * The SSE query should not return commands from other users.
	 */
	public function test_sse_query_excludes_other_users() {
		$this->create_command_directly( [ 'author' => self::$editor2_id ] );

		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 0, $results );
	}

	/**
	 * The SSE query should not return non-pending commands.
	 */
	public function test_sse_query_excludes_non_pending() {
		$this->create_command_directly( [ 'status' => 'running' ] );
		$this->create_command_directly( [ 'status' => 'completed' ] );
		$this->create_command_directly( [ 'status' => 'failed' ] );

		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 0, $results );
	}

	/**
	 * The SSE query should respect the last_seen_id filter.
	 */
	public function test_sse_query_respects_last_seen_id() {
		$first_id  = $this->create_command_directly();
		$second_id = $this->create_command_directly();

		$results = SSE_Handler::query_pending_commands( self::$editor_id, $first_id );

		$this->assertCount( 1, $results );
		$this->assertSame( $second_id, $results[0]->ID );
	}

	/**
	 * Repeated SSE queries must see newly-created commands (no stale cache).
	 *
	 * This tests the cache_results=false behaviour that prevents the in-memory
	 * object cache from hiding commands created by other PHP processes.
	 */
	public function test_sse_query_not_affected_by_object_cache() {
		// First query — no commands exist yet.
		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );
		$this->assertCount( 0, $results );

		// Simulate a command created by a separate HTTP request (different
		// process), which writes directly to the database.
		$command_id = $this->create_command_directly();

		// Second query in the same PHP process — must see the new command.
		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );
		$this->assertCount( 1, $results );
		$this->assertSame( $command_id, $results[0]->ID );
	}

	/**
	 * The SSE query should return commands ordered by ID ascending.
	 */
	public function test_sse_query_orders_by_id_ascending() {
		$first_id  = $this->create_command_directly();
		$second_id = $this->create_command_directly();
		$third_id  = $this->create_command_directly();

		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 3, $results );
		$this->assertSame( $first_id, $results[0]->ID );
		$this->assertSame( $second_id, $results[1]->ID );
		$this->assertSame( $third_id, $results[2]->ID );
	}

	/**
	 * The SSE query should exclude expired pending commands.
	 */
	public function test_sse_query_excludes_expired_commands() {
		// Expired command — should not appear in results.
		$this->create_command_directly(
			[ 'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) ]
		);

		// Non-expired command — should appear.
		$active_id = $this->create_command_directly();

		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 1, $results );
		$this->assertSame( $active_id, $results[0]->ID );
	}

	/**
	 * The list endpoint should expire stale commands and update post_modified_gmt.
	 */
	public function test_list_commands_expiry_updates_modified_date() {
		global $wpdb;

		$command_id = $this->create_command_directly(
			[ 'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) ]
		);

		// Set a known old modified time so we can deterministically detect
		// an update without relying on sleep().
		$original_modified = '2000-01-01 00:00:00';
		$wpdb->update(
			$wpdb->posts,
			[
				'post_modified'     => $original_modified,
				'post_modified_gmt' => $original_modified,
			],
			[ 'ID' => $command_id ],
			[ '%s', '%s' ],
			[ '%d' ]
		);
		clean_post_cache( $command_id );

		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		rest_get_server()->dispatch( $request );

		$updated_modified = get_post( $command_id )->post_modified_gmt;
		$this->assertNotSame( $original_modified, $updated_modified );
	}

	/**
	 * The since param should reject invalid date strings.
	 */
	public function test_list_commands_invalid_since_returns_400() {
		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$request->set_param( 'since', 'not-a-date' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * The since param filters commands by modification date.
	 */
	public function test_list_commands_since_filter() {
		// Create two commands with different modification times.
		$old_id = $this->create_command_directly();
		$new_id = $this->create_command_directly();

		// Back-date the old command's post_modified_gmt.
		global $wpdb;
		$wpdb->update(
			$wpdb->posts,
			[ 'post_modified_gmt' => '2020-01-01 00:00:00' ],
			[ 'ID' => $old_id ]
		);
		clean_post_cache( $old_id );

		// Query with since = 1 minute ago — should exclude the back-dated command.
		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$request->set_param( 'since', gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$ids = array_column( $response->get_data(), 'id' );
		$this->assertContains( $new_id, $ids );
		$this->assertNotContains( $old_id, $ids );
	}

	/**
	 * A subscriber cannot cancel commands (no edit_posts capability).
	 */
	public function test_cancel_command_no_permission() {
		$command_id = $this->create_command_directly();

		wp_set_current_user( self::$subscriber_id );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// Edge cases: is_expired(), validate_status_transition(), format_date()
	// -------------------------------------------------------------------------

	/**
	 * A pending command with no expires_at meta should not be treated as expired.
	 */
	public function test_update_command_without_expires_at_not_expired() {
		$command_id = $this->create_command_directly();

		// Remove the expires_at meta to exercise the is_expired() false path.
		delete_post_meta( $command_id, 'wpce_expires_at' );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'running', $response->get_data()['status'] );
	}

	/**
	 * Transitioning from an unknown status should return 409.
	 */
	public function test_update_command_with_unknown_current_status() {
		$command_id = $this->create_command_directly( [ 'status' => 'bogus_status' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * format_date() should fall back to epoch when strtotime() returns false.
	 *
	 * Calls the private method directly via reflection to bypass MySQL's
	 * datetime normalization (MySQL converts invalid dates to 0000-00-00).
	 */
	public function test_command_formatter_handles_invalid_date() {
		$ref = new \ReflectionMethod( Command_Formatter::class, 'format_date' );

		$result = $ref->invoke( null, 'not-a-date' );

		$this->assertSame( '1970-01-01T00:00:00Z', $result );
	}

	/**
	 * The status endpoint should return a version string.
	 */
	public function test_status_returns_version_string() {
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$data = $response->get_data();
		$this->assertIsString( $data['version'] );
		$this->assertNotEmpty( $data['version'] );
	}
}
