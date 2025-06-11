import './App.css';
import SigmaNetwork from './SigmaNetwork.jsx';
import { useState, useEffect, useRef } from 'react';
import Papa from 'papaparse';

const base = import.meta.env.BASE_URL;

function App() {
  const [graphmlString, setGraphmlString] = useState('');
  const [edgeListString, setEdgeListString] = useState('');
  const [metadataCsvString, setMetadataCsvString] = useState('');
  const [colorBy, setColorBy] = useState(''); // Start empty, auto-detect from CSV
  const [csvColumns, setCsvColumns] = useState([]); // Start empty
  const [searchId, setSearchId] = useState('');
  const [zoomToId, setZoomToId] = useState('');
  const [nodeIdOptions, setNodeIdOptions] = useState([]);
  const [filteredOptions, setFilteredOptions] = useState([]);
  const [highlightedNode, setHighlightedNode] = useState();
  const [hoveredNode, setHoveredNode] = useState();
  const [edgeMode, setEdgeMode] = useState('none'); // 'none', 'all', 'hovered'
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [hasDefaultData, setHasDefaultData] = useState(true); // Track if default data is available
  const [useEdgeList, setUseEdgeList] = useState(false); // Toggle between GraphML and edge list
  const [isProcessingGraph, setIsProcessingGraph] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [showIframe, setShowIframe] = useState(true);
  const [enableDynamicEdges, setEnableDynamicEdges] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const debounceRef = useRef();

  // Parse CSV headers whenever metadataCsvString changes
  useEffect(() => {
    if (metadataCsvString) {
      const parsed = Papa.parse(metadataCsvString, { header: true, skipEmptyLines: true });
      if (parsed.meta && parsed.meta.fields) {
        const fields = parsed.meta.fields.filter(f => f !== 'id');
        setCsvColumns(fields);
        // Only set colorBy if not already set and fields are available
        if ((!colorBy || !fields.includes(colorBy)) && fields.length > 0) {
          setColorBy(fields[0]); // Auto-select first available field
        }
      }
    } else {
      setCsvColumns([]);
      // When no metadata is available, don't force a colorBy value
      // Let the component handle the case where colorBy might not match any column
      if (colorBy && !['x', 'y', 'id', 'label', 'size'].includes(colorBy)) {
        setColorBy(''); // Clear invalid colorBy when no metadata
      }
    }
  }, [metadataCsvString]);

  // Extract node ids from the current data (GraphML or TSV edge list)
  useEffect(() => {
    let ids = [];
    
    if (useEdgeList && edgeListString) {
      // Parse node ids from TSV edge list
      const lines = edgeListString.trim().split('\n');
      const nodeSet = new Set();
      
      // Check if first line looks like a header
      let hasHeader = false;
      if (lines.length > 0) {
        const firstLine = lines[0].toLowerCase();
        if (firstLine.includes('source') || firstLine.includes('target') || firstLine.includes('from') || firstLine.includes('to')) {
          hasHeader = true;
        }
      }
      
      const startIndex = hasHeader ? 1 : 0;
      
      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const parts = line.split('\t');
        if (parts.length >= 2) {
          nodeSet.add(parts[0].trim());
          nodeSet.add(parts[1].trim());
        }
      }
      
      ids = Array.from(nodeSet);
    } else if (graphmlString) {
      // Parse node ids from GraphML string
      const matches = Array.from(graphmlString.matchAll(/<node id="([^"]+)"/g));
      ids = matches.map(m => m[1]);
    }
    
    setNodeIdOptions(ids);
  }, [graphmlString, edgeListString, useEdgeList]);

  // Debounced filter for autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!searchId) {
        setFilteredOptions([]);
      } else {
        setFilteredOptions(nodeIdOptions.filter(id => id.toLowerCase().includes(searchId.toLowerCase())).slice(0, 10));
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [searchId, nodeIdOptions]);

  // Function to load CSV in chunks
  const loadCsvInChunks = async () => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus('Initializing Metadata CSV load...');
    
    try {
      const response = await fetch(`${base}data/scatter_small.csv`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch CSV file');
      }
      
      // Get the content length to track progress
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      console.log(`CSV file size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);
      setLoadingStatus(`Loading Metadata CSV (${(contentLength / 1024 / 1024).toFixed(2)} MB)...`);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let csvData = '';
      let totalLoaded = 0;
      let isFirstChunk = true;
      let csvRows = [];
      let headers = [];
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        totalLoaded += value.length;
        const progress = contentLength > 0 ? (totalLoaded / contentLength * 100) : 0;
        setLoadingProgress(progress);
        setLoadingStatus(`Loading CSV: ${progress.toFixed(1)}% (${(totalLoaded / 1024 / 1024).toFixed(2)} MB)`);
        
        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });
        csvData += chunk;
        
        // Process complete lines (avoid breaking in the middle of a line)
        const lines = csvData.split('\n');
        csvData = lines.pop() || ''; // Keep the incomplete line for next iteration
        
        if (isFirstChunk && lines.length > 0) {
          // Extract headers from first line
          headers = lines[0].split(',').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
          console.log('CSV Headers:', headers);
          lines.shift(); // Remove header line
          isFirstChunk = false;
        }
        
        // Process the complete lines in this chunk
        for (const line of lines) {
          if (line.trim()) {
            const values = line.split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
            if (values.length >= headers.length) {
              const row = {};
              headers.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              csvRows.push(row);
            }
          }
        }
        
        // Update progress display for row processing
        if (csvRows.length % 10000 === 0 && csvRows.length > 0) {
          setLoadingStatus(`Processing CSV: ${progress.toFixed(1)}% - ${csvRows.length} rows`);
          // Yield control to prevent blocking
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // Process any remaining data
      if (csvData.trim()) {
        const values = csvData.trim().split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
        if (values.length >= headers.length) {
          const row = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          csvRows.push(row);
        }
      }
      
      console.log(`CSV loading complete! Total rows: ${csvRows.length}`);
      setLoadingStatus(`CSV loaded: ${csvRows.length} rows`);
      
      // Convert back to CSV string for compatibility with existing code
      const csvString = [
        headers.join(','),
        ...csvRows.map(row => headers.map(h => row[h] || '').join(','))
      ].join('\n');
      
      setMetadataCsvString(csvString);
      setHasDefaultData(false);
      
    } catch (error) {
      console.error('Error loading CSV in chunks:', error);
      setLoadingStatus('Error loading CSV data');
      alert('Error loading CSV data. Please try uploading your own files.');
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
      setLoadingStatus('');
    }
  };
  
  // Function to load mock GraphML for testing (small file)
  const loadMockGraphML = async () => {
    setIsLoading(true);
    setLoadingStatus('Loading mock GraphML...');
    
    try {
      const response = await fetch('/data/mock_imgpr_plsdb.graphml');
      
      if (!response.ok) {
        throw new Error('Failed to fetch GraphML file');
      }
      
      const graphmlText = await response.text();
      setGraphmlString(graphmlText);
      setHasDefaultData(false);
      
    } catch (error) {
      console.error('Error loading mock GraphML:', error);
      alert('Error loading GraphML data.');
    } finally {
      setIsLoading(false);
    }
  };

  // Function to load the large CSV file for testing
  const loadLargeCsvFile = async () => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus('Initializing large CSV load...');
    
    try {
      const response = await fetch(`${base}data/scatter_small.csv`); // This should be the 97MB file
      
      if (!response.ok) {
        throw new Error('Failed to fetch large CSV file');
      }
      
      // Get the content length to track progress
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      const fileSizeMB = (contentLength / 1024 / 1024).toFixed(2);
      console.log(`Large CSV file size: ${fileSizeMB} MB`);
      setLoadingStatus(`Loading large CSV (${fileSizeMB} MB)...`);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let buffer = '';
      let totalLoaded = 0;
      let isFirstChunk = true;
      let headers = [];
      let processedRows = 0;
      let csvRows = [];
      
      const startTime = Date.now();
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        totalLoaded += value.length;
        const progress = contentLength > 0 ? (totalLoaded / contentLength * 100) : 0;
        setLoadingProgress(progress);
        
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = totalLoaded / elapsedTime / 1024 / 1024; // MB/s
        
        setLoadingStatus(`Loading: ${progress.toFixed(1)}% - ${(totalLoaded / 1024 / 1024).toFixed(2)} MB - ${speed.toFixed(2)} MB/s - ${processedRows} rows`);
        
        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines (avoid breaking in the middle of a line)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the incomplete line for next iteration
        
        if (isFirstChunk && lines.length > 0) {
          // Extract headers from first line
          headers = lines[0].split(',').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
          console.log('Large CSV Headers:', headers);
          lines.shift(); // Remove header line
          isFirstChunk = false;
        }
        
        // Process the complete lines in this chunk
        for (const line of lines) {
          if (line.trim()) {
            const values = line.split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
            if (values.length >= headers.length) {
              const row = {};
              headers.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              csvRows.push(row);
              processedRows++;
            }
          }
        }
        
        // Yield control every 5000 rows to prevent blocking the UI
        if (processedRows % 5000 === 0 && processedRows > 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      
      // Process any remaining data
      if (buffer.trim()) {
        const values = buffer.trim().split(',').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
        if (values.length >= headers.length) {
          const row = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          csvRows.push(row);
          processedRows++;
        }
      }
      
      const endTime = Date.now();
      const totalTime = (endTime - startTime) / 1000;
      console.log(`Large CSV loading complete! Total rows: ${processedRows}, Time: ${totalTime.toFixed(2)}s`);
      setLoadingStatus(`Large CSV loaded: ${processedRows} rows in ${totalTime.toFixed(2)}s`);
      
      // Convert back to CSV string for compatibility with existing code
      const csvString = [
        headers.join(','),
        ...csvRows.map(row => headers.map(h => row[h] || '').join(','))
      ].join('\n');
      
      setMetadataCsvString(csvString);
      setHasDefaultData(false);
      
    } catch (error) {
      console.error('Error loading large CSV:', error);
      setLoadingStatus('Error loading large CSV data');
      alert('Error loading large CSV data. Check if the file exists in /public/data/');
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
      setTimeout(() => setLoadingStatus(''), 3000); // Clear status after 3 seconds
    }
  };

  // Function to load the large TSV file for testing (same logic as loadLargeCsvFile, but for TSV)
  const loadLargeTsvFile = async () => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus('Initializing large TSV load...');
    try {
      const response = await fetch('/data/mock_edges.tsv');
      if (!response.ok) {
        throw new Error('Failed to fetch large TSV file');
      }
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      const fileSizeMB = (contentLength / 1024 / 1024).toFixed(2);
      console.log(`Large TSV file size: ${fileSizeMB} MB`);
      setLoadingStatus(`Loading large TSV (${fileSizeMB} MB)...`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalLoaded = 0;
      let isFirstChunk = true;
      let headers = [];
      let processedRows = 0;
      let tsvRows = [];
      
      const startTime = Date.now();
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        totalLoaded += value.length;
        const progress = contentLength > 0 ? (totalLoaded / contentLength * 100) : 0;
        setLoadingProgress(progress);
        
        const elapsedTime = (Date.now() - startTime) / 1000;
        const speed = totalLoaded / elapsedTime / 1024 / 1024; // MB/s
        
        setLoadingStatus(`Loading: ${progress.toFixed(1)}% - ${(totalLoaded / 1024 / 1024).toFixed(2)} MB - ${speed.toFixed(2)} MB/s - ${processedRows} rows`);
        
        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Process complete lines (avoid breaking in the middle of a line)
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the incomplete line for next iteration
        
        if (isFirstChunk && lines.length > 0) {
          // Extract headers from first line
          headers = lines[0].split('\t').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
          console.log('Large TSV Headers:', headers);
          lines.shift(); // Remove header line
          isFirstChunk = false;
        }
        
        // Process the complete lines in this chunk
        for (const line of lines) {
          if (line.trim()) {
            const values = line.split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
            if (values.length >= headers.length) {
              const row = {};
              headers.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              tsvRows.push(row);
              processedRows++;
            }
          }
        }
        
        // Yield control every 5000 rows to prevent blocking the UI
        if (processedRows % 5000 === 0 && processedRows > 0) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      
      // Process any remaining data
      if (buffer.trim()) {
        const values = buffer.trim().split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
        if (values.length >= headers.length) {
          const row = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          tsvRows.push(row);
          processedRows++;
        }
      }
      
      const endTime = Date.now();
      const totalTime = (endTime - startTime) / 1000;
      console.log(`Large TSV loading complete! Total rows: ${processedRows}, Time: ${totalTime.toFixed(2)}s`);
      setLoadingStatus(`Large TSV loaded: ${processedRows} rows in ${totalTime.toFixed(2)}s`);
      
      // Convert back to TSV string for compatibility with existing code
      const tsvString = [
        headers.join('\t'),
        ...tsvRows.map(row => headers.map(h => row[h] || '').join('\t'))
      ].join('\n');
      
      setEdgeListString(tsvString);
      setUseEdgeList(true);
      setGraphmlString('');
      setHasDefaultData(false);
      
    } catch (error) {
      console.error('Error loading large TSV:', error);
      setLoadingStatus('Error loading large TSV data');
      alert('Error loading large TSV data. Check if the file exists in /public/data/');
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
      setTimeout(() => setLoadingStatus(''), 3000);
    }
  };

  // Function to load TSV test data (mock edge list + metadata with coordinates)
  const loadTsvTestData = async () => {
    setIsLoading(true);
    setLoadingStatus('Loading TSV test data...');
    
    try {
      // Load both TSV edge list and CSV metadata
      const [tsvResponse, csvResponse] = await Promise.all([
        fetch('/data/mock_edges.tsv'),
        fetch('/data/mock_metadata_with_coords.csv')
      ]);
      
      if (!tsvResponse.ok || !csvResponse.ok) {
        throw new Error('Failed to fetch TSV test files');
      }
      
      const [tsvText, csvText] = await Promise.all([
        tsvResponse.text(),
        csvResponse.text()
      ]);
      
      setEdgeListString(tsvText);
      setMetadataCsvString(csvText);
      setUseEdgeList(true);
      setGraphmlString(''); // Clear GraphML when using edge list
      setHasDefaultData(false);
      
    } catch (error) {
      console.error('Error loading TSV test data:', error);
      alert('Error loading TSV test data. Check if the files exist in /public/data/');
    } finally {
      setIsLoading(false);
    }
  };

  // Function to load TSV edges in chunks
  const loadTsvInChunks = async (filePath = '/data/mock_edges.tsv') => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingStatus('Initializing TSV load...');
    
    try {
      const response = await fetch(filePath);
      const text = await response.clone().text();
      console.log('TSV fetch status:', response.status, 'First 100 chars:', text.slice(0, 100));
      if (!response.ok) {
        throw new Error('Failed to fetch TSV file');
      }
      
      // Get the content length to track progress
      const contentLength = parseInt(response.headers.get('content-length') || '0');
      console.log(`TSV file size: ${(contentLength / 1024 / 1024).toFixed(2)} MB`);
      setLoadingStatus(`Loading TSV (${(contentLength / 1024 / 1024).toFixed(2)} MB)...`);
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      let tsvData = '';
      let totalLoaded = 0;
      let isFirstChunk = true;
      let tsvRows = [];
      let headers = [];
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        totalLoaded += value.length;
        const progress = contentLength > 0 ? (totalLoaded / contentLength * 100) : 0;
        setLoadingProgress(progress);
        setLoadingStatus(`Loading TSV: ${progress.toFixed(1)}% (${(totalLoaded / 1024 / 1024).toFixed(2)} MB)`);
        
        // Decode the chunk
        const chunk = decoder.decode(value, { stream: true });
        tsvData += chunk;
        
        // Process complete lines (avoid breaking in the middle of a line)
        const lines = tsvData.split('\n');
        tsvData = lines.pop() || ''; // Keep the incomplete line for next iteration
        
        if (isFirstChunk && lines.length > 0) {
          // Check if first line looks like a header
          const firstLine = lines[0].toLowerCase();
          if (firstLine.includes('source') || firstLine.includes('target') || firstLine.includes('from') || firstLine.includes('to')) {
            headers = lines[0].split('\t').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
            console.log('TSV Headers:', headers);
            lines.shift(); // Remove header line
          }
          isFirstChunk = false;
        }
        
        // Process the complete lines in this chunk
        for (const line of lines) {
          if (line.trim()) {
            const values = line.split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
            if (values.length >= headers.length) {
              const row = {};
              headers.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              tsvRows.push(row);
            }
          }
        }
        
        // Update progress display for row processing
        if (tsvRows.length % 10000 === 0 && tsvRows.length > 0) {
          setLoadingStatus(`Processing TSV: ${progress.toFixed(1)}% - ${tsvRows.length} rows`);
          // Yield control to prevent blocking
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // Process any remaining data
      if (tsvData.trim()) {
        const values = tsvData.trim().split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
        if (values.length >= headers.length) {
          const row = {};
          headers.forEach((header, index) => {
            row[header] = values[index] || '';
          });
          tsvRows.push(row);
        }
      }
      
      console.log(`TSV loading complete! Total rows: ${tsvRows.length}`);
      setLoadingStatus(`TSV loaded: ${tsvRows.length} rows`);
      
      // Convert back to TSV string for compatibility with existing code
      const tsvString = [
        headers.length > 0 ? headers.join('\t') : 'source\ttarget\tweight',
        ...tsvRows.map(row => {
          if (headers.length > 0) {
            return headers.map(h => row[h] || '').join('\t');
          } else {
            return `${row.source || ''}\t${row.target || ''}\t${row.weight || ''}`;
          }
        })
      ].join('\n');
      setEdgeListString(tsvString);
      setUseEdgeList(true);
      setGraphmlString(''); // Clear GraphML when using edge list
      setHasDefaultData(false);
      
    } catch (error) {
      console.error('Error loading TSV in chunks:', error);
      setLoadingStatus('Error loading TSV data');
      alert('Error loading TSV data. Please try uploading your own files.');
    } finally {
      setIsLoading(false);
      setLoadingProgress(0);
      setLoadingStatus('');
    }
  };

  // Handlers for file uploads
  const handleGraphmlUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setGraphmlString(event.target.result);
      setHasDefaultData(false); // Hide load button when custom data is loaded
      setIsLoading(false);
    };
    reader.onerror = () => {
      console.error('Error reading GraphML file');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };
  
  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setMetadataCsvString(event.target.result);
      setIsLoading(false);
    };
    reader.onerror = () => {
      console.error('Error reading CSV file');
      setIsLoading(false);
    };
    reader.readAsText(file);
  };

  // Handler for TSV edge list upload
  const handleTsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setEdgeListString(event.target.result);
      setUseEdgeList(true);
      setGraphmlString(''); // Clear GraphML when using edge list
      setHasDefaultData(false);
      setIsLoading(false);
    };
    reader.onerror = () => {
    };
    reader.readAsText(file);
  };

  // Callback for SigmaNetwork to signal when graph processing is done
  const handleGraphProcessingDone = () => {
    setIsProcessingGraph(false);
    setLoadingStatus('');
  };

  // Add effect to log loading state changes
  useEffect(() => {
    if (isLoading) {
      console.log('[App] Data loading started:', loadingStatus);
    } else {
      console.log('[App] Data loading stopped.');
    }
  }, [isLoading]);
  useEffect(() => {
    if (loadingStatus) {
      console.log('[App] Loading status:', loadingStatus);
    }
  }, [loadingStatus]);
  useEffect(() => {
    if (isProcessingGraph) {
      console.log('[App] Graph processing started.');
    } else {
      console.log('[App] Graph processing stopped.');
    }
  }, [isProcessingGraph]);

  // --- Add this useEffect for automatic loading on mount ---
  useEffect(() => {
    // Only auto-load if no data is present
    if (!metadataCsvString && !edgeListString && !graphmlString) {
      (async () => {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingStatus('Initializing TSV metadata load...');
        try {
          // 1. Load metadata TSV
          const response = await fetch(import.meta.env.BASE_URL + 'data/scatter_small.tsv');
          if (!response.ok) throw new Error('Failed to fetch TSV metadata file');
          const contentLength = parseInt(response.headers.get('content-length') || '0');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let tsvData = '';
          let totalLoaded = 0;
          let isFirstChunk = true;
          let tsvRows = [];
          let headers = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalLoaded += value.length;
            const progress = contentLength > 0 ? (totalLoaded / contentLength * 100) : 0;
            setLoadingProgress(progress);
            setLoadingStatus(`Loading TSV: ${progress.toFixed(1)}% (${(totalLoaded / 1024 / 1024).toFixed(2)} MB)`);
            const chunk = decoder.decode(value, { stream: true });
            tsvData += chunk;
            const lines = tsvData.split('\n');
            tsvData = lines.pop() || '';
            if (isFirstChunk && lines.length > 0) {
              headers = lines[0].split('\t').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
              lines.shift();
              isFirstChunk = false;
            }
            for (const line of lines) {
              if (line.trim()) {
                const values = line.split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
                if (values.length >= headers.length) {
                  const row = {};
                  headers.forEach((header, index) => {
                    row[header] = values[index] || '';
                  });
                  tsvRows.push(row);
                }
              }
            }
          }
          // Process any remaining data
          if (tsvData.trim()) {
            const values = tsvData.trim().split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
            if (values.length >= headers.length) {
              const row = {};
              headers.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              tsvRows.push(row);
            }
          }
          console.log(`TSV metadata loading complete! Total rows: ${tsvRows.length}`);
          setLoadingStatus(`TSV metadata loaded: ${tsvRows.length} rows`);
          // Convert back to TSV string for compatibility with existing code
          const tsvString = [
            headers.join('\t'),
            ...tsvRows.map(row => headers.map(h => row[h] || '').join('\t'))
          ].join('\n');
          setMetadataCsvString(tsvString);
          setHasDefaultData(false);
          setLoadingStatus('Node info loaded, now loading edges...');
          setLoadingProgress(0);
          // 2. Load network edge list (mock_edges.tsv)
          const tsvResponse = await fetch(import.meta.env.BASE_URL + 'data/mock_edges.tsv');
          if (!tsvResponse.ok) throw new Error('Failed to fetch TSV edge list');
          const tsvContentLength = parseInt(tsvResponse.headers.get('content-length') || '0');
          const tsvReader = tsvResponse.body.getReader();
          const tsvDecoder = new TextDecoder();
          let tsvEdgeData = '';
          let tsvTotalLoaded = 0;
          let tsvIsFirstChunk = true;
          let tsvRowsEdge = [];
          let tsvHeadersEdge = [];
          while (true) {
            const { done, value } = await tsvReader.read();
            if (done) break;
            tsvTotalLoaded += value.length;
            const tsvProgress = tsvContentLength > 0 ? (tsvTotalLoaded / tsvContentLength * 100) : 0;
            setLoadingProgress(tsvProgress);
            setLoadingStatus(`Loading network TSV: ${tsvProgress.toFixed(1)}% (${(tsvTotalLoaded / 1024 / 1024).toFixed(2)} MB)`);
            const chunk = tsvDecoder.decode(value, { stream: true });
            tsvEdgeData += chunk;
            const lines = tsvEdgeData.split('\n');
            tsvEdgeData = lines.pop() || '';
            if (tsvIsFirstChunk && lines.length > 0) {
              tsvHeadersEdge = lines[0].split('\t').map(h => h.trim().replace(/^"/, '').replace(/"$/, ''));
              lines.shift();
              tsvIsFirstChunk = false;
            }
            for (const line of lines) {
              if (line.trim()) {
                const values = line.split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
                if (values.length >= tsvHeadersEdge.length) {
                  const row = {};
                  tsvHeadersEdge.forEach((header, index) => {
                    row[header] = values[index] || '';
                  });
                  tsvRowsEdge.push(row);
                }
              }
            }
          }
          if (tsvEdgeData.trim()) {
            const values = tsvEdgeData.trim().split('\t').map(v => v.trim().replace(/^"/, '').replace(/"$/, ''));
            if (values.length >= tsvHeadersEdge.length) {
              const row = {};
              tsvHeadersEdge.forEach((header, index) => {
                row[header] = values[index] || '';
              });
              tsvRowsEdge.push(row);
            }
          }
          console.log(`TSV edge list loading complete! Total rows: ${tsvRowsEdge.length}`);
          setLoadingStatus(`TSV edge list loaded: ${tsvRowsEdge.length} rows`);
          const tsvStringEdge = [
            tsvHeadersEdge.join('\t'),
            ...tsvRowsEdge.map(row => tsvHeadersEdge.map(h => row[h] || '').join('\t'))
          ].join('\n');
          setEdgeListString(tsvStringEdge);
          setUseEdgeList(true);
          setGraphmlString('');
          setHasDefaultData(false);
          setLoadingStatus('TSV loaded, ready to process graph...');
          setLoadingProgress(100);
        } catch (error) {
          setLoadingStatus('Error loading data: ' + error.message);
          setIsLoading(false);
          setLoadingProgress(0);
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, [metadataCsvString, edgeListString, graphmlString]);

  // Effect: generate plasmid map viewer HTML when a gene node is selected
  useEffect(() => {
    if (!highlightedNode) {
      setIframeSrc('');
      return;
    }
    // Build JSON URL based on gene id
    const object = { id: highlightedNode };
    const idForUrl = object.id.startsWith('IMGPR') ? object.id.split('|')[0] : object.id;
    const jsonUrl = `https://raw.githubusercontent.com/pentamorfico/plsdb_imgpr_json/refs/heads/master/${idForUrl}.json`;
    // Full HTML content for CGV viewer
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>CGV Viewer</title>
  <!-- Load Roboto font -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/gh/pentamorfico/plsdb_imgpr_json@refs/heads/master/svgcanvas.iife.js"></script>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/cgview/dist/cgview.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/cgview/dist/cgview.css">
  <style>
    body { margin: 0; font-family: 'Roboto', sans-serif; }
    #my-viewer { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="my-viewer"></div>
  <script>
    const cgv = new CGV.Viewer('#my-viewer', { height: 350, width: 350, format: 'circular', SVGContext: svgcanvas.Context });
    fetch('${jsonUrl}').then(r => r.json()).then(json => { cgv.io.loadJSON(json); cgv.draw(); });
  </script>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    setIframeSrc(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [highlightedNode]);

  return (
    <>
      {/* Debug: show colorBy and csvColumns */}
      
      {/* Loading overlay */}
      {(isLoading || isProcessingGraph) && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          backgroundColor: 'rgba(255, 255, 255, 0.95)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          zIndex: 1000,
          flexDirection: 'column',
          gap: 20
        }}>
          <div style={{ 
            width: 80, 
            height: 80, 
            border: '8px solid #f3f3f3', 
            borderTop: '8px solid #3498db', 
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            marginBottom: 10
          }} />
          <div style={{ fontSize: 22, color: '#333', fontWeight: 'bold', letterSpacing: 0.5 }}>
            {isProcessingGraph ? 'Processing graph data...' : (loadingStatus || 'Loading data...')}
          </div>
          {loadingProgress > 0 && !isProcessingGraph && (
            <div style={{ width: 400, maxWidth: '80vw' }}>
              <div style={{ 
                width: '100%', 
                height: 24, 
                backgroundColor: '#f0f0f0', 
                borderRadius: 12,
                overflow: 'hidden',
                marginBottom: 6
              }}>
                <div style={{ 
                  width: `${loadingProgress}%`, 
                  height: '100%', 
                  backgroundColor: '#3498db',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: 16, color: '#666' }}>
                {loadingProgress.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}
      
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Only show controls if data is loaded */}
        {(graphmlString || edgeListString) && (
          <>
            <select value={String(colorBy)} onChange={e => setColorBy(String(e.target.value))} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4 }}>
              {csvColumns.map(col => (
                <option key={col} value={col}>{col}</option>
              ))}
            </select>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <input
                type="text"
                placeholder="Search node id..."
                style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px', minWidth: 120 }}
                value={searchId}
                onChange={e => setSearchId(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    setZoomToId(searchId);
                    setHighlightedNode(searchId);
                  }
                }}
                autoComplete="off"
                onBlur={() => setFilteredOptions([])}
              />
              {filteredOptions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #ccc', zIndex: 100, maxHeight: 180, overflowY: 'auto' }}>
                  {filteredOptions.map(option => (
                    <div
                      key={option}
                      style={{ padding: '2px 6px', cursor: 'pointer' }}
                      onMouseDown={() => {
                        setSearchId(option);
                        setZoomToId(option);
                        setHighlightedNode(option);
                      }}
                    >{option}</div>
                  ))}
                </div>
              )}
            </div>
            {/* Toggle dynamic edges on click/highlight/zoom */}
            <button onClick={() => setEnableDynamicEdges(!enableDynamicEdges)} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px' }}>
              {enableDynamicEdges ? 'Disable Dynamic Edges' : 'Enable Dynamic Edges'}
            </button>
            {/* Existing edge toggle */}
            <button onClick={() => setEdgeMode(edgeMode === 'none' ? 'all' : 'none')} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px' }}>
              {edgeMode === 'none' ? 'Show All Edges (slow)' : 'Hide Edges'}
            </button>
            {/* Toggle map visibility */}
            <button onClick={() => setShowIframe(!showIframe)} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px' }}>
              {showIframe ? 'Hide Genome Map' : 'Show Genome Map'}
            </button>
            <button onClick={() => setShowLabels(prev => !prev)} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px' }}>
              {showLabels ? 'Hide Labels' : 'Show Labels'}
            </button>
          </>
        )}
      </div>
      
      {/* Only render SigmaNetwork when data is loaded and not loading */}
      {(graphmlString || edgeListString) && !isLoading && (
        <SigmaNetwork
          graphmlString={graphmlString}
          edgeListString={edgeListString}
          useEdgeList={useEdgeList}
          metadataCsvString={metadataCsvString}
          colorBy={colorBy}
          zoomToId={zoomToId}
          highlightedNode={highlightedNode}
          hoveredNode={hoveredNode}
          setHoveredNode={setHoveredNode}
          setHighlightedNode={setHighlightedNode}
          edgeMode={edgeMode}
          enableDynamicEdges={enableDynamicEdges}
          showLabels={showLabels}
          onGraphProcessingDone={handleGraphProcessingDone}
          onGraphProcessingStart={() => {
            setIsProcessingGraph(true);
            setLoadingStatus('Processing graph data...');
          }}
        />
      )}
      {/* Plasmid map iframe in lower-left */}
      {iframeSrc && showIframe && (
        <div style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          width: 349,
          height: 349,
          border: '2px solid #ccc',
          zIndex: 20,
          background: '#fff',
          overflow: 'hidden',
        }}>
          <iframe
            src={iframeSrc}
            title="Plasmid Map Viewer"
            scrolling="no"
            style={{ width: '100%', height: '100%', border: 'none', fontFamily: 'Roboto, sans-serif', overflow: 'hidden' }}
          />
        </div>
      )}
    </>
  );
}

export default App;
