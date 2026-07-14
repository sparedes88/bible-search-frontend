const fs = require('fs');
const file = 'src/components/ProjectListsIssuesModule.js';
let content = fs.readFileSync(file, 'utf8');

// The block we want to keep exactly once
const goodBlock = `
  // Auto-select Ready for Review bucket as default for issue import
  useEffect(() => {
    const readyBucket = buckets.find((b) => String(b.name || "").trim().toLowerCase() === "ready for review");
    if (readyBucket) {
      setImportIssuesDefaultBucketId((prev) => prev || readyBucket.id);
    }
  }, [buckets]);`;

// Remove all variants of the block (multiple patterns from failed attempts)
const patterns = [
  /\n\n  \/\/ Auto-select Ready for Review bucket as default for issue import\n  useEffect\(\(\) => \{\n    const readyBucket = buckets\.find[\s\S]*?  \}, \[buckets\]\);/g
];

for (const pat of patterns) {
  content = content.replace(pat, '');
}

// Now insert once after }, [bucketsRef]);
const anchor = '  }, [bucketsRef]);';
const idx = content.indexOf(anchor);
console.log('Anchor at index:', idx);
if (idx >= 0) {
  const insertAt = idx + anchor.length;
  content = content.slice(0, insertAt) + goodBlock + '\n' + content.slice(insertAt);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Done - cleaned and inserted once');
}
