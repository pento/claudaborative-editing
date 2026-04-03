<?php
/**
 * Tests for the SSE_Handler class.
 */

namespace Claudaborative_Editing;

/**
 * Test SSE output formatting and query behaviour.
 */
class SSEHandlerTest extends \WP_UnitTestCase {

	/**
	 * Editor user ID.
	 *
	 * @var int
	 */
	private static $editor_id;

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

	/**
	 * Helper: invoke a private/protected static method via reflection.
	 *
	 * @param string       $method Method name.
	 * @param array<mixed> $args   Arguments to pass.
	 * @return mixed Return value.
	 */
	private static function invoke_static( $method, $args = [] ) {
		$ref = new \ReflectionMethod( SSE_Handler::class, $method );
		$ref->setAccessible( true );
		return $ref->invokeArgs( null, $args );
	}

	// -------------------------------------------------------------------------
	// send_event()
	// -------------------------------------------------------------------------

	/**
	 * send_event with an ID should output "id:", "event:", "data:" lines.
	 */
	public function test_send_event_with_id() {
		ob_start();
		self::invoke_static( 'send_event', [ 'command', '{"foo":"bar"}', '42' ] );
		$output = (string) ob_get_clean();

		$this->assertStringContainsString( "id: 42\n", $output );
		$this->assertStringContainsString( "event: command\n", $output );
		$this->assertStringContainsString( "data: {\"foo\":\"bar\"}\n\n", $output );
	}

	/**
	 * send_event without an ID should omit the "id:" line.
	 */
	public function test_send_event_without_id() {
		ob_start();
		self::invoke_static( 'send_event', [ 'command', '{"foo":"bar"}' ] );
		$output = (string) ob_get_clean();

		$this->assertStringNotContainsString( 'id:', $output );
		$this->assertStringContainsString( "event: command\n", $output );
		$this->assertStringContainsString( "data: {\"foo\":\"bar\"}\n\n", $output );
	}

	/**
	 * send_event should HTML-escape the event type and ID to prevent injection.
	 */
	public function test_send_event_escapes_html() {
		ob_start();
		self::invoke_static( 'send_event', [ '<script>', '{}', '<img>' ] );
		$output = (string) ob_get_clean();

		$this->assertStringNotContainsString( '<script>', $output );
		$this->assertStringNotContainsString( '<img>', $output );
		$this->assertStringContainsString( '&lt;script&gt;', $output );
		$this->assertStringContainsString( '&lt;img&gt;', $output );
	}

	// -------------------------------------------------------------------------
	// send_heartbeat()
	// -------------------------------------------------------------------------

	/**
	 * send_heartbeat should output the correct SSE heartbeat format.
	 */
	public function test_send_heartbeat_format() {
		ob_start();
		self::invoke_static( 'send_heartbeat' );
		$output = (string) ob_get_clean();

		$this->assertSame( "event: heartbeat\ndata: {}\n\n", $output );
	}

	// -------------------------------------------------------------------------
	// query_pending_commands() — additional edge cases
	// -------------------------------------------------------------------------

	/**
	 * Create a command post directly in the database.
	 *
	 * @param array<string, mixed> $overrides Override defaults.
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

	/**
	 * query_pending_commands returns an empty array when no commands exist.
	 */
	public function test_query_returns_empty_when_no_commands() {
		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 0, $results );
	}

	/**
	 * query_pending_commands with last_seen_id=0 should return all pending.
	 */
	public function test_query_with_zero_last_seen_returns_all() {
		$id1 = $this->create_command_directly();
		$id2 = $this->create_command_directly();
		$id3 = $this->create_command_directly();

		$results = SSE_Handler::query_pending_commands( self::$editor_id, 0 );

		$this->assertCount( 3, $results );
		$ids = array_map(
			function ( $p ) {
				return $p->ID;
			},
			$results
		);
		$this->assertContains( $id1, $ids );
		$this->assertContains( $id2, $ids );
		$this->assertContains( $id3, $ids );
	}
}
