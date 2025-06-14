// Web Worker for handling iframe-related tasks

self.onmessage = async function(event) {
  const { type, id } = event.data;

  if (type === 'LOAD_IFRAME') {
    try {
      // Build JSON URL based on gene id
      const idForUrl = id.startsWith('IMGPR') ? id.split('|')[0] : id;
      const jsonUrl = `https://raw.githubusercontent.com/pentamorfico/plsdb_imgpr_json/refs/heads/master/${idForUrl}.json`;

      // Generate HTML content for CGV viewer
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>CGV Viewer</title>
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

      // Send the generated HTML content back to the main thread
      self.postMessage({ type: 'IFRAME_LOADED', htmlContent });
    } catch (error) {
      self.postMessage({ type: 'IFRAME_ERROR', error: error.message });
    }
  }
};
