import { useEffect, useRef, useState } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import { parse } from 'graphology-graphml/browser';
import Papa from 'papaparse';
import { EdgeLineProgram, NodePointProgram } from 'sigma/rendering';
import { bindWebGLLayer, createContoursProgram } from '@sigma/layer-webgl';

// Color palettes
const DEFAULT_PALETTE = ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#1abc9c','#e67e22','#34495e','#95a5a6','#d35400'];
const GROUP_COLORS = { admin:'#e74c3c',user:'#3498db',moderator:'#2ecc71' };

function SigmaNetwork({
  graphmlString,
  edgeListString,
  useEdgeList = false,
  metadataCsvString,
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
}) {
  const containerRef = useRef(null);
  const sigmaInstance = useRef(null);
  const metadataRef = useRef(null);
  const allEdgesRef = useRef([]);
  const [communities, setCommunities] = useState([]);
  const [palette, setPalette] = useState({});
  const [visibleComms, setVisibleComms] = useState(new Set());
  const [highlightedComms, setHighlightedComms] = useState(new Set());

  // Ref to always get latest enableDynamicEdges in callbacks
  const enableDynamicEdgesRef = useRef(enableDynamicEdges);
  useEffect(() => { enableDynamicEdgesRef.current = enableDynamicEdges; }, [enableDynamicEdges]);

  useEffect(() => {
    if (metadataCsvString) {
      const isTsv = metadataCsvString.includes('\t');
      const parsed = Papa.parse(metadataCsvString, {
        header: true,
        skipEmptyLines: true,
        delimiter: isTsv ? '\t' : ',',
      });
      const map = {};
      parsed.data.forEach((row) => {
        if (row.id) map[row.id] = row;
      });
      metadataRef.current = map;
    }
  }, [metadataCsvString]);

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
    const graph = inst.getGraph();
    graph.forEachNode((node, attrs) => {
      const v = attrs[colorBy];
      // Only hide if there's a category and it's not in the visible set
      const hidden = v != null && v !== '' && !visibleComms.has(v);
      graph.setNodeAttribute(node, 'hidden', hidden);
    });
    inst.refresh();
  }, [visibleComms]);

  // Apply dynamic coloring and use built-in highlighted flag for selected and community highlights
  useEffect(() => {
    const s = sigmaInstance.current;
    if (!s) return;
    s.setSetting('nodeReducer', (node, data) => {
      const v = data[colorBy];
      const color = v != null && v !== ''
        ? (palette[v] || '#888')
        : data.color;
      const highlighted = node === highlightedNode || highlightedComms.has(v);
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
  }, [palette, colorBy, highlightedComms, highlightedNode, hoveredNode, showLabels, edgeMode]);

  const loadFromEdgeList = async (tsv) => {
    if (onGraphProcessingStart) onGraphProcessingStart();
    await new Promise((r) => setTimeout(r, 0));
    const graph = new Graph();
    const lines = tsv.trim().split('\n');
    const hasHeader = /source|target/i.test(lines[0]);
    const start = hasHeader ? 1 : 0;
    const nodeSet = new Set();
    const edges = [];

    // Always parse edges into ref
    for (let i = start; i < lines.length; i++) {
      const [source, target, weight] = lines[i].split('\t');
      if (!source || !target) continue;
      nodeSet.add(source);
      nodeSet.add(target);
      edges.push({ source, target, attributes: { weight: parseFloat(weight) || 1, color: 'rgb(227, 227, 227)', size: 1 } });
    }
    allEdgesRef.current = edges;

    // Add nodes
    for (const id of nodeSet) {
      const attrs = metadataRef.current?.[id] ?? {};
      let x = parseFloat(attrs.x);
      let y = parseFloat(attrs.y);
      if (isNaN(x)) x = Math.random() * 10;
      if (isNaN(y)) y = Math.random() * 10;
      graph.addNode(id, { ...attrs, x, y, size: 0.7, label: id });
    }

    // Conditionally add edges: all edges only if edgeMode is 'all'
    if (edgeMode === 'all') {
      edges.forEach(({ source, target, attributes }) => {
        try { graph.addEdge(source, target, attributes); } catch {}
      });
    }

    renderGraph(graph);
    if (onGraphProcessingDone) onGraphProcessingDone();
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
    if (useEdgeList && edgeListString) {
      loadFromEdgeList(edgeListString);
    } else if (graphmlString) {
      loadFromGraphML(graphmlString);
    }
  }, [graphmlString, edgeListString, useEdgeList, metadataCsvString, edgeMode]); // removed colorBy

  // Recompute legend/palette and visible set when colorBy changes
  useEffect(() => {
    const inst = sigmaInstance.current;
    if (!inst) return;
    const graph = inst.getGraph();
    handleCommunities(graph);
  }, [colorBy]);

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

  // Compute community list & palette when graph is rendered
  const handleCommunities = graph => {
    // Gather unique values for current colorBy
    const commSet = new Set();
    graph.forEachNode((node, attrs) => {
      const v = attrs[colorBy];
      if (v != null) commSet.add(v);
    });
    const commList = Array.from(commSet);
    // Build consistent palette: groupColors for 'group', else DEFAULT_PALETTE
    const pal = {};
    commList.forEach((comm, i) => {
      if (colorBy === 'group' && GROUP_COLORS[comm]) pal[comm] = GROUP_COLORS[comm];
      else pal[comm] = DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
    });
    setCommunities(commList);
    setVisibleComms(new Set(commList));
    setPalette(pal);

    // Apply nodeReducer immediately to update colors
    const s = sigmaInstance.current;
    if (s) {
      s.setSetting('nodeReducer', (node, data) => {
        const v = data[colorBy];
        return { ...data, color: pal[v] || '#888' };
      });
      s.refresh();
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <details style={{ position: 'absolute', top: 10, right: 10, zIndex: 20, background: 'rgba(255,255,255,0.9)', padding: 4, borderRadius: 4, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', padding: '4px' }}>Legend</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px', maxHeight: '50vh', overflowY: 'auto' }}>
          <button onClick={toggleAll} style={{ fontSize: 12, padding: '2px 4px', marginBottom: 4, background: '#fff', color: '#000', border: '1px solid #ccc' }}>
            {visibleComms.size < communities.length ? 'Show All' : 'Hide All'}
          </button>
          {communities.map(comm => (
            <label key={comm} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', opacity: visibleComms.has(comm) ? 1 : 0.3 }}>
              <span onClick={() => toggleComm(comm)} style={{ width: 12, height: 12, background: palette[comm], display: 'inline-block', borderRadius: 2, cursor: 'pointer' }} />
              <span onClick={() => toggleHighlight(comm)} style={{ fontSize: 12, cursor: 'pointer', fontWeight: highlightedComms.has(comm) ? 'bold' : 'normal' }}>{comm}</span>
            </label>
          ))}
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
