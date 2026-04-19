<?php
/**
 * Tests for the editor asset enqueuer — specifically that the
 * wpceInitialState inline script carries the user and site locale so
 * the editor bundle can forward them with every MCP command.
 */

/**
 * Test that enqueue_editor_assets injects user/site locale.
 */
class EditorAssetsTest extends \WP_UnitTestCase {

	/**
	 * Clear registered scripts between tests so inline-script data
	 * from a prior enqueue doesn't leak.
	 *
	 * @return void
	 */
	public function tear_down() {
		global $wp_scripts;
		$wp_scripts = null; // Let WordPress lazily rebuild on next access.
		parent::tear_down();
	}

	/**
	 * Read the "after" inline script blob attached to the wp-hooks
	 * handle, which is where enqueue_editor_assets writes wpceInitialState.
	 *
	 * @return string
	 */
	private function get_wp_hooks_inline_after() {
		global $wp_scripts;
		$wp_scripts = wp_scripts();
		$data       = $wp_scripts->get_data( 'wp-hooks', 'after' );
		if ( ! is_array( $data ) ) {
			return '';
		}
		return implode( "\n", $data );
	}

	public function test_inline_state_includes_user_and_site_locale() {
		// Skip if the built asset file is missing — the enqueue is a
		// no-op in that case and there's nothing to assert against.
		if ( ! file_exists( dirname( __DIR__ ) . '/build/index.asset.php' ) ) {
			$this->markTestSkipped(
				'Plugin build assets are not present; run `npm run build` first.'
			);
		}

		\Claudaborative_Editing::enqueue_editor_assets();

		$inline = $this->get_wp_hooks_inline_after();

		$this->assertStringContainsString( 'window.wpceInitialState', $inline );
		$this->assertStringContainsString( '"userLocale"', $inline );
		$this->assertStringContainsString( '"siteLocale"', $inline );
	}
}
