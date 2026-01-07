let canvas, ctx;
let angle = 0;

const rotationSpeed = 4; // Degrees per frame
const frameInterval = 16; // ~60fps for very smooth animation

const CX = 125, CY = 125;

function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function createGenePath(opts) {
  const { startAngle, lengthAngle, tipLengthAngle, R_in, R_out, flare } = opts;
  const R_mid = (R_in + R_out) / 2;
  const shoulderAngle = startAngle + lengthAngle;
  const tipAngle = shoulderAngle + tipLengthAngle;

  const p1 = polarToCartesian(CX, CY, R_in, startAngle);
  const p2 = polarToCartesian(CX, CY, R_out, startAngle);
  const p3 = polarToCartesian(CX, CY, R_out, shoulderAngle);
  const p4 = polarToCartesian(CX, CY, R_out + flare, shoulderAngle);
  const p5 = polarToCartesian(CX, CY, R_mid, tipAngle);
  const p6 = polarToCartesian(CX, CY, R_in - flare, shoulderAngle);
  const p7 = polarToCartesian(CX, CY, R_in, shoulderAngle);

  const largeArcFlag = lengthAngle > 180 ? '1' : '0';

  return [
    `M ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${R_out} ${R_out} 0 ${largeArcFlag} 1 ${p3.x} ${p3.y}`,
    `L ${p4.x} ${p4.y}`,
    `L ${p5.x} ${p5.y}`,
    `L ${p6.x} ${p6.y}`,
    `L ${p7.x} ${p7.y}`,
    `A ${R_in} ${R_in} 0 ${largeArcFlag} 0 ${p1.x} ${p1.y}`,
    'Z',
  ].join(' ');
}

// Same parameters as the spinner in App.tsx
const GENES = [
  { startAngle: 10, lengthAngle: 90, tipLengthAngle: 12, R_in: 100, R_out: 118, flare: 7, fill: '#F2748E' },
  { startAngle: 120, lengthAngle: 60, tipLengthAngle: 12, R_in: 100, R_out: 118, flare: 7, fill: '#BADB9A' },
  { startAngle: 200, lengthAngle: 80, tipLengthAngle: 12, R_in: 100, R_out: 118, flare: 7, fill: '#98D3C4' },
  { startAngle: 300, lengthAngle: 40, tipLengthAngle: 12, R_in: 100, R_out: 118, flare: 7, fill: '#D9DAD9' },
];

self.onmessage = async function (e) {
  if (e.data.type === 'init') {
    canvas = new OffscreenCanvas(32, 32);
    ctx = canvas.getContext('2d');
    startAnimation();
  }
};

function drawPlasmid() {
  const size = canvas.width;
  const scale = size / 250; // viewBox is 250x250 like spinner
  const centerX = size / 2;
  const centerY = size / 2;
  
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-centerX, -centerY);
  ctx.scale(scale, scale);
  
  // Draw circle (r=108 like spinner)
  ctx.beginPath();
  ctx.arc(125, 125, 108, 0, Math.PI * 2);
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 7;
  ctx.stroke();
  
  // Draw gene paths
  for (const gene of GENES) {
    const d = createGenePath(gene);
    const p = new Path2D(d);
    ctx.fillStyle = gene.fill;
    ctx.fill(p);
  }
  
  ctx.restore();
  updateFavicon();
}

function updateFavicon() {
  canvas.convertToBlob({ type: 'image/png' }).then(blob => {
    const reader = new FileReader();
    reader.onloadend = () => {
      self.postMessage({ type: 'updateFavicon', dataUrl: reader.result });
    };
    reader.readAsDataURL(blob);
  });
}

function startAnimation() {
  drawPlasmid(); // Draw first frame immediately
  setInterval(() => {
    angle = (angle + rotationSpeed) % 360;
    drawPlasmid();
  }, frameInterval);
}
