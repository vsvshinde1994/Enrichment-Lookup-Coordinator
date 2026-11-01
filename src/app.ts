import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { lookupRouter } from './routes/lookupRoutes.js';
import { quotaRouter } from './routes/quotaRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

app.use(express.json());

// Enable basic CORS for frontend development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Idempotency-Key, x-idempotency-key, x-analyst-id');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Route mountings
app.use('/api/enrichments', lookupRouter);
app.use('/api/quota', quotaRouter);

// Serve static frontend build if present
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
const altFrontendDist = path.resolve(__dirname, '../frontend/dist');
const staticPath = fs.existsSync(frontendDist)
  ? frontendDist
  : fs.existsSync(altFrontendDist)
  ? altFrontendDist
  : null;

if (staticPath) {
  app.use(express.static(staticPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(staticPath, 'index.html'));
  });
}

// Centralized error handling
app.use(errorHandler);


