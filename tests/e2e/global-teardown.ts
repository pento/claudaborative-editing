import { teardownWpEnv } from './helpers/wp-env';

export default async function globalTeardown(): Promise<void> {
  teardownWpEnv();
}
