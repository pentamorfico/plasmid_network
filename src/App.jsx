import './App.css';
import SigmaNetwork from './SigmaNetwork.jsx';
import { useState, useEffect, useRef } from 'react';
import { asyncBufferFromUrl, parquetReadObjects } from 'hyparquet';
import { downloadAsPNG } from '@sigma/export-image';

function App() {
  // Ref to capture Sigma instance for export
  const sigmaRef = useRef(null);

  const [graphmlString, setGraphmlString] = useState('');
  const [edgeRows, setEdgeRows] = useState([]);
  const [metadataRows, setMetadataRows] = useState([]);
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
  const [hasDefaultData, setHasDefaultData] = useState(true);
  const [useEdgeList, setUseEdgeList] = useState(false); // Toggle between GraphML and edge list
  const [isProcessingGraph, setIsProcessingGraph] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [showIframe, setShowIframe] = useState(false);
  const [enableDynamicEdges, setEnableDynamicEdges] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  // Toggle PTU cluster labels overlay
  const [showPTUs, setShowPTUs] = useState(false);
  const debounceRef = useRef();

  // Parse CSV headers whenever metadataCsvString changes
  useEffect(() => {
    if (metadataRows.length > 0) {
      const fields = Object.keys(metadataRows[0]).filter(f => f !== 'id');
      setCsvColumns(fields);
      // Only set colorBy if not already set and fields are available
      if ((!colorBy || !fields.includes(colorBy)) && fields.length > 0) {
        setColorBy(fields[0]); // Auto-select first available field
      }
    } else {
      setCsvColumns([]);
      // When no metadata is available, don't force a colorBy value
      // Let the component handle the case where colorBy might not match any column
      if (colorBy && !['x', 'y', 'id', 'label', 'size'].includes(colorBy)) {
        setColorBy(''); // Clear invalid colorBy when no metadata
      }
    }
  }, [metadataRows]);

  // Extract node ids from the current data (GraphML or TSV edge list)
  useEffect(() => {
    let ids = [];
    
    if (useEdgeList && edgeRows.length > 0) {
      // Parse node ids from edge list
      const nodeSet = new Set();
      
      for (const row of edgeRows) {
        if (row.source) nodeSet.add(row.source);
        if (row.target) nodeSet.add(row.target);
      }
      
      ids = Array.from(nodeSet);
    } else if (graphmlString) {
      // Parse node ids from GraphML string
      const matches = Array.from(graphmlString.matchAll(/<node id="([^"]+)"/g));
      ids = matches.map(m => m[1]);
    }
    
    setNodeIdOptions(ids);
  }, [graphmlString, edgeRows, useEdgeList]);

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
    if (hasDefaultData && !metadataRows.length && !edgeRows.length && !graphmlString) {
      (async () => {
        setIsLoading(true);
        setLoadingProgress(0);
        setLoadingStatus('Initializing Parquet metadata load...');
        try {
          // 1. Load metadata from Parquet via hyparquet
          const url = import.meta.env.BASE_URL + 'data/scatter_small.parquet';
          const file = await asyncBufferFromUrl({ url });
          const rows = await parquetReadObjects({ file });
          setMetadataRows(rows);
          setHasDefaultData(false);
          setLoadingStatus(`Parquet metadata loaded: ${rows.length} rows`);
          setLoadingProgress(0);
           
          // 2. Load network edge list from Parquet
          const edgeUrl = import.meta.env.BASE_URL + 'data/mock_edges.parquet';
          const edgeFile = await asyncBufferFromUrl({ url: edgeUrl });
          const edgeRowsArr = await parquetReadObjects({ file: edgeFile });
          setEdgeRows(edgeRowsArr);
          setUseEdgeList(true);
          setGraphmlString('');
          setHasDefaultData(false);
          setLoadingStatus('Parquet edges loaded, ready to process graph...');
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
  }, [hasDefaultData, /* clear CSV/string deps */ graphmlString]);

  // Effect: generate plasmid map viewer HTML when a gene node is selected
  useEffect(() => {
    if (!highlightedNode) {
      setIframeSrc('');
      setShowIframe(false);
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
    setShowIframe(true);
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
        {(graphmlString || edgeRows.length > 0) && (
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
            <button onClick={() => setShowPTUs(prev => !prev)} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px' }}>
              {showPTUs ? 'Hide PTUs' : 'Show PTUs'}
            </button>
            {/* Export network snapshot */}
            <button onClick={() => {
                if (sigmaRef.current) downloadAsPNG(sigmaRef.current, { backgroundColor: '#ffffff' });
              }}
              style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4, padding: '2px 6px' }}>
              Download PNG
            </button>
          </>
        )}
      </div>

      {/* Render network canvas */}
      <div style={{ width: '100vw', height: '100vh' }}>
        <SigmaNetwork
          graphmlString={graphmlString}
          edgeRows={edgeRows}
          useEdgeList={useEdgeList}
          metadataRows={metadataRows}
          colorBy={colorBy}
          highlightedNode={highlightedNode}
          hoveredNode={hoveredNode}
          edgeMode={edgeMode}
          enableDynamicEdges={enableDynamicEdges}
          zoomToId={zoomToId}
          setHoveredNode={setHoveredNode}
          setHighlightedNode={setHighlightedNode}
          onGraphProcessingStart={() => setIsProcessingGraph(true)}
          onGraphProcessingDone={handleGraphProcessingDone}
          showLabels={showLabels}
          showPTULabels={showPTUs}
          onSigmaInit={sigma => { sigmaRef.current = sigma; }}
        />
      </div>

      {/* Optional genome map iframe */}
      {showIframe && iframeSrc && (
        <div style={{ 
            position: 'absolute', 
            bottom: 10, 
            left: 10, 
            width: 355.5, 
            height: 355.5, 
            zIndex: 15, 
            backgroundColor: '#fff', 
          borderRadius: 0,  
            borderWidth: 0,
            border: 'none', 
            overflow: 'hidden',
            boxShadow: 'none' 
          }}>

          <iframe src={iframeSrc} title="Genome Map" style={{ width: '100%', height: '100%' }} />
        </div>
      )}
    </>
  );
}

export default App;
