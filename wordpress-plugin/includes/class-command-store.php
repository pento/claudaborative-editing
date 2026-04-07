<?php
/**
 * Command Store — registers the wpce_command CPT and its meta fields.
 *
 * @package Claudaborative_Editing
 */

namespace Claudaborative_Editing;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Handles registration and CRUD for the wpce_command custom post type.
 */
class Command_Store {

	/**
	 * Post type slug.
	 */
	const POST_TYPE = 'wpce_command';

	/**
	 * Sanitize a JSON string. Returns the input if valid JSON, or an empty
	 * JSON object if parsing fails.
	 *
	 * @param mixed $value The value to sanitize.
	 * @return string Sanitized JSON string.
	 */
	public static function sanitize_json( $value ) {
		if ( ! is_string( $value ) ) {
			return '{}';
		}

		$decoded = json_decode( $value );

		if ( ! is_object( $decoded ) && ! is_array( $decoded ) ) {
			return '{}';
		}

		// Re-encode to normalize whitespace. Using json_decode without the
		// associative flag preserves the object/array distinction, so "{}"
		// stays as "{}" rather than becoming "[]".
		$encoded = wp_json_encode( $decoded );

		return false !== $encoded ? $encoded : '{}';
	}

	/**
	 * Register the wpce_command custom post type.
	 *
	 * @return void
	 */
	public static function register_post_type() {
		register_post_type(
			self::POST_TYPE,
			array(
				'labels'              => array(
					'name'          => __( 'Commands', 'claudaborative-editing' ),
					'singular_name' => __( 'Command', 'claudaborative-editing' ),
				),
				'public'              => false,
				'publicly_queryable'  => false,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_rest'        => false,
				'supports'            => array( 'author' ),
				'map_meta_cap'        => true,
				'can_export'          => false,
				'delete_with_user'    => true,
				'exclude_from_search' => true,
			)
		);
	}

	/**
	 * Register post meta fields for the wpce_command post type.
	 *
	 * @return void
	 */
	public static function register_meta() {
		$meta_fields = array(
			'wpce_prompt'         => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'wpce_arguments'      => array(
				'type'              => 'string',
				'default'           => '{}',
				'sanitize_callback' => array( __CLASS__, 'sanitize_json' ),
			),
			'wpce_command_status' => array(
				'type'              => 'string',
				'default'           => 'pending',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'wpce_claimed_by'     => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'wpce_message'        => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'wp_kses_post',
			),
			'wpce_result_data'    => array(
				'type'              => 'string',
				'default'           => '{}',
				'sanitize_callback' => array( __CLASS__, 'sanitize_json' ),
			),
			'wpce_expires_at'     => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
		);

		foreach ( $meta_fields as $key => $args ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				array(
					'type'              => $args['type'],
					'single'            => true,
					'default'           => $args['default'],
					'show_in_rest'      => false,
					'sanitize_callback' => $args['sanitize_callback'],
				)
			);
		}
	}

	/**
	 * Transition expired pending commands to "expired" status.
	 *
	 * @param int  $user_id       The user whose commands to check.
	 * @param bool $cache_results Whether to cache query results.
	 * @return void
	 */
	public static function expire_stale_commands( $user_id, $cache_results = true ) {
		$query = new \WP_Query(
			array(
				'post_type'      => self::POST_TYPE,
				'post_status'    => 'any',
				'author'         => $user_id,
				'posts_per_page' => 100,
				'no_found_rows'  => true,
				'fields'         => 'ids',
				'cache_results'  => $cache_results,
				'meta_query'     => array(
					'relation' => 'AND',
					array(
						'key'     => 'wpce_command_status',
						'value'   => 'pending',
						'compare' => '=',
					),
					array(
						'key'     => 'wpce_expires_at',
						'value'   => gmdate( 'Y-m-d\TH:i:s\Z' ),
						'compare' => '<=',
						'type'    => 'CHAR',
					),
				),
			)
		);

		/** @var int[] $post_ids */
		$post_ids = $query->posts;
		foreach ( $post_ids as $post_id ) {
			update_post_meta( $post_id, 'wpce_command_status', 'expired' );
			wp_update_post( array( 'ID' => $post_id ) );
		}
	}
}
