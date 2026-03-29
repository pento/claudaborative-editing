<?php
/**
 * Tests for the REST_Controller class.
 */

/**
 * Test the wpce/v1 REST API endpoints.
 */
class RestControllerTest extends WP_UnitTestCase {

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
	 * @param WP_UnitTest_Factory $factory The factory instance.
	 */
	public static function wpSetUpBeforeClass( WP_UnitTest_Factory $factory ) {
		self::$editor_id      = $factory->user->create( [ 'role' => 'editor' ] );
		self::$editor2_id     = $factory->user->create( [ 'role' => 'editor' ] );
		self::$subscriber_id  = $factory->user->create( [ 'role' => 'subscriber' ] );
		self::$target_post_id = $factory->post->create(
			[
				'post_author' => self::$editor_id,
				'post_status' => 'draft',
			]
		);
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
	 * @param array $params Override default command parameters.
	 * @return WP_REST_Response The response.
	 */
	private function create_command( $params = [] ) {
		$defaults = [
			'post_id' => self::$target_post_id,
			'prompt'  => 'review',
		];

		$request = new WP_REST_Request( 'POST', '/wpce/v1/commands' );
		$request->set_body_params( array_merge( $defaults, $params ) );

		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Create a command post directly in the database and return its ID.
	 *
	 * @param array $overrides Override defaults for the command.
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
		$this->assertArrayHasKey( 'created_at', $data );
		$this->assertArrayHasKey( 'updated_at', $data );
		$this->assertArrayHasKey( 'expires_at', $data );
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
		foreach ( REST_Controller::ALLOWED_PROMPTS as $prompt ) {
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

		$request  = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
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

		$request  = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
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

		$request = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
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

		$request = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
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

		$request  = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$response = rest_get_server()->dispatch( $request );

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
		$request  = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// PATCH /wpce/v1/commands/{id}
	// -------------------------------------------------------------------------

	/**
	 * Claiming a pending command transitions it to "claimed".
	 */
	public function test_claim_command() {
		$command_id = $this->create_command_directly();

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 'claimed', $data['status'] );
		$this->assertSame( self::$editor_id, $data['claimed_by'] );
	}

	/**
	 * Claiming an already-claimed command should return 409.
	 */
	public function test_double_claim_returns_conflict() {
		$command_id = $this->create_command_directly( [ 'status' => 'claimed' ] );

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Transitioning claimed → running should succeed.
	 */
	public function test_claimed_to_running() {
		$command_id = $this->create_command_directly( [ 'status' => 'claimed' ] );

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'running', $response->get_data()['status'] );
	}

	/**
	 * Transitioning running → completed should succeed, with a message.
	 */
	public function test_running_to_completed_with_message() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
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

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
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
	 * An invalid transition (pending → running) should be rejected.
	 */
	public function test_invalid_transition_pending_to_running() {
		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * An invalid transition (completed → claimed) should be rejected.
	 */
	public function test_invalid_transition_completed_to_claimed() {
		$command_id = $this->create_command_directly( [ 'status' => 'completed' ] );

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Updating a nonexistent command should return 404.
	 */
	public function test_update_nonexistent_command() {
		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/999999' );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 404, $response->get_status() );
	}

	/**
	 * A user cannot update another user's command.
	 */
	public function test_update_other_users_command() {
		$command_id = $this->create_command_directly( [ 'author' => self::$editor2_id ] );

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * Claiming an expired command should return 409.
	 */
	public function test_claim_expired_command() {
		$command_id = $this->create_command_directly(
			[ 'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) ]
		);

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// DELETE /wpce/v1/commands/{id}
	// -------------------------------------------------------------------------

	/**
	 * Cancelling a pending command should set status to "cancelled".
	 */
	public function test_cancel_pending_command() {
		$command_id = $this->create_command_directly();

		$request  = new WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'cancelled', $response->get_data()['status'] );
	}

	/**
	 * Cancelling a claimed command should set status to "cancelled".
	 */
	public function test_cancel_claimed_command() {
		$command_id = $this->create_command_directly( [ 'status' => 'claimed' ] );

		$request  = new WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'cancelled', $response->get_data()['status'] );
	}

	/**
	 * Cancelling a running command should fail with 400.
	 */
	public function test_cancel_running_command_fails() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request  = new WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * Cancelling a completed command should fail with 400.
	 */
	public function test_cancel_completed_command_fails() {
		$command_id = $this->create_command_directly( [ 'status' => 'completed' ] );

		$request  = new WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * A user cannot cancel another user's command.
	 */
	public function test_cancel_other_users_command() {
		$command_id = $this->create_command_directly( [ 'author' => self::$editor2_id ] );

		$request  = new WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * Cancelling a nonexistent command should return 404.
	 */
	public function test_cancel_nonexistent_command() {
		$request  = new WP_REST_Request( 'DELETE', '/wpce/v1/commands/999999' );
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
		$request  = new WP_REST_Request( 'GET', '/wpce/v1/status' );
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

		$request  = new WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$data = $response->get_data();
		$this->assertFalse( $data['mcp_connected'] );
		$this->assertNull( $data['mcp_last_seen_at'] );
	}

	/**
	 * MCP should show as connected after claiming a command.
	 */
	public function test_mcp_connected_after_claim() {
		$command_id = $this->create_command_directly();

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'claimed' ] );
		rest_get_server()->dispatch( $request );

		$request  = new WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertTrue( $response->get_data()['mcp_connected'] );
	}

	/**
	 * MCP should show as disconnected after the timeout elapses.
	 */
	public function test_mcp_disconnected_after_timeout() {
		$stale_time = gmdate( 'Y-m-d\TH:i:s\Z', time() - REST_Controller::MCP_TIMEOUT_SECONDS - 1 );
		set_transient( 'wpce_mcp_last_seen_' . self::$editor_id, $stale_time, 120 );

		$request  = new WP_REST_Request( 'GET', '/wpce/v1/status' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertFalse( $response->get_data()['mcp_connected'] );
	}

	/**
	 * A subscriber cannot access the status endpoint.
	 */
	public function test_status_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$request  = new WP_REST_Request( 'GET', '/wpce/v1/status' );
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
		$request  = new WP_REST_Request( 'GET', '/wpce/v1/commands/stream' );
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
		$this->create_command_directly( [ 'status' => 'claimed' ] );
		$this->create_command_directly( [ 'status' => 'running' ] );
		$this->create_command_directly( [ 'status' => 'completed' ] );

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
	 * Updating an expired claimed command should return 409 and expire it.
	 */
	public function test_update_expired_claimed_command() {
		$command_id = $this->create_command_directly(
			[
				'status'     => 'claimed',
				'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ),
			]
		);

		$request = new WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 409, $response->get_status() );
		$this->assertSame(
			'expired',
			get_post_meta( $command_id, 'wpce_command_status', true )
		);
	}

	/**
	 * The list endpoint should expire stale commands and update post_modified_gmt.
	 */
	public function test_list_commands_expiry_updates_modified_date() {
		$command_id = $this->create_command_directly(
			[ 'expires_at' => gmdate( 'Y-m-d\TH:i:s\Z', time() - 60 ) ]
		);

		$original_modified = get_post( $command_id )->post_modified_gmt;

		// Allow 1-second gap so post_modified_gmt can change.
		sleep( 1 );

		$request = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
		rest_get_server()->dispatch( $request );

		$updated_modified = get_post( $command_id )->post_modified_gmt;
		$this->assertNotSame( $original_modified, $updated_modified );
	}

	/**
	 * The since param should reject invalid date strings.
	 */
	public function test_list_commands_invalid_since_returns_400() {
		$request = new WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$request->set_param( 'since', 'not-a-date' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}
}
