<?php
/**
 * Command Formatter — converts a wpce_command post into the REST API response shape.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Formats wpce_command posts into the standard command object shape.
 */
class Command_Formatter {

	/**
	 * Format a wpce_command post as an associative array for REST responses.
	 *
	 * @param WP_Post $post A post of type wpce_command.
	 * @return array{
	 *     id: int,
	 *     post_id: int,
	 *     prompt: string,
	 *     arguments: object,
	 *     status: string,
	 *     user_id: int,
	 *     claimed_by: int|null,
	 *     message: string|null,
	 *     created_at: string,
	 *     updated_at: string,
	 *     expires_at: string,
	 * } Command object.
	 */
	public static function format( WP_Post $post ) {
		$claimed_by = get_post_meta( $post->ID, 'wpce_claimed_by', true );
		$message    = get_post_meta( $post->ID, 'wpce_message', true );
		$arguments  = get_post_meta( $post->ID, 'wpce_arguments', true );

		$decoded_args = json_decode( $arguments ? $arguments : '{}' );

		// Arguments is always an object per the API schema. WordPress REST
		// sanitization converts objects to arrays in PHP, so "[]" can end up
		// stored for empty objects. Cast to ensure the response is always an
		// object.
		if ( ! is_object( $decoded_args ) ) {
			$decoded_args = (object) $decoded_args;
		}

		return [
			'id'         => $post->ID,
			'post_id'    => (int) $post->post_parent,
			'prompt'     => get_post_meta( $post->ID, 'wpce_prompt', true ),
			'arguments'  => $decoded_args,
			'status'     => get_post_meta( $post->ID, 'wpce_command_status', true ),
			'user_id'    => (int) $post->post_author,
			'claimed_by' => $claimed_by ? (int) $claimed_by : null,
			'message'    => '' !== $message ? $message : null,
			'created_at' => self::format_date( $post->post_date_gmt ),
			'updated_at' => self::format_date( $post->post_modified_gmt ),
			'expires_at' => get_post_meta( $post->ID, 'wpce_expires_at', true ),
		];
	}

	/**
	 * Convert a MySQL GMT date string to ISO 8601 format.
	 *
	 * @param string $mysql_date MySQL datetime string (Y-m-d H:i:s).
	 * @return string ISO 8601 date string.
	 */
	private static function format_date( $mysql_date ) {
		return gmdate( 'Y-m-d\TH:i:s\Z', strtotime( $mysql_date ) );
	}
}
