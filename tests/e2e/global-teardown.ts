import { teardownWpEnv } from './helpers/wp-env';

export default function globalTeardown(): void {
	teardownWpEnv();
}
