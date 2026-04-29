require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const connectDB    = require('./config/db');
const errorHandler = require('./middleware/errorHandler');

// ── Routes ────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth.routes');
const userRoutes      = require('./routes/user.routes');
const nodeRoutes      = require('./routes/node.routes');
const logRoutes       = require('./routes/log.routes');
const otaRoutes       = require('./routes/ota.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const routerRoutes    = require('./routes/router.routes');
const settingsRoutes  = require('./routes/settings.routes');

// ── Init ──────────────────────────────────────────────────────
const app = express();
connectDB();

// ── Middlewares globaux ───────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:      process.env.CORS_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});


// ── API Routes ────────────────────────────────────────────────
app.use('/api',           authRoutes);
app.use('/api/users',     userRoutes);
app.use('/api/nodes',     nodeRoutes);
app.use('/api/logs',      logRoutes);
app.use('/api/ota',       otaRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/routers',   routerRoutes);
app.use('/api/settings',  settingsRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ message: `Route introuvable : ${req.originalUrl}` });
});

// ── Gestionnaire d'erreurs global ─────────────────────────────
app.use(errorHandler);

// ── Démarrage ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SERVER] LoraNœud backend démarré sur le port ${PORT}`);
  console.log(`[SERVER] Environnement : ${process.env.NODE_ENV || 'development'}`);
});