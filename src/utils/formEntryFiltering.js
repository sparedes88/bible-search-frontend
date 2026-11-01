export const isEmptyFormValue = (value) => value == null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.every(isEmptyFormValue));

const textValue = (value) => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(textValue).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'object') return textValue(value.label ?? value.value ?? '');
  return String(value);
};

const comparableValue = (value, field) => {
  if (field.type === 'number') return Number(textValue(value));
  if (field.type === 'date' || field.name === 'createdAt') {
    const date = new Date(textValue(value));
    return date.getTime();
  }
  return textValue(value).trim();
};

export const filterAndSortFormEntries = (entries, fields = [], { searchTerm = '', filters = [], sortField = 'createdAt', sortDirection = 'desc' } = {}) => {
  const fieldMap = new Map([...fields, { name: 'createdAt', type: 'date' }, { name: 'submittedBy', type: 'text' }].map((field) => [field.name, field]));
  const normalize = (value) => textValue(value).trim().toLowerCase();
  const search = normalize(searchTerm);
  const filtered = entries.filter((entry) => {
    if (search && !fields.some((field) => normalize(entry[field.name]).includes(search))) return false;
    return filters.every((filter) => {
      const field = fieldMap.get(filter.field);
      if (!field) return true;
      const value = entry[filter.field];
      if (filter.operator === 'empty') return isEmptyFormValue(value);
      if (filter.operator === 'notEmpty') return !isEmptyFormValue(value);
      if (isEmptyFormValue(filter.value)) return true;
      if (filter.operator === 'gte' || filter.operator === 'lte') {
        if (isEmptyFormValue(value)) return false;
        let actual = comparableValue(value, field);
        let expected = comparableValue(filter.value, field);
        if (field.type === 'date' || field.name === 'createdAt') {
          if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
          actual = textValue(value).slice(0, 10);
          expected = textValue(filter.value).slice(0, 10);
        } else if (typeof actual !== 'number' || !Number.isFinite(actual) || !Number.isFinite(expected)) return false;
        return filter.operator === 'gte' ? actual >= expected : actual <= expected;
      }
      const expected = normalize(filter.value);
      const answers = (Array.isArray(value) ? value : [value]).map(normalize);
      const equal = field.type === 'number'
        ? !isEmptyFormValue(value) && Number.isFinite(Number(expected)) && Number(textValue(value)) === Number(expected)
        : answers.some((answer) => field.type === 'date' ? answer.slice(0, 10) === expected : answer === expected);
      if (filter.operator === 'equals') return equal;
      if (filter.operator === 'notEquals') return !equal;
      return normalize(value).includes(expected);
    });
  });
  const field = fieldMap.get(sortField);
  if (!field) return filtered;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...filtered].sort((first, second) => {
    const firstEmpty = isEmptyFormValue(first[sortField]);
    const secondEmpty = isEmptyFormValue(second[sortField]);
    if (firstEmpty || secondEmpty) return firstEmpty === secondEmpty ? 0 : firstEmpty ? 1 : -1;
    const firstValue = comparableValue(first[sortField], field);
    const secondValue = comparableValue(second[sortField], field);
    const comparison = typeof firstValue === 'number' && typeof secondValue === 'number' && Number.isFinite(firstValue) && Number.isFinite(secondValue)
      ? firstValue - secondValue : collator.compare(String(firstValue), String(secondValue));
    return sortDirection === 'asc' ? comparison : -comparison;
  });
};