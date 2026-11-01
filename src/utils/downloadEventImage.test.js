import { saveAs } from 'file-saver';
import { downloadEventImage } from './downloadEventImage';

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));

let originalFetch;
beforeEach(() => {
  jest.clearAllMocks();
  originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['original-image'], { type: 'image/jpeg' }) });
});
afterEach(() => { global.fetch = originalFetch; });

test('downloads the original Firebase image through the local proxy and preserves its format', async () => {
  const imageUrl = 'https://firebasestorage.googleapis.com/v0/b/project/o/events%2Fposter.png?alt=media&token=public-image';
  await downloadEventImage(imageUrl, 'Family Night / Editorial');
  expect(global.fetch).toHaveBeenCalledWith('/storage-api/v0/b/project/o/events%2Fposter.png?alt=media&token=public-image', { credentials: 'omit' });
  expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'Family Night - Editorial.jpg');
  expect(saveAs.mock.calls[0][0].size).toBe(14);
});

test('downloads ordinary image URLs without changing their host', async () => {
  global.fetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['image'], { type: 'image/png' }) });
  await downloadEventImage('https://example.com/image.png', 'Sunday Service');
  expect(global.fetch).toHaveBeenCalledWith('https://example.com/image.png', { credentials: 'omit' });
  expect(saveAs).toHaveBeenCalledWith(expect.any(Blob), 'Sunday Service.png');
});

test('rejects a failed response without triggering a download', async () => {
  global.fetch.mockResolvedValue({ ok: false });
  await expect(downloadEventImage('https://example.com/image.png')).rejects.toThrow('Could not download');
  expect(saveAs).not.toHaveBeenCalled();
});

test('rejects non-image responses and missing images', async () => {
  global.fetch.mockResolvedValue({ ok: true, blob: async () => new Blob(['error'], { type: 'text/html' }) });
  await expect(downloadEventImage('https://example.com/error')).rejects.toThrow('not a downloadable image');
  await expect(downloadEventImage('')).rejects.toThrow('No image');
  expect(saveAs).not.toHaveBeenCalled();
});