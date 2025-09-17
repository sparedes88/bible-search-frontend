const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Existing proxy for /api
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'https://iglesiatech.app',
      changeOrigin: true,
    })
  );
  
  // New proxy for Firebase Functions
  app.use(
    '/firebase-api',
    createProxyMiddleware({
      target: 'https://us-central1-igletechv1.cloudfunctions.net',
      changeOrigin: true,
      pathRewrite: {
        '^/firebase-api': '/' // Remove /firebase-api prefix when forwarding the request
      },
      onProxyRes: function(proxyRes, req, res) {
        // Add CORS headers to the proxied response
        proxyRes.headers['Access-Control-Allow-Origin'] = '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
      }
    })
  );
};
