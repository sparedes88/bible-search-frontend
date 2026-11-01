export const MAX_CHART_FIELDS = 3;

export const getChartableFormFields = (fields = []) => fields.filter((field) => (
  field.name && !["file", "image", "signature", "heading", "paragraph", "section", "html", "divider", "description"].includes(String(field.type || "").toLowerCase())
));

const answerLabel = (answer) => {
  if (answer === true) return "Yes";
  if (answer === false) return "No";
  if (typeof answer === "string" || typeof answer === "number") return String(answer).trim();
  if (answer && typeof answer === "object" && !Array.isArray(answer)) return answerLabel(answer.label ?? answer.value);
  return "";
};

export const getFormFieldTotals = (entries, field) => {
  const counts = new Map();
  let answeredEntries = 0;
  entries.forEach((entry) => {
    const raw = entry[field.name];
    const answers = [...new Set((Array.isArray(raw) ? raw : [raw]).map(answerLabel).filter(Boolean))];
    if (answers.length) answeredEntries += 1;
    (answers.length ? answers : ["No answer"]).forEach((label) => counts.set(label, (counts.get(label) || 0) + 1));
  });
  const totals = Array.from(counts, ([label, total]) => ({ label, total }))
    .sort((first, second) => second.total - first.total || first.label.localeCompare(second.label));
  const slices = totals.length > 10
    ? [...totals.slice(0, 9), { label: "Other answers (grouped)", total: totals.slice(9).reduce((sum, entry) => sum + entry.total, 0) }]
    : totals;
  return { totals, slices, answeredEntries, responseTotal: totals.reduce((sum, entry) => sum + entry.total, 0) };
};