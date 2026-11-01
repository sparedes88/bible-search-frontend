import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import FormEntryCharts from './FormEntryCharts';
import { exportFormTotalsPdf, loadPdfLogo } from '../utils/exportFormTotalsPdf';
import { toast } from 'react-toastify';

jest.mock('../utils/exportFormTotalsPdf', () => ({ exportFormTotalsPdf: jest.fn(), loadPdfLogo: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('react-chartjs-2', () => {
  const React = require('react');
  return { Pie: React.forwardRef(({ data, ...props }, ref) => {
    React.useImperativeHandle(ref, () => ({ stop: jest.fn(), update: jest.fn(), toBase64Image: () => 'data:image/png;base64,chart-image', canvas: { width: 600, height: 600 } }), []);
    return <div data-testid="pie-chart" data-chart={JSON.stringify(data)} aria-label={props['aria-label']} />;
  }) };
});
jest.mock('react-select', () => ({ inputId, options, value, onChange, isOptionDisabled }) => (
  <select id={inputId} multiple value={value.map((option) => option.value)} onChange={(event) => onChange(Array.from(event.target.selectedOptions).map((selected) => options.find((option) => option.value === selected.value)))}>
    {options.map((option) => <option key={option.value} value={option.value} disabled={isOptionDisabled(option)}>{option.label}</option>)}
  </select>
));

const fields = [
  { name: 'city', label: 'City', type: 'text' },
  { name: 'class', label: 'Class', type: 'select' },
  { name: 'consent', label: 'Consent', type: 'boolean' },
  { name: 'program', label: 'Program', type: 'select' },
];
const entries = [
  { city: 'Chicago', class: 'Evening', consent: true, program: 'A' },
  { city: 'Chicago', class: 'Morning', consent: false, program: 'B' },
  { city: 'Evanston', class: 'Evening', consent: true, program: 'A' },
];
let container;
let root;
const render = async (rows = entries, filtered = false, logoUrl = '') => {
  await act(async () => root.render(<FormEntryCharts fields={fields} entries={rows} filtered={filtered} reportTitle="Sample Form" organizationName="Test Church" organizationLogoUrl={logoUrl} />));
};
const selectFields = async (names) => {
  await act(async () => Simulate.change(container.querySelector('select'), { target: { selectedOptions: names.map((value) => ({ value })) } }));
};

beforeEach(() => {
  jest.clearAllMocks();
  exportFormTotalsPdf.mockResolvedValue(undefined);
  loadPdfLogo.mockResolvedValue({ image: 'data:image/png;base64,logo', width: 200, height: 100 });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test('selecting fields creates separate pies and exact total tables', async () => {
  await render();
  await selectFields(['city', 'class']);
  expect(container.querySelectorAll('[data-testid="pie-chart"]')).toHaveLength(2);
  const chart = JSON.parse(container.querySelector('[aria-label="City answer totals"]').getAttribute('data-chart'));
  expect(chart.labels).toEqual(['Chicago', 'Evanston']);
  expect(chart.datasets[0].data).toEqual([2, 1]);
  expect(container.querySelector('table[aria-label="City totals"]').textContent).toContain('Chicago2');
});

test('selection cannot exceed three fields and unselected options are disabled at the limit', async () => {
  await render();
  await selectFields(['city', 'class', 'consent']);
  expect(container.querySelector('option[value="program"]').disabled).toBe(true);
  await selectFields(['city', 'class', 'consent', 'program']);
  expect(container.querySelectorAll('[data-testid="pie-chart"]')).toHaveLength(3);
  expect(container.textContent).toContain('Fields (3/3)');
});

test('removing a field frees a chart slot and clearing fields removes the charts', async () => {
  await render();
  await selectFields(['city', 'class', 'consent']);
  await selectFields(['city']);
  expect(container.querySelector('option[value="program"]').disabled).toBe(false);
  await selectFields([]);
  expect(container.querySelectorAll('[data-testid="pie-chart"]')).toHaveLength(0);
});

test('charts update when filtered entries change', async () => {
  await render();
  await selectFields(['city']);
  await render([entries[2]], true);
  const chart = JSON.parse(container.querySelector('[data-testid="pie-chart"]').getAttribute('data-chart'));
  expect(chart.labels).toEqual(['Evanston']);
  expect(chart.datasets[0].data).toEqual([1]);
  expect(container.textContent).toContain('1 matching entries');
});

test('empty filtered results show an empty state without rendering an empty pie', async () => {
  await render([], true);
  await selectFields(['city']);
  expect(container.textContent).toContain('No entries to chart.');
  expect(container.querySelectorAll('[data-testid="pie-chart"]')).toHaveLength(0);
});

test('PDF export is unavailable until fields and entries are available', async () => {
  await render();
  expect(container.querySelector('button').disabled).toBe(true);
  await selectFields(['city']);
  expect(container.querySelector('button').disabled).toBe(false);
  await render([]);
  expect(container.querySelector('button').disabled).toBe(true);
});

test('PDF export includes each selected canvas and all data below it', async () => {
  const rows = Array.from({ length: 30 }, (_unused, index) => ({ city: `City ${index}`, class: 'Evening' }));
  await render(rows, true);
  await selectFields(['city', 'class']);
  await act(async () => Simulate.click(container.querySelector('button')));
  expect(exportFormTotalsPdf).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sample Form', organizationName: 'Test Church', entryCount: 30, filtered: true }));
  const report = exportFormTotalsPdf.mock.calls[0][0];
  expect(report.charts).toHaveLength(2);
  expect(report.charts[0].image).toBe('data:image/png;base64,chart-image');
  expect(report.charts[0].totals).toHaveLength(30);
  expect(report.charts[1].totals).toEqual([{ label: 'Evening', total: 30 }]);
  expect(toast.success).toHaveBeenCalledWith('Report PDF downloaded');
});

test('PDF failure reports the error and enables retry', async () => {
  await render();
  await selectFields(['city']);
  exportFormTotalsPdf.mockRejectedValueOnce(new Error('download failed'));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => Simulate.click(container.querySelector('button')));
  expect(toast.error).toHaveBeenCalledWith('Failed to export report PDF. Please try again.');
  expect(container.querySelector('button').disabled).toBe(false);
  consoleError.mockRestore();
});

test('export passes the organization logo and complete filtered responses', async () => {
  await render([entries[2]], true, 'https://example.com/organization-logo.png');
  await selectFields(['city']);
  await act(async () => Simulate.click(container.querySelector('button')));
  expect(loadPdfLogo).toHaveBeenCalledWith('https://example.com/organization-logo.png');
  expect(exportFormTotalsPdf).toHaveBeenCalledWith(expect.objectContaining({
    logo: { image: 'data:image/png;base64,logo', width: 200, height: 100 }, entries: [entries[2]], fields, filtered: true,
  }));
});

test('a logo load failure does not silently download an unbranded report', async () => {
  await render(entries, false, 'https://example.com/missing-logo.png');
  await selectFields(['city']);
  loadPdfLogo.mockRejectedValueOnce(new Error('Logo unavailable'));
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => Simulate.click(container.querySelector('button')));
  expect(exportFormTotalsPdf).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith('Failed to export report PDF. Please try again.');
  consoleError.mockRestore();
});