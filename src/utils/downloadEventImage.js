import { saveAs } from 'file-saver';

export const downloadEventImage = async (imageUrl, title = 'event-image') => {
  if (!imageUrl) throw new Error('No image is available to download.');
  const url = new URL(imageUrl, window.location.origin);
  const source = window.location.hostname === 'localhost' && url.hostname === 'firebasestorage.googleapis.com'
    ? `/storage-api${url.pathname}${url.search}` : url.href;
  const response = await fetch(source, { credentials: 'omit' });
  if (!response.ok) throw new Error('Could not download the image. Please retry.');
  const blob = await response.blob();
  const mimeType = blob.type.split(';')[0].toLowerCase();
  if (!mimeType.startsWith('image/')) throw new Error('The saved file is not a downloadable image.');
  const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/bmp': 'bmp', 'image/tiff': 'tif', 'image/heic': 'heic' };
  const name = String(title || 'event-image').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120).replace(/[. ]+$/g, '') || 'event-image';
  saveAs(blob, `${name}.${extensions[mimeType] || 'img'}`);
};