import React, { useRef, useState } from 'react';
import Select from 'react-select';
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import { Pie } from 'react-chartjs-2';
import { FiDownload } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getChartableFormFields, getFormFieldTotals, MAX_CHART_FIELDS } from '../utils/formEntryTotals';
import { exportFormTotalsPdf, loadPdfLogo } from '../utils/exportFormTotalsPdf';
import './FormEntryCharts.css';

ChartJS.register(ArcElement, Tooltip, Legend);

const COLORS = ['#167d8d', '#db644c', '#d2a52c', '#4875be', '#469566', '#b25d84', '#744f9b', '#a16c38', '#6d858e', '#92989e'];

const FormEntryCharts = ({ fields, entries, filtered = false, reportTitle = 'Form Entries', organizationName = '', organizationLogoUrl = '' }) => {
  const [selectedNames, setSelectedNames] = useState([]);
  const [exporting, setExporting] = useState(false);
  const chartRefs = useRef({});
  const availableFields = getChartableFormFields(fields);
  const options = availableFields.map((field) => ({ value: field.name, label: field.label || field.name }));
  const selectedFields = selectedNames.map((name) => availableFields.find((field) => field.name === name)).filter(Boolean);

  const handleExportPdf = async () => {
    if (exporting || !selectedFields.length || !entries.length) return;
    setExporting(true);
    try {
      const charts = selectedFields.map((field) => {
        const chart = chartRefs.current[field.name];
        if (!chart) throw new Error('Chart is not ready');
        chart.stop();
        chart.update('none');
        const totals = getFormFieldTotals(entries, field);
        return {
          ...totals, title: field.label || field.name,
          image: chart.toBase64Image(), imageWidth: chart.canvas.width, imageHeight: chart.canvas.height,
          colors: totals.totals.map((_answer, index) => COLORS[totals.totals.length > 10 && index >= 9 ? 9 : index]),
        };
      });
      const logo = organizationLogoUrl ? await loadPdfLogo(organizationLogoUrl) : null;
      await exportFormTotalsPdf({ title: reportTitle, organizationName, entryCount: entries.length, filtered, charts, logo, entries, fields });
      toast.success('Report PDF downloaded');
    } catch (error) {
      console.error('Failed to export field totals PDF:', error);
      toast.error('Failed to export report PDF. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="form-entry-charts" aria-labelledby="form-entry-charts-heading">
      <div className="form-entry-charts-header">
        <h3 id="form-entry-charts-heading">Field Totals</h3>
        <span>{entries.length} {filtered ? 'matching entries' : 'entries'}</span>
        <button type="button" className="form-entry-charts-export" onClick={handleExportPdf} disabled={exporting || selectedFields.length === 0 || entries.length === 0}>
          <FiDownload aria-hidden="true" /> {exporting ? 'Exporting...' : 'Export PDF'}
        </button>
      </div>
      <label htmlFor="form-chart-fields">Fields ({selectedFields.length}/{MAX_CHART_FIELDS})</label>
      <Select
        inputId="form-chart-fields"
        isMulti
        closeMenuOnSelect={false}
        isDisabled={exporting}
        options={options}
        value={selectedFields.map((field) => ({ value: field.name, label: field.label || field.name }))}
        onChange={(selected) => setSelectedNames((selected || []).slice(0, MAX_CHART_FIELDS).map((option) => option.value))}
        isOptionDisabled={(option) => selectedFields.length >= MAX_CHART_FIELDS && !selectedNames.includes(option.value)}
        placeholder="Select fields"
      />
      {availableFields.length === 0 && <p className="form-chart-empty">No chartable fields.</p>}
      <div className="form-entry-charts-grid">
        {selectedFields.map((field) => {
          const { totals, slices, answeredEntries, responseTotal } = getFormFieldTotals(entries, field);
          const title = field.label || field.name;
          return (
            <article key={field.name} className="form-entry-chart">
              <h4>{title}</h4>
              <p className="form-entry-chart-summary">{answeredEntries} answered / {entries.length} entries</p>
              {responseTotal === 0 ? <p className="form-chart-empty">No entries to chart.</p> : (
                <>
                  <div className="form-entry-pie">
                    <Pie
                      ref={(chart) => { if (chart) chartRefs.current[field.name] = chart; else delete chartRefs.current[field.name]; }}
                      aria-label={`${title} answer totals`}
                      role="img"
                      data={{ labels: slices.map((slice) => slice.label), datasets: [{ data: slices.map((slice) => slice.total), backgroundColor: COLORS.slice(0, slices.length), borderColor: '#ffffff', borderWidth: 2 }] }}
                      options={{
                        responsive: true, maintainAspectRatio: false, animation: false,
                        plugins: {
                          legend: { display: false },
                          tooltip: { callbacks: { label: (context) => `${context.label}: ${context.parsed} (${(context.parsed / responseTotal * 100).toFixed(1)}%)` } },
                        },
                      }}
                    />
                  </div>
                  {totals.length > 10 && <p className="form-entry-chart-summary">Pie: top 9 answers + other answers</p>}
                  <div className="form-entry-chart-table">
                    <table aria-label={`${title} totals`}>
                      <thead><tr><th scope="col">Answer</th><th scope="col">Total</th></tr></thead>
                      <tbody>
                        {totals.map((answer, index) => (
                          <tr key={answer.label}>
                            <td><span className="form-chart-swatch" aria-hidden="true" style={{ backgroundColor: COLORS[totals.length > 10 && index >= 9 ? 9 : index] }} />{answer.label}</td>
                            <td>{answer.total}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><th scope="row">Total responses</th><td>{responseTotal}</td></tr></tfoot>
                    </table>
                  </div>
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default FormEntryCharts;