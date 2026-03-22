import { describe, it, expect } from 'vitest';
import { getMimeType, getMediaCategory } from '../../../src/wordpress/mime-types.js';

describe('getMimeType', () => {
  it('returns correct MIME type for common image extensions', () => {
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('logo.png')).toBe('image/png');
    expect(getMimeType('animation.gif')).toBe('image/gif');
    expect(getMimeType('modern.webp')).toBe('image/webp');
    expect(getMimeType('vector.svg')).toBe('image/svg+xml');
    expect(getMimeType('next-gen.avif')).toBe('image/avif');
    expect(getMimeType('apple.heic')).toBe('image/heic');
  });

  it('returns correct MIME type for video extensions', () => {
    expect(getMimeType('clip.mp4')).toBe('video/mp4');
    expect(getMimeType('clip.m4v')).toBe('video/mp4');
    expect(getMimeType('clip.mov')).toBe('video/quicktime');
    expect(getMimeType('clip.webm')).toBe('video/webm');
    expect(getMimeType('clip.avi')).toBe('video/avi');
    expect(getMimeType('clip.ogv')).toBe('video/ogg');
  });

  it('returns correct MIME type for audio extensions', () => {
    expect(getMimeType('song.mp3')).toBe('audio/mpeg');
    expect(getMimeType('song.ogg')).toBe('audio/ogg');
    expect(getMimeType('song.wav')).toBe('audio/wav');
    expect(getMimeType('song.flac')).toBe('audio/flac');
    expect(getMimeType('song.m4a')).toBe('audio/mp4');
    expect(getMimeType('song.aac')).toBe('audio/aac');
  });

  it('returns correct MIME type for document extensions', () => {
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
    expect(getMimeType('doc.doc')).toBe('application/msword');
    expect(getMimeType('doc.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(getMimeType('slides.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(getMimeType('data.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('handles uppercase extensions (case-insensitive)', () => {
    expect(getMimeType('PHOTO.JPG')).toBe('image/jpeg');
    expect(getMimeType('Image.PNG')).toBe('image/png');
    expect(getMimeType('video.MP4')).toBe('video/mp4');
  });

  it('throws for unknown extensions', () => {
    expect(() => getMimeType('file.xyz')).toThrow('Unsupported file type: .xyz');
    expect(() => getMimeType('file.xyz')).toThrow('Supported types:');
  });

  it('throws for files with no extension', () => {
    expect(() => getMimeType('Makefile')).toThrow('Unsupported file type: (no extension)');
  });

  it('handles paths with directories', () => {
    expect(getMimeType('/path/to/photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('images/logo.png')).toBe('image/png');
  });
});

describe('getMediaCategory', () => {
  it('returns "image" for image MIME types', () => {
    expect(getMediaCategory('image/jpeg')).toBe('image');
    expect(getMediaCategory('image/png')).toBe('image');
    expect(getMediaCategory('image/svg+xml')).toBe('image');
  });

  it('returns "video" for video MIME types', () => {
    expect(getMediaCategory('video/mp4')).toBe('video');
    expect(getMediaCategory('video/webm')).toBe('video');
    expect(getMediaCategory('video/quicktime')).toBe('video');
  });

  it('returns "audio" for audio MIME types', () => {
    expect(getMediaCategory('audio/mpeg')).toBe('audio');
    expect(getMediaCategory('audio/ogg')).toBe('audio');
    expect(getMediaCategory('audio/wav')).toBe('audio');
  });

  it('returns "application" for document/other MIME types', () => {
    expect(getMediaCategory('application/pdf')).toBe('application');
    expect(getMediaCategory('application/msword')).toBe('application');
    expect(getMediaCategory('application/octet-stream')).toBe('application');
  });
});
