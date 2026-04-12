import { useState, useCallback, useRef, useEffect } from '@wordpress/element';

export function useCopyToClipboard(text: string): {
	copied: boolean;
	handleCopy: () => void;
} {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined
	);

	useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const handleCopy = useCallback(() => {
		if (!navigator.clipboard?.writeText) {
			return;
		}
		navigator.clipboard.writeText(text).then(
			() => {
				setCopied(true);
				if (timeoutRef.current) {
					clearTimeout(timeoutRef.current);
				}
				timeoutRef.current = setTimeout(() => {
					setCopied(false);
					timeoutRef.current = undefined;
				}, 2000);
			},
			() => {
				// Clipboard write rejected (e.g., permission denied).
				// The <code> element has user-select: all for manual copy.
			}
		);
	}, [text]);

	return { copied, handleCopy };
}
