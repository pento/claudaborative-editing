<?php
/**
 * Tests for the Command_Store class.
 */

namespace Claudaborative_Editing;

/**
 * Test the wpce_command custom post type registration.
 */
class CommandStoreTest extends \WP_UnitTestCase {

	/**
	 * Re-register meta before each test, since the WP test framework
	 * tears down registered meta between tests.
	 */
	public function set_up() {
		parent::set_up();
		Command_Store::register_meta();
	}

	/**
	 * The wpce_command post type should be registered.
	 */
	public function test_post_type_is_registered() {
		$this->assertTrue( post_type_exists( Command_Store::POST_TYPE ) );
	}

	/**
	 * The wpce_command post type should not be public.
	 */
	public function test_post_type_is_not_public() {
		$post_type = get_post_type_object( Command_Store::POST_TYPE );

		$this->assertInstanceOf( \WP_Post_Type::class, $post_type );
		$this->assertFalse( $post_type->public );
		$this->assertFalse( $post_type->publicly_queryable );
		$this->assertFalse( $post_type->show_ui );
		$this->assertFalse( $post_type->show_in_rest );
	}

	/**
	 * All expected meta keys should be registered for the post type.
	 */
	public function test_meta_keys_are_registered() {
		$expected_keys = [
			'wpce_prompt',
			'wpce_arguments',
			'wpce_command_status',
			'wpce_claimed_by',
			'wpce_message',
			'wpce_expires_at',
		];

		foreach ( $expected_keys as $key ) {
			$this->assertTrue(
				registered_meta_key_exists( 'post', $key, Command_Store::POST_TYPE ),
				"Meta key '{$key}' should be registered."
			);
		}
	}

	/**
	 * The wpce_command_status meta should default to 'pending'.
	 */
	public function test_command_status_defaults_to_pending() {
		/** @var int $post_id */
		$post_id = self::factory()->post->create( [ 'post_type' => Command_Store::POST_TYPE ] );

		$this->assertSame( 'pending', get_post_meta( $post_id, 'wpce_command_status', true ) );
	}

	/**
	 * The wpce_arguments meta should default to an empty JSON object.
	 */
	public function test_arguments_defaults_to_empty_json() {
		/** @var int $post_id */
		$post_id = self::factory()->post->create( [ 'post_type' => Command_Store::POST_TYPE ] );

		$this->assertSame( '{}', get_post_meta( $post_id, 'wpce_arguments', true ) );
	}

	/**
	 * The wpce_arguments sanitize callback should accept valid JSON.
	 */
	public function test_sanitize_json_accepts_valid_json() {
		$this->assertSame(
			'{"key":"value"}',
			Command_Store::sanitize_json( '{"key": "value"}' )
		);
	}

	/**
	 * The wpce_arguments sanitize callback should reject invalid JSON.
	 */
	public function test_sanitize_json_rejects_invalid_json() {
		$this->assertSame( '{}', Command_Store::sanitize_json( 'not json' ) );
	}

	/**
	 * The wpce_arguments sanitize callback should reject scalar JSON values.
	 */
	public function test_sanitize_json_rejects_scalars() {
		$this->assertSame( '{}', Command_Store::sanitize_json( '"a string"' ) );
		$this->assertSame( '{}', Command_Store::sanitize_json( '42' ) );
		$this->assertSame( '{}', Command_Store::sanitize_json( 'null' ) );
		$this->assertSame( '{}', Command_Store::sanitize_json( 'true' ) );
	}

	/**
	 * The wpce_arguments sanitize callback should handle non-string input.
	 */
	public function test_sanitize_json_handles_non_string() {
		$this->assertSame( '{}', Command_Store::sanitize_json( 42 ) );
	}
}
