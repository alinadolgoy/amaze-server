import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import * as dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import liftRoutes from './routes/lift.js';

// Load Environment Variables
dotenv.config();

const PORT = parseInt(process.env.PORT || '5050', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'default-super-secret-key-at-least-32-chars-long';

// Initialize Fastify Server
const server = Fastify({
  logger: true
});

// Register Recommended Security & Utilities Stack
await server.register(helmet, {
  global: true,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false
});

await server.register(cookie, {
  secret: COOKIE_SECRET,
  parseOptions: {}
});

await server.register(cors, {
  origin: [FRONTEND_URL],
  credentials: true, // Crucial: Allows browser to send cookies across ports on localhost
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// ==========================================
// 🔌 REGISTER MODULAR PLUGINS / ROUTES
// ==========================================
await server.register(authRoutes, { prefix: '/api/auth' });
await server.register(liftRoutes, { prefix: '/api/lift' });

// ==========================================
// 🚀 START SERVER
// ==========================================
const start = async () => {
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
