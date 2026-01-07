#!/usr/bin/env node
/**
 * Script to pre-generate color palettes for all categorical columns.
 * This avoids blocking the UI during initial load.
 * 
 * Run: node scripts/generate-palettes.js
 */

import { Database } from 'duckdb-async';
import iwanthue from 'iwanthue';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// High quality iwanthue settings - optimized for maximum color distinction
const IWANTHUE_SETTINGS = {
  colorSpace: 'default',
  clustering: 'force-vector', // Best quality but slower
  quality: 200, // Higher = better quality (default is 50)
  ultraPrecision: true,
  seed: 42 // For reproducibility
};

// Columns that should be treated as categorical (strings with limited unique values)
const MAX_CATEGORICAL_UNIQUE = 1000;

async function generatePalettes() {
  const parquetPath = join(__dirname, '../public/data/plasmid-network-points.parquet');
  const configPath = join(__dirname, '../public/data/plasmid-network-config.json');
  const outputPath = join(__dirname, '../public/data/color-palettes.json');
  
  console.log('Loading config...');
  const config = JSON.parse(await readFile(configPath, 'utf-8'));
  
  console.log('Connecting to DuckDB...');
  const db = await Database.create(':memory:');
  
  // Get column info from parquet
  console.log('Analyzing parquet schema...');
  const schemaInfo = await db.all(`DESCRIBE SELECT * FROM '${parquetPath}' LIMIT 1`);
  
  // Filter to string/varchar columns from pointIncludeColumns
  const includeColumns = config.pointIncludeColumns || [];
  const stringColumns = schemaInfo
    .filter(col => 
      (col.column_type === 'VARCHAR' || col.column_type === 'STRING') &&
      includeColumns.includes(col.column_name)
    )
    .map(col => col.column_name);
  
  console.log(`Found ${stringColumns.length} string columns to analyze`);
  
  const palettes = {};
  
  for (const colName of stringColumns) {
    console.log(`\nProcessing ${colName}...`);
    
    // Get actual unique count from parquet
    const countResult = await db.all(`
      SELECT COUNT(DISTINCT "${colName}") as cnt 
      FROM '${parquetPath}'
      WHERE "${colName}" IS NOT NULL
    `);
    const uniqueCount = Number(countResult[0].cnt);
    
    console.log(`  Unique values: ${uniqueCount}`);
    
    if (uniqueCount > 0 && uniqueCount <= MAX_CATEGORICAL_UNIQUE) {
      // Generate palette with actual count
      console.log(`  Generating palette with ${uniqueCount} colors (quality: ${IWANTHUE_SETTINGS.quality})...`);
      const startTime = Date.now();
      
      const colors = iwanthue(uniqueCount, {
        ...IWANTHUE_SETTINGS,
        seed: colName // Use column name as seed for reproducibility
      });
      
      const elapsed = Date.now() - startTime;
      console.log(`  Generated in ${elapsed}ms`);
      
      palettes[colName] = colors;
    } else if (uniqueCount > MAX_CATEGORICAL_UNIQUE) {
      console.log(`  Skipping - too many unique values (${uniqueCount})`);
    }
  }
  
  console.log('\nWriting palettes to', outputPath);
  await writeFile(outputPath, JSON.stringify(palettes, null, 2));
  
  await db.close();
  console.log('Done!');
}

generatePalettes().catch(console.error);
