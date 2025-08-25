require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
const app = express();
// index.js (top)
const cors = require('cors');

// Allow local dev, your production Vercel domain, and Vercel previews for this project
const allowedOrigins = [
  'http://localhost:5173',
  'https://cardgamefront.vercel.app',
  // If you use a custom domain, add it here:
  // 'https://yourdomain.com',
  /^https:\/\/cardgamefront-git-.*\.vercel\.app$/, // preview deployments
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // allow server-to-server, curl, etc.
    const ok = allowedOrigins.some(o => (o instanceof RegExp ? o.test(origin) : o === origin));
    cb(ok ? null : new Error('CORS blocked'), ok);
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // keep true if you might use cookies; harmless with Bearer tokens
}));

// Ensure preflight works everywhere (extra-safe)
app.options('*', cors());

// Connect to MongoDB
const connectDB = require('./utils/db');
connectDB();

// Routes
app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
  res.send('API running...');
});

const gameRoutes = require('./routes/gameRoutes');
app.use('/api/game', gameRoutes);

const campaignRoutes = require('./routes/campaignRoutes');
app.use('/api/campaigns', campaignRoutes);

const enemyRoutes = require('./routes/enemyRoutes');
app.use('/api/enemies', enemyRoutes);

const cardRoutes = require('./routes/cardRoutes');
app.use('/api/cards', cardRoutes);

const roomRoutes = require('./routes/roomRoutes');
app.use('/api/rooms', roomRoutes);

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
