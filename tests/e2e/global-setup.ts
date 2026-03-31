import { ensureWpEnvRunning } from './helpers/wp-env';

export default function globalSetup(): void {
	ensureWpEnvRunning();
}
