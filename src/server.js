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

// ── Route seed temporaire — À SUPPRIMER APRÈS UTILISATION ─────
app.get('/seed-init', async (req, res) => {
  const secret = req.query.secret;
  if (secret !== 'nahed2025') return res.status(403).json({ message: 'Interdit' });
  try {
    const User = require('./models/User');
    const Site = require('./models/Site');
    const Log  = require('./models/Log');
    await Site.deleteMany({});
    await User.deleteMany({});
    await Log.deleteMany({});
    await Site.create({ siteId: 'loranoeud-site01', siteName: 'Usine Nord' });
    await User.create({
      siteId:   'loranoeud-site01',
      fullName: 'Responsable Système',
      email:    'responsable@loranoeud.com',
      role:     'Responsable',
      password: 'TonMotDePasse123!',
    });
    await User.create({
      siteId:   'loranoeud-site01',
      fullName: 'Ahmed Mansour',
      email:    'technicien@loranoeud.com',
      role:     'Technicien',
      pin:      '1234',
      permissions: {
        canManageNodes:    false,
        canConfigureNodes: false,
        canLaunchOTA:      true,
        canManageTopology: false,
      },
    });
    await Log.create({ siteId: 'loranoeud-site01', tag: 'SYS', type: 'ok', msg: 'Système initialisé.' });
    res.json({ message: '✅ Seed terminé avec succès !' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
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