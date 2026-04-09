<?php
/**
 * Plugin Name: Disable Login Autofocus
 * Description: Prevents wp-login.php's focus timer from interfering with automated test input.
 */

add_filter( 'enable_login_autofocus', '__return_false' );
