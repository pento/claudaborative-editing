<?php
/**
 * REST Controller — registers and handles the wpce/v1 REST API endpoints.
 *
 * @package Claudaborative_Editing
 */

namespace Claudaborative_Editing;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * REST API controller for the command queue.
 */
class REST_Controller extends \WP_REST_Controller {

	/**
	 * REST API namespace.
	 */
	const API_NAMESPACE = 'wpce/v1';

	/**
	 * Protocol version for MCP ↔ plugin compatibility checks.
	 */
	const PROTOCOL_VERSION = 1;


	/**
	 * Minutes until a command expires.
	 */
	const EXPIRY_MINUTES = 10;

	/**
	 * Seconds after which the MCP is considered disconnected.
	 */
	const MCP_TIMEOUT_SECONDS = 30;

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			self::API_NAMESPACE,
			'/commands',
			array(
				array(
					'methods'             => \WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_command' ),
					'permission_callback' => array( $this, 'create_command_permissions' ),
					'args'                => array(
						'post_id'   => array(
							'required'          => true,
							'type'              => 'integer',
							'validate_callback' => 'rest_validate_request_arg',
							'sanitize_callback' => 'absint',
						),
						'prompt'    => array(
							'required'          => true,
							'type'              => 'string',
							'enum'              => Command_Defs::ALLOWED_PROMPTS,
							'validate_callback' => 'rest_validate_request_arg',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'arguments' => array(
							'required' => false,
							'type'     => 'object',
							'default'  => new \stdClass(),
						),
					),
				),
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( $this, 'list_commands' ),
					'permission_callback' => array( $this, 'edit_posts_permissions' ),
					'args'                => array(
						'post_id' => array(
							'required'          => false,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'status'  => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'since'   => array(
							'required'          => false,
							'type'              => 'string',
							'validate_callback' => array( $this, 'validate_since_param' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/commands/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => 'PATCH',
					'callback'            => array( $this, 'update_command' ),
					'permission_callback' => array( $this, 'edit_posts_permissions' ),
					'args'                => array(
						'status'      => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'message'     => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'wp_kses_post',
						),
						'result_data' => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => array( Command_Store::class, 'sanitize_json' ),
							'validate_callback' => static function ( $value ) {
								// Only accept JSON objects, not arrays or scalars.
								return is_object( json_decode( $value ) );
							},
						),
					),
				),
				array(
					'methods'             => \WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_command' ),
					'permission_callback' => array( $this, 'delete_command_permissions' ),
				),
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/commands/(?P<id>[\d]+)/respond',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'respond_to_command' ),
				'permission_callback' => array( $this, 'respond_command_permissions' ),
				'args'                => array(
					'message' => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
				),
			)
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/status',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_status' ),
				'permission_callback' => array( $this, 'edit_posts_permissions' ),
			)
		);

		// Lightweight endpoint for the core-data entity resolver.
		// Returns an empty array so getEntityRecords() succeeds and
		// triggers collection Yjs sync for the root/wpce_commands room.
		register_rest_route(
			self::API_NAMESPACE,
			'/sync-entity',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_sync_entity' ),
				'permission_callback' => array( $this, 'edit_posts_permissions' ),
			)
		);
	}

	/**
	 * Permission check: user can edit the target post.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return true|\WP_Error True if permitted, \WP_Error otherwise.
	 */
	public function create_command_permissions( $request ) {
		$post_id = $request->get_param( 'post_id' );

		if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to create commands for this post.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Permission check: user can edit posts.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return true|\WP_Error True if permitted, \WP_Error otherwise.
	 */
	public function edit_posts_permissions( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to manage commands.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Permission check: user can edit posts and owns the command.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return true|\WP_Error True if permitted, \WP_Error otherwise.
	 */
	public function delete_command_permissions( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to manage commands.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		$command = get_post( (int) $request['id'] );

		if ( ! $command || Command_Store::POST_TYPE !== $command->post_type ) {
			return new \WP_Error(
				'rest_not_found',
				__( 'Command not found.', 'claudaborative-editing' ),
				array( 'status' => 404 )
			);
		}

		if ( get_current_user_id() !== (int) $command->post_author ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You can only cancel your own commands.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Permission check: user can edit posts and owns the command.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return true|\WP_Error True if permitted, \WP_Error otherwise.
	 */
	public function respond_command_permissions( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to manage commands.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		$command = get_post( (int) $request['id'] );

		if ( ! $command || Command_Store::POST_TYPE !== $command->post_type ) {
			return new \WP_Error(
				'rest_not_found',
				__( 'Command not found.', 'claudaborative-editing' ),
				array( 'status' => 404 )
			);
		}

		if ( get_current_user_id() !== (int) $command->post_author ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You can only respond to your own commands.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Validate the "since" query parameter is a parseable date.
	 *
	 * @param string           $value   The parameter value.
	 * @param \WP_REST_Request $request The request object.
	 * @param string           $param   The parameter name.
	 * @return true|\WP_Error True if valid, \WP_Error otherwise.
	 */
	public function validate_since_param( $value, $request, $param ) {
		if ( false === rest_parse_date( $value ) ) {
			return new \WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %s: parameter name */
					__( '%s is not a valid date.', 'claudaborative-editing' ),
					$param
				),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * POST /wpce/v1/commands — create a new command.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return \WP_REST_Response|\WP_Error Response or error.
	 */
	public function create_command( $request ) {
		$post_id   = (int) $request->get_param( 'post_id' );
		$prompt    = $request->get_param( 'prompt' );
		$arguments = $request->get_param( 'arguments' );

		$command_id = wp_insert_post(
			array(
				'post_type'   => Command_Store::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => get_current_user_id(),
				'post_parent' => $post_id,
			),
			true
		);

		if ( is_wp_error( $command_id ) ) {
			return $command_id;
		}

		$expires_at = gmdate( 'Y-m-d\TH:i:s\Z', time() + self::EXPIRY_MINUTES * MINUTE_IN_SECONDS );

		update_post_meta( $command_id, 'wpce_prompt', $prompt );
		update_post_meta( $command_id, 'wpce_arguments', wp_json_encode( $arguments ) );
		update_post_meta( $command_id, 'wpce_command_status', 'pending' );
		update_post_meta( $command_id, 'wpce_result_data', '{}' );
		update_post_meta( $command_id, 'wpce_expires_at', $expires_at );

		$command = get_post( $command_id );

		return new \WP_REST_Response( Command_Formatter::format( $command ), 201 );
	}

	/**
	 * GET /wpce/v1/commands — list commands for the current user.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return \WP_REST_Response Response.
	 */
	public function list_commands( $request ) {
		$user_id = get_current_user_id();

		// Lazily expire stale commands before returning results.
		Command_Store::expire_stale_commands( $user_id );

		$args = array(
			'post_type'      => Command_Store::POST_TYPE,
			'post_status'    => 'any',
			'author'         => $user_id,
			'posts_per_page' => 100,
			'no_found_rows'  => true,
			'orderby'        => 'date',
			'order'          => 'DESC',
		);

		$post_id = $request->get_param( 'post_id' );
		if ( $post_id ) {
			$args['post_parent'] = (int) $post_id;
		}

		$status = $request->get_param( 'status' );

		if ( $status ) {
			$args['meta_query'] = array(
				array(
					'key'   => 'wpce_command_status',
					'value' => $status,
				),
			);
		}

		$since = $request->get_param( 'since' );
		if ( $since ) {
			$args['date_query'] = array(
				array(
					'after'     => $since,
					'inclusive' => true,
					'column'    => 'post_modified_gmt',
				),
			);
		}

		$query = new \WP_Query( $args );
		/** @var \WP_Post[] $posts */
		$posts    = $query->posts;
		$commands = array_map( array( '\Claudaborative_Editing\Command_Formatter', 'format' ), $posts );

		return rest_ensure_response( $commands );
	}

	/**
	 * PATCH /wpce/v1/commands/{id} — update command status.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return \WP_REST_Response|\WP_Error Response or error.
	 */
	public function update_command( $request ) {
		$command = get_post( (int) $request['id'] );

		if ( ! $command || Command_Store::POST_TYPE !== $command->post_type ) {
			return new \WP_Error(
				'rest_not_found',
				__( 'Command not found.', 'claudaborative-editing' ),
				array( 'status' => 404 )
			);
		}

		// User scoping: only the command author can update it.
		if ( get_current_user_id() !== (int) $command->post_author ) {
			return new \WP_Error(
				'rest_forbidden',
				__( 'You can only update your own commands.', 'claudaborative-editing' ),
				array( 'status' => 403 )
			);
		}

		$current_status = get_post_meta( $command->ID, 'wpce_command_status', true );
		$new_status     = $request->get_param( 'status' );

		// Check if the command has expired.
		if ( $this->is_expired( $command->ID ) && 'pending' === $current_status ) {
			update_post_meta( $command->ID, 'wpce_command_status', 'expired' );
			wp_update_post( array( 'ID' => $command->ID ) );

			return new \WP_Error(
				'rest_command_expired',
				__( 'This command has expired.', 'claudaborative-editing' ),
				array( 'status' => 409 )
			);
		}

		// Validate the status transition.
		if ( ! $this->validate_status_transition( $current_status, $new_status ) ) {
			return new \WP_Error(
				'rest_invalid_transition',
				sprintf(
					/* translators: 1: current status, 2: requested status */
					__( 'Cannot transition from "%1$s" to "%2$s".', 'claudaborative-editing' ),
					$current_status,
					$new_status
				),
				array( 'status' => 409 )
			);
		}

		// Atomic conditional update for transitions from "pending": only update
		// the status if it is still "pending" at the database level. This
		// prevents two concurrent requests from both reading "pending" and
		// both succeeding.
		if ( 'pending' === $current_status ) {
			global $wpdb;

			$updated_rows = $wpdb->update(
				$wpdb->postmeta,
				array( 'meta_value' => $new_status ),
				array(
					'post_id'    => $command->ID,
					'meta_key'   => 'wpce_command_status',
					'meta_value' => 'pending',
				),
				array( '%s' ),
				array( '%d', '%s', '%s' )
			);

			if ( false === $updated_rows ) {
				return new \WP_Error(
					'rest_update_failed',
					__( 'Failed to update command status.', 'claudaborative-editing' ),
					array( 'status' => 500 )
				);
			}

			if ( 0 === $updated_rows ) {
				return new \WP_Error(
					'rest_conflict',
					__( 'This command is no longer pending.', 'claudaborative-editing' ),
					array( 'status' => 409 )
				);
			}

			// Clear the cached meta so subsequent reads reflect the DB state.
			wp_cache_delete( $command->ID, 'post_meta' );
		} else {
			update_post_meta( $command->ID, 'wpce_command_status', $new_status );
		}

		$message = $request->get_param( 'message' );
		if ( null !== $message ) {
			update_post_meta( $command->ID, 'wpce_message', $message );
		}

		// When transitioning to awaiting_input, WordPress manages the
		// conversation history — append the message as an assistant entry.
		// Any non-messages fields from client result_data (e.g., planReady)
		// are merged into the existing result_data.
		if ( 'awaiting_input' === $new_status ) {
			if ( null !== $message ) {
				$this->append_conversation_message( $command->ID, 'assistant', $message );
			}

			$result_data = $request->get_param( 'result_data' );
			if ( null !== $result_data ) {
				$this->merge_result_data_flags( $command->ID, $result_data );
			}
		} else {
			$result_data = $request->get_param( 'result_data' );
			if ( null !== $result_data ) {
				update_post_meta( $command->ID, 'wpce_result_data', $result_data );
			}
		}

		if ( 'running' === $new_status && 'pending' === $current_status ) {
			update_post_meta( $command->ID, 'wpce_claimed_by', (string) get_current_user_id() );
			$this->update_mcp_last_seen( get_current_user_id() );
		}

		// Touch the post to update post_modified_gmt.
		wp_update_post( array( 'ID' => $command->ID ) );

		return rest_ensure_response( Command_Formatter::format( get_post( $command->ID ) ) );
	}

	/**
	 * DELETE /wpce/v1/commands/{id} — cancel a command.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return \WP_REST_Response|\WP_Error Response or error.
	 */
	public function delete_command( $request ) {
		$command = get_post( (int) $request['id'] );

		// Ownership and existence already validated in delete_command_permissions.

		$current_status = get_post_meta( $command->ID, 'wpce_command_status', true );
		$cancellable    = array( 'pending', 'awaiting_input' );

		if ( ! in_array( $current_status, $cancellable, true ) ) {
			return new \WP_Error(
				'rest_invalid_transition',
				sprintf(
					/* translators: %s: current status */
					__( 'Cannot cancel a command with status "%s".', 'claudaborative-editing' ),
					$current_status
				),
				array( 'status' => 400 )
			);
		}

		// Atomic cancel: only update if still in a cancellable status to
		// prevent overwriting a concurrent status transition.
		global $wpdb;

		$updated_rows = $wpdb->update(
			$wpdb->postmeta,
			array( 'meta_value' => 'cancelled' ),
			array(
				'post_id'    => $command->ID,
				'meta_key'   => 'wpce_command_status',
				'meta_value' => $current_status,
			),
			array( '%s' ),
			array( '%d', '%s', '%s' )
		);

		if ( false === $updated_rows ) {
			return new \WP_Error(
				'rest_update_failed',
				__( 'Failed to cancel command.', 'claudaborative-editing' ),
				array( 'status' => 500 )
			);
		}

		if ( 0 === $updated_rows ) {
			return new \WP_Error(
				'rest_conflict',
				__( 'This command can no longer be cancelled.', 'claudaborative-editing' ),
				array( 'status' => 409 )
			);
		}

		wp_cache_delete( $command->ID, 'post_meta' );

		// Touch the post to update post_modified_gmt.
		wp_update_post( array( 'ID' => $command->ID ) );

		return rest_ensure_response( Command_Formatter::format( get_post( $command->ID ) ) );
	}

	/**
	 * POST /wpce/v1/commands/{id}/respond — submit a user response to an awaiting_input command.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return \WP_REST_Response|\WP_Error Response or error.
	 */
	public function respond_to_command( $request ) {
		$command = get_post( (int) $request['id'] );

		if ( ! $command || Command_Store::POST_TYPE !== $command->post_type ) {
			return new \WP_Error(
				'rest_not_found',
				__( 'Command not found.', 'claudaborative-editing' ),
				array( 'status' => 404 )
			);
		}

		// Ownership already verified in respond_command_permissions.

		$current_status = get_post_meta( $command->ID, 'wpce_command_status', true );

		if ( 'awaiting_input' !== $current_status ) {
			return new \WP_Error(
				'rest_invalid_status',
				sprintf(
					/* translators: %s: current status */
					__( 'Command is not awaiting input (current status: "%s").', 'claudaborative-editing' ),
					$current_status
				),
				array( 'status' => 409 )
			);
		}

		// Atomic CAS: awaiting_input → running.
		global $wpdb;

		$updated_rows = $wpdb->update(
			$wpdb->postmeta,
			array( 'meta_value' => 'running' ),
			array(
				'post_id'    => $command->ID,
				'meta_key'   => 'wpce_command_status',
				'meta_value' => 'awaiting_input',
			),
			array( '%s' ),
			array( '%d', '%s', '%s' )
		);

		if ( false === $updated_rows ) {
			return new \WP_Error(
				'rest_update_failed',
				__( 'Failed to update command status.', 'claudaborative-editing' ),
				array( 'status' => 500 )
			);
		}

		if ( 0 === $updated_rows ) {
			return new \WP_Error(
				'rest_conflict',
				__( 'This command is no longer awaiting input.', 'claudaborative-editing' ),
				array( 'status' => 409 )
			);
		}

		// Clear the cached meta so subsequent reads reflect the DB state.
		wp_cache_delete( $command->ID, 'post_meta' );

		// Append the user's response to the conversation history.
		// Run through wpautop to preserve line/paragraph breaks as HTML.
		$this->append_conversation_message( $command->ID, 'user', wpautop( $request->get_param( 'message' ) ) );

		// Keep MCP connection alive during conversation.
		$this->update_mcp_last_seen( get_current_user_id() );

		// Touch the post to update post_modified_gmt.
		wp_update_post( array( 'ID' => $command->ID ) );

		return rest_ensure_response( Command_Formatter::format( get_post( $command->ID ) ) );
	}

	/**
	 * GET /wpce/v1/sync-entity — minimal record for core-data entity resolver.
	 *
	 * Returns an empty array so that getEntityRecords() succeeds and
	 * triggers collection Yjs sync for the root/wpce_commands room.
	 *
	 * @return \WP_REST_Response Response.
	 */
	public function get_sync_entity() {
		return rest_ensure_response( array() );
	}

	/**
	 * GET /wpce/v1/status — plugin and MCP connection status.
	 *
	 * @param \WP_REST_Request $request The request object.
	 * @return \WP_REST_Response Response.
	 */
	public function get_status( $request ) {
		$user_id      = get_current_user_id();
		$last_seen_at = $this->get_mcp_last_seen( $user_id );
		$connected    = false;

		if ( $last_seen_at ) {
			$elapsed   = time() - strtotime( $last_seen_at );
			$connected = $elapsed < self::MCP_TIMEOUT_SECONDS;
		}

		return rest_ensure_response(
			array(
				'version'          => self::get_plugin_version(),
				'protocol_version' => self::PROTOCOL_VERSION,
				'mcp_connected'    => $connected,
				'mcp_last_seen_at' => $last_seen_at ? $last_seen_at : null,
			)
		);
	}

	/**
	 * Check whether a command has passed its expiry time.
	 *
	 * @param int $post_id The command post ID.
	 * @return bool True if the command has expired.
	 */
	private function is_expired( $post_id ) {
		$expires_at = get_post_meta( $post_id, 'wpce_expires_at', true );

		if ( ! $expires_at ) {
			return false;
		}

		return time() > strtotime( $expires_at );
	}

	/**
	 * Validate a status transition against the allowed transitions map.
	 *
	 * @param string $current_status The current command status.
	 * @param string $new_status     The requested new status.
	 * @return bool True if the transition is valid.
	 */
	private function validate_status_transition( $current_status, $new_status ) {
		if ( ! isset( Command_Defs::VALID_TRANSITIONS[ $current_status ] ) ) {
			return false;
		}

		return in_array( $new_status, Command_Defs::VALID_TRANSITIONS[ $current_status ], true );
	}

	/**
	 * Record the current time as the MCP's last seen timestamp for a user.
	 *
	 * @param int $user_id The user ID.
	 * @return void
	 */
	private function update_mcp_last_seen( $user_id ) {
		set_transient(
			'wpce_mcp_last_seen_' . $user_id,
			gmdate( 'Y-m-d\TH:i:s\Z' ),
			self::MCP_TIMEOUT_SECONDS * 2
		);
	}

	/**
	 * Get the MCP's last seen timestamp for a user.
	 *
	 * @param int $user_id The user ID.
	 * @return string|false ISO 8601 timestamp, or false if not set.
	 */
	private function get_mcp_last_seen( $user_id ) {
		return get_transient( 'wpce_mcp_last_seen_' . $user_id );
	}

	/**
	 * Append a message to the conversation history in result_data.
	 *
	 * Reads the current result_data, ensures a messages array exists,
	 * appends the new message, and writes it back to post meta.
	 *
	 * @param int    $post_id The command post ID.
	 * @param string $role    Message role ('assistant' or 'user').
	 * @param string $content The message content.
	 * @return void
	 */
	private function append_conversation_message( $post_id, $role, $content ) {
		$result_data_raw = get_post_meta( $post_id, 'wpce_result_data', true );
		$result_data     = json_decode( $result_data_raw ? $result_data_raw : '{}', true );

		if ( ! is_array( $result_data ) ) {
			$result_data = array();
		}

		if ( ! isset( $result_data['messages'] ) || ! is_array( $result_data['messages'] ) ) {
			$result_data['messages'] = array();
		}

		$result_data['messages'][] = array(
			'role'      => $role,
			'content'   => $content,
			'timestamp' => gmdate( 'Y-m-d\TH:i:s\Z' ),
		);

		$json = wp_json_encode( $result_data );

		// Write directly via $wpdb to bypass the register_post_meta
		// sanitize_json callback, which re-encodes the JSON and can cause
		// update_post_meta to skip the write if the normalized value matches
		// the old value.
		global $wpdb;
		$wpdb->update(
			$wpdb->postmeta,
			array( 'meta_value' => $json ),
			array(
				'post_id'  => $post_id,
				'meta_key' => 'wpce_result_data',
			),
			array( '%s' ),
			array( '%d', '%s' )
		);

		// Update the object cache to match.
		wp_cache_delete( $post_id, 'post_meta' );
	}

	/**
	 * Merge non-messages fields from client result_data into the stored
	 * result_data. This allows the client to set flags (e.g., planReady)
	 * without overwriting the server-managed messages array.
	 *
	 * @param int    $post_id     The command post ID.
	 * @param string $client_json JSON string from the client's resultData parameter.
	 * @return void
	 */
	private function merge_result_data_flags( $post_id, $client_json ) {
		$client_data = json_decode( $client_json, true );

		if ( ! is_array( $client_data ) ) {
			return;
		}

		// Remove messages — those are managed by append_conversation_message.
		unset( $client_data['messages'] );

		if ( empty( $client_data ) ) {
			return;
		}

		$result_data_raw = get_post_meta( $post_id, 'wpce_result_data', true );
		$result_data     = json_decode( $result_data_raw ? $result_data_raw : '{}', true );

		if ( ! is_array( $result_data ) ) {
			$result_data = array();
		}

		// Merge client flags into result_data (messages are preserved).
		$result_data = array_merge( $result_data, $client_data );

		$json = wp_json_encode( $result_data );

		global $wpdb;
		$wpdb->update(
			$wpdb->postmeta,
			array( 'meta_value' => $json ),
			array(
				'post_id'  => $post_id,
				'meta_key' => 'wpce_result_data',
			),
			array( '%s' ),
			array( '%d', '%s' )
		);

		wp_cache_delete( $post_id, 'post_meta' );
	}

	/**
	 * Get the plugin version from the main plugin file header.
	 *
	 * @return string Plugin version string.
	 */
	private static function get_plugin_version() {
		if ( ! function_exists( 'get_plugin_data' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$plugin_data = get_plugin_data( dirname( __DIR__ ) . '/claudaborative-editing.php', false, false );

		return $plugin_data['Version'];
	}
}
