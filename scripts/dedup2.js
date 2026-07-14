const fs = require('fs');
const file = 'src/components/ProjectListsIssuesModule.js';
let lines = fs.readFileSync(file, 'utf8').split('\n');

// Find all lines with "Auto-select" and "Ready for Review"
const indices = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Auto-select') && lines[i].includes('Ready for Review')) {
    indices.push(i);
  }
}
console.log('Comment lines found at 1-based:', indices.map(i => i+1), indices.map(i => lines[i]));

// Keep only first occurrence; remove subsequent blocks
if (indices.length > 1) {
  const toRemove = new Set();
  for (let k = 1; k < indices.length; k++) {
    const start = indices[k];
    for (let j = start; j < lines.length; j++) {
      if (lines[j].trim() === '' && j > start + 6) break;
      toRemove.add(j);
      if (lines[j].trim() === '}, [buckets]);') break;
    }
  }
  // Also remove preceding blank lines for each block
  for (const idx of [...toRemove]) {
    if (toRemove.has(idx) && !toRemove.has(idx - 1) && lines[idx - 1] === '') {
      toRemove.add(idx - 1);
    }
  }
  console.log('Removing lines:', [...toRemove].sort((a,b)=>a-b).map(i=>i+1));
  lines = lines.filter((_, i) => !toRemove.has(i));
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log('Done');
} else {
  console.log('Only one occurrence, nothing to remove');
}
