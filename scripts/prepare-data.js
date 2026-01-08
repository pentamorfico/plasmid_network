#!/usr/bin/env node
/**
 * Convert plasmid network data to Cosmograph format.
 *
 * This script:
 * 1. Reads nodes and edges parquet files
 * 2. Adds idx column to nodes (0, 1, 2, ...)
 * 3. Creates id -> idx mapping
 * 4. Adds sourceidx and targetidx to edges
 * 5. Filters edges to only include valid connections
 * 6. Saves prepared data as parquet files
 * 7. Creates configuration JSON
 *
 * Usage:
 *   npm run prepare-data                    # Process all data
 *   node scripts/prepare-data.js 1000       # Limit to 1000 nodes
 *   node scripts/prepare-data.js 1000 5000  # Limit to 1000 nodes and 5000 edges
 */

import { Database } from 'duckdb-async';
import { writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const INPUT_NODES = join(__dirname, '../public/data/nodes.parquet');
const INPUT_EDGES = join(__dirname, '../public/data/edges.parquet');
const OUTPUT_NODES = join(__dirname, '../public/data/plasmid-network-points.parquet');
const OUTPUT_EDGES = join(__dirname, '../public/data/plasmid-network-links.parquet');
const OUTPUT_CONFIG = join(__dirname, '../public/data/plasmid-network-config.json');

// Limits (set to null to process all data)
// Can be overridden via command line args: node prepare-data.js [maxNodes] [maxEdges]
const MAX_NODES = process.argv[2] ? parseInt(process.argv[2], 10) : null;
const MAX_EDGES = process.argv[3] ? parseInt(process.argv[3], 10) : null;

async function main() {
  console.log('🚀 Starting Cosmograph data preparation...');
  console.log(`   Input nodes: ${INPUT_NODES}`);
  console.log(`   Input edges: ${INPUT_EDGES}`);
  if (MAX_NODES) console.log(`   Limit nodes: ${MAX_NODES.toLocaleString()}`);
  if (MAX_EDGES) console.log(`   Limit edges: ${MAX_EDGES.toLocaleString()}`);
  console.log();

  const db = await Database.create(':memory:');

  // ========================================
  // Step 1: Load and prepare nodes
  // ========================================
  console.log('📊 Loading nodes...');
  
  // Get total count
  const totalNodes = await db.all(`SELECT COUNT(*) as cnt FROM '${INPUT_NODES}'`);
  console.log(`   Total nodes in file: ${Number(totalNodes[0].cnt).toLocaleString()}`);

  // Load nodes with limit and add idx
  const limitClause = MAX_NODES ? `LIMIT ${MAX_NODES}` : '';
  await db.run(`
    CREATE TABLE nodes AS
    SELECT *, ROW_NUMBER() OVER () - 1 AS idx
    FROM '${INPUT_NODES}'
    ${limitClause}
  `);

  const nodeCount = await db.all('SELECT COUNT(*) as cnt FROM nodes');
  const numNodes = Number(nodeCount[0].cnt);
  if (MAX_NODES) {
    console.log(`   Limited to: ${numNodes.toLocaleString()} nodes`);
  }
  console.log(`   Added 'idx' column (0 to ${numNodes - 1})`);

  // Get node columns
  const nodeColumns = await db.all('DESCRIBE nodes');
  const nodeColNames = nodeColumns.map(c => c.column_name);
  console.log(`   Node columns (${nodeColNames.length}): ${nodeColNames.slice(0, 10).join(', ')}...`);
  console.log();

  // ========================================
  // Step 2: Load and prepare edges
  // ========================================
  console.log('📊 Loading edges...');

  // Get total count
  const totalEdges = await db.all(`SELECT COUNT(*) as cnt FROM '${INPUT_EDGES}'`);
  console.log(`   Total edges in file: ${Number(totalEdges[0].cnt).toLocaleString()}`);

  // Load edges with limit
  const edgeLimitClause = MAX_EDGES ? `LIMIT ${MAX_EDGES}` : '';
  
  // Check if weight column exists
  const edgeSchema = await db.all(`DESCRIBE SELECT * FROM '${INPUT_EDGES}' LIMIT 1`);
  const edgeColNames = edgeSchema.map(c => c.column_name);
  const hasWeight = edgeColNames.includes('weight');

  await db.run(`
    CREATE TABLE edges_raw AS
    SELECT *${hasWeight ? '' : ', 1.0 AS weight'}
    FROM '${INPUT_EDGES}'
    ${edgeLimitClause}
  `);

  if (!hasWeight) {
    console.log("   Added default 'weight' column (all 1.0)");
  }

  const rawEdgeCount = await db.all('SELECT COUNT(*) as cnt FROM edges_raw');
  const numRawEdges = Number(rawEdgeCount[0].cnt);
  if (MAX_EDGES) {
    console.log(`   Limited to: ${numRawEdges.toLocaleString()} edges`);
  }

  // Add sourceidx and targetidx by joining with nodes
  console.log('   Mapping source and target to indices...');
  await db.run(`
    CREATE TABLE edges AS
    SELECT 
      e.*,
      n1.idx AS sourceidx,
      n2.idx AS targetidx
    FROM edges_raw e
    INNER JOIN nodes n1 ON e.source = n1.id
    INNER JOIN nodes n2 ON e.target = n2.id
  `);

  const finalEdgeCount = await db.all('SELECT COUNT(*) as cnt FROM edges');
  const numFinalEdges = Number(finalEdgeCount[0].cnt);
  const filteredOut = numRawEdges - numFinalEdges;

  console.log(`   Valid edges (both nodes exist): ${numFinalEdges.toLocaleString()} (${filteredOut.toLocaleString()} filtered out)`);

  // Get final edge columns
  const finalEdgeColumns = await db.all('DESCRIBE edges');
  const finalEdgeColNames = finalEdgeColumns.map(c => c.column_name);
  console.log(`   Edge columns (${finalEdgeColNames.length}): ${finalEdgeColNames.join(', ')}`);
  console.log();

  // ========================================
  // Step 3: Save prepared data
  // ========================================
  console.log('💾 Saving prepared data...');

  // Save nodes
  await db.run(`COPY nodes TO '${OUTPUT_NODES}' (FORMAT PARQUET)`);
  console.log(`   ✅ Nodes saved to: ${OUTPUT_NODES}`);
  console.log(`      Rows: ${numNodes.toLocaleString()}, Columns: ${nodeColNames.length + 1}`);

  // Save edges
  await db.run(`COPY edges TO '${OUTPUT_EDGES}' (FORMAT PARQUET)`);
  console.log(`   ✅ Edges saved to: ${OUTPUT_EDGES}`);
  console.log(`      Rows: ${numFinalEdges.toLocaleString()}, Columns: ${finalEdgeColNames.length}`);
  console.log();

  // ========================================
  // Step 4: Create configuration JSON
  // ========================================
  console.log('📝 Creating configuration JSON...');

  // Detect all columns to include (exclude coordinate and index columns)
  const excludeCols = new Set(['id', 'idx', 'x', 'y', 'source', 'target', 'sourceidx', 'targetidx', 'weight']);
  const includeColumns = nodeColNames.filter(col => !excludeCols.has(col));

  const config = {
    pointIdBy: 'id',
    pointIndexBy: 'idx',
    pointXBy: 'x',
    pointYBy: 'y',
    pointColorBy: 'Ecosystem_category',
    pointSizeBy: 'length',
    pointIncludeColumns: includeColumns,
    linkSourceBy: 'source',
    linkTargetBy: 'target',
    linkSourceIndexBy: 'sourceidx',
    linkTargetIndexBy: 'targetidx',
    linkWidthBy: 'weight'
  };

  await writeFile(OUTPUT_CONFIG, JSON.stringify(config, null, 2));

  console.log(`   ✅ Config saved to: ${OUTPUT_CONFIG}`);
  console.log(`      Including ${includeColumns.length} additional columns`);
  console.log();

  // ========================================
  // Summary
  // ========================================
  console.log('='.repeat(60));
  console.log('✨ Preparation complete!');
  console.log('='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Points: ${numNodes.toLocaleString()} nodes with ${nodeColNames.length + 1} columns`);
  console.log(`   Links:  ${numFinalEdges.toLocaleString()} edges with ${finalEdgeColNames.length} columns`);
  console.log(`   Config: ${OUTPUT_CONFIG}`);
  console.log();
  console.log('📋 Included columns:');
  for (const col of includeColumns.slice(0, 20)) {
    console.log(`   • ${col}`);
  }
  if (includeColumns.length > 20) {
    console.log(`   ... and ${includeColumns.length - 20} more`);
  }

  await db.close();
}

main().catch(console.error);
