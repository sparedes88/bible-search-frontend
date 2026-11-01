import React from "react";
import { formatLeadDisplayValue, getClassInstanceLabel, LEAD_DETAIL_LISTS } from "../utils/leadOptions";

const LeadDetailFields = ({ values, options, onChange, onCreateOption, prefix, lockClassAssignment = false, hideClassInstance = false, disabled = false }) => {
  return (
  <>
    {LEAD_DETAIL_LISTS.map((list) => {
      const value = formatLeadDisplayValue(values[list.field]);
      const choices = (options[list.id] || []).map(formatLeadDisplayValue);
      return (
        <div className="col-sm-6 col-md-3" key={list.id}>
          <label className="form-label" htmlFor={`${prefix}-${list.field}`}>
            {list.singular.charAt(0).toUpperCase() + list.singular.slice(1)}
          </label>
          {list.field === "cityState" ? (
            <div className="lead-city-state-field">
              <input
                id={`${prefix}-${list.field}`}
                type="text"
                className="form-control"
                list={`${prefix}-${list.field}-options`}
                value={value}
                onChange={onChange(list.field)}
                placeholder="City, State"
                autoComplete="off"
                disabled={disabled}
              />
              <datalist id={`${prefix}-${list.field}-options`}>
                {[...new Set([value, ...choices].filter(Boolean))].map((choice) => <option key={choice} value={choice} />)}
              </datalist>
              {value && !choices.some((choice) => choice.toLowerCase() === value.toLowerCase()) && onCreateOption && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onCreateOption(list.id, value)} disabled={disabled}>Add to options</button>
              )}
            </div>
          ) : (
            <select
              id={`${prefix}-${list.field}`}
              className="form-select"
              value={value}
              onChange={onChange(list.field)}
              disabled={disabled || (lockClassAssignment && list.field === "classType")}
            >
              <option value="">Select {list.singular}</option>
              {value && !choices.includes(value) && <option value={value}>{value}</option>}
              {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          )}
        </div>
      );
    })}
    {!hideClassInstance && <div className="col-sm-6 col-md-3">
      <label className="form-label" htmlFor={`${prefix}-classInstanceId`}>Class instance</label>
      <select
        id={`${prefix}-classInstanceId`}
        className="form-select"
        value={values.classInstanceId || ""}
        onChange={onChange("classInstanceId")}
        disabled={disabled || lockClassAssignment || !values.classType}
      >
        <option value="">Select class instance</option>
        {values.classInstanceId && !options.classInstances.some((instance) => instance.id === values.classInstanceId && instance.classType === values.classType) && (
          <option value={values.classInstanceId}>{values.classInstance ? getClassInstanceLabel(values.classInstance) : "Saved class instance"}</option>
        )}
        {options.classInstances.filter((instance) => instance.classType === values.classType)
          .sort((first, second) => first.startDate.localeCompare(second.startDate))
          .map((instance) => <option key={instance.id} value={instance.id}>{getClassInstanceLabel(instance)}</option>)}
      </select>
    </div>}
    <div className="col-sm-6 col-md-3 ms-md-auto">
      <label className="form-label" htmlFor={`${prefix}-callbackTime`}>Best callback time</label>
      <input id={`${prefix}-callbackTime`} type="time" className="form-control" value={values.callbackTime || ""} onChange={onChange("callbackTime")} disabled={disabled} />
    </div>
  </>
  );
};

export default LeadDetailFields;