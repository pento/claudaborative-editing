<?php
/**
 * REST Controller — registers and handles the wpce/v1 REST API endpoints.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * REST API controller for the command queue.
 */
class REST_Controller extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 */
	const API_NAMESPACE = 'wpce/v1';

	/**
	 * Protocol version for MCP ↔ plugin compatibility checks.
	 */
	const PROTOCOL_VERSION = 1;

	/**
	 * Allowed prompt values for command creation.
	 */
	const ALLOWED_PROMPTS = [
		'proofread',
		'review',
		'respond-to-notes',
		'respond-to-note',
		'edit',
		'translate',
	];

	/**
	 * Valid status transitions: current_status => [ allowed_next_statuses ].
	 */
	const VALID_TRANSITIONS = [
		'pending' => [ 'running' ],
		'running' => [ 'completed', 'failed' ],
	];

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
			[
				[
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => [ $this, 'create_command' ],
					'permission_callback' => [ $this, 'create_command_permissions' ],
					'args'                => [
						'post_id'   => [
							'required'          => true,
							'type'              => 'integer',
							'validate_callback' => 'rest_validate_request_arg',
							'sanitize_callback' => 'absint',
						],
						'prompt'    => [
							'required'          => true,
							'type'              => 'string',
							'enum'              => self::ALLOWED_PROMPTS,
							'validate_callback' => 'rest_validate_request_arg',
							'sanitize_callback' => 'sanitize_text_field',
						],
						'arguments' => [
							'required' => false,
							'type'     => 'object',
							'default'  => new stdClass(),
						],
					],
				],
				[
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => [ $this, 'list_commands' ],
					'permission_callback' => [ $this, 'edit_posts_permissions' ],
					'args'                => [
						'post_id' => [
							'required'          => false,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						],
						'status'  => [
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						],
						'since'   => [
							'required'          => false,
							'type'              => 'string',
							'validate_callback' => [ $this, 'validate_since_param' ],
							'sanitize_callback' => 'sanitize_text_field',
						],
					],
				],
			]
		);

		// The /commands/{id} route only matches digits via [\d]+, so "stream"
		// never conflicts.
		register_rest_route(
			self::API_NAMESPACE,
			'/commands/stream',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'stream_commands' ],
				'permission_callback' => [ $this, 'edit_posts_permissions' ],
			]
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/commands/(?P<id>[\d]+)',
			[
				[
					'methods'             => 'PATCH',
					'callback'            => [ $this, 'update_command' ],
					'permission_callback' => [ $this, 'edit_posts_permissions' ],
					'args'                => [
						'status'  => [
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						],
						'message' => [
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_textarea_field',
						],
					],
				],
				[
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => [ $this, 'delete_command' ],
					'permission_callback' => [ $this, 'delete_command_permissions' ],
				],
			]
		);

		register_rest_route(
			self::API_NAMESPACE,
			'/status',
			[
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => [ $this, 'get_status' ],
				'permission_callback' => [ $this, 'edit_posts_permissions' ],
			]
		);
	}

	/**
	 * Permission check: user can edit the target post.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return true|WP_Error True if permitted, WP_Error otherwise.
	 */
	public function create_command_permissions( $request ) {
		$post_id = $request->get_param( 'post_id' );

		if ( ! $post_id || ! current_user_can( 'edit_post', $post_id ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to create commands for this post.', 'claudaborative-editing' ),
				[ 'status' => 403 ]
			);
		}

		return true;
	}

	/**
	 * Permission check: user can edit posts.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return true|WP_Error True if permitted, WP_Error otherwise.
	 */
	public function edit_posts_permissions( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to manage commands.', 'claudaborative-editing' ),
				[ 'status' => 403 ]
			);
		}

		return true;
	}

	/**
	 * Permission check: user can edit posts and owns the command.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return true|WP_Error True if permitted, WP_Error otherwise.
	 */
	public function delete_command_permissions( $request ) {
		if ( ! current_user_can( 'edit_posts' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to manage commands.', 'claudaborative-editing' ),
				[ 'status' => 403 ]
			);
		}

		$command = get_post( (int) $request['id'] );

		if ( ! $command || Command_Store::POST_TYPE !== $command->post_type ) {
			return new WP_Error(
				'rest_not_found',
				__( 'Command not found.', 'claudaborative-editing' ),
				[ 'status' => 404 ]
			);
		}

		if ( get_current_user_id() !== (int) $command->post_author ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You can only cancel your own commands.', 'claudaborative-editing' ),
				[ 'status' => 403 ]
			);
		}

		return true;
	}

	/**
	 * Validate the "since" query parameter is a parseable date.
	 *
	 * @param string          $value   The parameter value.
	 * @param WP_REST_Request $request The request object.
	 * @param string          $param   The parameter name.
	 * @return true|WP_Error True if valid, WP_Error otherwise.
	 */
	public function validate_since_param( $value, $request, $param ) {
		if ( false === rest_parse_date( $value ) ) {
			return new WP_Error(
				'rest_invalid_param',
				sprintf(
					/* translators: %s: parameter name */
					__( '%s is not a valid date.', 'claudaborative-editing' ),
					$param
				),
				[ 'status' => 400 ]
			);
		}

		return true;
	}

	/**
	 * POST /wpce/v1/commands — create a new command.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error Response or error.
	 */
	public function create_command( $request ) {
		$post_id   = (int) $request->get_param( 'post_id' );
		$prompt    = $request->get_param( 'prompt' );
		$arguments = $request->get_param( 'arguments' );

		$command_id = wp_insert_post(
			[
				'post_type'   => Command_Store::POST_TYPE,
				'post_status' => 'publish',
				'post_author' => get_current_user_id(),
				'post_parent' => $post_id,
			],
			true
		);

		if ( is_wp_error( $command_id ) ) {
			return $command_id;
		}

		$expires_at = gmdate( 'Y-m-d\TH:i:s\Z', time() + self::EXPIRY_MINUTES * MINUTE_IN_SECONDS );

		update_post_meta( $command_id, 'wpce_prompt', $prompt );
		update_post_meta( $command_id, 'wpce_arguments', wp_json_encode( $arguments ) );
		update_post_meta( $command_id, 'wpce_command_status', 'pending' );
		update_post_meta( $command_id, 'wpce_expires_at', $expires_at );

		$command = get_post( $command_id );

		return new WP_REST_Response( Command_Formatter::format( $command ), 201 );
	}

	/**
	 * GET /wpce/v1/commands — list commands for the current user.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response Response.
	 */
	public function list_commands( $request ) {
		$user_id = get_current_user_id();

		// Lazily expire stale commands before returning results.
		Command_Store::expire_stale_commands( $user_id );

		$args = [
			'post_type'      => Command_Store::POST_TYPE,
			'post_status'    => 'any',
			'author'         => $user_id,
			'posts_per_page' => 100,
			'no_found_rows'  => true,
			'orderby'        => 'date',
			'order'          => 'DESC',
		];

		$post_id = $request->get_param( 'post_id' );
		if ( $post_id ) {
			$args['post_parent'] = (int) $post_id;
		}

		$status = $request->get_param( 'status' );
		if ( $status ) {
			$args['meta_query'] = [
				[
					'key'   => 'wpce_command_status',
					'value' => $status,
				],
			];
		}

		$since = $request->get_param( 'since' );
		if ( $since ) {
			$args['date_query'] = [
				[
					'after'     => $since,
					'inclusive' => true,
					'column'    => 'post_modified_gmt',
				],
			];
		}

		$query = new WP_Query( $args );
		/** @var WP_Post[] $posts */
		$posts    = $query->posts;
		$commands = array_map( [ 'Command_Formatter', 'format' ], $posts );

		return rest_ensure_response( $commands );
	}

	/**
	 * GET /wpce/v1/commands/stream — SSE stream of pending commands.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return void
	 */
	public function stream_commands( $request ) {
		$user_id       = get_current_user_id();
		$last_event_id = $request->get_header( 'Last-Event-ID' );

		$this->update_mcp_last_seen( $user_id );

		SSE_Handler::handle( $user_id, $last_event_id ? $last_event_id : '' );
	}

	/**
	 * PATCH /wpce/v1/commands/{id} — update command status.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error Response or error.
	 */
	public function update_command( $request ) {
		$command = get_post( (int) $request['id'] );

		if ( ! $command || Command_Store::POST_TYPE !== $command->post_type ) {
			return new WP_Error(
				'rest_not_found',
				__( 'Command not found.', 'claudaborative-editing' ),
				[ 'status' => 404 ]
			);
		}

		// User scoping: only the command author can update it.
		if ( get_current_user_id() !== (int) $command->post_author ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You can only update your own commands.', 'claudaborative-editing' ),
				[ 'status' => 403 ]
			);
		}

		$current_status = get_post_meta( $command->ID, 'wpce_command_status', true );
		$new_status     = $request->get_param( 'status' );

		// Check if the command has expired.
		if ( $this->is_expired( $command->ID ) && 'pending' === $current_status ) {
			update_post_meta( $command->ID, 'wpce_command_status', 'expired' );
			wp_update_post( [ 'ID' => $command->ID ] );

			return new WP_Error(
				'rest_command_expired',
				__( 'This command has expired.', 'claudaborative-editing' ),
				[ 'status' => 409 ]
			);
		}

		// Validate the status transition.
		if ( ! $this->validate_status_transition( $current_status, $new_status ) ) {
			return new WP_Error(
				'rest_invalid_transition',
				sprintf(
					/* translators: 1: current status, 2: requested status */
					__( 'Cannot transition from "%1$s" to "%2$s".', 'claudaborative-editing' ),
					$current_status,
					$new_status
				),
				[ 'status' => 409 ]
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
				[ 'meta_value' => $new_status ],
				[
					'post_id'    => $command->ID,
					'meta_key'   => 'wpce_command_status',
					'meta_value' => 'pending',
				],
				[ '%s' ],
				[ '%d', '%s', '%s' ]
			);

			if ( false === $updated_rows ) {
				return new WP_Error(
					'rest_update_failed',
					__( 'Failed to update command status.', 'claudaborative-editing' ),
					[ 'status' => 500 ]
				);
			}

			if ( 0 === $updated_rows ) {
				return new WP_Error(
					'rest_conflict',
					__( 'This command is no longer pending.', 'claudaborative-editing' ),
					[ 'status' => 409 ]
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

		if ( 'running' === $new_status && 'pending' === $current_status ) {
			update_post_meta( $command->ID, 'wpce_claimed_by', (string) get_current_user_id() );
			$this->update_mcp_last_seen( get_current_user_id() );
		}

		// Touch the post to update post_modified_gmt.
		wp_update_post( [ 'ID' => $command->ID ] );

		return rest_ensure_response( Command_Formatter::format( get_post( $command->ID ) ) );
	}

	/**
	 * DELETE /wpce/v1/commands/{id} — cancel a command.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error Response or error.
	 */
	public function delete_command( $request ) {
		$command = get_post( (int) $request['id'] );

		// Ownership and existence already validated in delete_command_permissions.

		$current_status = get_post_meta( $command->ID, 'wpce_command_status', true );

		if ( 'pending' !== $current_status ) {
			return new WP_Error(
				'rest_invalid_transition',
				sprintf(
					/* translators: %s: current status */
					__( 'Cannot cancel a command with status "%s".', 'claudaborative-editing' ),
					$current_status
				),
				[ 'status' => 400 ]
			);
		}

		update_post_meta( $command->ID, 'wpce_command_status', 'cancelled' );

		// Touch the post to update post_modified_gmt.
		wp_update_post( [ 'ID' => $command->ID ] );

		return rest_ensure_response( Command_Formatter::format( get_post( $command->ID ) ) );
	}

	/**
	 * GET /wpce/v1/status — plugin and MCP connection status.
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response Response.
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
			[
				'version'          => self::get_plugin_version(),
				'protocol_version' => self::PROTOCOL_VERSION,
				'mcp_connected'    => $connected,
				'mcp_last_seen_at' => $last_seen_at ? $last_seen_at : null,
			]
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
		if ( ! isset( self::VALID_TRANSITIONS[ $current_status ] ) ) {
			return false;
		}

		return in_array( $new_status, self::VALID_TRANSITIONS[ $current_status ], true );
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
