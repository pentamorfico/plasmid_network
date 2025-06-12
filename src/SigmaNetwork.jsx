import { useEffect, useRef, useState, useMemo } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { parse } from 'graphology-graphml/browser';
import { EdgeLineProgram, NodePointProgram } from 'sigma/rendering';
import { bindWebGLLayer, createContoursProgram } from '@sigma/layer-webgl';
import iwanthue from 'iwanthue';
import { getSequentialColors, getPalettes } from 'dicopal';

function SigmaNetwork({
  graphmlString,
  edgeRows = [],
  useEdgeList = false,
  metadataRows = [],
  colorBy = 'group',
  highlightedNode,
  hoveredNode,
  edgeMode = 'none',
  enableDynamicEdges = true,
  zoomToId,
  setHoveredNode,
  setHighlightedNode,
  onGraphProcessingStart,
  onGraphProcessingDone,
  showLabels,
  onSigmaInit, // new callback prop
  showPTULabels,
}) {
  const containerRef = useRef(null);
  const sigmaInstance = useRef(null);
  const metadataRef = useRef(null);
  const allEdgesRef = useRef([]);
  const ptuPaletteRef = useRef({});
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

  // Ref to always get latest enableDynamicEdges in callbacks
  const enableDynamicEdgesRef = useRef(enableDynamicEdges);
  useEffect(() => { enableDynamicEdgesRef.current = enableDynamicEdges; }, [enableDynamicEdges]);

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
      // Extract communities once graph is live
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
                  `style="position:absolute;top:${vp.y}px;left:${vp.x}px;` +
                  `color:${cluster.color};font-size:12px;pointer-events:none;">` +
                  `${cluster.label}</div>`;
        });
        labelsLayer.innerHTML = html;
        containerRef.current.insertBefore(labelsLayer, containerRef.current.querySelector('.sigma-hovers'));

        // Update positions on each render
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

  // Effect: show/hide nodes when visibleComms changes
  useEffect(() => {
    const inst = sigmaInstance.current;
    if (!inst) return;
    // Skip hiding behavior when numeric coloring is active
    if (isNumeric) {
      inst.refresh();
      return;
    }
    const graph = inst.getGraph();
    graph.forEachNode((node, attrs) => {
      const v = attrs[colorBy];
      // Hide any category (including empty string) if it's not in the visible set
      const hidden = v != null && !visibleComms.has(v);
      graph.setNodeAttribute(node, 'hidden', hidden);
    });
    inst.refresh();
  }, [visibleComms, isNumeric]);

  // Apply dynamic coloring and use built-in highlighted flag for selected and community highlights
  useEffect(() => {
    const s = sigmaInstance.current;
    if (!s) return;
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
   s.refresh({ skipIndexation: true });
 }, [palette, colorBy, highlightedComms, highlightedNode, hoveredNode, showLabels, edgeMode, isNumeric]);

  // Build graph directly from Parquet rows
  const loadFromEdgeList = async () => {
    onGraphProcessingStart?.();
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
    onGraphProcessingDone?.();
  };

  const loadFromGraphML = (graphmlText) => {
    if (onGraphProcessingStart) onGraphProcessingStart();
    const graph = parse(Graph, graphmlText);
    // store all edges
    allEdgesRef.current = graph.edges().map(edge => ({
      source: graph.source(edge),
      target: graph.target(edge),
      attributes: graph.getEdgeAttributes(edge)
    }));

    // If edgeMode none, clear edges; else keep
    if (edgeMode === 'none') graph.clearEdges();

    graph.forEachNode((node, attrs) => {
      const meta = metadataRef.current?.[node];
      if (meta) {
        Object.entries(meta).forEach(([k, v]) => {
          if (k !== 'id' && k !== 'type') graph.setNodeAttribute(node, k, v);
        });
      }
     let x = parseFloat(attrs.x ?? attrs.d0);
      let y = parseFloat(attrs.y ?? attrs.d1);
      if (isNaN(x)) x = Math.random() * 10;
      if (isNaN(y)) y = Math.random() * 10;
      graph.setNodeAttribute(node, 'x', x);
      graph.setNodeAttribute(node, 'y', y);
      graph.setNodeAttribute(node, 'size', 2);
      // Also set the node's label to its id
      graph.setNodeAttribute(node, 'label', node);
    });

    renderGraph(graph);
    if (onGraphProcessingDone) onGraphProcessingDone();
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
    if (useEdgeList && edgeRows.length) loadFromEdgeList();
    else if (graphmlString) loadFromGraphML(graphmlString);
  }, [graphmlString, edgeRows, useEdgeList, metadataRows, edgeMode]);

  // Recompute legend/palette and visible set when colorBy changes
  useEffect(() => {
    const inst = sigmaInstance.current;
    if (!inst) return;
    const graph = inst.getGraph();
    handleCommunities(graph);
  }, [colorBy, sequentialPaletteName]);

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

  // Compute community list & palette when graph is rendered
  const handleCommunities = graph => {
     // Precompute PTU palette including missing values (empty) in light gray
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
     ptuPaletteRef.current = ptuPal;

    // Determine nodes and values for colorBy
    const nodes = [];
    graph.forEachNode(node => nodes.push(node));
    const numericData = nodes.map(node => ({ node, v: Number(graph.getNodeAttribute(node, colorBy)) }))
      .filter(d => !isNaN(d.v));
    // Numeric if all nodes have a valid number
    const numeric = numericData.length === nodes.length;
    setIsNumeric(numeric);
    if (colorBy === 'new_PTU') {
      const pal = ptuPaletteRef.current;
      setPalette(pal);
      const commList = Object.keys(pal);
      setCommunities(commList);
      setVisibleComms(new Set(commList));
      setIsNumeric(false);
      return;
    }
    if (numeric) {
      // Sort nodes by value
      numericData.sort((a, b) => a.v - b.v);
      // Store numeric domain and palette for legend
      const values = numericData.map(d => d.v);
      numericDomainRef.current = [values[0], values[values.length - 1]];
      // Generate numeric palette via dicopal
      const palColors = getSequentialColors(sequentialPaletteName, numericData.length);
      numericPaletteRef.current = palColors;
      const palMap = {};
      numericData.forEach((d, i) => { palMap[d.node] = palColors[i] ?? '#888'; });
      setPalette(palMap);
      setCommunities([]);
      setVisibleComms(new Set());
      return;
    }
    // Categorical branch
    const commSet = new Set();
    graph.forEachNode((node, attrs) => {
      const v = attrs[colorBy];
      if (v != null) commSet.add(v);
    });
    const allComms = Array.from(commSet);
    // Generate categorical palette via iwanthue
    let colors = iwanthue(allComms.length) || [];
    // Randomize order
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [colors[i], colors[j]] = [colors[j], colors[i]];
    }
    const nonMissing = allComms.filter(c => c !== '').sort((a, b) => a.localeCompare(b));
    const missing = allComms.includes('') ? [''] : [];
    const commList = [...nonMissing, ...missing];
    const pal = {};
    commList.forEach((comm, i) => {
      pal[comm] = comm === '' ? '#d3d3d3' : (colors[i] ?? '#888');
    });
    setCommunities(commList);
    setVisibleComms(new Set(commList));
    setPalette(pal);
 };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <details style={{ position: 'absolute', top: 10, right: 10, zIndex: 20, background: 'rgba(255,255,255,0.9)', padding: 4, borderRadius: 4, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', padding: '4px' }}>Legend</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px', maxHeight: '50vh', overflowY: 'auto' }}>
          {isNumeric ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 6, flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{numericDomainRef.current[0].toLocaleString()}</span>
                <div
                  style={{
                    flex: 1,
                    height: 20,
                    background: `linear-gradient(to right, ${numericPaletteRef.current[0]}, ${numericPaletteRef.current[numericPaletteRef.current.length - 1]})`,
                    border: '1px solid #ccc',
                    borderRadius: 4,
                  }}
                />
                <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{numericDomainRef.current[1].toLocaleString()}</span>
              </div>
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, width: '100%' }}>
                <label style={{ fontSize: 13 }}>Palette:</label>
                {/* Dropdown to select sequential palette dynamically */}
                <select
                  value={sequentialPaletteName}
                  onChange={e => setSequentialPaletteName(e.target.value)}
                  style={{ flex: 1, padding: '2px 4px', fontSize: 13 }}
                >
                  {paletteOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            communities.map(comm => (
              <label key={comm} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', opacity: visibleComms.has(comm) ? 1 : 0.3 }}>
                <span onClick={() => toggleComm(comm)} style={{ width: 12, height: 12, background: palette[comm], display: 'inline-block', borderRadius: 2, cursor: 'pointer' }} />
                <span onClick={() => toggleHighlight(comm)} style={{ fontSize: 12, cursor: 'pointer', fontWeight: highlightedComms.has(comm) ? 'bold' : 'normal' }}>
                  {comm === '' ? 'Missing' : comm}
                </span>
              </label>
            ))
          )}
        </div>
      </details>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {/* Metadata info box */}
      {(highlightedNode || hoveredNode) && metadataRef.current?.[highlightedNode || hoveredNode] && (
        <div style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          zIndex: 25,
          background: 'rgba(255,255,255,0.95)',
          padding: 8,
          maxWidth: 400,
          maxHeight: '50vh',
          overflowY: 'auto',
          borderRadius: 4,
          border: '1px solid #ccc',
          fontSize: 12
        }}>
          <strong>{highlightedNode || hoveredNode}</strong>
          <dl style={{ margin: 0, padding: 0 }}>
            {Object.entries(metadataRef.current[highlightedNode || hoveredNode]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex' }}>
                <dt style={{ fontWeight: 'bold', marginRight: 4 }}>{k}:</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export default SigmaNetwork;