require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

const allowedOrigins = [
  'http://localhost:5173',
  'https://cardgamefront.vercel.app',
  /^https:\/\/cardgamefront-git-.*\.vercel\.app$/,
  // 'https://yourdomain.com',
];
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some(o => (o instanceof RegExp ? o.test(origin) : o === origin));
    cb(ok ? null : new Error('CORS blocked'), ok);
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());

// DB
const connectDB = require('./utils/db');
connectDB();

// Health
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/api/health', (_, res) => res.json({ ok: true }));

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/game', require('./routes/gameRoutes'));
app.use('/api/campaigns', require('./routes/campaignRoutes'));
app.use('/api/enemies', require('./routes/enemyRoutes'));
app.use('/api/cards', require('./routes/cardRoutes'));
app.use('/api/rooms', require('./routes/roomRoutes'));

// Swagger
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
