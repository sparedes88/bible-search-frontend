/**
 * Script to add lazy loading to all images
 * Run with: node scripts/add-lazy-loading.js
 * 
 * This script finds all <img> tags without loading="lazy" and adds it
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src');

function findJSFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
      findJSFiles(filePath, fileList);
    } else if (file.endsWith('.js') || file.endsWith('.jsx')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function addLazyLoading(content) {
  // Pattern to match <img> tags without loading attribute
  const imgPattern = /<img\s+([^>]*?)(?<!loading=["'])(?<!loading=)([^>]*?)>/g;
  
  let modified = content;
  let count = 0;
  
  // Find all img tags
  const imgMatches = content.matchAll(/<img\s+([^>]*?)>/g);
  
  for (const match of imgMatches) {
    const fullMatch = match[0];
    const attributes = match[1];
    
    // Skip if already has loading attribute
    if (attributes.includes('loading=')) {
      continue;
    }
    
    // Skip if it's a self-closing OptimizedImage or LazyImage component
    if (attributes.includes('OptimizedImage') || attributes.includes('LazyImage')) {
      continue;
    }
    
    // Add loading="lazy" and error handler
    let newAttributes = attributes.trim();
    
    // Add loading="lazy" if not present
    if (!newAttributes.includes('loading=')) {
      newAttributes += ' loading="lazy"';
    }
    
    // Add onError handler if not present
    if (!newAttributes.includes('onError=')) {
      newAttributes += ' onError={(e) => { e.target.src = \'/img/image-fallback.svg\'; }}';
    }
    
    const newTag = `<img ${newAttributes}>`;
    modified = modified.replace(fullMatch, newTag);
    count++;
  }
  
  return { modified, count };
}

// Main execution
const jsFiles = findJSFiles(srcDir);
let totalModified = 0;

console.log(`Found ${jsFiles.length} JavaScript files\n`);

jsFiles.forEach(file => {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const { modified, count } = addLazyLoading(content);
    
    if (count > 0) {
      fs.writeFileSync(file, modified, 'utf8');
      console.log(`✅ Updated ${count} image(s) in ${path.relative(srcDir, file)}`);
      totalModified += count;
    }
  } catch (error) {
    console.error(`❌ Error processing ${file}:`, error.message);
  }
});

console.log(`\n✨ Total: ${totalModified} images updated with lazy loading`);




