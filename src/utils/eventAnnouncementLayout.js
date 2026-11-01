export const formatAnnouncementTime = value => {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return '';
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const period = match[3]?.toUpperCase();
  if (minutes > 59 || hours > (period ? 12 : 23) || (period && hours < 1)) return '';
  if (period) hours = hours % 12 + (period === 'PM' ? 12 : 0);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'PM' : 'AM'}`;
};

export const formatAnnouncementDate = value => {
  const source = String(value || '');
  const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const legacy = source.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!iso && !legacy) return '';
  const year = Number(iso ? iso[1] : legacy[3]);
  const month = Number(iso ? iso[2] : legacy[1]);
  const day = Number(iso ? iso[3] : legacy[2]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
  return date.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
};

export const fitAnnouncementText = (context, text, width, height, maximum = 92, weight = 800, family = 'Manrope') => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  for (let fontSize = maximum; fontSize >= 10; fontSize -= 2) {
    context.font = `${weight} ${fontSize}px "${family}", sans-serif`;
    const lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= width) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = '';
        for (const character of Array.from(word)) {
          if (context.measureText(line + character).width > width && line) {
            lines.push(line);
            line = '';
          }
          line += character;
        }
      }
    }
    if (line) lines.push(line);
    const lineHeight = fontSize * 1.17;
    if (lines.length * lineHeight <= height) return { lines, fontSize, lineHeight, weight, family };
  }
  throw new Error('The event text is too long for the announcement. Shorten it before generating.');
};

const loadImage = source => new Promise((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Could not load announcement artwork or the organization logo.'));
  const url = new URL(source, window.location.origin);
  image.src = window.location.hostname === 'localhost' && url.hostname === 'firebasestorage.googleapis.com'
    ? `/storage-api${url.pathname}${url.search}` : source;
});

const drawImage = (context, image, left, top, width, height, contain = false) => {
  const scale = contain ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height);
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  context.save();
  context.beginPath();
  context.rect(left, top, width, height);
  context.clip();
  context.drawImage(image, left + (width - renderedWidth) / 2, top + (height - renderedHeight) / 2, renderedWidth, renderedHeight);
  context.restore();
};

const drawText = (context, text, left, top, width, height, color, size, weight = 800, family = 'Manrope') => {
  const fitted = fitAnnouncementText(context, text, width, height, size, weight, family);
  context.fillStyle = color;
  context.font = `${weight} ${fitted.fontSize}px "${family}", sans-serif`;
  context.textBaseline = 'top';
  fitted.lines.forEach((line, index) => context.fillText(line, left, top + index * fitted.lineHeight));
};

const logoAccent = logo => {
  if (!logo) return '#28715d';
  const sample = document.createElement('canvas');
  sample.width = 48;
  sample.height = 48;
  const context = sample.getContext('2d');
  context.drawImage(logo, 0, 0, 48, 48);
  const pixels = context.getImageData(0, 0, 48, 48).data;
  const colors = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    if (pixels[index + 3] < 200 || Math.max(red, green, blue) - Math.min(red, green, blue) < 45) continue;
    const key = [red, green, blue].map(channel => Math.round(channel / 16) * 16).map(channel => Math.min(channel, 255).toString(16).padStart(2, '0')).join('');
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  const mostCommon = [...colors.entries()].sort((first, second) => second[1] - first[1])[0];
  return mostCommon ? `#${mostCommon[0]}` : '#28715d';
};

export const composeEventAnnouncement = async ({ artworkBlob, event, brand, layoutIndex }) => {
  const artworkSource = URL.createObjectURL(artworkBlob);
  try {
    const [artwork, logo] = await Promise.all([loadImage(artworkSource), brand.logoUrl ? loadImage(brand.logoUrl) : Promise.resolve(null)]);
    if (document.fonts) {
      await Promise.all([document.fonts.load('800 92px Manrope'), document.fonts.load('600 40px "DM Sans"')]);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image composition is not available in this browser.');
    const accent = brand.colors.find(color => /^#[0-9a-f]{6}$/i.test(color)) || logoAccent(logo);
    const title = event.instanceTitle || event.title || '';
    const date = [formatAnnouncementDate(event.startDate), event.endDate !== event.startDate ? formatAnnouncementDate(event.endDate) : ''].filter(Boolean).join(' - ');
    const time = [formatAnnouncementTime(event.startHour), formatAnnouncementTime(event.endHour)].filter(Boolean).join(' - ');
    const ink = '#182724';
    const dark = layoutIndex === 2;
    context.fillStyle = dark ? ink : '#ffffff';
    context.fillRect(0, 0, 1080, 1350);
    if (layoutIndex === 0) {
      drawImage(context, artwork, 64, 565, 952, 430);
      context.fillStyle = accent;
      context.fillRect(64, 190, 96, 8);
      drawText(context, title, 64, 230, 952, 295, ink, 112);
    } else if (layoutIndex === 1) {
      drawImage(context, artwork, 0, 160, 1080, 595);
      context.fillStyle = accent;
      context.fillRect(64, 802, 72, 8);
      drawText(context, title, 64, 842, 952, 216, ink, 92);
    } else {
      drawImage(context, artwork, 0, 160, 1080, 650);
      context.fillStyle = accent;
      context.fillRect(0, 782, 1080, 14);
      drawText(context, title, 64, 844, 952, 216, '#ffffff', 98);
    }
    const detailsTop = layoutIndex === 0 ? 1050 : 1100;
    const textColor = dark ? '#ffffff' : ink;
    drawText(context, date, 64, detailsTop, 952, 66, textColor, 40, 600, 'DM Sans');
    drawText(context, time, 64, detailsTop + 72, 952, 58, textColor, 38, 600, 'DM Sans');
    drawText(context, event.location || '', 64, detailsTop + 136, 952, 62, textColor, 28, 500, 'DM Sans');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 1080, 160);
    if (logo) drawImage(context, logo, 64, 32, 180, 96, true);
    drawText(context, brand.name, logo ? 280 : 64, 48, logo ? 736 : 952, 70, ink, 30, 600, 'DM Sans');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not export the announcement image.');
    if (blob.size >= 5 * 1024 * 1024) throw new Error('The composed announcement exceeds the 5MB image limit. Please regenerate the artwork.');
    return blob;
  } finally {
    URL.revokeObjectURL(artworkSource);
  }
};