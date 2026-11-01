import React, { useRef } from 'react';
import { FiPlus, FiRotateCcw, FiX } from 'react-icons/fi';
import { getChartableFormFields } from '../utils/formEntryTotals';
import './FormEntryFilters.css';

const FormEntryFilters = ({ fields, filters, onFiltersChange, sortField, onSortFieldChange, sortDirection, onSortDirectionChange, onReset, matchingCount, totalCount }) => {
  const nextId = useRef(0);
  const availableFields = getChartableFormFields(fields);
  const update = (id, changes) => onFiltersChange(filters.map((filter) => filter.id === id ? { ...filter, ...changes } : filter));
  const sortFields = [{ name: 'createdAt', label: 'Submission Date' }, { name: 'submittedBy', label: 'Submitted By' }, ...availableFields];

  return (
    <section className="form-entry-filters" aria-label="Entry filters and sorting">
      <div className="form-entry-filter-toolbar">
        <div><label htmlFor="entries-sort-field">Sort by</label><select id="entries-sort-field" value={sortField} onChange={(event) => onSortFieldChange(event.target.value)}>{sortFields.map((field) => <option key={field.name} value={field.name}>{field.label || field.name}</option>)}</select></div>
        <div><label htmlFor="entries-sort-direction">Order</label><select id="entries-sort-direction" value={sortDirection} onChange={(event) => onSortDirectionChange(event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></div>
        <button type="button" disabled={!availableFields.length} onClick={() => {
          const field = availableFields[0];
          onFiltersChange([...filters, { id: `filter-${nextId.current++}`, field: field.name, operator: ['number', 'date', 'boolean'].includes(field.type) ? 'equals' : 'contains', value: '' }]);
        }}><FiPlus aria-hidden="true" />Add Filter</button>
        <button type="button" onClick={onReset}><FiRotateCcw aria-hidden="true" />Reset</button>
      </div>
      {filters.map((filter, index) => {
        const field = availableFields.find((entry) => entry.name === filter.field);
        const operators = [
          ...(!['number', 'date', 'boolean'].includes(field?.type) ? [{ value: 'contains', label: 'Contains' }] : []),
          { value: 'equals', label: 'Equals' }, { value: 'notEquals', label: 'Does not equal' },
          ...(['number', 'date'].includes(field?.type) ? [{ value: 'gte', label: 'At least / On or after' }, { value: 'lte', label: 'At most / On or before' }] : []),
          { value: 'empty', label: 'Is empty' }, { value: 'notEmpty', label: 'Is not empty' },
        ];
        const noValue = ['empty', 'notEmpty'].includes(filter.operator);
        return (
          <div className="form-entry-filter-row" key={filter.id} role="group" aria-label={`Field filter ${index + 1}`}>
            <div><label htmlFor={`${filter.id}-field`}>Field</label><select id={`${filter.id}-field`} value={filter.field} onChange={(event) => {
              const next = availableFields.find((entry) => entry.name === event.target.value);
              update(filter.id, { field: event.target.value, operator: ['number', 'date', 'boolean'].includes(next?.type) ? 'equals' : 'contains', value: '' });
            }}>{availableFields.map((entry) => <option key={entry.name} value={entry.name}>{entry.label || entry.name}</option>)}</select></div>
            <div><label htmlFor={`${filter.id}-operator`}>Condition</label><select id={`${filter.id}-operator`} value={filter.operator} onChange={(event) => update(filter.id, { operator: event.target.value })}>{operators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></div>
            <div><label htmlFor={`${filter.id}-value`}>Value</label>{field?.type === 'boolean' ? (
              <select id={`${filter.id}-value`} value={filter.value} disabled={noValue} onChange={(event) => update(filter.id, { value: event.target.value })}><option value="">Any value</option><option value="Yes">Yes</option><option value="No">No</option></select>
            ) : <input id={`${filter.id}-value`} type={['number', 'date'].includes(field?.type) ? field.type : 'text'} value={filter.value} disabled={noValue} onChange={(event) => update(filter.id, { value: event.target.value })} />}</div>
            <button type="button" aria-label={`Remove filter ${index + 1}`} title="Remove filter" onClick={() => onFiltersChange(filters.filter((entry) => entry.id !== filter.id))}><FiX aria-hidden="true" /></button>
          </div>
        );
      })}
      <p className="form-entry-filter-count" role="status">{matchingCount} of {totalCount} entries</p>
    </section>
  );
};

export default FormEntryFilters;