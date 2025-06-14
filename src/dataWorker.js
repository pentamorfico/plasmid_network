// Web Worker for handling heavy data processing tasks
// This keeps the main thread free for smooth animations

import { parquetReadObjects } from 'hyparquet';

const LOADING_STATES = [
  'Loading node data...',
  'Loading edge data...',
  'Creating network...',
  'Coloring network...'
];

// Handle messages from main thread
self.onmessage = async function(event) {
  const { type, baseUrl } = event.data;
  
  if (type === 'LOAD_DATA') {
    try {
      // Send progress updates to main thread
      const postProgress = (stage, progress, status) => {
        self.postMessage({
          type: 'PROGRESS_UPDATE',
          stage,
          progress,
          status
        });
      };

      // 1. Load node data
      postProgress(0, 0, LOADING_STATES[0]);
      
      const nodeUrl = baseUrl + 'data/scatter_small.parquet';
      const nodeResponse = await fetch(nodeUrl);
      const nodeBuffer = await nodeResponse.arrayBuffer();
      
      // Process node data in chunks to avoid blocking
      const nodeRows = await parquetReadObjects({ file: nodeBuffer });
      
      postProgress(0, 25, LOADING_STATES[0]);
      
      // Send node data to main thread
      self.postMessage({
        type: 'NODE_DATA_LOADED',
        data: nodeRows
      });

      // 2. Load edge data
      postProgress(1, 25, LOADING_STATES[1]);
      
      const edgeUrl = baseUrl + 'data/mock_edges.parquet';
      const edgeResponse = await fetch(edgeUrl);
      const edgeBuffer = await edgeResponse.arrayBuffer();
      
      // Process edge data in chunks to avoid blocking
      const edgeRows = await parquetReadObjects({ file: edgeBuffer });
      
      postProgress(1, 50, LOADING_STATES[1]);
      
      // Send edge data to main thread
      self.postMessage({
        type: 'EDGE_DATA_LOADED',
        data: edgeRows
      });

      // 3. Simulate network creation processing
      postProgress(2, 50, LOADING_STATES[2]);
      
      // Simulate some heavy computation with yielding
      await new Promise(resolve => {
        let progress = 50;
        const step = () => {
          progress += 5;
          if (progress <= 75) {
            postProgress(2, progress, LOADING_STATES[2]);
            setTimeout(step, 50); // Yield to keep animations smooth
          } else {
            postProgress(2, 75, LOADING_STATES[2]);
            resolve();
          }
        };
        step();
      });

      // 4. Simulate network coloring
      postProgress(3, 75, LOADING_STATES[3]);
      
      await new Promise(resolve => {
        let progress = 75;
        const step = () => {
          progress += 5;
          if (progress <= 100) {
            postProgress(3, progress, LOADING_STATES[3]);
            setTimeout(step, 50); // Yield to keep animations smooth
          } else {
            resolve();
          }
        };
        step();
      });

      // Signal completion
      self.postMessage({
        type: 'LOADING_COMPLETE'
      });
      
    } catch (error) {
      self.postMessage({
        type: 'LOADING_ERROR',
        error: error.message
      });
    }
  }
};

// Handle worker errors
self.onerror = function(error) {
  self.postMessage({
    type: 'LOADING_ERROR',
    error: error.message
  });
};
