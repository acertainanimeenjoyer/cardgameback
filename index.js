// index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./utils/db');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');

const app = express();

// Body parsers
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// CORS: allow local dev, your Vercel app, and Vercel previews
const allowedOrigins = [
  'http://localhost:5173',
  'https://cardgamefront.vercel.app',
  /^https:\/\/cardgamefront-git-.*\.vercel\.app$/, // preview deployments
  // 'https://your-custom-domain.com', // add if you have one
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // server-to-server, curl, health checks
    const ok = allowedOrigins.some(o => (o instanceof RegExp ? o.test(origin) : o === origin));
    cb(ok ? null : new Error('CORS blocked'), ok);
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true,
}));
app.options('*', cors());

// DB connect
connectDB();

// Health checks
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/api/health', (_, res) => res.json({ ok: true }));

// Helper to mount routers and catch bad route paths early
function mount(path, file) {
  try {
    console.log(`Mounting ${path} from ${file}`);
    const router = require(file);
    app.use(path, router);
    console.log(`Mounted OK: ${path}`);
  } catch (e) {
    console.error(`💥 Router crashed while mounting ${path} from ${file}`);
    console.error(e && e.stack ? e.stack : e);
    // Crash fast so Render logs show the exact offender
    process.exit(1);
  }
}

// Routes (enable one-by-one if needed)
mount('/api/auth', './routes/authRoutes');
mount('/api/game', './routes/gameRoutes');
mount('/api/campaigns', './routes/campaignRoutes');
mount('/api/enemies', './routes/enemyRoutes');
mount('/api/cards', './routes/cardRoutes');
mount('/api/rooms', './routes/roomRoutes');

// Swagger
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Extra safety: surface any uncaught errors with full stack
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  process.exit(1);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
