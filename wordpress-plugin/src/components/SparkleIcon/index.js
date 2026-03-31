/**
 * Sparkle icon component.
 *
 * Three sparkles (one large, two small) with optional processing
 * animation. When processing, the main sparkle pulses and small
 * sparkles twinkle in and out with staggered timing.
 *
 * Uses CSS classes defined in ConnectionStatus/style.scss:
 * - .wpce-sparkles / .wpce-sparkles-processing
 * - .wpce-sparkles-main
 * - .wpce-sparkles-small-{1..5}
 */

/**
 * Sparkle icon with optional processing animation.
 *
 * @param {Object}  props            Component props.
 * @param {number}  props.size       Icon size in pixels. Default 20.
 * @param {boolean} props.active     Whether to show active (orange) or inactive (grey) colour.
 * @param {boolean} props.processing Whether to animate sparkles (command in progress).
 * @return {import('react').ReactElement} SVG element.
 */
export default function SparkleIcon({
	size = 20,
	active = true,
	processing = false,
}) {
	const fill = active ? '#D97706' : '#949494';
	const cls = processing
		? 'wpce-sparkles wpce-sparkles-processing'
		: 'wpce-sparkles';

	return (
		<svg
			className={cls}
			width={size}
			height={size}
			viewBox="6 2 18 16"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Main sparkle — pulses when processing */}
			<path
				className="wpce-sparkles-main"
				d="M14 4l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z"
				fill={fill}
			/>
			{/* Small sparkle top-right */}
			<path
				className="wpce-sparkles-small wpce-sparkles-small-1"
				d="M20 4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
				fill={fill}
			/>
			{/* Small sparkle right */}
			<path
				className="wpce-sparkles-small wpce-sparkles-small-2"
				d="M19.5 11l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"
				fill={fill}
			/>
			{/* Extra sparkles — only visible when processing */}
			<path
				className="wpce-sparkles-small wpce-sparkles-small-3"
				d="M8 5l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3z"
				fill={fill}
			/>
			<path
				className="wpce-sparkles-small wpce-sparkles-small-4"
				d="M22 8l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3z"
				fill={fill}
			/>
			<path
				className="wpce-sparkles-small wpce-sparkles-small-5"
				d="M10 13l.3.9.9.3-.9.3-.3.9-.3-.9-.9-.3.9-.3z"
				fill={fill}
			/>
		</svg>
	);
}
