import { stopPlayground } from './helpers/playground';

export default function globalTeardown(): void {
	stopPlayground();
}
