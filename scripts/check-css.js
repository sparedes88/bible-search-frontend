const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
      continue;
    }
    if (!p.endsWith('.css')) continue;

    const css = fs.readFileSync(p, 'utf8');
    try {
      postcss.parse(css, { from: p });
    } catch (error) {
      console.error('CSS parse error in', p);
      console.error(error.reason || error.message);
      console.error('Line', error.line, 'Col', error.column);
      process.exit(1);
    }
  }
}

walk(path.join(process.cwd(), 'src'));
console.log('All CSS parsed OK');
