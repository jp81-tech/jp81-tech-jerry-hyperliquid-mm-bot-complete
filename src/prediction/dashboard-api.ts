/**
 * Dashboard API for Price Prediction
 * Simple HTTP endpoint for War Room dashboard integration
 */

import http from 'http';
import { getPredictionService } from './index.js';

const PORT = process.env.PREDICTION_PORT || 8090;

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    const service = getPredictionService();

    // GET /predict/:token
    if (path.startsWith('/predict/')) {
      const token = path.split('/')[2]?.toUpperCase();
      if (!token) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Token required' }));
        return;
      }

      const result = await service.getPrediction(token);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
      return;
    }

    // GET /predict-all
    if (path === '/predict-all') {
      const tokens = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'XRP', 'LIT', 'FARTCOIN'];
      const results: Record<string, any> = {};

      for (const token of tokens) {
        try {
          results[token] = await service.getPrediction(token);
        } catch (error) {
          results[token] = { error: String(error) };
        }
      }

      res.statusCode = 200;
      res.end(JSON.stringify(results));
      return;
    }

    // GET /verify/:token
    if (path.startsWith('/verify/')) {
      const token = path.split('/')[2]?.toUpperCase();
      if (!token) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Token required' }));
        return;
      }

      const accuracy = await service.verifyPredictions(token);
      res.statusCode = 200;
      res.end(JSON.stringify({ token, accuracy }));
      return;
    }

    // GET /weights
    if (path === '/weights') {
      const weights = service.getWeights();
      res.statusCode = 200;
      res.end(JSON.stringify(weights));
      return;
    }

    // GET /features
    if (path === '/features') {
      const features = service.getFeatureImportance();
      res.statusCode = 200;
      res.end(JSON.stringify(features));
      return;
    }

    // GET /predict-xgb/:token — XGBoost-only prediction (all horizons)
    if (path.startsWith('/predict-xgb/')) {
      const token = path.split('/')[2]?.toUpperCase();
      if (!token) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Token required' }));
        return;
      }

      const xgbResult = await service.getXGBPrediction(token);
      res.statusCode = 200;
      res.end(JSON.stringify(xgbResult));
      return;
    }

    // GET /xgb-status — Model ages, sample counts, accuracy
    if (path === '/xgb-status') {
      const status = service.getXGBStatus();
      res.statusCode = 200;
      res.end(JSON.stringify(status));
      return;
    }

    // GET /xgb-features/:token — Feature importance from XGBoost
    if (path.startsWith('/xgb-features/')) {
      const token = path.split('/')[2]?.toUpperCase();
      if (!token) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Token required' }));
        return;
      }

      const importance = service.getXGBFeatureImportance(token);
      res.statusCode = 200;
      res.end(JSON.stringify(importance));
      return;
    }

    // GET /health
    if (path === '/health') {
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // 404 for unknown routes
    res.statusCode = 404;
    res.end(JSON.stringify({
      error: 'Not found',
      available: [
        '/predict/:token',
        '/predict-all',
        '/predict-xgb/:token',
        '/verify/:token',
        '/weights',
        '/features',
        '/xgb-status',
        '/xgb-features/:token',
        '/health',
      ],
    }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  }
}

export function startPredictionServer(): void {
  const server = http.createServer(handleRequest);

  server.listen(PORT, () => {
    console.log(`🔮 Prediction API running on http://localhost:${PORT}`);
    console.log('  Endpoints:');
    console.log('    GET /predict/:token      - Get prediction for a token');
    console.log('    GET /predict-all         - Get predictions for all tokens');
    console.log('    GET /predict-xgb/:token  - XGBoost-only prediction');
    console.log('    GET /verify/:token       - Verify past predictions');
    console.log('    GET /weights             - Get model weights');
    console.log('    GET /features            - Get feature importance');
    console.log('    GET /xgb-status          - XGBoost model status');
    console.log('    GET /xgb-features/:token - XGBoost feature importance');
    console.log('    GET /health              - Health check');
  });
}

// Run if called directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startPredictionServer();
}
