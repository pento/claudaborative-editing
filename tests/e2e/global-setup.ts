import { ensureWpEnvRunning } from './helpers/wp-env';

export default async function globalSetup(): Promise<void> {
  await ensureWpEnvRunning();
}
