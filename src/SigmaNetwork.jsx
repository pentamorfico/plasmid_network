import React, { useEffect, useRef, useState, useMemo } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { EdgeLineProgram, NodePointProgram } from 'sigma/rendering';
import { bindWebGLLayer, createContoursProgram } from '@sigma/layer-webgl';
import iwanthue from 'iwanthue';
import { getSequentialColors, getPalettes } from 'dicopal';
import { flushSync } from 'react-dom';

function SigmaNetwork({
  edgeRows = [],
  metadataRows = [],
  colorBy = 'group',
  highlightedNode,
  hoveredNode,
  edgeMode = 'none',
  enableDynamicEdges = true,
  zoomToId,
  setHoveredNode,
  setHighlightedNode,
  onSigmaInit, // new callback prop
  onNetworkReady, // callback when network is fully loaded and colored
  showLabels,
  showPTULabels,
}) {
  const containerRef = useRef(null);
  const sigmaInstance = useRef(null);
  const metadataRef = useRef(null);
  const allEdgesRef = useRef([]);
  const ptuPaletteRef = useRef({});
  const networkReadyCalledRef = useRef(false); // Track if network ready has been called
  const [communities, setCommunities] = useState([]);
  const [palette, setPalette] = useState({});
  const [visibleComms, setVisibleComms] = useState(new Set());
  const [highlightedComms, setHighlightedComms] = useState(new Set());
  const [isNumeric, setIsNumeric] = useState(false);
  const numericPaletteRef = useRef([]);
  const numericDomainRef = useRef([0, 0]);
  // Sequential palette choices for numeric legend (dynamic list)
  const paletteOptions = useMemo(
    () => [...new Set(
      getPalettes({ type: 'sequential' })
        .map(p => p.name)
    )],
    []
  );
  const [sequentialPaletteName, setSequentialPaletteName] = useState('Blues');
  // Toggle to reverse numeric palette order
  const [isReversed, setIsReversed] = useState(false);
  // Array state for legend gradient stops
  const [numericPaletteState, setNumericPaletteState] = useState([]);
  const [showLegend, setShowLegend] = useState(false);
  // Shared style for all panel buttons
  const buttonStyle = {
    padding: '6px 12px',
    background: '#fff',
    color: '#000',
    border: '1px solid #ccc',
    borderRadius: 14,
    cursor: 'pointer',
    fontSize: '11px'
  };

  // Ref to always get latest enableDynamicEdges in callbacks
  const enableDynamicEdgesRef = useRef(enableDynamicEdges);
  useEffect(() => { enableDynamicEdgesRef.current = enableDynamicEdges; }, [enableDynamicEdges]);

  // Helper to call onNetworkReady only once per network load
  const callNetworkReady = () => {
    if (!networkReadyCalledRef.current && onNetworkReady) {
      console.log('[SigmaNetwork] Network is fully ready and colored!');
      networkReadyCalledRef.current = true;
      setTimeout(() => {
        onNetworkReady();
      }, 100);
    }
  };

  // Flag to track if this is initial data load (not just color change)
  const isInitialLoadRef = useRef(true);

  // Reset network ready flag only when actual data changes (not color changes)
  useEffect(() => {
    networkReadyCalledRef.current = false;
    isInitialLoadRef.current = true; // Mark as initial load
  }, [edgeRows, metadataRows]);

  // Build metadata map directly
  useEffect(() => {
    if (!metadataRows.length) return;
    const map = {};
    metadataRows.forEach(r => { if (r.id) map[r.id] = r; });
    metadataRef.current = map;
  }, [metadataRows]);

  const renderGraph = (graph) => {
    if (sigmaInstance.current) sigmaInstance.current.kill();

    if (containerRef.current instanceof HTMLElement) {
      sigmaInstance.current = new Sigma(graph, containerRef.current, {
        nodeProgramClasses: { circle: NodePointProgram },
        edgeProgramClasses: { line: EdgeLineProgram },
        defaultNodeType: 'circle',
        defaultEdgeType: 'line',
        renderLabels: false,  // start with no labels, use reducer to show only hovered/highlighted
        renderEdgeLabels: false,
        enableNodeClickEvents: true,
        enableNodeHoverEvents: true,
        enableEdgeClickEvents: false,
        enableEdgeWheelEvents: false,
        enableEdgeHoverEvents: false,
        zoomDuration: 10,
        zoomingRatio: 1.5,
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
        renderEdgeArrows: false,
        zIndex: false,
        // Dynamic coloring via GPU-side reducer
      });

      // Initial GPU-side coloring applied automatically

      // Expose sigma instance to parent
      onSigmaInit?.(sigmaInstance.current);

      sigmaInstance.current.on('enterNode', ({ node }) => {
        setHoveredNode?.(node);
      });
      sigmaInstance.current.on('leaveNode', () => {
        setHoveredNode?.(null);
      });
      // Handle node click as selection
      sigmaInstance.current.on('clickNode', ({ node }) => {
        setHighlightedNode?.(node);
        // On click in 'none' mode and if dynamic edges enabled, defer edge loading
        if (edgeMode === 'none' && enableDynamicEdgesRef.current) {
          setTimeout(() => updateEdgesForHighlight(node), 0);
        }
      });
      // Clear highlighted node when clicking empty stage
      sigmaInstance.current.on('clickStage', () => {
        setHighlightedNode?.(null);
        setHoveredNode?.(null);
      });
      // Extract communities once graph is live - but don't call network ready yet
      handleCommunities(graph);

      // --- PTU cluster labels overlay ---
      if (showPTULabels) {
        const renderer = sigmaInstance.current;
        // Remove existing labels layer if present
        let labelsLayer = containerRef.current.querySelector('#ptuLabels');
        if (labelsLayer) labelsLayer.remove();
        labelsLayer = document.createElement('div');
        labelsLayer.id = 'ptuLabels';

        // Use existing PTU palette cached by handleCommunities
        // Create PTU labels container
        const graph = renderer.getGraph();
        // Use cached PTU palette
        const ptuColorMap = ptuPaletteRef.current;

        // Build ptuMap with positions and colors for overlay
        const ptuMap = {};
        graph.forEachNode((node, attr) => {
          const ptu = attr.new_PTU;
          if (!ptu) return;
          if (!ptuMap[ptu]) ptuMap[ptu] = { positions: [], color: ptuColorMap[ptu] || '#000', label: ptu };
          ptuMap[ptu].positions.push({ x: attr.x, y: attr.y });
        });
        // Build HTML for PTU labels
        let html = '';
        Object.values(ptuMap).forEach(cluster => {
          const avg = cluster.positions.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
          avg.x /= cluster.positions.length;
          avg.y /= cluster.positions.length;
          const vp = renderer.graphToViewport(avg);
          html += `<div id="ptu-${cluster.label}" class="ptuLabel" ` +
                  `style="position:absolute !important;top:${vp.y}px !important;left:${vp.x}px !important;` +
                  `color:${cluster.color} !important;font-size:102px !important;pointer-events:none !important;` +
                  `transform:translate(-100%,-50%) !important;font-weight:bold !important;text-align:right !important;` +
                  `z-index:1000 !important;font-family:Arial,sans-serif !important;">` +
                  `${cluster.label}</div>`;
        });
        labelsLayer.innerHTML = html;
        containerRef.current.insertBefore(labelsLayer, containerRef.current.querySelector('.sigma-hovers'));

        // Update positions on each render
        renderer.on('afterRender', () => {
          Object.values(ptuMap).forEach(cluster => {
            const avg = cluster.positions.reduce((acc, p) => ({ x: acc.x + p.x-200, y: acc.y + p.y }), { x: 0, y: 0 });
            avg.x /= cluster.positions.length; avg.y /= cluster.positions.length;
            const vp = renderer.graphToViewport(avg);
            const el = document.getElementById(`ptu-${cluster.label}`);
            if (el) {
              el.style.top = `${vp.y}px`;
              el.style.left = `${vp.x}px`;
            }
          });
        });
      } else {
        // remove any existing PTU overlay
        const existing = containerRef.current.querySelector('#ptuLabels');
        if (existing) existing.remove();
      }
    }
  };

  // Toggle visibility of a single community
  const toggleComm = comm => {
    const next = new Set(visibleComms);
    next.has(comm) ? next.delete(comm) : next.add(comm);
    setVisibleComms(next);
  };
  // Toggle all communities on/off
  const toggleAll = () => {
    if (visibleComms.size < communities.length) setVisibleComms(new Set(communities));
    else setVisibleComms(new Set());
  };
  // Toggle highlight(s) of communities
  const toggleHighlight = comm => {
    const next = new Set(highlightedComms);
    next.has(comm) ? next.delete(comm) : next.add(comm);
    setHighlightedComms(next);
    // Clear any node highlight to ensure community effect runs
    setHighlightedNode?.(null);
  };

  // Effect: show/hide nodes when visibleComms or numeric mode change, but only when palette ready
  useEffect(() => {
    const inst = sigmaInstance.current;
    if (!inst || Object.keys(palette).length === 0) return; // wait for palette
    // Skip hiding behavior when numeric coloring is active
    if (isNumeric) {
      inst.refresh({ skipIndexation: true });
      return;
    }
    const graph = inst.getGraph();
    graph.forEachNode((node, attrs) => {
      const v = attrs[colorBy];
      const hidden = v != null && !visibleComms.has(v);
      graph.setNodeAttribute(node, 'hidden', hidden);
    });
    inst.refresh({ skipIndexation: true });
  }, [visibleComms, isNumeric, palette]);

  // Apply dynamic coloring and use built-in highlighted flag for selected and community highlights
  useEffect(() => {
    const s = sigmaInstance.current;
    if (!s || Object.keys(palette).length === 0) return; // Don't refresh with empty palette
    
    s.setSetting('nodeReducer', (node, data) => {
      // Choose color from numeric palette (node-keyed) or categorical (value-keyed)
      const color = isNumeric
        ? palette[node] || data.color
        : (data[colorBy] != null ? palette[data[colorBy]] : data.color);
     const highlighted = node === highlightedNode || highlightedComms.has(data[colorBy]);
     const hovered = node === hoveredNode;
     const nodeLabel = data.label;
     const newData = { ...data, color, highlighted };
     if (!showLabels) {
       newData.label = undefined;
     } else if (!(highlighted || hovered)) {
       newData.label = undefined;
     } else {
       newData.label = nodeLabel;
     }
     return newData;
   });
   
   // Only refresh after palette is set and ready
   s.refresh({ skipIndexation: true });
 }, [palette, highlightedComms, highlightedNode, hoveredNode, showLabels, edgeMode, isNumeric]);

  // Separate effect to call network ready only after initial load and coloring
  useEffect(() => {
    if (isInitialLoadRef.current && Object.keys(palette).length > 0 && sigmaInstance.current) {
      isInitialLoadRef.current = false;
      setTimeout(() => callNetworkReady(), 100);
    }
  }, [palette]);

  // Build graph directly from Parquet rows
  const loadFromEdgeList = async () => {
    // build graph and edge list
    const graph = new Graph();
    const edges = edgeRows.map(r => ({
      source: r.source,
      target: r.target,
      attributes: { weight: r.weight || 1, color: 'rgb(227,227,227)', size: 1 }
    }));
    allEdgesRef.current = edges;
    const nodeSet = new Set(edges.flatMap(e => [e.source, e.target]));
    // add nodes from metadata
    nodeSet.forEach(id => {
      const attrs = metadataRef.current?.[id] ?? {};
      let x = parseFloat(attrs.x), y = parseFloat(attrs.y);
      if (isNaN(x)) x = Math.random() * 10;
      if (isNaN(y)) y = Math.random() * 10;
      graph.addNode(id, { ...attrs, x, y, size: 0.7, label: id });
    });
    // add edges if mode=all
    if (edgeMode === 'all') edges.forEach(e => { try { graph.addEdge(e.source, e.target, e.attributes); } catch {} });
    renderGraph(graph);
  };

  // helper: update edges for a single node highlight
  const updateEdgesForHighlight = node => {
    const s = sigmaInstance.current;
    if (!s) return;
    const g = s.getGraph();
    g.clearEdges();
    allEdgesRef.current.forEach(({ source, target, attributes }) => {
      if (source === node || target === node) {
        try { g.addEdge(source, target, attributes); } catch {};
      }
    });
    s.refresh();
  };

  // React to programmatic highlights (zoom or legend) and load edges when in 'none' mode
  useEffect(() => {
    const s = sigmaInstance.current;
    if (!s) return;
    const g = s.getGraph();
    // Only run dynamic edge loading when mode none and dynamic edges enabled
    if (edgeMode !== 'none' || !enableDynamicEdges) return;
    // No highlights: clear all edges
    if (!highlightedNode && highlightedComms.size === 0) {
      g.clearEdges();
      s.refresh();
      return;
    }
    // Single node highlight
    if (highlightedNode) {
      updateEdgesForHighlight(highlightedNode);
      return;
    }
    // Community highlights: only edges in those communities
    g.clearEdges();
    allEdgesRef.current.forEach(({ source, target, attributes }) => {
      const srcComm = g.getNodeAttribute(source, colorBy);
      const tgtComm = g.getNodeAttribute(target, colorBy);
      if (highlightedComms.has(srcComm) || highlightedComms.has(tgtComm)) {
        try { g.addEdge(source, target, attributes); } catch {};
      }
    });
    s.refresh();
  }, [highlightedNode, highlightedComms, edgeMode, enableDynamicEdges]);

  // Clear any highlighted edges when dynamic edges are disabled
  useEffect(() => {
    const s = sigmaInstance.current;
    if (!s) return;
    if (!enableDynamicEdges && edgeMode === 'none') {
      const g = s.getGraph();
      g.clearEdges();
      s.refresh();
    }
  }, [enableDynamicEdges, edgeMode]);

  useEffect(() => {
    if (edgeRows.length && metadataRows.length) loadFromEdgeList();
  }, [edgeRows, metadataRows, edgeMode]);

  // Recompute legend/palette and visible set when colorBy changes
  useEffect(() => {
    const inst = sigmaInstance.current;
    if (!inst) return;
    const graph = inst.getGraph();
    // Don't reset isInitialLoadRef for color changes - only for data changes
    handleCommunities(graph);
  }, [colorBy, sequentialPaletteName, isReversed]);

  useEffect(() => {
    const resize = () => sigmaInstance.current?.refresh(
      {
        skipIndexation: true,
      }
    );
    window.addEventListener('resize', resize);
    return () => {
      sigmaInstance.current?.kill();
      window.removeEventListener('resize', resize);
    };
  }, []);

  useEffect(() => {
    if (!zoomToId || !sigmaInstance.current) return;
    const r = sigmaInstance.current;
    const pos = r.getNodeDisplayData(zoomToId) ?? r.getGraph().getNodeAttributes(zoomToId);
    if (pos?.x && pos?.y) r.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.01 }, { duration: 1000 });
    // Treat zoom-to as selection
    setHighlightedNode?.(zoomToId);
  }, [zoomToId]);

  // Effect: show/hide PTU cluster labels overlay on prop change
  useEffect(() => {
    const renderer = sigmaInstance.current;
    const container = containerRef.current;
    if (!renderer || !container) return;

    // Remove any existing PTU overlay
    const existing = container.querySelector('#ptuLabels');
    if (existing) existing.remove();

    if (showPTULabels) {
      // Use existing PTU palette cached by handleCommunities
       // Create PTU labels container
       const labelsLayer = document.createElement('div');
       labelsLayer.id = 'ptuLabels';

       // Build PTU label clusters and html
       const graph = renderer.getGraph();
       // Use cached PTU palette
       const ptuColorMap = ptuPaletteRef.current;
       // Build ptuMap with positions and colors for overlay
       const ptuMap = {};
       graph.forEachNode((node, attr) => {
         const ptu = attr.new_PTU;
         if (!ptu) return;
         if (!ptuMap[ptu]) ptuMap[ptu] = { positions: [], color: ptuColorMap[ptu] || '#000', label: ptu };
         ptuMap[ptu].positions.push({ x: attr.x, y: attr.y });
       });
       // Build HTML for PTU labels
       let html = '';
       Object.values(ptuMap).forEach(cluster => {
         const avg = cluster.positions.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
         avg.x /= cluster.positions.length;
         avg.y /= cluster.positions.length;
         const vp = renderer.graphToViewport(avg);
         html += `<div id="ptu-${cluster.label}" class="ptuLabel" ` +
                 `style="position:absolute;top:${vp.y}px;left:${vp.x}px;` +
                 `color:${cluster.color};font-size:12px;pointer-events:none;">` +
                 `${cluster.label}</div>`;
       });
       labelsLayer.innerHTML = html;
       container.insertBefore(labelsLayer, container.querySelector('.sigma-hovers'));

       // Update label positions on each render
       renderer.on('afterRender', () => {
         Object.values(ptuMap).forEach(cluster => {
           const avg = cluster.positions.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
           avg.x /= cluster.positions.length; avg.y /= cluster.positions.length;
           const vp = renderer.graphToViewport(avg);
           const el = document.getElementById(`ptu-${cluster.label}`);
           if (el) {
             el.style.top = `${vp.y}px`;
             el.style.left = `${vp.x}px`;
           }
         });
       });
    }
  }, [showPTULabels, palette]);

  // Compute community list & palette when graph is rendered, batching state updates to avoid intermediate empty palette
  const handleCommunities = (graph) => {
    // Always precompute PTU palette for PTU label overlay (regardless of current colorBy)
    const ptuSet = new Set();
    graph.forEachNode((n, attrs) => {
      const v = attrs.new_PTU;
      ptuSet.add(v != null && v !== '' ? v : '');
    });
    const ptuList = Array.from(ptuSet);
    const ptuColors = iwanthue(ptuList.length) || [];
    const ptuPal = {};
    ptuList.forEach((ptu, i) => {
      ptuPal[ptu] = ptu === '' ? '#d3d3d3' : (ptuColors[i] || '#888');
    });
    ptuPaletteRef.current = ptuPal; // Always store PTU palette for label overlay
    // Determine if numeric data
    const nodes = [];
    graph.forEachNode(node => nodes.push(node));
    const numericData = nodes.map(node => ({ node, v: Number(graph.getNodeAttribute(node, colorBy)) }))
      .filter(d => !isNaN(d.v));
    const numeric = numericData.length === nodes.length;

    // Prepare new state variables
    let newPalette, newCommunities, newVisibleComms, newNumericPaletteState, newIsNumeric;

    if (colorBy === 'new_PTU') {
      newPalette = ptuPal;
      newCommunities = Object.keys(ptuPal);
      newVisibleComms = new Set(newCommunities);
      newIsNumeric = false;
    } else if (numeric) {
      // Numeric mode
      numericData.sort((a, b) => a.v - b.v);
      const values = numericData.map(d => d.v);
      numericDomainRef.current = [values[0], values[values.length - 1]];
      let palColors = getSequentialColors(sequentialPaletteName, numericData.length);
      if (isReversed) palColors = [...palColors].reverse();
      const palMap = {};
      numericData.forEach((d, i) => { palMap[d.node] = palColors[i] ?? '#888'; });
      newPalette = palMap;
      newCommunities = [];
      newVisibleComms = new Set();
      newNumericPaletteState = palColors;
      newIsNumeric = true;
    } else {
      // Categorical mode
      const commSet = new Set();
      graph.forEachNode((node, attrs) => {
        const v = attrs[colorBy];
        if (v != null) commSet.add(v);
      });
      const allComms = Array.from(commSet);
      let colorsCat = iwanthue(allComms.length) || [];
      for (let i = colorsCat.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [colorsCat[i], colorsCat[j]] = [colorsCat[j], colorsCat[i]];
      }
      const nonMissing = allComms.filter(c => c !== '').sort((a, b) => a.localeCompare(b));
      const missing = allComms.includes('') ? [''] : [];
      newCommunities = [...nonMissing, ...missing];
      newVisibleComms = new Set(newCommunities);
      const pal = {};
      newCommunities.forEach((comm, i) => {
        pal[comm] = comm === '' ? '#d3d3d3' : (colorsCat[i] ?? '#888');
      });
      newPalette = pal;
      newIsNumeric = false;
    }

    // Synchronously batch updates to avoid intermediate empty palette flashing
    flushSync(() => {
      setIsNumeric(newIsNumeric);
      setPalette(newPalette);
      setCommunities(newCommunities);
      setVisibleComms(newVisibleComms);
      if (newNumericPaletteState) setNumericPaletteState(newNumericPaletteState);
    });
  };

  // Determine which node info to display: clicked (highlighted) has priority over hover
  const displayNode = highlightedNode || hoveredNode;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} className="sigma-container" style={{ width: '100%', height: '100%' }} />
      {/* Bottom-right independent panels */}
      <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 20, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        {/* Hover/Click Info Panel */}
        {displayNode && (
          <div style={{ marginBottom: '6px', width: 220, maxHeight: '30vh', overflowY: 'auto', background: '#fff', border: '1px solid #ccc', borderRadius: 4, padding: '8px', fontSize: '11px', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
            <strong style={{ display: 'block', marginBottom: '4px' }}>{displayNode}</strong>
            {metadataRef.current?.[displayNode] && Object.entries(metadataRef.current[displayNode]).map(([key, value]) => (
              key !== 'id' && <div key={key} style={{ marginBottom: '3px' }}>{key}: {String(value)}</div>
            ))}
          </div>
        )}
        {/* Legend Panel */}
        {showLegend && (
          <div style={{ marginBottom: '16px', width: 220, maxHeight: '40vh', overflowY: 'auto', background: '#fff', border: '1px solid #ccc', borderRadius: 4, padding: '8px', fontSize: '11px', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
            <button onClick={toggleAll} style={{
  ...buttonStyle,
  width: '100%',
  marginBottom: '10px',
}}>
              {visibleComms.size < communities.length ? 'Show All' : 'Hide All'}
            </button>
            {communities.map(comm => (
              <div key={comm} style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                <span onClick={() => toggleComm(comm)} style={{ width: '10px', height: '10px', backgroundColor: palette[comm], marginRight: '6px', cursor: 'pointer', opacity: visibleComms.has(comm) ? 1 : 0.3, flexShrink: 0 }} />
                <span onClick={() => toggleHighlight(comm)} style={{ cursor: 'pointer', fontWeight: highlightedComms.has(comm) ? 'bold' : 'normal', fontSize: '11px' }}>
                  {comm || '(missing)'}
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Legend Toggle Button */}
        <button onClick={() => setShowLegend(prev => !prev)} style={buttonStyle}>
          {showLegend ? 'Hide Legend' : 'Show Legend'}
        </button>
      </div>
    </div>
  );
}

export default SigmaNetwork;