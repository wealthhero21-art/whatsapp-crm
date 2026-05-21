// Run with: npm run worker
// Spawns BullMQ workers in a separate process for horizontal scaling.
import { startWorkers } from './queue.js';

startWorkers();
console.log('Worker process up. Ctrl-C to stop.');
