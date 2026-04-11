import { useState, useCallback, useRef, useEffect } from '@wordpress/element';

export function useCopyToClipboard(text: string): {
	copied: boolean;
	handleCopy: () => void;
} {
	const [copied, setCopied] = useState(false);
	const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

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
				timeoutRef.current = setTimeout(() => setCopied(false), 2000);
			},
			() => {
				// Clipboard write rejected (e.g., permission denied).
				// The <code> element has user-select: all for manual copy.
			}
		);
	}, [text]);

	return { copied, handleCopy };
}
