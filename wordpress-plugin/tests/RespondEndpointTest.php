<?php
/**
 * Tests for the POST /wpce/v1/commands/{id}/respond endpoint.
 */

namespace Claudaborative_Editing;

/**
 * Test the /respond endpoint for two-way command communication.
 */
class RespondEndpointTest extends \WP_UnitTestCase {

	/**
	 * Editor user ID (primary test user / command author).
	 *
	 * @var int
	 */
	private static $editor_id;

	/**
	 * Second editor user ID (for ownership tests).
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
		$editor_id       = $factory->user->create( array( 'role' => 'editor' ) );
		self::$editor_id = $editor_id;

		/** @var int $editor2_id */
		$editor2_id       = $factory->user->create( array( 'role' => 'editor' ) );
		self::$editor2_id = $editor2_id;

		/** @var int $subscriber_id */
		$subscriber_id       = $factory->user->create( array( 'role' => 'subscriber' ) );
		self::$subscriber_id = $subscriber_id;

		/** @var int $target_post_id */
		$target_post_id       = $factory->post->create(
			array(
				'post_author' => self::$editor_id,
				'post_status' => 'draft',
			)
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
	 * Create a command post directly in the database and return its ID.
	 *
	 * @param array<string, mixed> $overrides Override defaults for the command.
	 * @return int The command post ID.
	 */
	private function create_command_directly( $overrides = array() ) {
		$defaults = array(
			'author'      => self::$editor_id,
			'post_id'     => self::$target_post_id,
			'prompt'      => 'review',
			'arguments'   => '{}',
			'status'      => 'awaiting_input',
			'result_data' => '{}',
			'expires_at'  => gmdate( 'Y-m-d\TH:i:s\Z', time() + REST_Controller::EXPIRY_MINUTES * MINUTE_IN_SECONDS ),
		);

		$opts = array_merge( $defaults, $overrides );

		/** @var int $command_id */
		$command_id = self::factory()->post->create(
			array(
				'post_type'   => Command_Store::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => $opts['author'],
				'post_parent' => $opts['post_id'],
			)
		);

		update_post_meta( $command_id, 'wpce_prompt', $opts['prompt'] );
		update_post_meta( $command_id, 'wpce_arguments', $opts['arguments'] );
		update_post_meta( $command_id, 'wpce_command_status', $opts['status'] );
		update_post_meta( $command_id, 'wpce_result_data', $opts['result_data'] );
		update_post_meta( $command_id, 'wpce_expires_at', $opts['expires_at'] );

		return $command_id;
	}

	/**
	 * Send a respond request for a command.
	 *
	 * @param int    $command_id The command ID.
	 * @param string $message    The response message.
	 * @return \WP_REST_Response The response.
	 */
	private function respond( $command_id, $message = 'Here is my answer.' ) {
		$request = new \WP_REST_Request( 'POST', '/wpce/v1/commands/' . $command_id . '/respond' );
		$request->set_body_params( array( 'message' => $message ) );

		return rest_get_server()->dispatch( $request );
	}

	// -------------------------------------------------------------------------
	// Route registration
	// -------------------------------------------------------------------------

	/**
	 * The /respond route should be registered.
	 */
	public function test_respond_route_is_registered() {
		$routes = rest_get_server()->get_routes();
		$this->assertArrayHasKey( '/wpce/v1/commands/(?P<id>[\\d]+)/respond', $routes );
	}

	// -------------------------------------------------------------------------
	// Happy path
	// -------------------------------------------------------------------------

	/**
	 * Responding to an awaiting_input command should succeed and transition
	 * to running.
	 */
	public function test_respond_happy_path() {
		$result_data = wp_json_encode(
			array(
				'messages' => array(
					array(
						'role'      => 'assistant',
						'content'   => 'What color do you prefer?',
						'timestamp' => gmdate( 'Y-m-d\TH:i:s\Z' ),
					),
				),
			)
		);

		$command_id = $this->create_command_directly( array( 'result_data' => $result_data ) );
		$response   = $this->respond( $command_id, 'Blue, please.' );

		$this->assertSame( 200, $response->get_status() );

		$data = $response->get_data();
		$this->assertSame( 'running', $data['status'] );

		// Verify the message was appended to result_data.
		$this->assertIsObject( $data['result_data'] );
		$encoded = wp_json_encode( $data['result_data'] );
		$this->assertIsString( $encoded );
		$result = json_decode( $encoded, true );
		$this->assertCount( 2, $result['messages'] );
		$this->assertSame( 'assistant', $result['messages'][0]['role'] );
		$this->assertSame( 'user', $result['messages'][1]['role'] );
		$this->assertSame( "<p>Blue, please.</p>\n", $result['messages'][1]['content'] );
		$this->assertArrayHasKey( 'timestamp', $result['messages'][1] );
	}

	/**
	 * Responding should update the MCP last-seen transient.
	 */
	public function test_respond_updates_mcp_last_seen() {
		delete_transient( 'wpce_mcp_last_seen_' . self::$editor_id );

		$command_id = $this->create_command_directly();
		$this->respond( $command_id );

		$last_seen = get_transient( 'wpce_mcp_last_seen_' . self::$editor_id );
		$this->assertNotFalse( $last_seen );
	}

	/**
	 * Responding when result_data has no messages array should create one.
	 */
	public function test_respond_creates_messages_array_if_missing() {
		$command_id = $this->create_command_directly( array( 'result_data' => '{"some":"data"}' ) );
		$response   = $this->respond( $command_id, 'My response.' );

		$this->assertSame( 200, $response->get_status() );

		$data    = $response->get_data();
		$encoded = wp_json_encode( $data['result_data'] );
		$this->assertIsString( $encoded );
		$result = json_decode( $encoded, true );
		$this->assertArrayHasKey( 'messages', $result );
		$this->assertCount( 1, $result['messages'] );
		$this->assertSame( 'user', $result['messages'][0]['role'] );
		$this->assertSame( "<p>My response.</p>\n", $result['messages'][0]['content'] );
		// Preserve existing data.
		$this->assertSame( 'data', $result['some'] );
	}

	/**
	 * Responding when result_data is empty should initialize properly.
	 */
	public function test_respond_with_empty_result_data() {
		$command_id = $this->create_command_directly( array( 'result_data' => '{}' ) );
		$response   = $this->respond( $command_id, 'First message.' );

		$this->assertSame( 200, $response->get_status() );

		$data    = $response->get_data();
		$encoded = wp_json_encode( $data['result_data'] );
		$this->assertIsString( $encoded );
		$result = json_decode( $encoded, true );
		$this->assertCount( 1, $result['messages'] );
		$this->assertSame( "<p>First message.</p>\n", $result['messages'][0]['content'] );
	}

	// -------------------------------------------------------------------------
	// Wrong status
	// -------------------------------------------------------------------------

	/**
	 * Responding to a pending command should return 409.
	 */
	public function test_respond_to_pending_returns_409() {
		$command_id = $this->create_command_directly( array( 'status' => 'pending' ) );
		$response   = $this->respond( $command_id );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Responding to a running command should return 409.
	 */
	public function test_respond_to_running_returns_409() {
		$command_id = $this->create_command_directly( array( 'status' => 'running' ) );
		$response   = $this->respond( $command_id );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Responding to a completed command should return 409.
	 */
	public function test_respond_to_completed_returns_409() {
		$command_id = $this->create_command_directly( array( 'status' => 'completed' ) );
		$response   = $this->respond( $command_id );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Responding to a failed command should return 409.
	 */
	public function test_respond_to_failed_returns_409() {
		$command_id = $this->create_command_directly( array( 'status' => 'failed' ) );
		$response   = $this->respond( $command_id );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * Responding to a cancelled command should return 409.
	 */
	public function test_respond_to_cancelled_returns_409() {
		$command_id = $this->create_command_directly( array( 'status' => 'cancelled' ) );
		$response   = $this->respond( $command_id );

		$this->assertSame( 409, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// Authorization
	// -------------------------------------------------------------------------

	/**
	 * A different user cannot respond to another user's command.
	 */
	public function test_respond_wrong_author_returns_403() {
		$command_id = $this->create_command_directly( array( 'author' => self::$editor2_id ) );

		$response = $this->respond( $command_id );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * A subscriber cannot respond to commands.
	 */
	public function test_respond_no_permission_returns_403() {
		$command_id = $this->create_command_directly();

		wp_set_current_user( self::$subscriber_id );

		$response = $this->respond( $command_id );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * An unauthenticated request cannot respond.
	 */
	public function test_respond_unauthenticated_returns_403() {
		$command_id = $this->create_command_directly();

		wp_set_current_user( 0 );

		$response = $this->respond( $command_id );

		$this->assertSame( 403, $response->get_status() );
	}

	/**
	 * Responding to a nonexistent command returns 404.
	 */
	public function test_respond_nonexistent_command_returns_404() {
		$response = $this->respond( 999999 );

		$this->assertSame( 404, $response->get_status() );
	}

	// -------------------------------------------------------------------------
	// Concurrent respond (CAS atomicity)
	// -------------------------------------------------------------------------

	/**
	 * A second respond after the first has already transitioned should
	 * return 409.
	 */
	public function test_concurrent_respond_returns_409() {
		$command_id = $this->create_command_directly();

		// First respond succeeds.
		$response1 = $this->respond( $command_id, 'First response.' );
		$this->assertSame( 200, $response1->get_status() );

		// Second respond fails — command is now running, not awaiting_input.
		$response2 = $this->respond( $command_id, 'Second response.' );
		$this->assertSame( 409, $response2->get_status() );
	}

	/**
	 * The atomic CAS returns 409 when the DB status has changed since
	 * the meta cache was populated (simulates a concurrent transition
	 * by another process, e.g. cancellation).
	 */
	public function test_respond_atomic_conflict_via_direct_db_change() {
		global $wpdb;

		$command_id = $this->create_command_directly();

		// Populate the WP object cache with 'awaiting_input'.
		get_post_meta( $command_id, 'wpce_command_status', true );

		// Directly change the DB to 'cancelled', bypassing the object cache.
		// This simulates another process (e.g. browser cancel) winning the race.
		$wpdb->update(
			$wpdb->postmeta,
			array( 'meta_value' => 'cancelled' ),
			array(
				'post_id'    => $command_id,
				'meta_key'   => 'wpce_command_status',
				'meta_value' => 'awaiting_input',
			)
		);

		// The respond handler reads 'awaiting_input' from cache, passes the
		// status check, but the atomic DB update finds 0 rows.
		$response = $this->respond( $command_id );

		$this->assertSame( 409, $response->get_status() );
	}

	/**
	 * After a successful respond, the result_data in the DB should contain
	 * the appended user message.
	 */
	public function test_respond_persists_result_data() {
		$initial_data = wp_json_encode(
			array(
				'question' => 'Pick a color',
				'messages' => array(
					array(
						'role'      => 'assistant',
						'content'   => 'Pick a color.',
						'timestamp' => '2026-01-01T00:00:00Z',
					),
				),
			)
		);

		$command_id = $this->create_command_directly( array( 'result_data' => $initial_data ) );
		$this->respond( $command_id, 'Red.' );

		$stored = get_post_meta( $command_id, 'wpce_result_data', true );
		$parsed = json_decode( $stored, true );

		$this->assertSame( 'Pick a color', $parsed['question'] );
		$this->assertCount( 2, $parsed['messages'] );
		$this->assertSame( "<p>Red.</p>\n", $parsed['messages'][1]['content'] );
	}

	/**
	 * The message parameter is required — omitting it should return 400.
	 */
	public function test_respond_without_message_returns_400() {
		$command_id = $this->create_command_directly();

		$request  = new \WP_REST_Request( 'POST', '/wpce/v1/commands/' . $command_id . '/respond' );
		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 400, $response->get_status() );
	}
}
