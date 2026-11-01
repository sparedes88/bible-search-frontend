import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const getPdfLogoUrl = (url, origin = window.location.origin) => {
  if (!url) return url;
  const source = new URL(url, origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  if (local && source.protocol === 'https:' && source.hostname === 'firebasestorage.googleapis.com') {
    return `/storage-api${source.pathname}${source.search}`;
  }
  return url;
};

export const loadPdfLogo = (url) => new Promise((resolve, reject) => {
  if (!url) { resolve(null); return; }
  const image = new Image();
  image.crossOrigin = 'anonymous';
  const timeout = setTimeout(() => reject(new Error('Organization logo timed out')), 15000);
  image.onload = () => {
    clearTimeout(timeout);
    try {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    } catch (error) { reject(error); }
  };
  image.onerror = () => { clearTimeout(timeout); reject(new Error('Unable to load organization logo')); };
  image.src = getPdfLogoUrl(url);
});

export const formatPdfResponse = (value) => {
  if (value === undefined || value === null || value === '') return 'No answer';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(formatPdfResponse).join(', ') : 'No answer';
  if (typeof value?.toDate === 'function') return value.toDate().toLocaleString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Unknown' : value.toLocaleString();
  if (typeof value === 'object') return value.label != null || value.value != null || value.url != null
    ? formatPdfResponse(value.label ?? value.value ?? value.url) : JSON.stringify(value);
  return String(value);
};

export const exportFormTotalsPdf = ({ title, organizationName, entryCount, filtered, charts, logo = null, entries = [], fields = [] }) => {
  if (!charts.length) throw new Error('Select at least one field');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  const headerTextLeft = logo ? 45 : 15;
  pdf.setFontSize(11);
  const organizationLines = organizationName ? pdf.splitTextToSize(organizationName, width - headerTextLeft - 15) : [];
  pdf.setFontSize(12);
  const titleLines = pdf.splitTextToSize(title || 'Form Entries', width - headerTextLeft - 15);
  const contentTop = Math.max(logo ? 36 : 20, 14 + organizationLines.length * 5 + titleLines.length * 5) + 8;
  const generatedAt = new Date().toLocaleString();
  charts.forEach((chart, index) => {
    if (index) pdf.addPage();
    let top = contentTop;
    const text = (value, size) => {
      pdf.setFontSize(size);
      const lines = pdf.splitTextToSize(String(value), width - 30);
      pdf.text(lines, 15, top);
      top += lines.length * size * 0.4 + 3;
    };
    text('Field Totals', 13);
    text(`${entryCount} ${filtered ? 'matching entries' : 'entries'} | Generated ${generatedAt}`, 9);
    text(chart.title, 13);
    text(`${chart.answeredEntries} answered / ${entryCount} entries`, 10);
    const ratio = chart.imageWidth / chart.imageHeight;
    const imageWidth = Math.min(width - 30, 85 * ratio);
    const imageHeight = imageWidth / ratio;
    pdf.addImage(chart.image, 'PNG', (width - imageWidth) / 2, top, imageWidth, imageHeight);
    top += imageHeight + 8;
    if (chart.totals.length > 10) text('Pie: top 9 answers + other answers. All answer totals are listed below.', 9);
    autoTable(pdf, {
      startY: top,
      head: [['Answer', 'Total']],
      body: chart.totals.map((answer) => [answer.label, answer.total]),
      foot: [['Total responses', chart.responseTotal]],
      showFoot: 'lastPage',
      theme: 'striped',
      margin: { top: contentTop, bottom: 16, left: 15, right: 15 },
      styles: { fontSize: 10, overflow: 'linebreak' },
      headStyles: { fillColor: [22, 125, 141] },
      columnStyles: { 0: { cellPadding: { top: 2, right: 2, bottom: 2, left: 7 } }, 1: { halign: 'right', cellWidth: 25 } },
      didDrawCell: (cell) => {
        const color = chart.colors?.[cell.row.index];
        if (cell.section === 'body' && cell.column.index === 0 && color) {
          pdf.setFillColor(color);
          pdf.rect(cell.cell.x + 2, cell.cell.y + cell.cell.height / 2 - 1.2, 2.4, 2.4, 'F');
        }
      },
    });
  });
  if (entries.length) {
    pdf.addPage();
    let top = contentTop;
    pdf.setFontSize(14);
    pdf.text('Individual Responses', 15, top);
    top += 10;
    entries.forEach((entry, index) => {
      if (top > height - 50) { pdf.addPage(); top = contentTop; }
      pdf.setFontSize(11);
      pdf.text(`Response ${index + 1}`, 15, top);
      autoTable(pdf, {
        startY: top + 4,
        head: [['Field', 'Response']],
        body: [
          ['Submission Date', formatPdfResponse(entry.createdAt)],
          ['Submitted By', formatPdfResponse(entry.submittedBy || 'Anonymous')],
          ...fields.filter((field) => field.name).map((field) => [field.label || field.name, formatPdfResponse(entry[field.name])]),
        ],
        theme: 'striped',
        margin: { top: contentTop, bottom: 16, left: 15, right: 15 },
        styles: { fontSize: 10, overflow: 'linebreak' },
        headStyles: { fillColor: [22, 125, 141] },
        columnStyles: { 0: { cellWidth: 55 } },
      });
      top = (pdf.lastAutoTable?.finalY || top + 30) + 12;
    });
  }
  const pages = pdf.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    pdf.setPage(pageNumber);
    if (logo) {
      const scale = Math.min(24 / logo.width, 24 / logo.height);
      pdf.addImage(logo.image, 'PNG', 15, 10, logo.width * scale, logo.height * scale);
    }
    pdf.setFontSize(11);
    if (organizationLines.length) pdf.text(organizationLines, headerTextLeft, 14);
    pdf.setFontSize(12);
    pdf.text(titleLines, headerTextLeft, 14 + organizationLines.length * 5);
    pdf.setFontSize(9);
    pdf.text(`${pageNumber} / ${pages}`, width - 25, height - 7);
  }
  const filename = String(title || 'Form Entries').replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-') || 'Form-Entries';
  pdf.save(`${filename}-field-totals.pdf`);
};