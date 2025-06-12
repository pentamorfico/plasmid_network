# Plasmid Defense Network Viewer

![Network Diagram](docs/screen_record.gif)

This [live application](https://pentamorfico.github.io/plasmid_network/) visualizes a biological plasmid network using Graphology and Sigma.js. It automatically loads metadata and edge data from Parquet files, builds an interactive graph, and allows real-time exploration of network structure and individual plasmid maps.

## Features

- **Color by Metadata**: Nodes are colored by any metadata field. Select a column from the dropdown to recolor the network.
- **Search & Zoom**: Type a node ID into the search box; autocomplete suggestions appear after two characters. Press Enter or click a suggestion to zoom and highlight.
- **Dynamic Edges**: When in **None** edge mode, clicking or highlighting a node shows only its immediate connections. Toggle **Enable Dynamic Edges** to switch between static and dynamic edge rendering.
- **Show/Hide**: Buttons to show/hide all edges, toggle node labels, and display a detailed plasmid map in an embedded iframe.
- **Legend Panel**: A collapsible legend listing metadata categories lets you filter (show/hide) or highlight entire groups of nodes.
- **Performance**: Uses GPU-based rendering and a WebGL layer for large networks.

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Run in development**
   ```bash
   npm run dev
   ```
   Open http://localhost:5173 in your browser.

3. **Build for production**
   ```bash
   npm run build
   ```

4. **Deploy to GitHub Pages**
   ```bash
   npm run deploy
   ```
   (Requires `gh-pages` configured in `package.json`.)

## How to Interact

- **Color dropdown**: Pick a metadata field (e.g., `group`, `size`, custom CSV columns).
- **Search box**: Type node IDs, use arrow keys or mouse to select, then Enter to zoom & highlight.
- **Edges**:
  - **Show All Edges** / **Hide Edges** toggles full network edges.
  - **Enable Dynamic Edges** toggles on-click/hover edge display.
- **Labels**: Toggle node labels on/off.
- **Legend**:
  - Click colored square to hide/show that category.
  - Click category name to highlight all nodes in that group.
  - **Show All** / **Hide All** buttons quickly toggle all categories.
- **Plasmid Map**: When a node is clicked, an interactive plasmid viewer loads in the lower-left corner. Toggle its visibility with the **Show/Hide Genome Map** button.