import React from "react";

export default function MultiSelectDropdown({ options, value, onChange, placeholder }) {
  // value: array of selected strings
  const handleToggle = (option) => {
    if (value.includes(option)) {
      onChange(value.filter((v) => v !== option));
    } else {
      onChange([...value, option]);
    }
  };
  return (
    <div className="multi-select-dropdown" style={{ border: "1px solid #ccc", borderRadius: 4, padding: 6, minHeight: 38 }}>
      {options.map((opt) => (
        <label key={opt} style={{ marginRight: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={value.includes(opt)}
            onChange={() => handleToggle(opt)}
          />
          {opt}
        </label>
      ))}
      {options.length === 0 && <span style={{ color: "#888" }}>{placeholder || "No options"}</span>}
    </div>
  );
}
