# Plasmid Network Viewer

An interactive web application for exploring the global plasmidome and visualizing the distribution of defense systems, antimicrobial resistance (AMR) genes, and anti-defense systems across bacterial plasmids.

## About

This tool accompanies the research paper:

> **Plasmids are major vectors of anti-phage defense**  
> Payne LJ*, Rodríguez Mestre M*, Zheng H*, Mayo-Muñoz D, Russel J, Camara-Wilpert S, Zhang DJ, Zhao R, Li H, Nesme J, Fineran PC, Riber L, Camargo AP, Pinilla-Redondo R*, Sørensen SJ*  
> *These authors contributed equally

## Description

**Plasmid Defense Network** is a visualization tool that enables exploration of relationships between plasmids through a similarity network representation. The application reveals that defense systems are more prevalent on plasmids than antimicrobial resistance genes, even in clinical contexts, highlighting the underappreciated role of plasmids in shaping bacterial immune profiles across environments.

### Key findings from the research:

- **Defense systems are ubiquitous**: 44% of analyzed plasmids harbor at least one defense system, spanning 140 of 156 identifiable system types
- **Higher density than chromosomes**: Plasmids encode over 10× more defense systems per megabase than chromosomes
- **Co-occurrence with AMR**: Defense systems frequently co-occur with AMR genes and anti-defense systems, particularly on large, conjugative plasmids
- **Horizontal transfer**: Extensive transfer of defense loci across plasmids and between replicons, often mediated by nested mobile elements

### Data included:

- **Taxonomy**: Domain, phylum, class, order, family, genus, and species of the host
- **Plasmid characteristics**: Length, topology, predicted mobility, copy number (PCN)
- **Transfer systems**: Relaxase types (MOB), MPF systems, oriT types
- **Defense systems**: CRISPR-Cas, restriction-modification, abortive infection, toxin-antitoxin, and many more
- **Anti-defense systems**: Anti-CRISPR, anti-RM, and other counter-defense mechanisms
- **AMR genes**: Antimicrobial resistance gene content
- **Ecology**: Ecosystem categories, environmental types and subtypes
- **Clustering**: Plasmid Taxonomic Units (PTUs), hierarchical clusters (L1-L8)

## Key Features

- 🔍 **Interactive network visualization** of plasmid similarity relationships using [Cosmograph](https://cosmograph.app/)
- 🎨 **Dynamic coloring** by multiple categorical and numerical attributes (defense content, AMR, taxonomy, etc.)
- 📊 **Node scaling** based on properties like length, plasmid copy number (PCN), defense system count
- 🌓 **Light/dark mode** support
- 📋 **Interactive data table** to explore each plasmid's attributes
- 🔎 **Search and filtering** of nodes in the network
- 📈 **Dynamic legends** for colors and sizes
- 🗺️ **Genome maps** with annotations for defenses, anti-defenses, AMR genes, and mobility-associated genes

## Technologies

- **Frontend**: React 19 + TypeScript
- **Build**: Vite
- **Graph visualization**: Cosmograph
- **UI Components**: Radix UI + Tailwind CSS
- **Tables**: TanStack Table + Glide Data Grid
- **Charts**: Recharts

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd plasmid_network

# Install dependencies
npm install

# Prepare data (if needed)
npm run prepare-data

# Start development server
npm run dev
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Starts the development server |
| `npm run build` | Builds the application for production |
| `npm run preview` | Previews the production build |
| `npm run prepare-data` | Preprocesses input data |
| `npm run generate-palettes` | Generates color palettes |

## Project Structure

```
plasmid_network/
├── public/
│   └── data/           # Network data (configuration, palettes)
├── src/
│   ├── components/     # React components
│   │   ├── ui/         # Reusable UI components
│   │   ├── network-cosmograph.tsx  # Main network visualizer
│   │   └── ...
│   ├── hooks/          # Custom hooks
│   └── lib/            # Utilities
└── scripts/            # Data preparation scripts
```

## Usage

1. **Explore the network**: Use the mouse to zoom and pan the visualization
2. **Select nodes**: Click on a node to view its details and genome map
3. **Change coloring**: Use the sidebar to color by different attributes (defense systems, AMR, PTU, taxonomy, etc.)
4. **Adjust sizes**: Configure node sizes based on numerical properties
5. **View data table**: Toggle between network view and data table
6. **Identify patterns**: Explore PTU clusters to identify defense-enriched or AMR-enriched plasmid families

## Citation

If you use this tool in your research, please cite:

```
Payne LJ, Rodríguez Mestre M, Zheng H, et al. Plasmids are major vectors of anti-phage defense. [Journal]. [Year].
```

## License

MIT
