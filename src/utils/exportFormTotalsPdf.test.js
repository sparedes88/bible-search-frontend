import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { exportFormTotalsPdf, formatPdfResponse, getPdfLogoUrl, loadPdfLogo } from './exportFormTotalsPdf';

jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));
jest.mock('jspdf-autotable', () => jest.fn());

let pdf;
beforeEach(() => {
  jest.clearAllMocks();
  pdf = {
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
    getNumberOfPages: jest.fn(() => 2), setPage: jest.fn(),
    addPage: jest.fn(), setFontSize: jest.fn(), splitTextToSize: jest.fn((text) => [text]),
    text: jest.fn(), addImage: jest.fn(), save: jest.fn(), setFillColor: jest.fn(), rect: jest.fn(),
  };
  jsPDF.mockImplementation(() => pdf);
});

test('exports every totals row below its chart and starts each field on a new page', () => {
  const totals = Array.from({ length: 300 }, (_unused, index) => ({ label: `Answer ${index}`, total: 1 }));
  const chart = { title: 'City', answeredEntries: 300, responseTotal: 300, totals, image: 'data:image/png;base64,test', imageWidth: 1200, imageHeight: 600 };
  exportFormTotalsPdf({ title: 'Sample Form', organizationName: 'Test Church', entryCount: 300, filtered: true, charts: [chart, { ...chart, title: 'Program' }] });
  expect(pdf.addImage).toHaveBeenCalledTimes(2);
  expect(pdf.addPage).toHaveBeenCalledTimes(1);
  expect(autoTable).toHaveBeenCalledTimes(2);
  expect(autoTable.mock.calls[0][1].body).toHaveLength(300);
  expect(autoTable.mock.calls[0][1].body[299]).toEqual(['Answer 299', 1]);
  const image = pdf.addImage.mock.calls[0];
  expect(autoTable.mock.calls[0][1].startY).toBeGreaterThan(image[3] + image[5]);
  expect(image[4] / image[5]).toBe(2);
  expect(pdf.save).toHaveBeenCalledWith('Sample-Form-field-totals.pdf');
});

test('does not save a report without selected charts', () => {
  expect(() => exportFormTotalsPdf({ charts: [] })).toThrow('Select at least one field');
  expect(pdf.save).not.toHaveBeenCalled();
});

test('individual responses contain every field, including false, zero and multiple selections', () => {
  const chart = { title: 'City', answeredEntries: 1, responseTotal: 1, totals: [{ label: 'Chicago', total: 1 }], image: 'chart', imageWidth: 600, imageHeight: 600 };
  exportFormTotalsPdf({ title: 'Form', entryCount: 1, charts: [chart], fields: [
    { name: 'city', label: 'City' }, { name: 'consent', label: 'Consent' }, { name: 'quantity', label: 'Quantity' }, { name: 'choices', label: 'Choices' }, { name: 'notes', label: 'Notes' },
  ], entries: [{ city: 'Chicago', consent: false, quantity: 0, choices: ['A', 'B'], submittedBy: 'respondent@example.com' }] });
  const responses = autoTable.mock.calls[1][1];
  expect(responses.head).toEqual([['Field', 'Response']]);
  expect(responses.body).toEqual([
    ['Submission Date', 'No answer'], ['Submitted By', 'respondent@example.com'],
    ['City', 'Chicago'], ['Consent', 'No'], ['Quantity', '0'], ['Choices', 'A, B'], ['Notes', 'No answer'],
  ]);
  expect(pdf.text).toHaveBeenCalledWith('Individual Responses', 15, expect.any(Number));
});

test('logo repeats at the top left on every page, including table continuation pages', () => {
  pdf.getNumberOfPages.mockReturnValue(4);
  const chart = { title: 'City', answeredEntries: 1, responseTotal: 1, totals: [{ label: 'Chicago', total: 1 }], image: 'chart', imageWidth: 600, imageHeight: 600 };
  exportFormTotalsPdf({ title: 'Form', organizationName: 'Organization', entryCount: 1, charts: [chart], logo: { image: 'logo', width: 200, height: 100 }, entries: [{ city: 'Chicago' }], fields: [{ name: 'city' }] });
  const logos = pdf.addImage.mock.calls.filter(([image]) => image === 'logo');
  expect(logos).toHaveLength(4);
  logos.forEach((args) => expect(args).toEqual(['logo', 'PNG', 15, 10, 24, 12]));
  expect(pdf.setPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 3, 4]);
  autoTable.mock.calls.forEach(([_document, options]) => expect(options.margin.top).toBeGreaterThan(34));
});

test('response formatting supports structured choices and Firestore dates', () => {
  expect(formatPdfResponse({ label: 'Selected option' })).toBe('Selected option');
  expect(formatPdfResponse({ toDate: () => new Date(2026, 9, 28, 12) })).toBe(new Date(2026, 9, 28, 12).toLocaleString());
  expect(formatPdfResponse([])).toBe('No answer');
  expect(formatPdfResponse('First line\nSecond line')).toBe('First line\nSecond line');
});

test('logo loading creates an embeddable image without distorting its aspect ratio', async () => {
  const originalImage = global.Image;
  const createElement = document.createElement.bind(document);
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: jest.fn() }), toDataURL: () => 'data:image/png;base64,logo' };
  global.Image = class {
    naturalWidth = 1200;
    naturalHeight = 600;
    set src(_value) { this.onload(); }
  };
  const create = jest.spyOn(document, 'createElement').mockImplementation((tag) => tag === 'canvas' ? canvas : createElement(tag));
  try {
    await expect(loadPdfLogo('https://example.com/logo.png')).resolves.toEqual({ image: 'data:image/png;base64,logo', width: 600, height: 300 });
  } finally {
    create.mockRestore();
    global.Image = originalImage;
  }
});

test('local Firebase logo loading uses the same-origin storage proxy and preserves the encoded path and query', () => {
  const url = 'https://firebasestorage.googleapis.com/v0/b/example/o/churches%2Flogo%20name.jpg?alt=media&token=example';
  expect(getPdfLogoUrl(url, 'http://localhost:3000')).toBe('/storage-api/v0/b/example/o/churches%2Flogo%20name.jpg?alt=media&token=example');
  expect(getPdfLogoUrl(url, 'http://127.0.0.1:3000')).toContain('/storage-api/');
  expect(getPdfLogoUrl(url, 'https://igletechv1.web.app')).toBe(url);
  expect(getPdfLogoUrl('/img/logo-fallback.svg', 'http://localhost:3000')).toBe('/img/logo-fallback.svg');
  expect(getPdfLogoUrl('https://example.com/logo.png', 'http://localhost:3000')).toBe('https://example.com/logo.png');
});