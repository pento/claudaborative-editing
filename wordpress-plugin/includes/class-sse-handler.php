<?php
/**
 * SSE Handler — streams pending commands to the MCP server via Server-Sent Events.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Handles the SSE stream for delivering commands in real-time.
 */
class SSE_Handler {

	/**
	 * Seconds between heartbeat events.
	 */
	const HEARTBEAT_INTERVAL = 30;

	/**
	 * Seconds between database polls within the stream loop.
	 */
	const POLL_INTERVAL = 2;

	/**
	 * Maximum execution time in seconds before the handler exits (client reconnects).
	 */
	const MAX_EXECUTION_TIME = 300;

	/**
	 * Handle an SSE stream request. Sends headers, enters a poll loop, and exits.
	 *
	 * @param int    $user_id       The authenticated user's ID.
	 * @param string $last_event_id The Last-Event-ID header value, or empty string.
	 */
	public static function handle( $user_id, $last_event_id ) {
		// Keep the script running even if the client disconnects, so we can
		// detect disconnection via connection_aborted() rather than PHP
		// terminating the script mid-execution.
		ignore_user_abort( true );
		set_time_limit( self::MAX_EXECUTION_TIME );

		// Clear all output buffering layers so echo goes directly to the client.
		while ( ob_get_level() ) {
			ob_end_clean();
		}

		// Enable implicit flushing so every echo is sent immediately.
		ob_implicit_flush( 1 );

		header( 'Content-Type: text/event-stream' );
		header( 'Cache-Control: no-cache' );
		header( 'Connection: keep-alive' );
		header( 'X-Accel-Buffering: no' );

		// Release the session lock so concurrent requests are not blocked.
		if ( session_status() === PHP_SESSION_ACTIVE ) {
			session_write_close();
		}

		$last_seen_id   = $last_event_id ? (int) $last_event_id : 0;
		$start_time     = time();
		$last_heartbeat = time();
		$last_expiry    = 0;

		// Send an initial heartbeat so the client knows the connection is alive.
		self::send_heartbeat();

		while ( true ) {
			// Check if the client disconnected.
			if ( connection_aborted() ) {
				break;
			}

			// Check if we're approaching the execution time limit.
			if ( ( time() - $start_time ) >= ( self::MAX_EXECUTION_TIME - 10 ) ) {
				break;
			}

			// Query for pending commands newer than the last seen ID.
			$commands = self::query_pending_commands( $user_id, $last_seen_id );

			foreach ( $commands as $command_post ) {
				$data = wp_json_encode( Command_Formatter::format( $command_post ) );
				self::send_event( 'command', $data, (string) $command_post->ID );
				$last_seen_id   = $command_post->ID;
				$last_heartbeat = time();
			}

			// Send heartbeat if the interval has elapsed.
			if ( ( time() - $last_heartbeat ) >= self::HEARTBEAT_INTERVAL ) {
				self::send_heartbeat();
				$last_heartbeat = time();
			}

			// Expire stale commands at heartbeat cadence, not every poll.
			if ( ( time() - $last_expiry ) >= self::HEARTBEAT_INTERVAL ) {
				self::expire_stale_commands( $user_id );
				$last_expiry = time();
			}

			sleep( self::POLL_INTERVAL );
		}

		exit;
	}

	/**
	 * Query pending commands for a user, ordered by ID ascending.
	 *
	 * Public to allow direct testing — called from the SSE poll loop.
	 *
	 * @param int $user_id      The user ID to filter by.
	 * @param int $last_seen_id Only return commands with ID greater than this.
	 * @return WP_Post[] Array of command posts.
	 */
	public static function query_pending_commands( $user_id, $last_seen_id ) {
		$filter_callback = null;
		$now             = gmdate( 'Y-m-d\TH:i:s\Z' );

		$args = [
			'post_type'      => Command_Store::POST_TYPE,
			'post_status'    => 'any',
			'author'         => $user_id,
			'posts_per_page' => 50,
			'orderby'        => 'ID',
			'order'          => 'ASC',
			'cache_results'  => false,
			'meta_query'     => [
				'relation' => 'AND',
				[
					'key'   => 'wpce_command_status',
					'value' => 'pending',
				],
				[
					'key'     => 'wpce_expires_at',
					'value'   => $now,
					'compare' => '>',
					'type'    => 'CHAR',
				],
			],
		];

		if ( $last_seen_id > 0 ) {
			// Tag this query so the filter only applies to it, not to any
			// nested queries that may run during WP_Query execution.
			$args['wpce_last_seen_id'] = $last_seen_id;

			$filter_callback = function ( $where, $query ) use ( $last_seen_id ) {
				if ( empty( $query->query_vars['wpce_last_seen_id'] ) ) {
					return $where;
				}
				global $wpdb;
				$where .= $wpdb->prepare( " AND {$wpdb->posts}.ID > %d", $last_seen_id );
				return $where;
			};
			add_filter( 'posts_where', $filter_callback, 10, 2 );
		}

		$query  = new WP_Query( $args );
		$result = $query->posts;

		if ( $filter_callback ) {
			remove_filter( 'posts_where', $filter_callback );
		}

		return $result;
	}

	/**
	 * Transition expired pending/claimed commands to "expired" status.
	 *
	 * @param int $user_id The user whose commands to check.
	 */
	private static function expire_stale_commands( $user_id ) {
		$query = new WP_Query(
			[
				'post_type'      => Command_Store::POST_TYPE,
				'post_status'    => 'any',
				'author'         => $user_id,
				'posts_per_page' => 100,
				'cache_results'  => false,
				'meta_query'     => [
					'relation' => 'AND',
					[
						'key'     => 'wpce_command_status',
						'value'   => [ 'pending', 'claimed' ],
						'compare' => 'IN',
					],
					[
						'key'     => 'wpce_expires_at',
						'value'   => gmdate( 'Y-m-d\TH:i:s\Z' ),
						'compare' => '<=',
						'type'    => 'CHAR',
					],
				],
			]
		);

		foreach ( $query->posts as $post ) {
			update_post_meta( $post->ID, 'wpce_command_status', 'expired' );
		}
	}

	/**
	 * Send an SSE event.
	 *
	 * @param string $event The event type.
	 * @param string $data  The event data (JSON string).
	 * @param string $id    The event ID (optional).
	 */
	private static function send_event( $event, $data, $id = '' ) {
		if ( $id ) {
			echo 'id: ' . esc_html( $id ) . "\n";
		}
		echo 'event: ' . esc_html( $event ) . "\n";
		echo 'data: ' . $data . "\n\n";
		flush();
	}

	/**
	 * Send a heartbeat event.
	 */
	private static function send_heartbeat() {
		echo "event: heartbeat\ndata: {}\n\n";
		flush();
	}
}
