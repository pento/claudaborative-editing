import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';
import { getMediaCategory } from '../wordpress/mime-types.js';
import type { WPMediaItem } from '../wordpress/types.js';

interface UploadMediaInput {
	filePath: string;
	altText?: string;
	title?: string;
	caption?: string;
}

/**
 * Build a block insertion hint based on the uploaded media's MIME type.
 * Shows the primary block type with the exact attributes needed,
 * plus alternative block types that also accept this media category.
 */
function buildInsertionHint(media: WPMediaItem): string {
	const category = getMediaCategory(media.mime_type);
	const lines: string[] = [];

	switch (category) {
		case 'image': {
			const imageAttrs: Record<string, unknown> = {
				id: media.id,
				url: media.source_url,
			};
			if (media.alt_text) imageAttrs.alt = media.alt_text;
			lines.push('To insert as a block, use wp_insert_block with:');
			lines.push(
				`  name: "core/image", attributes: ${JSON.stringify(imageAttrs)}`
			);
			lines.push(
				'Other blocks that accept images: core/cover (id + url), core/media-text (mediaId + mediaUrl + mediaType: "image")'
			);
			break;
		}
		case 'video':
			lines.push('To insert as a block, use wp_insert_block with:');
			lines.push(
				`  name: "core/video", attributes: { "id": ${media.id}, "src": "${media.source_url}" }`
			);
			lines.push(
				'Other blocks that accept videos: core/cover (id + url + backgroundType: "video"), core/media-text (mediaId + mediaUrl + mediaType: "video")'
			);
			break;
		case 'audio':
			lines.push('To insert as a block, use wp_insert_block with:');
			lines.push(
				`  name: "core/audio", attributes: { "id": ${media.id}, "src": "${media.source_url}" }`
			);
			break;
		default:
			lines.push('To insert as a block, use wp_insert_block with:');
			lines.push(
				`  name: "core/file", attributes: { "id": ${media.id}, "href": "${media.source_url}" }`
			);
			break;
	}

	return lines.join('\n');
}

export const mediaTools: ToolDefinition[] = [
	{
		name: 'wp_upload_media',
		description:
			'Upload a local file to the WordPress media library. Returns the attachment ID and URL for use with wp_insert_block (e.g., core/image, core/video, core/audio, core/file).',
		inputSchema: {
			filePath: z
				.string()
				.describe('Absolute path to the local file to upload'),
			altText: z
				.string()
				.optional()
				.describe(
					'Alt text for the media (important for image accessibility)'
				),
			title: z.string().optional().describe('Title for the media item'),
			caption: z
				.string()
				.optional()
				.describe('Caption for the media item'),
		},
		availableIn: ['connected', 'editing'],
		tags: ['media'],
		execute: async (
			session,
			{ filePath, altText, title, caption }: UploadMediaInput
		) => {
			const media = await session.uploadMedia(filePath, {
				altText,
				title,
				caption,
			});
			const lines = [
				'Uploaded successfully.',
				'',
				`Attachment ID: ${media.id}`,
				`URL: ${media.source_url}`,
				`MIME type: ${media.mime_type}`,
			];

			if (media.alt_text) {
				lines.push(`Alt text: ${media.alt_text}`);
			}

			if (media.media_details.width && media.media_details.height) {
				lines.push(
					`Dimensions: ${media.media_details.width}x${media.media_details.height}`
				);
			}

			lines.push('');
			lines.push(buildInsertionHint(media));

			return lines.join('\n');
		},
	},
];
