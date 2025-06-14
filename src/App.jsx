import './App.css';
import SigmaNetwork from './SigmaNetwork.jsx';
import { useState, useEffect, useRef } from 'react';
import { downloadAsPNG } from '@sigma/export-image';

const LOADING_STATES = [
  'Loading node data...',
  'Loading edge data...',
  'Creating network...',
  'Coloring network...'
];

function App() {
  // Ref to capture Sigma instance for export
  const sigmaRef = useRef(null);

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
  const [isLoading, setIsLoading] = useState(true); // Start with loading true
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingStatus, setLoadingStatus] = useState('Initializing...');
  const [iframeSrc, setIframeSrc] = useState('');
  const [showIframe, setShowIframe] = useState(false);
  const [enableDynamicEdges, setEnableDynamicEdges] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  // Toggle PTU cluster labels overlay
  const [showPTUs, setShowPTUs] = useState(false);
  // Shared button style (match SigmaNetwork buttons)
  const buttonStyle = {
    padding: '3px 12px',
    background: '#fff',
    color: '#000',
    border: '1px solid #ccc',
    borderRadius: 14,
    cursor: 'pointer',
    fontSize: '11px'
  };
  const [loadingStage, setLoadingStage] = useState(0); // 0: node, 1: edge, 2: create, 3: color
  const [isReady, setIsReady] = useState(false);
  const [isNetworkReady, setIsNetworkReady] = useState(false); // New state for when network is fully colored
  const debounceRef = useRef();

  console.log('[App] Render - isLoading:', isLoading, 'isReady:', isReady, 'isNetworkReady:', isNetworkReady, 'loadingStatus:', loadingStatus);

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
    const nodeSet = new Set();
    for (const row of edgeRows) {
      if (row.source) nodeSet.add(row.source);
      if (row.target) nodeSet.add(row.target);
    }
    setNodeIdOptions(Array.from(nodeSet));
  }, [edgeRows]);

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
  
  // Effect to log loading state changes
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
    let mounted = true;
    let worker = null;

    // Fallback for main thread loading - more reliable
    const loadDataMainThread = async () => {
      console.log('[App] Starting main thread data loading...');
      
      try {
        const { parquetReadObjects } = await import('hyparquet');
        
        setIsLoading(true);
        setIsReady(false);
        setLoadingStage(0);
        setLoadingProgress(0);
        setLoadingStatus(LOADING_STATES[0]);
        
        console.log('[App] Loading node data...');
        // 1. Load node data
        const url = import.meta.env.BASE_URL + 'data/scatter_small.parquet';
        console.log('[App] Fetching from:', url);
        
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch node data: ${response.status} ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        const rows = await parquetReadObjects({ file: buffer });
        console.log('[App] Node data loaded:', rows.length, 'rows');
        
        if (!mounted) return;
        
        setMetadataRows(rows);
        setLoadingProgress(25);
        setLoadingStage(1);
        setLoadingStatus(LOADING_STATES[1]);
        
        // Small delay to show progress
        await new Promise(res => setTimeout(res, 300));
        
        console.log('[App] Loading edge data...');
        // 2. Load edge data
        const edgeUrl = import.meta.env.BASE_URL + 'data/mock_edges.parquet';
        console.log('[App] Fetching edges from:', edgeUrl);
        
        const edgeResp = await fetch(edgeUrl);
        if (!edgeResp.ok) {
          throw new Error(`Failed to fetch edge data: ${edgeResp.status} ${edgeResp.statusText}`);
        }
        
        const edgeBuf = await edgeResp.arrayBuffer();
        const edgeRowsArr = await parquetReadObjects({ file: edgeBuf });
        console.log('[App] Edge data loaded:', edgeRowsArr.length, 'rows');
        
        if (!mounted) return;
        
        setEdgeRows(edgeRowsArr);
        setLoadingProgress(50);
        setLoadingStage(2);
        setLoadingStatus(LOADING_STATES[2]);
        
        // 3. Simulate network creation
        await new Promise(res => setTimeout(res, 400));
        setLoadingProgress(75);
        setLoadingStage(3);
        setLoadingStatus(LOADING_STATES[3]);
        
        // 4. Simulate coloring
        await new Promise(res => setTimeout(res, 400));
        setLoadingProgress(100);
        
        console.log('[App] Data loading complete!');
        setTimeout(() => {
          if (mounted) {
            setIsLoading(false);
            setIsReady(true);
            setIsNetworkReady(false); // Reset network ready state
          }
        }, 400);
        
      } catch (error) {
        console.error('Main thread loading error:', error);
        setLoadingStatus('Error loading data: ' + error.message);
        setIsLoading(false);
      }
    };

    const loadDataWithWorker = async () => {
      // Check for Web Worker support
      if (typeof Worker === 'undefined') {
        console.warn('Web Workers not supported, falling back to main thread loading');
        return loadDataMainThread();
      }

      try {
        console.log('[App] Attempting to create Web Worker...');
        // Create worker
        worker = new Worker(new URL('./dataWorker.js', import.meta.url), { type: 'module' });
        
        // Set up worker message handling
        worker.onmessage = (event) => {
          const { type, stage, progress, status, data, error } = event.data;
          
          if (!mounted) return;
          
          switch (type) {
            case 'PROGRESS_UPDATE':
              setLoadingStage(stage);
              setLoadingProgress(progress);
              setLoadingStatus(status);
              break;
              
            case 'NODE_DATA_LOADED':
              setMetadataRows(data);
              break;
              
            case 'EDGE_DATA_LOADED':
              setEdgeRows(data);
              break;
              
            case 'LOADING_COMPLETE':
              setTimeout(() => {
                if (mounted) {
                  setIsLoading(false);
                  setIsReady(true);
                  setIsNetworkReady(false); // Reset network ready state
                }
              }, 500); // Small delay to show completion
              break;
              
            case 'LOADING_ERROR':
              console.error('Worker loading error:', error);
              setLoadingStatus('Worker failed, falling back to main thread...');
              // Fallback to main thread
              setTimeout(() => loadDataMainThread(), 1000);
              break;
          }
        };
        
        worker.onerror = (error) => {
          console.error('Worker error:', error);
          if (mounted) {
            console.log('[App] Worker failed, falling back to main thread');
            worker.terminate();
            worker = null;
            // Fallback to main thread
            setTimeout(() => loadDataMainThread(), 1000);
          }
        };
        
        // Start loading
        setIsLoading(true);
        setIsReady(false);
        setLoadingStage(0);
        setLoadingProgress(0);
        setLoadingStatus(LOADING_STATES[0]);
        
        console.log('[App] Sending work to worker...');
        // Send work to worker
        worker.postMessage({
          type: 'LOAD_DATA',
          baseUrl: import.meta.env.BASE_URL
        });
        
      } catch (error) {
        console.error('Failed to create worker:', error);
        loadDataMainThread();
      }
    };

    // Start with main thread loading for reliability
    console.log('[App] Starting data loading process...');
    loadDataMainThread();

    // Cleanup
    return () => {
      mounted = false;
      if (worker) {
        worker.terminate();
      }
    };
  }, []); // Empty dependency array - only run on mount

  // Effect: generate plasmid map viewer HTML when a gene node is selected
  useEffect(() => {
    if (!highlightedNode) {
      setIframeSrc('');
      setShowIframe(false);
      return;
    }

    const worker = new Worker(new URL('./iframeWorker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { type, htmlContent, error } = event.data;

      if (type === 'IFRAME_LOADED') {
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        setIframeSrc(blobUrl);
        setShowIframe(true);
        return () => URL.revokeObjectURL(blobUrl);
      }

      if (type === 'IFRAME_ERROR') {
        console.error('Error loading iframe:', error);
      }
    };

    worker.postMessage({ type: 'LOAD_IFRAME', id: highlightedNode });

    return () => {
      worker.terminate();
    };
  }, [highlightedNode]);

  // --- Elegant Plasmid DNA Loading Animation ---
  return (
    <>
      {(isLoading || !isNetworkReady) && (
        <div className="loading-container">
          <div className="plasmid-container">
            <div className="plasmid-circle pulse"></div>
            <div className="center-dot"></div>
            <div className="gene-track">
              <div className="gene gene-1 long"></div>
              <div className="gene gene-2 type-2 short"></div>
              <div className="gene gene-3 type-3 medium"></div>
              <div className="gene gene-4 type-4 long"></div>
              <div className="gene gene-5 short"></div>
              <div className="gene gene-6 type-2 medium"></div>
              <div className="gene gene-7 type-3 long"></div>
              <div className="gene gene-8 type-4 short"></div>
            </div>
          </div>
          <div className="loading-text">
            {!isNetworkReady && isReady ? 'Finalizing network visualization...' : loadingStatus}
          </div>
          
          <div className="progress-container">
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{width: `${!isNetworkReady && isReady ? 95 : loadingProgress}%`}}
              ></div>
            </div>
            <div className="progress-dots">
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
              <div className="dot"></div>
            </div>
          </div>
        </div>
      )}

      {/* Always render the network, but hide it until ready */}
      <div style={{ 
        width: '100vw', 
        height: '100vh',
        visibility: isReady && isNetworkReady ? 'visible' : 'hidden',
        position: 'absolute',
        top: 0,
        left: 0
      }}>
        {isReady && (
          <>
            <div style={{ 
                position: 'absolute', 
                top: 10, 
                left: 0, // align to the very left
                width: '100vw', // span the full width
                zIndex: 20, 
                display: 'flex', 
                gap: 8, 
                flexWrap: 'wrap',
                alignItems: 'center', // vertical alignment
                justifyContent: 'flex-start', // align all to the left
                paddingLeft: 10, // add a little padding
                paddingRight: 10
              }}>
              {(edgeRows.length > 0) && (
                <>
                  {/* Color by selector label */}
                  <span style={{ fontSize: 13, marginRight: 6, whiteSpace: 'nowrap', marginTop: 0 }}>Color by:</span>
                  <select value={String(colorBy)} onChange={e => setColorBy(String(e.target.value))} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 4 }}>
                    {csvColumns.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <input
                      type="text"
                      placeholder="Search node id..."
                      style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: '2px 6px', minWidth: 120 }}
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
                  <button onClick={() => setEnableDynamicEdges(!enableDynamicEdges)} style={buttonStyle}>
                    {enableDynamicEdges ? 'Disable Dynamic Edges' : 'Enable Dynamic Edges'}
                  </button>
                  {/* Existing edge toggle */}
                  <button onClick={() => setEdgeMode(edgeMode === 'none' ? 'all' : 'none')} style={buttonStyle}>
                    {edgeMode === 'none' ? 'Show All Edges (slow)' : 'Hide Edges'}
                  </button>
                  {/* Toggle map visibility */}
                  <button onClick={() => setShowIframe(!showIframe)} style={buttonStyle}>
                    {showIframe ? 'Hide Genome Map' : 'Show Genome Map'}
                  </button>
                  <button onClick={() => setShowLabels(prev => !prev)} style={buttonStyle}>
                    {showLabels ? 'Hide Labels' : 'Show Labels'}
                  </button>
                  <button onClick={() => setShowPTUs(prev => !prev)} style={buttonStyle}>
                    {showPTUs ? 'Hide PTUs' : 'Show PTUs'}
                  </button>
                  {/* Export network snapshot */}
                  <button onClick={() => {
                      if (sigmaRef.current) downloadAsPNG(sigmaRef.current, { height: 800, width: 800 });
                    }}
                    style={buttonStyle}>
                     Download PNG
                   </button>
                </>
              )}
            </div>

            {/* Render network canvas */}
            <SigmaNetwork
              edgeRows={edgeRows}
              metadataRows={metadataRows}
              colorBy={colorBy}
              highlightedNode={highlightedNode}
              hoveredNode={hoveredNode}
              edgeMode={edgeMode}
              enableDynamicEdges={enableDynamicEdges}
              zoomToId={zoomToId}
              setHoveredNode={setHoveredNode}
              setHighlightedNode={setHighlightedNode}
              showLabels={showLabels}
              showPTULabels={showPTUs}
              onSigmaInit={sigma => { sigmaRef.current = sigma; }}
              onNetworkReady={() => {
                console.log('[App] Network is fully ready and colored!');
                setIsNetworkReady(true);
              }}
            />

            {/* Optional genome map iframe */}
            {showIframe && iframeSrc && isNetworkReady && (
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
        )}
      </div>
    </>
  );
}

export default App;
