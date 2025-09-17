export const findDuplicateLocation = (inputValue, options) => {
  if (!inputValue) return null;
  
  const normalizedInput = inputValue.trim().toLowerCase();
  
  // Check for exact matches
  const exactMatch = options.find(opt => 
    opt.label.toLowerCase() === normalizedInput ||
    opt.value.toLowerCase() === normalizedInput
  );
  if (exactMatch) return exactMatch;

  // Check for close matches (optional)
  const closeMatch = options.find(opt => 
    opt.label.toLowerCase().includes(normalizedInput) ||
    opt.value.toLowerCase().includes(normalizedInput)
  );
  if (closeMatch) return closeMatch;

  return null;
};

export const createLocationOption = (inputValue) => {
  const normalized = inputValue.trim();
  const firstChar = normalized.charAt(0).toUpperCase();
  const rest = normalized.slice(1).toLowerCase();
  const formattedValue = firstChar + rest;
  
  return {
    label: formattedValue,
    value: formattedValue
  };
};
