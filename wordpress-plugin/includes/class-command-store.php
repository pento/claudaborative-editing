<?php
/**
 * Command Store — registers the wpce_command CPT and its meta fields.
 */

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
	 * Register the wpce_command custom post type.
	 */
	public static function register_post_type() {
		register_post_type(
			self::POST_TYPE,
			[
				'labels'              => [
					'name'          => __( 'Commands', 'claudaborative-editing' ),
					'singular_name' => __( 'Command', 'claudaborative-editing' ),
				],
				'public'              => false,
				'publicly_queryable'  => false,
				'show_ui'             => false,
				'show_in_menu'        => false,
				'show_in_rest'        => false,
				'supports'            => [ 'author' ],
				'map_meta_cap'        => true,
				'can_export'          => false,
				'delete_with_user'    => true,
				'exclude_from_search' => true,
			]
		);
	}

	/**
	 * Register post meta fields for the wpce_command post type.
	 */
	public static function register_meta() {
		$meta_fields = [
			'wpce_prompt'         => [
				'type'    => 'string',
				'default' => '',
			],
			'wpce_arguments'      => [
				'type'    => 'string',
				'default' => '{}',
			],
			'wpce_command_status' => [
				'type'    => 'string',
				'default' => 'pending',
			],
			'wpce_claimed_by'     => [
				'type'    => 'string',
				'default' => '',
			],
			'wpce_message'        => [
				'type'    => 'string',
				'default' => '',
			],
			'wpce_expires_at'     => [
				'type'    => 'string',
				'default' => '',
			],
		];

		foreach ( $meta_fields as $key => $args ) {
			register_post_meta(
				self::POST_TYPE,
				$key,
				[
					'type'              => $args['type'],
					'single'            => true,
					'default'           => $args['default'],
					'show_in_rest'      => false,
					'sanitize_callback' => 'sanitize_text_field',
				]
			);
		}
	}
}
