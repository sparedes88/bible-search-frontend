import { composeEventAnnouncement, fitAnnouncementText, formatAnnouncementDate } from './eventAnnouncementLayout';

const measureContext = () => ({
  font: '',
  measureText(text) { return { width: Array.from(text).length * Number(this.font.match(/(\d+)px/)[1]) * 0.6 }; },
});

test.each([
  ['2026-11-02', 'November 02, 2026'],
  ['11-02-2026', 'November 02, 2026'],
  ['2026-11-01', 'November 01, 2026'],
  ['11-01-2026', 'November 01, 2026'],
  ['2026-02-30', ''],
  ['', ''],
])('formats event date %s without inventing a date', (source, expected) => {
  expect(formatAnnouncementDate(source)).toBe(expected);
});

test('wraps and shrinks long titles while keeping every word within its reserved area', () => {
  const context = measureContext();
  const title = 'A Special Evening For Every Family In Our Community With Dinner And Music';
  const fitted = fitAnnouncementText(context, title, 400, 180, 112);
  expect(fitted.fontSize).toBeLessThan(112);
  expect(fitted.lines.join(' ')).toBe(title);
  expect(fitted.lines.length * fitted.lineHeight).toBeLessThanOrEqual(180);
  fitted.lines.forEach(line => expect(context.measureText(line).width).toBeLessThanOrEqual(400));
});

test('fits a long unbroken word without clipping or discarding characters', () => {
  const context = measureContext();
  const text = 'Supercalifragilisticexpialidocious'.repeat(3);
  const fitted = fitAnnouncementText(context, text, 250, 300, 90);
  expect(fitted.lines.join('')).toBe(text);
  fitted.lines.forEach(line => expect(context.measureText(line).width).toBeLessThanOrEqual(250));
});

test('rejects text that cannot fit instead of silently truncating it', () => {
  expect(() => fitAnnouncementText(measureContext(), 'A very long title '.repeat(100), 20, 10)).toThrow('too long');
});

describe('poster export', () => {
  let context;
  let originalImage;
  let originalCreateObjectURL;
  let originalRevokeObjectURL;
  let canvasContext;
  let canvasBlob;

  beforeEach(() => {
    context = {
      ...measureContext(), save: jest.fn(), restore: jest.fn(), beginPath: jest.fn(), rect: jest.fn(),
      clip: jest.fn(), drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([240, 128, 16, 255]) }),
    };
    canvasContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    canvasBlob = jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['poster'], { type: 'image/png' })));
    originalImage = global.Image;
    global.Image = class {
      width = 1600;
      height = 900;
      set src(value) { this.source = value; Promise.resolve().then(() => this.onload()); }
    };
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:artwork');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    canvasContext.mockRestore();
    canvasBlob.mockRestore();
    global.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  const compose = layoutIndex => composeEventAnnouncement({
    artworkBlob: new Blob(['photo']),
    event: { title: 'Family Night', startDate: '11-02-2026', startHour: '18:00', endHour: '20:30', location: 'Main Hall' },
    brand: { name: 'Lighthouse Church', logoUrl: 'https://example.com/real-logo.png', colors: ['#ff7b00'] },
    layoutIndex,
  });

  test.each([0, 1, 2])('exports layout %s at the exact poster size with deterministic event copy', async layoutIndex => {
    const blob = await compose(layoutIndex);
    expect(blob.type).toBe('image/png');
    const canvas = canvasContext.mock.instances[0];
    expect([canvas.width, canvas.height]).toEqual([1080, 1350]);
    const printed = context.fillText.mock.calls.map(([text]) => text).join(' ');
    expect(printed).toContain('Family Night');
    expect(printed).toContain('November 02, 2026');
    expect(printed).toContain('6:00 PM - 8:30 PM');
    expect(printed).toContain('Main Hall');
    expect(printed).not.toContain('18:00');
    expect(context.drawImage.mock.calls.some(([image]) => image.source === 'https://example.com/real-logo.png')).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:artwork');
    context.fillText.mock.calls.forEach(([, left, top]) => {
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(1350);
    });
  });

  test('reports failed PNG export and releases temporary artwork', async () => {
    canvasBlob.mockImplementation(callback => callback(null));
    await expect(compose(0)).rejects.toThrow('Could not export');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:artwork');
  });
});