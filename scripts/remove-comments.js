import { readFile, writeFile } from 'fs/promises';
import { readdir } from 'fs/promises';
import { join } from 'path';
import stripComments from 'strip-comments';

async function getAllFiles(dir, extensions = ['.ts', '.tsx', '.js', '.jsx']) {
  const files = [];
  const items = await readdir(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...await getAllFiles(fullPath, extensions));
    } else if (extensions.some(ext => item.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  
  return files;
}

async function removeCommentsFromFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stripped = stripComments(content, { preserveNewlines: true });
    await writeFile(filePath, stripped, 'utf-8');
    console.log(`✅ ${filePath}`);
  } catch (err) {
    console.error(`❌ ${filePath}: ${err.message}`);
  }
}

const srcDir = 'src';
const files = await getAllFiles(srcDir);

console.log(`🚀 Removing comments from ${files.length} files...\n`);

for (const file of files) {
  await removeCommentsFromFile(file);
}

console.log(`\n✨ Done! Processed ${files.length} files.`);
