import { getChartableFormFields, getFormFieldTotals, MAX_CHART_FIELDS } from "./formEntryTotals";

test("counts answers and missing values without losing false or zero", () => {
  const result = getFormFieldTotals([{ value: false }, { value: true }, { value: 0 }, { value: " Yes " }, {}, { value: " " }], { name: "value" });
  expect(result.totals).toEqual([{ label: "No answer", total: 2 }, { label: "Yes", total: 2 }, { label: "0", total: 1 }, { label: "No", total: 1 }]);
  expect(result.answeredEntries).toBe(4);
  expect(result.responseTotal).toBe(6);
});

test("multiple-choice fields count each selected answer once per entry", () => {
  const result = getFormFieldTotals([{ choice: ["A", "B", "A"] }, { choice: ["A"] }, { choice: [] }], { name: "choice" });
  expect(result.totals).toEqual([{ label: "A", total: 2 }, { label: "B", total: 1 }, { label: "No answer", total: 1 }]);
  expect(result.answeredEntries).toBe(2);
});

test("groups large pies without losing detailed counts or total", () => {
  const entries = Array.from({ length: 15 }, (_unused, index) => ({ field: `Answer ${index}` }));
  const result = getFormFieldTotals(entries, { name: "field" });
  expect(result.totals).toHaveLength(15);
  expect(result.slices).toHaveLength(10);
  expect(result.slices[9]).toEqual({ label: "Other answers (grouped)", total: 6 });
  expect(result.slices.reduce((sum, slice) => sum + slice.total, 0)).toBe(15);
});

test("supports structured choice labels and empty result sets", () => {
  expect(getFormFieldTotals([{ field: { label: "Choice A", value: "a" } }], { name: "field" }).totals).toEqual([{ label: "Choice A", total: 1 }]);
  expect(getFormFieldTotals([], { name: "field" }).totals).toEqual([]);
});

test("excludes non-answer field types and caps chart selection at three", () => {
  expect(MAX_CHART_FIELDS).toBe(3);
  expect(getChartableFormFields([{ name: "name", type: "text" }, { name: "file", type: "file" }, { type: "heading" }])).toEqual([{ name: "name", type: "text" }]);
});