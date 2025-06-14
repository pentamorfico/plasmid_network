(function(){"use strict";self.onmessage=async function(e){const{type:i,id:s}=e.data;if(i==="LOAD_IFRAME")try{const r=`<!DOCTYPE html>
<html>
<head>
  <title>CGV Viewer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Roboto&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/gh/pentamorfico/plsdb_imgpr_json@refs/heads/master/svgcanvas.iife.js"><\/script>
  <script src="https://d3js.org/d3.v7.min.js"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/cgview/dist/cgview.min.js"><\/script>
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
    fetch('${`https://raw.githubusercontent.com/pentamorfico/plsdb_imgpr_json/refs/heads/master/${s.startsWith("IMGPR")?s.split("|")[0]:s}.json`}').then(r => r.json()).then(json => { cgv.io.loadJSON(json); cgv.draw(); });
  <\/script>
</body>
</html>`;self.postMessage({type:"IFRAME_LOADED",htmlContent:r})}catch(t){self.postMessage({type:"IFRAME_ERROR",error:t.message})}}})();
