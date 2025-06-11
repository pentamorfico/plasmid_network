// Example mock data for a network
export const nodes = [
  { id: 'n1', label: 'Alice', x: 0, y: 0, size: 12, color: '#e41a1c', group: 'admin', email: 'alice@example.com', age: 34 },
  { id: 'n2', label: 'Bob', x: 1, y: 1, size: 10, color: '#377eb8', group: 'user', email: 'bob@example.com', age: 28 },
  { id: 'n3', label: 'Carol', x: 2, y: 0, size: 8, color: '#4daf4a', group: 'user', email: 'carol@example.com', age: 25 },
  { id: 'n4', label: 'Dave', x: 1, y: -1, size: 9, color: '#984ea3', group: 'moderator', email: 'dave@example.com', age: 41 },
  { id: 'n5', label: 'Eve', x: 3, y: 1, size: 11, color: '#ff7f00', group: 'admin', email: 'eve@example.com', age: 37 },
];

export const edges = [
  { id: 'e1', source: 'n1', target: 'n2', color: '#999' },
  { id: 'e2', source: 'n2', target: 'n3', color: '#999' },
  { id: 'e3', source: 'n3', target: 'n4', color: '#999' },
  { id: 'e4', source: 'n4', target: 'n1', color: '#999' },
  { id: 'e5', source: 'n2', target: 'n5', color: '#999' },
];
