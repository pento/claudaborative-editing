import { stopPlayground } from './helpers/playground';

export default async function globalTeardown(): Promise<void> {
	await stopPlayground();
}
