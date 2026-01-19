export const states = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  // ... Add all US states
  { value: 'WY', label: 'Wyoming' },
  // Add common international regions/provinces
  { value: 'ON', label: 'Ontario' },
  { value: 'BC', label: 'British Columbia' },
  // ... etc
];

export const majorCities = {
  'AL': ['Birmingham', 'Montgomery', 'Mobile'],
  'AK': ['Anchorage', 'Fairbanks', 'Juneau'],
  // ... Add cities for each state
  'ON': ['Toronto', 'Ottawa', 'Hamilton'],
  // ... etc
};

export const countries = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'MX', label: 'Mexico' },
  // Add more countries as needed
];

// Sample postal code patterns for validation
export const postalCodePatterns = {
  'US': /^\d{5}(-\d{4})?$/,  // US: 12345 or 12345-6789
  'CA': /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/,  // CA: A1A 1A1
  'MX': /^\d{5}$/,  // MX: 12345
};

export const validatePostalCode = (code, country) => {
  if (!code || !country) return true; // Allow empty values
  const pattern = postalCodePatterns[country];
  return pattern ? pattern.test(code) : true; // If no pattern exists for country, return true
};

export const formatPostalCode = (code, country) => {
  if (!code) return '';
  
  switch(country) {
    case 'CA':
      // Format Canadian postal code: A1A 1A1
      code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3,6)}` : code;
    case 'US':
      // Format US ZIP: 12345 or 12345-6789
      code = code.replace(/[^0-9-]/g, '');
      if (code.includes('-')) {
        const [main, ext] = code.split('-');
        return `${main.slice(0,5)}-${ext.slice(0,4)}`;
      }
      return code.slice(0,5);
    default:
      return code;
  }
};
