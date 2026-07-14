const fs = require('fs');
const file = 'src/components/ProjectListsIssuesModule.js';
const lines = fs.readFileSync(file, 'utf8').split('\n');

// Find all occurrences of the useEffect comment
const marker = '  // Auto-select Ready for Review bucket as default for issue import';
const markerAlt = '  // Auto-select "Ready for Review" bucket as default for issue import';
const blockLen = 9; // comment + useEffect 7 lines + blank

let occurrences = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i] === marker || lines[i] === markerAlt) {
    occurrences.push(i);
  }
}
console.log('Found occurrences at lines:', occurrences.map(i => i+1));

// Remove all but the last occurrence
// Remove in reverse order to preserve indices
const toRemove = new Set();
for (let k = 0; k < occurrences.length - 1; k++) {
  const start = occurrences[k];
  // remove from comment line through }, [buckets]); line
  for (let j = start; j < lines.length; j++) {
    toRemove.add(j);
    if (lines[j].trim() === '}, [buckets]);') break;
  }
}

console.log('Removing line numbers:', [...toRemove].map(i => i+1).sort((a,b)=>a-b));
const result = lines.filter((_, i) => !toRemove.has(i));
fs.writeFileSync(file, result.join('\n'), 'utf8');
console.log('Done');
