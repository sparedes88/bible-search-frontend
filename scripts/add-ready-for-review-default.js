const fs = require('fs');
const file = 'src/components/ProjectListsIssuesModule.js';
let content = fs.readFileSync(file, 'utf8');
const anchor = '  }, [bucketsRef]);';
const idx = content.indexOf(anchor);
console.log('Anchor found at index:', idx);
if (idx >= 0) {
  const insertAt = idx + anchor.length;
  const insert = [
    '',
    '',
    '  // Auto-select Ready for Review bucket as default for issue import',
    '  useEffect(() => {',
    '    const readyBucket = buckets.find((b) => String(b.name || "").trim().toLowerCase() === "ready for review");',
    '    if (readyBucket) {',
    '      setImportIssuesDefaultBucketId((prev) => prev || readyBucket.id);',
    '    }',
    '  }, [buckets]);',
  ].join('\n');
  content = content.slice(0, insertAt) + insert + content.slice(insertAt);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Done');
} else {
  console.log('Anchor not found - searching for alternatives...');
  const lines = content.split('\n');
  lines.forEach((l, i) => { if (l.includes('bucketsRef')) console.log(i+1, l); });
}
