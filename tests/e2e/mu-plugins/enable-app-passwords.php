<?php
/**
 * Plugin Name: Enable Application Passwords for E2E
 * Description: Playground serves HTTP and without a reliable way to set WP_ENVIRONMENT_TYPE=local (blueprint's defineWpConfigConsts races with the CLI's own consts write), core disables app passwords. Force-enable via filter.
 */

add_filter( 'wp_is_application_passwords_available', '__return_true' );
