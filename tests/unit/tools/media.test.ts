import { describe, it, expect, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMediaTools } from '../../../src/tools/media.js';
import type { SessionManager } from '../../../src/session/session-manager.js';
import {
  createMockServer,
  createMockSession,
  fakeUser,
  fakePost,
  fakeMediaItem,
} from './helpers.js';

describe('media tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createMockSession({ state: 'editing', user: fakeUser, post: fakePost });
    registerMediaTools(server as unknown as McpServer, session);
  });

  it('registers wp_upload_media tool', () => {
    expect(server.registeredTools.has('wp_upload_media')).toBe(true);
  });

  describe('wp_upload_media', () => {
    it('returns formatted response with image insertion hint', async () => {
      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({
        filePath: '/path/to/photo.jpg',
      });

      expect(session.uploadMedia).toHaveBeenCalledWith('/path/to/photo.jpg', {
        altText: undefined,
        title: undefined,
        caption: undefined,
      });

      const text = result.content[0].text;
      expect(text).toContain('Uploaded successfully');
      expect(text).toContain('Attachment ID: 101');
      expect(text).toContain('https://example.com/wp-content/uploads/2026/03/test.jpg');
      expect(text).toContain('image/jpeg');
      expect(text).toContain('800x600');
      expect(text).toContain('core/image');
      expect(text).toContain('"id":101');
      expect(result.isError).toBeUndefined();
    });

    it('passes optional parameters to session', async () => {
      const tool = server.registeredTools.get('wp_upload_media')!;
      await tool.handler({
        filePath: '/path/to/photo.jpg',
        altText: 'A scenic view',
        title: 'Sunset Photo',
        caption: 'Taken at dusk',
      });

      expect(session.uploadMedia).toHaveBeenCalledWith('/path/to/photo.jpg', {
        altText: 'A scenic view',
        title: 'Sunset Photo',
        caption: 'Taken at dusk',
      });
    });

    it('shows video insertion hint for video uploads', async () => {
      const videoMedia = {
        ...fakeMediaItem,
        mime_type: 'video/mp4',
        source_url: 'https://example.com/wp-content/uploads/2026/03/clip.mp4',
        media_details: { width: 1920, height: 1080, sizes: {} },
      };
      (session.uploadMedia as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValueOnce(
        videoMedia,
      );

      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({ filePath: '/path/to/clip.mp4' });

      const text = result.content[0].text;
      expect(text).toContain('core/video');
      expect(text).toContain('"src"');
      expect(text).toContain('core/cover');
      expect(text).toContain('core/media-text');
    });

    it('shows audio insertion hint for audio uploads', async () => {
      const audioMedia = {
        ...fakeMediaItem,
        mime_type: 'audio/mpeg',
        source_url: 'https://example.com/wp-content/uploads/2026/03/song.mp3',
        media_details: {},
      };
      (session.uploadMedia as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValueOnce(
        audioMedia,
      );

      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({ filePath: '/path/to/song.mp3' });

      const text = result.content[0].text;
      expect(text).toContain('core/audio');
      expect(text).toContain('"src"');
      expect(text).not.toContain('core/cover');
      expect(text).not.toContain('core/media-text');
      expect(text).not.toContain('Dimensions');
    });

    it('shows file insertion hint for document uploads', async () => {
      const pdfMedia = {
        ...fakeMediaItem,
        mime_type: 'application/pdf',
        source_url: 'https://example.com/wp-content/uploads/2026/03/doc.pdf',
        media_details: {},
      };
      (session.uploadMedia as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValueOnce(
        pdfMedia,
      );

      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({ filePath: '/path/to/doc.pdf' });

      const text = result.content[0].text;
      expect(text).toContain('core/file');
      expect(text).toContain('"href"');
      expect(text).not.toContain('Dimensions');
    });

    it('includes alt text in response and insertion hint', async () => {
      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({ filePath: '/path/to/photo.jpg' });

      const text = result.content[0].text;
      expect(text).toContain('Alt text: A test image');
      // The insertion hint should include the alt text in attributes
      expect(text).toContain('"alt":"A test image"');
    });

    it('returns error when upload fails', async () => {
      (session.uploadMedia as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValueOnce(
        new Error('File not found'),
      );

      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({ filePath: '/path/to/missing.jpg' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to upload media');
      expect(result.content[0].text).toContain('File not found');
    });

    it('returns error for unsupported file type', async () => {
      (session.uploadMedia as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValueOnce(
        new Error('Unsupported file type: .xyz'),
      );

      const tool = server.registeredTools.get('wp_upload_media')!;
      const result = await tool.handler({ filePath: '/path/to/file.xyz' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unsupported file type');
    });
  });
});
