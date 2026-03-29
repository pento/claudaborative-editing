<?php
/**
 * Tests for the Command_Store class.
 */

/**
 * Test the wpce_command custom post type registration.
 */
class CommandStoreTest extends WP_UnitTestCase {

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

		$registered = get_registered_meta_keys( 'post', Command_Store::POST_TYPE );

		foreach ( $expected_keys as $key ) {
			$this->assertArrayHasKey( $key, $registered, "Meta key '{$key}' should be registered." );
		}
	}

	/**
	 * The wpce_command_status meta should default to 'pending'.
	 */
	public function test_command_status_defaults_to_pending() {
		$registered = get_registered_meta_keys( 'post', Command_Store::POST_TYPE );

		$this->assertSame( 'pending', $registered['wpce_command_status']['default'] );
	}

	/**
	 * The wpce_arguments meta should default to an empty JSON object.
	 */
	public function test_arguments_defaults_to_empty_json() {
		$registered = get_registered_meta_keys( 'post', Command_Store::POST_TYPE );

		$this->assertSame( '{}', $registered['wpce_arguments']['default'] );
	}
}
