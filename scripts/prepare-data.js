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
import { readFile, writeFile } from 'fs/promises';
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

  // Load nodes with limit
  const limitClause = MAX_NODES ? `LIMIT ${MAX_NODES}` : '';
  await db.run(`
    CREATE TABLE nodes_raw AS
    SELECT *
    FROM '${INPUT_NODES}'
    WHERE domain != 'Eukaryota'
    ${limitClause}
  `);
  
  // Apply transformations and add log columns
  console.log('   Applying data transformations...');
  
  // First, normalize empty/null values across all string columns
  console.log('   Normalizing empty values (-, nan, null, etc.)...');
  const rawColumnsInfo = await db.all('DESCRIBE nodes_raw');
  const columnsToNormalize = rawColumnsInfo.filter(c => 
    c.column_type === 'VARCHAR' || c.column_type.includes('VARCHAR')
  ).map(c => c.column_name);
  
  const normalizedSelects = rawColumnsInfo.map(col => {
    const colName = col.column_name;
    if (columnsToNormalize.includes(colName)) {
      // Normalize empty values to empty string for string columns
      return `CASE 
        WHEN "${colName}" IN ('-', 'nan', 'NaN', 'null', 'NULL', 'NA', 'N/A', 'None', '') THEN ''
        WHEN TRIM("${colName}") = '' THEN ''
        ELSE "${colName}"
      END AS "${colName}"`;
    }
    return `"${colName}"`;
  }).join(',\n      ');
  
  await db.run(`CREATE TABLE nodes_clean AS SELECT ${normalizedSelects} FROM nodes_raw`);
  await db.run(`DROP TABLE nodes_raw`);
  await db.run(`ALTER TABLE nodes_clean RENAME TO nodes_raw`);
  
  // Get existing columns to know which ones to exclude
  const rawColumns = await db.all('DESCRIBE nodes_raw');
  const existingCols = new Set(rawColumns.map(c => c.column_name));
  
  // Build EXCLUDE list for columns we want to recreate or don't want at all
  const excludeCols = [
    'topology', 'putative_phage_plasmid',  // Replace with normalized versions
    'num_def_sys_host', 'num_Anti_sys_host',
    'log2_length', 'log10_length',
    'log2_total_chromosome_length_host', 'log10_total_chromosome_length_host',
    'log2_PCN', 'log10_PCN',
    'log2_num_def_sys', 'log10_num_def_sys',
    'log2_num_PDC_sys', 'log10_num_PDC_sys',
    'log2_num_Anti_sys', 'log10_num_Anti_sys',
    'log2_num_amr', 'log10_num_amr',
    'log2_num_plasmids', 'log10_num_plasmids',
    'log2_num_def_sys_host', 'log10_num_def_sys_host',
    'log2_num_Anti_sys_host', 'log10_num_Anti_sys_host',
    'log2_avg_dice_similarity', 'log10_avg_dice_similarity',
    // Exclude unwanted binary columns (specific mpf, relaxase, orit variants)
    'mpf_MPF_F', 'mpf_MPF_G', 'mpf_MPF_I', 'mpf_MPF_T',
    'relaxase_MOBB', 'relaxase_MOBC', 'relaxase_MOBF', 'relaxase_MOBH', 'relaxase_MOBM', 'relaxase_MOBP', 'relaxase_MOBQ', 'relaxase_MOBT', 'relaxase_MOBV',
    'orit_MOBB', 'orit_MOBC', 'orit_MOBF', 'orit_MOBH', 'orit_MOBP', 'orit_MOBQ', 'orit_MOBV',
    // Exclude technical/internal columns that shouldn't be visible
    'ecosystem', 'Member', 'PTU_sHSBM (10)', 'cluster', 'depth', 'is_representative',
    // Exclude metadata columns
    'sample_id', 'Representative'
  ].filter(col => existingCols.has(col));
  
  const excludeClause = excludeCols.length > 0 ? `EXCLUDE (${excludeCols.map(col => `"${col}"`).join(', ')})` : '';
  
  await db.run(`
    CREATE TABLE nodes AS
    SELECT 
      * ${excludeClause},
      ROW_NUMBER() OVER () - 1 AS idx,
      -- Convert string host columns to numeric
      TRY_CAST(num_def_sys_host AS DOUBLE) AS num_def_sys_host,
      TRY_CAST(num_Anti_sys_host AS DOUBLE) AS num_Anti_sys_host,
      -- Normalize topology
      CASE 
        WHEN LOWER(topology) = 'linear' THEN 'Linear'
        WHEN LOWER(topology) = 'circular' THEN 'Circular'
        WHEN topology IS NULL OR LOWER(topology) = 'not-set' THEN 'Unknown'
        ELSE topology
      END AS topology_normalized,
      -- Normalize putative_phage_plasmid to TRUE/FALSE (original values are Yes/No)
      CASE 
        WHEN LOWER(putative_phage_plasmid) IN ('yes', 'true', '1') THEN 'TRUE'
        WHEN LOWER(putative_phage_plasmid) IN ('no', 'false', '0') THEN 'FALSE'
        ELSE 'FALSE'
      END AS putative_phage_plasmid_normalized,
      -- Add log-transformed columns for ALL numeric columns (both log2 and log10)
      CASE WHEN length > 0 THEN LOG2(length) ELSE NULL END AS log2_length,
      CASE WHEN length > 0 THEN LOG10(length) ELSE NULL END AS log10_length,
      CASE WHEN total_chromosome_length_host > 0 THEN LOG2(total_chromosome_length_host) ELSE NULL END AS log2_total_chromosome_length_host,
      CASE WHEN total_chromosome_length_host > 0 THEN LOG10(total_chromosome_length_host) ELSE NULL END AS log10_total_chromosome_length_host,
      CASE WHEN PCN > 0 THEN LOG2(PCN) ELSE NULL END AS log2_PCN,
      CASE WHEN PCN > 0 THEN LOG10(PCN) ELSE NULL END AS log10_PCN,
      CASE WHEN num_def_sys > 0 THEN LOG2(num_def_sys) ELSE NULL END AS log2_num_def_sys,
      CASE WHEN num_def_sys > 0 THEN LOG10(num_def_sys) ELSE NULL END AS log10_num_def_sys,
      CASE WHEN num_PDC_sys > 0 THEN LOG2(num_PDC_sys) ELSE NULL END AS log2_num_PDC_sys,
      CASE WHEN num_PDC_sys > 0 THEN LOG10(num_PDC_sys) ELSE NULL END AS log10_num_PDC_sys,
      CASE WHEN num_Anti_sys > 0 THEN LOG2(num_Anti_sys) ELSE NULL END AS log2_num_Anti_sys,
      CASE WHEN num_Anti_sys > 0 THEN LOG10(num_Anti_sys) ELSE NULL END AS log10_num_Anti_sys,
      CASE WHEN num_amr > 0 THEN LOG2(num_amr) ELSE NULL END AS log2_num_amr,
      CASE WHEN num_amr > 0 THEN LOG10(num_amr) ELSE NULL END AS log10_num_amr,
      CASE WHEN num_plasmids > 0 THEN LOG2(num_plasmids) ELSE NULL END AS log2_num_plasmids,
      CASE WHEN num_plasmids > 0 THEN LOG10(num_plasmids) ELSE NULL END AS log10_num_plasmids,
      CASE WHEN TRY_CAST(num_def_sys_host AS DOUBLE) > 0 THEN LOG2(TRY_CAST(num_def_sys_host AS DOUBLE)) ELSE NULL END AS log2_num_def_sys_host,
      CASE WHEN TRY_CAST(num_def_sys_host AS DOUBLE) > 0 THEN LOG10(TRY_CAST(num_def_sys_host AS DOUBLE)) ELSE NULL END AS log10_num_def_sys_host,
      CASE WHEN TRY_CAST(num_Anti_sys_host AS DOUBLE) > 0 THEN LOG2(TRY_CAST(num_Anti_sys_host AS DOUBLE)) ELSE NULL END AS log2_num_Anti_sys_host,
      CASE WHEN TRY_CAST(num_Anti_sys_host AS DOUBLE) > 0 THEN LOG10(TRY_CAST(num_Anti_sys_host AS DOUBLE)) ELSE NULL END AS log10_num_Anti_sys_host,
      CASE WHEN avg_dice_similarity > 0 THEN LOG2(avg_dice_similarity) ELSE NULL END AS log2_avg_dice_similarity,
      CASE WHEN avg_dice_similarity > 0 THEN LOG10(avg_dice_similarity) ELSE NULL END AS log10_avg_dice_similarity,
      -- Rename Ecosystem_1 to Ecosystem
      "Ecosystem_1" AS "Ecosystem"
    FROM nodes_raw
  `);
  
  await db.run('DROP TABLE nodes_raw');

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
  // Step 3: Load column display names and rename columns
  // ========================================
  console.log('📖 Loading column display names...');
  
  let columnDisplayNames = {};
  try {
    const configData = await readFile(OUTPUT_CONFIG, 'utf-8');
    const config = JSON.parse(configData);
    columnDisplayNames = config.columnDisplayNames || {};
    console.log(`   Found ${Object.keys(columnDisplayNames).length} display names`);
  } catch (err) {
    console.log('   No existing config found, using original column names');
  }

  // Build SELECT with renamed columns
  const allNodeColumns = await db.all('DESCRIBE nodes');
  const renamedSelects = allNodeColumns.map(col => {
    const colName = col.column_name;
    const displayName = columnDisplayNames[colName];
    
    if (displayName && displayName !== colName) {
      // Always escape both names for safety
      return `"${colName}" AS "${displayName}"`;
    }
    
    // Keep original name but always escape for safety
    return `"${colName}"`;
  }).join(', ');

  console.log('🔄 Renaming columns...');
  await db.run(`CREATE TABLE nodes_renamed AS SELECT ${renamedSelects} FROM nodes`);

  // ========================================
  // Step 4: Save prepared data
  // ========================================
  console.log('💾 Saving prepared data...');

  // Save nodes with renamed columns
  await db.run(`COPY nodes_renamed TO '${OUTPUT_NODES}' (FORMAT PARQUET)`);
  console.log(`   ✅ Nodes saved to: ${OUTPUT_NODES}`);
  console.log(`      Rows: ${numNodes.toLocaleString()}, Columns: ${allNodeColumns.length}`);

  // Save edges
  await db.run(`COPY edges TO '${OUTPUT_EDGES}' (FORMAT PARQUET)`);
  console.log(`   ✅ Edges saved to: ${OUTPUT_EDGES}`);
  console.log(`      Rows: ${numFinalEdges.toLocaleString()}, Columns: ${finalEdgeColNames.length}`);
  console.log();

  // ========================================
  // Step 5: Update configuration JSON with renamed columns
  // ========================================
  console.log('📝 Updating configuration JSON...');

  // Create mapping: originalName -> displayName
  const nameMapping = {};
  for (const [original, display] of Object.entries(columnDisplayNames)) {
    nameMapping[original] = display;
  }

  // Helper to rename a column name
  const renameColumn = (col) => nameMapping[col] || col;

  // Read existing config
  let existingConfig = {};
  try {
    const configData = await readFile(OUTPUT_CONFIG, 'utf-8');
    existingConfig = JSON.parse(configData);
  } catch (err) {
    console.log('   No existing config to update');
  }

  // Update all arrays and objects with renamed columns
  const updatedConfig = {
    ...existingConfig,
    pointIncludeColumns: existingConfig.pointIncludeColumns?.map(renameColumn),
    numericColumns: existingConfig.numericColumns?.map(renameColumn),
    pointExcludeFromColorBy: existingConfig.pointExcludeFromColorBy?.map(renameColumn),
    
    // Update logColumnMapping
    logColumnMapping: Object.entries(existingConfig.logColumnMapping || {}).reduce((acc, [key, value]) => {
      acc[renameColumn(key)] = {
        log2: value.log2 ? renameColumn(value.log2) : value.log2,
        log10: value.log10 ? renameColumn(value.log10) : value.log10,
      };
      return acc;
    }, {}),
    
    // Update columnCategories
    columnCategories: Object.entries(existingConfig.columnCategories || {}).reduce((acc, [key, value]) => {
      acc[renameColumn(key)] = value;
      return acc;
    }, {}),
  };

  // Keep columnDisplayNames for future runs (needed for the renaming process)
  // Don't delete it: we need it to map technical names to display names
  // delete updatedConfig.columnDisplayNames;

  await writeFile(OUTPUT_CONFIG, JSON.stringify(updatedConfig, null, 2));
  console.log(`   ✅ Config updated: ${OUTPUT_CONFIG}`);
  console.log();

  // ========================================
  // Step 6: Summary
  // ========================================
  console.log('='.repeat(60));
  console.log('✨ Preparation complete!');
  console.log('='.repeat(60));
  console.log('📊 Summary:');
  console.log(`   Points: ${numNodes.toLocaleString()} nodes with ${allNodeColumns.length} columns`);
  console.log(`   Links:  ${numFinalEdges.toLocaleString()} edges with ${finalEdgeColNames.length} columns`);
  console.log(`   Config: ${OUTPUT_CONFIG}`);
  console.log(`   Renamed: ${Object.keys(columnDisplayNames).length} columns`);

  await db.close();
}

main().catch(console.error);
