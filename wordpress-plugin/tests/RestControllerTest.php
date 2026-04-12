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

		/** @var int $admin_id */
		$admin_id       = $factory->user->create( [ 'role' => 'administrator' ] );
		self::$admin_id = $admin_id;

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

	/**
	 * Completing a command with result_data returns decoded JSON in the response.
	 */
	public function test_complete_with_result_data() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$result_json = '{"checks":[{"name":"seo","passed":true}],"score":85}';

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'      => 'completed',
				'message'     => 'Check complete.',
				'result_data' => $result_json,
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 'completed', $data['status'] );
		$this->assertSame( 'Check complete.', $data['message'] );

		// result_data should be decoded JSON in the response.
		$this->assertIsObject( $data['result_data'] );
		$encoded = wp_json_encode( $data['result_data'] );
		$this->assertIsString( $encoded );
		$result_array = json_decode( $encoded, true );
		$this->assertSame( 85, $result_array['score'] );
		$this->assertIsArray( $result_array['checks'] );

		// The stored meta value should be valid JSON.
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$this->assertNotEmpty( $stored );
		$stored_array = json_decode( $stored, true );
		$this->assertIsArray( $stored_array );
		$this->assertSame( 85, $stored_array['score'] );
	}

	/**
	 * Completing a command without result_data returns the default empty object.
	 */
	public function test_complete_without_result_data() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'  => 'completed',
				'message' => 'Done.',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		// The registered default for wpce_result_data is '{}', which the
		// formatter decodes into an empty stdClass object.
		$data = $response->get_data();
		$this->assertIsObject( $data['result_data'] );
		$this->assertEquals( new \stdClass(), $data['result_data'] );
	}

	/**
	 * The pre-publish-check prompt should be accepted.
	 */
	public function test_create_command_with_pre_publish_check_prompt() {
		$response = $this->create_command( [ 'prompt' => 'pre-publish-check' ] );

		$this->assertSame( 201, $response->get_status() );
		$this->assertSame( 'pre-publish-check', $response->get_data()['prompt'] );
	}

	/**
	 * Invalid JSON sent as result_data should be rejected.
	 */
	public function test_result_data_rejects_invalid_json() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'      => 'completed',
				'result_data' => 'not valid json',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		// validate_callback rejects non-object JSON.
		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * JSON arrays sent as result_data should be rejected (only objects accepted).
	 */
	public function test_result_data_rejects_json_arrays() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'      => 'completed',
				'result_data' => '["an","array"]',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		// validate_callback rejects JSON arrays.
		$this->assertSame( 400, $response->get_status() );
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

	// -------------------------------------------------------------------------
	// GET /wpce/v1/sync-entity
	// -------------------------------------------------------------------------

	/**
	 * The sync-entity endpoint returns an empty array.
	 */
	public function test_sync_entity_returns_empty_array() {
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/sync-entity' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( [], $response->get_data() );
	}

	/**
	 * A subscriber cannot access the sync-entity endpoint.
	 */
	public function test_sync_entity_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/sync-entity' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// GET /wpce/v1/sync-entity/{id}
	// -------------------------------------------------------------------------

	/**
	 * The sync-entity single endpoint returns the requested ID.
	 */
	public function test_sync_entity_single_returns_id() {
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/sync-entity/42' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( [ 'id' => 42 ], $response->get_data() );
	}

	/**
	 * A subscriber cannot access the sync-entity single endpoint.
	 */
	public function test_sync_entity_single_no_permission() {
		wp_set_current_user( self::$subscriber_id );
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/sync-entity/42' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// PATCH /wpce/v1/commands/{id} — awaiting_input transitions
	// -------------------------------------------------------------------------

	/**
	 * Transitioning running → awaiting_input with a message should append
	 * the message to conversation history and merge result_data flags.
	 */
	public function test_running_to_awaiting_input_appends_conversation_message() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'      => 'awaiting_input',
				'message'     => 'What color do you prefer?',
				'result_data' => '{"planReady":true}',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 'awaiting_input', $data['status'] );
		$this->assertSame( 'What color do you prefer?', $data['message'] );

		// Verify the result_data contains the assistant message and the merged flag.
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertIsArray( $parsed['messages'] );
		$this->assertCount( 1, $parsed['messages'] );
		$this->assertSame( 'assistant', $parsed['messages'][0]['role'] );
		$this->assertSame( 'What color do you prefer?', $parsed['messages'][0]['content'] );
		$this->assertTrue( $parsed['planReady'] );
	}

	/**
	 * merge_result_data_flags merges non-messages fields without overwriting
	 * the existing messages array.
	 */
	public function test_merge_result_data_flags_preserves_messages() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		// First transition to awaiting_input with a message.
		$request1 = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request1->set_body_params(
			[
				'status'  => 'awaiting_input',
				'message' => 'First question',
			]
		);
		rest_get_server()->dispatch( $request1 );

		// Respond to move back to running.
		update_post_meta( $command_id, 'wpce_command_status', 'running' );
		wp_cache_delete( $command_id, 'post_meta' );

		// Second transition to awaiting_input with a flag.
		update_post_meta( $command_id, 'wpce_command_status', 'running' );
		wp_cache_delete( $command_id, 'post_meta' );

		$request2 = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request2->set_body_params(
			[
				'status'      => 'awaiting_input',
				'message'     => 'Second question',
				'result_data' => '{"planReady":true,"messages":["should-be-ignored"]}',
			]
		);
		rest_get_server()->dispatch( $request2 );

		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		// Messages should contain the appended conversation entries, not the
		// client-provided messages array.
		$this->assertIsArray( $parsed['messages'] );
		foreach ( $parsed['messages'] as $msg ) {
			$this->assertIsArray( $msg );
			$this->assertArrayHasKey( 'role', $msg );
		}

		// The planReady flag should have been merged.
		$this->assertTrue( $parsed['planReady'] );
	}

	/**
	 * append_conversation_message uses add_post_meta fallback when the
	 * meta row does not exist yet.
	 */
	public function test_append_conversation_message_fallback_to_add_post_meta() {
		$command_id = $this->create_command_directly(
			[
				'status'      => 'awaiting_input',
				'result_data' => '{}',
			]
		);

		// Delete the result_data meta so the $wpdb->update finds 0 rows.
		delete_post_meta( $command_id, 'wpce_result_data' );

		$response = ( new \WP_REST_Request( 'POST', '/wpce/v1/commands/' . $command_id . '/respond' ) );
		$response->set_body_params( [ 'message' => 'Test fallback' ] );
		$result = rest_get_server()->dispatch( $response );

		$this->assertSame( 200, $result->get_status() );

		// The meta should now exist (created via add_post_meta fallback).
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertIsArray( $parsed['messages'] );
		$this->assertCount( 1, $parsed['messages'] );
		$this->assertSame( 'user', $parsed['messages'][0]['role'] );
	}

	// -------------------------------------------------------------------------
	// Error paths and edge cases for uncovered lines
	// -------------------------------------------------------------------------

	/**
	 * create_command returns a WP_Error when wp_insert_post fails.
	 *
	 * Uses the wp_insert_post_empty_content filter to force wp_insert_post
	 * to return a WP_Error.
	 */
	public function test_create_command_returns_error_when_wp_insert_post_fails() {
		$filter = function () {
			return true;
		};
		add_filter( 'wp_insert_post_empty_content', $filter );

		$response = $this->create_command();

		remove_filter( 'wp_insert_post_empty_content', $filter );

		$this->assertSame( 500, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'empty_content', $data['code'] );
	}

	/**
	 * update_command returns 500 when $wpdb->update returns false during
	 * the pending -> running CAS.
	 *
	 * Intercepts the SQL query to replace the postmeta table name with a
	 * nonexistent table, causing the DB query to fail.
	 */
	public function test_update_command_returns_500_on_db_error_during_pending_cas() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		$filter = function ( $sql ) use ( &$filter ) {
			global $wpdb;
			if ( str_contains( $sql, 'UPDATE' ) && str_contains( $sql, 'wpce_command_status' ) ) {
				remove_filter( 'query', $filter );
				return str_replace( $wpdb->postmeta, 'nonexistent_table_xyz', $sql );
			}
			return $sql;
		};

		$wpdb->suppress_errors( true );
		add_filter( 'query', $filter );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params( [ 'status' => 'running' ] );
		$response = rest_get_server()->dispatch( $request );

		$wpdb->suppress_errors( false );
		// Safety cleanup in case the filter was never triggered.
		remove_filter( 'query', $filter );

		$this->assertSame( 500, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_update_failed', $data['code'] );
	}

	/**
	 * delete_command (cancel) returns 500 when $wpdb->update returns false
	 * during the atomic cancel CAS.
	 */
	public function test_cancel_command_returns_500_on_db_error() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'pending' ] );

		$filter = function ( $sql ) use ( &$filter ) {
			global $wpdb;
			if ( str_contains( $sql, 'UPDATE' ) && str_contains( $sql, 'wpce_command_status' ) ) {
				remove_filter( 'query', $filter );
				return str_replace( $wpdb->postmeta, 'nonexistent_table_xyz', $sql );
			}
			return $sql;
		};

		$wpdb->suppress_errors( true );
		add_filter( 'query', $filter );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/commands/' . $command_id );
		$response = rest_get_server()->dispatch( $request );

		$wpdb->suppress_errors( false );
		remove_filter( 'query', $filter );

		$this->assertSame( 500, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_update_failed', $data['code'] );
	}

	/**
	 * respond_to_command returns 404 for a nonexistent command when called
	 * directly on the controller (bypasses permissions check).
	 *
	 * This covers the defensive not-found check inside respond_to_command
	 * that is normally unreachable via REST dispatch because
	 * respond_command_permissions catches it first.
	 */
	public function test_respond_handler_returns_404_for_nonexistent_command() {
		$controller = new REST_Controller();

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/commands/999999/respond' );
		$request->set_url_params( [ 'id' => 999999 ] );
		$request->set_body_params( [ 'message' => 'test' ] );

		$result = $controller->respond_to_command( $request );

		$this->assertWPError( $result );
		$this->assertSame( 'rest_not_found', $result->get_error_code() );
	}

	/**
	 * respond_to_command returns 500 when $wpdb->update returns false during
	 * the awaiting_input -> running CAS.
	 */
	public function test_respond_returns_500_on_db_error_during_cas() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'awaiting_input' ] );
		update_post_meta( $command_id, 'wpce_result_data', '{}' );

		$filter = function ( $sql ) use ( &$filter ) {
			global $wpdb;
			if ( str_contains( $sql, 'UPDATE' ) && str_contains( $sql, 'wpce_command_status' ) ) {
				remove_filter( 'query', $filter );
				return str_replace( $wpdb->postmeta, 'nonexistent_table_xyz', $sql );
			}
			return $sql;
		};

		$wpdb->suppress_errors( true );
		add_filter( 'query', $filter );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/commands/' . $command_id . '/respond' );
		$request->set_body_params( [ 'message' => 'My response.' ] );
		$response = rest_get_server()->dispatch( $request );

		$wpdb->suppress_errors( false );
		remove_filter( 'query', $filter );

		$this->assertSame( 500, $response->get_status() );
		$data = $response->get_data();
		$this->assertSame( 'rest_update_failed', $data['code'] );
	}

	/**
	 * append_conversation_message handles corrupted (non-JSON) result_data
	 * by resetting to an empty array and still appending the message.
	 *
	 * Covers line 796: if ( ! is_array( $result_data ) ) { $result_data = array(); }
	 */
	public function test_append_message_handles_corrupted_result_data() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'awaiting_input' ] );

		// Ensure result_data meta exists first (via normal path).
		update_post_meta( $command_id, 'wpce_result_data', '{}' );

		// Corrupt the stored value directly via $wpdb to bypass the
		// registered sanitize_json callback that would normalize it.
		$wpdb->update(
			$wpdb->postmeta,
			[ 'meta_value' => 'not-json' ],
			[
				'post_id'  => $command_id,
				'meta_key' => 'wpce_result_data',
			]
		);
		wp_cache_delete( $command_id, 'post_meta' );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/commands/' . $command_id . '/respond' );
		$request->set_body_params( [ 'message' => 'Recovery test.' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		// The result_data should have been reset and the message appended.
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertIsArray( $parsed );
		$this->assertIsArray( $parsed['messages'] );
		$this->assertCount( 1, $parsed['messages'] );
		$this->assertSame( 'user', $parsed['messages'][0]['role'] );
	}

	/**
	 * merge_result_data_flags skips processing when client result_data is
	 * invalid JSON (non-array after decoding).
	 *
	 * Covers line 850: if ( ! is_array( $client_data ) ) { return; }
	 *
	 * Calls update_command directly on the controller to bypass REST
	 * argument validation (which rejects non-object JSON before the
	 * handler runs).
	 */
	public function test_merge_result_data_flags_skips_invalid_json() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );
		update_post_meta( $command_id, 'wpce_result_data', '{"existing":"value"}' );

		$controller = new REST_Controller();

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_url_params( [ 'id' => $command_id ] );
		$request->set_body_params(
			[
				'status'      => 'awaiting_input',
				'message'     => 'A question.',
				'result_data' => 'not-json',
			]
		);
		$result = $controller->update_command( $request );

		$this->assertNotWPError( $result );

		// The existing result_data should be unchanged (aside from the
		// appended conversation message), proving the merge was skipped.
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertSame( 'value', $parsed['existing'] );
		$this->assertIsArray( $parsed['messages'] );
	}

	/**
	 * merge_result_data_flags skips processing when client result_data
	 * contains only a messages key (empty after removing messages).
	 *
	 * Covers line 857: if ( empty( $client_data ) ) { return; }
	 */
	public function test_merge_result_data_flags_skips_when_only_messages() {
		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );
		update_post_meta( $command_id, 'wpce_result_data', '{"existing":"preserved"}' );

		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'      => 'awaiting_input',
				'message'     => 'Another question.',
				'result_data' => '{"messages":["should-be-ignored"]}',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		// The existing "preserved" key should remain, proving the empty-
		// after-unset path was taken and existing data was not overwritten.
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertSame( 'preserved', $parsed['existing'] );
		$this->assertIsArray( $parsed['messages'] );
	}

	/**
	 * merge_result_data_flags handles corrupted (non-JSON) stored result_data
	 * by resetting to an empty array before merging client flags.
	 *
	 * Covers line 864: if ( ! is_array( $result_data ) ) { $result_data = array(); }
	 */
	public function test_merge_result_data_flags_handles_corrupted_stored_data() {
		global $wpdb;

		$command_id = $this->create_command_directly( [ 'status' => 'running' ] );

		// Ensure result_data meta exists first (via normal path).
		update_post_meta( $command_id, 'wpce_result_data', '{}' );

		// Corrupt the stored value directly via $wpdb to bypass the
		// registered sanitize_json callback that would normalize it.
		$wpdb->update(
			$wpdb->postmeta,
			[ 'meta_value' => 'not-json' ],
			[
				'post_id'  => $command_id,
				'meta_key' => 'wpce_result_data',
			]
		);
		wp_cache_delete( $command_id, 'post_meta' );

		// Omit 'message' so append_conversation_message does NOT run first
		// (which would fix the corruption before merge_result_data_flags
		// reads the meta). This ensures merge_result_data_flags encounters
		// the corrupted stored data directly.
		$request = new \WP_REST_Request( 'PATCH', '/wpce/v1/commands/' . $command_id );
		$request->set_body_params(
			[
				'status'      => 'awaiting_input',
				'result_data' => '{"planReady":true}',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		// The stored result_data should have the merged flag, proving
		// the reset-to-empty-array path in merge_result_data_flags worked.
		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertIsArray( $parsed );
		$this->assertTrue( $parsed['planReady'] );
	}

	// -------------------------------------------------------------------------
	// REST_Controller::is_mcp_connected_for_user()
	// -------------------------------------------------------------------------

	/**
	 * is_mcp_connected_for_user returns false when no transient exists.
	 */
	public function test_is_mcp_connected_returns_false_without_transient() {
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		$this->assertFalse( REST_Controller::is_mcp_connected_for_user( self::$editor_id ) );
	}

	/**
	 * is_mcp_connected_for_user returns true when transient is recent.
	 */
	public function test_is_mcp_connected_returns_true_when_recent() {
		set_transient(
			'wpce_mcp_last_seen_' . self::$editor_id,
			gmdate( 'Y-m-d\TH:i:s\Z' ),
			REST_Controller::MCP_TIMEOUT_SECONDS * 2
		);

		$this->assertTrue( REST_Controller::is_mcp_connected_for_user( self::$editor_id ) );
	}

	/**
	 * is_mcp_connected_for_user returns false when transient is stale.
	 */
	public function test_is_mcp_connected_returns_false_when_stale() {
		$stale_time = gmdate( 'Y-m-d\TH:i:s\Z', time() - REST_Controller::MCP_TIMEOUT_SECONDS - 1 );
		set_transient(
			'wpce_mcp_last_seen_' . self::$editor_id,
			$stale_time,
			REST_Controller::MCP_TIMEOUT_SECONDS * 2
		);

		$this->assertFalse( REST_Controller::is_mcp_connected_for_user( self::$editor_id ) );
	}

	// -------------------------------------------------------------------------
	// Claudaborative_Editing::track_mcp_sync()
	// -------------------------------------------------------------------------

	/**
	 * track_mcp_sync updates the transient for a matching request.
	 */
	public function test_track_mcp_sync_updates_transient() {
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		$request = new \WP_REST_Request( 'POST', '/wp-sync/v1/updates' );
		$request->set_header( 'X-WPCE-Client', 'mcp' );
		\Claudaborative_Editing::track_mcp_sync( null, rest_get_server(), $request );

		$this->assertTrue( REST_Controller::is_mcp_connected_for_user( self::$editor_id ) );
	}

	/**
	 * track_mcp_sync does NOT update the transient when the header is missing.
	 */
	public function test_track_mcp_sync_ignores_request_without_header() {
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		$request = new \WP_REST_Request( 'POST', '/wp-sync/v1/updates' );
		\Claudaborative_Editing::track_mcp_sync( null, rest_get_server(), $request );

		$this->assertFalse( REST_Controller::is_mcp_connected_for_user( self::$editor_id ) );
	}

	/**
	 * track_mcp_sync does NOT update the transient for a different route.
	 */
	public function test_track_mcp_sync_ignores_different_route() {
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		$request = new \WP_REST_Request( 'GET', '/wpce/v1/commands' );
		$request->set_header( 'X-WPCE-Client', 'mcp' );
		\Claudaborative_Editing::track_mcp_sync( null, rest_get_server(), $request );

		$this->assertFalse( REST_Controller::is_mcp_connected_for_user( self::$editor_id ) );
	}

	/**
	 * track_mcp_sync throttles: when the transient is already fresh it
	 * should NOT overwrite it with a new timestamp.
	 */
	public function test_track_mcp_sync_throttles_when_fresh() {
		// Set a "recent" transient with a recognizable timestamp.
		$sentinel_time = gmdate( 'Y-m-d\TH:i:s\Z', time() - 5 );
		set_transient(
			'wpce_mcp_last_seen_' . self::$editor_id,
			$sentinel_time,
			REST_Controller::MCP_TIMEOUT_SECONDS * 2
		);

		$request = new \WP_REST_Request( 'POST', '/wp-sync/v1/updates' );
		$request->set_header( 'X-WPCE-Client', 'mcp' );
		\Claudaborative_Editing::track_mcp_sync( null, rest_get_server(), $request );

		// The transient should still hold the sentinel value because
		// is_mcp_connected_for_user() returned true and the write was skipped.
		$stored = get_transient( 'wpce_mcp_last_seen_' . self::$editor_id );
		$this->assertSame( $sentinel_time, $stored );
	}

	// -------------------------------------------------------------------------
	// Claudaborative_Editing::enqueue_editor_assets() — inline script
	// -------------------------------------------------------------------------

	/**
	 * Path to the build asset file used by enqueue_editor_assets().
	 *
	 * @return string
	 */
	private static function asset_file_path() {
		return dirname( __DIR__ ) . '/build/index.asset.php';
	}

	/**
	 * Create a minimal build asset file so enqueue_editor_assets() doesn't
	 * bail early. The file is gitignored and may not exist in CI.
	 *
	 * @return void
	 */
	private function ensure_asset_file(): void {
		$path = self::asset_file_path();
		if ( ! file_exists( $path ) ) {
			// Ensure directory exists.
			wp_mkdir_p( dirname( $path ) );
			global $wp_filesystem;
			if ( ! $wp_filesystem ) {
				require_once ABSPATH . 'wp-admin/includes/file.php';
				WP_Filesystem();
			}
			$wp_filesystem->put_contents(
				$path,
				"<?php return array('dependencies' => array('wp-hooks'), 'version' => 'test');\n"
			);
		}
	}

	/**
	 * enqueue_editor_assets sets mcpConnected: false and does NOT add the
	 * polling interval filter when MCP is not connected.
	 */
	public function test_enqueue_editor_assets_mcp_disconnected() {
		$this->ensure_asset_file();
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		// Reset WP_Scripts and re-register defaults so wp-hooks is available
		// for wp_add_inline_script.
		$GLOBALS['wp_scripts'] = null;
		wp_default_scripts( wp_scripts() );

		\Claudaborative_Editing::enqueue_editor_assets();

		$scripts = wp_scripts();
		$inline  = $scripts->get_data( 'wp-hooks', 'after' );

		// wp_add_inline_script stores data as an array of script strings.
		$this->assertIsArray( $inline );

		$joined = implode( "\n", $inline );
		$this->assertStringContainsString( '"mcpConnected":false', $joined );
		$this->assertStringNotContainsString( 'pollingInterval', $joined );
	}

	/**
	 * enqueue_editor_assets includes cloudUrl and cloudApiKey in wpceInitialState
	 * when cloud options are configured.
	 */
	public function test_enqueue_editor_assets_includes_cloud_settings() {
		$this->ensure_asset_file();
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		update_option( 'wpce_cloud_url', 'https://cloud.example.com', false );
		update_option( 'wpce_cloud_api_key', 'test-key-123', false );

		$GLOBALS['wp_scripts'] = null;
		wp_default_scripts( wp_scripts() );

		\Claudaborative_Editing::enqueue_editor_assets();

		$scripts = wp_scripts();
		$inline  = $scripts->get_data( 'wp-hooks', 'after' );

		$this->assertIsArray( $inline );

		$joined = implode( "\n", $inline );
		$this->assertStringContainsString( '"cloudUrl":"https:\/\/cloud.example.com"', $joined );
		$this->assertStringContainsString( '"cloudApiKey":"test-key-123"', $joined );
	}

	/**
	 * enqueue_editor_assets sets empty cloudUrl and cloudApiKey when cloud
	 * options are not configured.
	 */
	public function test_enqueue_editor_assets_empty_cloud_settings() {
		$this->ensure_asset_file();
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		delete_option( 'wpce_cloud_url' );
		delete_option( 'wpce_cloud_api_key' );

		$GLOBALS['wp_scripts'] = null;
		wp_default_scripts( wp_scripts() );

		\Claudaborative_Editing::enqueue_editor_assets();

		$scripts = wp_scripts();
		$inline  = $scripts->get_data( 'wp-hooks', 'after' );

		$this->assertIsArray( $inline );

		$joined = implode( "\n", $inline );
		$this->assertStringContainsString( '"cloudUrl":""', $joined );
		$this->assertStringContainsString( '"cloudApiKey":""', $joined );
	}

	/**
	 * enqueue_editor_assets sets mcpConnected: true and adds the polling
	 * interval filter when MCP IS connected.
	 */
	public function test_enqueue_editor_assets_mcp_connected() {
		$this->ensure_asset_file();
		set_transient(
			'wpce_mcp_last_seen_' . self::$editor_id,
			gmdate( 'Y-m-d\TH:i:s\Z' ),
			REST_Controller::MCP_TIMEOUT_SECONDS * 2
		);

		// Reset WP_Scripts and re-register defaults so wp-hooks is available
		// for wp_add_inline_script.
		$GLOBALS['wp_scripts'] = null;
		wp_default_scripts( wp_scripts() );

		\Claudaborative_Editing::enqueue_editor_assets();

		$scripts = wp_scripts();
		$inline  = $scripts->get_data( 'wp-hooks', 'after' );

		$this->assertIsArray( $inline );

		$joined = implode( "\n", $inline );
		$this->assertStringContainsString( '"mcpConnected":true', $joined );
		$this->assertStringContainsString( 'pollingInterval', $joined );
		$this->assertStringContainsString( 'return 1000', $joined );
	}

	// -------------------------------------------------------------------------
	// GET /wpce/v1/cloud
	// -------------------------------------------------------------------------

	/**
	 * GET /wpce/v1/cloud returns configured:false when no options are set.
	 */
	public function test_get_cloud_settings_unconfigured() {
		delete_option( 'wpce_cloud_url' );
		delete_option( 'wpce_cloud_api_key' );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertFalse( $data['configured'] );
		$this->assertSame( '', $data['cloud_url'] );
		// API key should NOT be in the GET response.
		$this->assertArrayNotHasKey( 'api_key', $data );
	}

	/**
	 * GET /wpce/v1/cloud returns configured:true and the URL when options are set.
	 */
	public function test_get_cloud_settings_configured() {
		update_option( 'wpce_cloud_url', 'https://cloud.example.com', false );
		update_option( 'wpce_cloud_api_key', 'secret-key', false );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertTrue( $data['configured'] );
		$this->assertSame( 'https://cloud.example.com', $data['cloud_url'] );
		$this->assertArrayNotHasKey( 'api_key', $data );
	}

	/**
	 * An editor can read cloud settings (requires edit_posts).
	 */
	public function test_get_cloud_settings_editor_allowed() {
		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
	}

	/**
	 * A subscriber cannot read cloud settings.
	 */
	public function test_get_cloud_settings_subscriber_denied() {
		wp_set_current_user( self::$subscriber_id );

		$request  = new \WP_REST_Request( 'GET', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// POST /wpce/v1/cloud
	// -------------------------------------------------------------------------

	/**
	 * An admin can store cloud settings via POST.
	 */
	public function test_update_cloud_settings_admin_allowed() {
		wp_set_current_user( self::$admin_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'https://cloud.example.com',
				'api_key'   => 'my-api-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['ok'] );

		// Verify options were persisted.
		$this->assertSame( 'https://cloud.example.com', get_option( 'wpce_cloud_url' ) );
		$this->assertSame( 'my-api-key', get_option( 'wpce_cloud_api_key' ) );
	}

	/**
	 * An editor (non-admin) cannot store cloud settings.
	 */
	public function test_update_cloud_settings_editor_denied() {
		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'https://cloud.example.com',
				'api_key'   => 'my-api-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * A subscriber cannot store cloud settings.
	 */
	public function test_update_cloud_settings_subscriber_denied() {
		wp_set_current_user( self::$subscriber_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'https://cloud.example.com',
				'api_key'   => 'my-api-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * POST /wpce/v1/cloud requires both cloud_url and api_key.
	 */
	public function test_update_cloud_settings_missing_params() {
		wp_set_current_user( self::$admin_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params( [ 'cloud_url' => 'https://cloud.example.com' ] );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * POST /wpce/v1/cloud rejects plain HTTP cloud_url (non-localhost).
	 */
	public function test_update_cloud_settings_rejects_http() {
		wp_set_current_user( self::$admin_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'http://cloud.example.com',
				'api_key'   => 'my-api-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	/**
	 * POST /wpce/v1/cloud allows http://localhost for development.
	 */
	public function test_update_cloud_settings_allows_localhost_http() {
		wp_set_current_user( self::$admin_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'http://localhost:8080',
				'api_key'   => 'dev-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
	}

	/**
	 * POST /wpce/v1/cloud allows http://127.0.0.1 for development.
	 */
	public function test_update_cloud_settings_allows_127_http() {
		wp_set_current_user( self::$admin_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'http://127.0.0.1:3000',
				'api_key'   => 'dev-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
	}

	/**
	 * POST /wpce/v1/cloud rejects non-HTTP/HTTPS schemes.
	 */
	public function test_update_cloud_settings_rejects_ftp_scheme() {
		wp_set_current_user( self::$admin_id );

		$request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$request->set_body_params(
			[
				'cloud_url' => 'ftp://cloud.example.com',
				'api_key'   => 'my-api-key',
			]
		);
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// DELETE /wpce/v1/cloud
	// -------------------------------------------------------------------------

	/**
	 * An admin can delete cloud settings via DELETE.
	 */
	public function test_delete_cloud_settings_admin_allowed() {
		update_option( 'wpce_cloud_url', 'https://cloud.example.com', false );
		update_option( 'wpce_cloud_api_key', 'secret-key', false );

		wp_set_current_user( self::$admin_id );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['ok'] );

		// Verify options were removed.
		$this->assertFalse( get_option( 'wpce_cloud_url' ) );
		$this->assertFalse( get_option( 'wpce_cloud_api_key' ) );
	}

	/**
	 * An editor (non-admin) cannot delete cloud settings.
	 */
	public function test_delete_cloud_settings_editor_denied() {
		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * A subscriber cannot delete cloud settings.
	 */
	public function test_delete_cloud_settings_subscriber_denied() {
		wp_set_current_user( self::$subscriber_id );

		$request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/cloud' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * Full round-trip: POST → GET → DELETE → GET verifies the complete
	 * cloud settings lifecycle.
	 */
	public function test_cloud_settings_round_trip() {
		wp_set_current_user( self::$admin_id );

		// POST — store settings.
		$post_request = new \WP_REST_Request( 'POST', '/wpce/v1/cloud' );
		$post_request->set_body_params(
			[
				'cloud_url' => 'https://round-trip.example.com',
				'api_key'   => 'rt-key',
			]
		);
		$post_response = rest_get_server()->dispatch( $post_request );
		$this->assertSame( 200, $post_response->get_status() );

		// GET — verify settings are returned.
		$get_request  = new \WP_REST_Request( 'GET', '/wpce/v1/cloud' );
		$get_response = rest_get_server()->dispatch( $get_request );
		$get_data     = $get_response->get_data();

		$this->assertTrue( $get_data['configured'] );
		$this->assertSame( 'https://round-trip.example.com', $get_data['cloud_url'] );

		// DELETE — remove settings.
		$del_request  = new \WP_REST_Request( 'DELETE', '/wpce/v1/cloud' );
		$del_response = rest_get_server()->dispatch( $del_request );
		$this->assertSame( 200, $del_response->get_status() );

		// GET — verify settings are gone.
		$get_request2  = new \WP_REST_Request( 'GET', '/wpce/v1/cloud' );
		$get_response2 = rest_get_server()->dispatch( $get_request2 );
		$get_data2     = $get_response2->get_data();

		$this->assertFalse( $get_data2['configured'] );
		$this->assertSame( '', $get_data2['cloud_url'] );
	}
}
