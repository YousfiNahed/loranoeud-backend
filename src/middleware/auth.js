const jwt  = require('jsonwebtoken');
const User = require('../models/User');

// ── Générer un token JWT ──────────────────────────────────────
const signToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// ── Vérifier le token JWT ─────────────────────────────────────
const protect = async (req, res, next) => {
  let token;

  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    token = auth.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Accès non autorisé. Token manquant.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id).select('-password -pin');

    if (!user || !user.active) {
      return res.status(401).json({ message: 'Utilisateur introuvable ou désactivé.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalide ou expiré.' });
  }
};

// ── Accès réservé au Responsable ──────────────────────────────
const responsableOnly = (req, res, next) => {
  if (req.user?.role !== 'Responsable') {
    return res.status(403).json({ message: 'Accès réservé au Responsable.' });
  }
  next();
};

// ── Vérifier une permission spécifique (Technicien) ───────────
const requirePermission = (perm) => (req, res, next) => {
  if (req.user?.role === 'Responsable') return next(); // Responsable a tout
  if (!req.user?.permissions?.[perm]) {
    return res.status(403).json({ message: `Permission refusée : ${perm}` });
  }
  next();
};

module.exports = { protect, responsableOnly, requirePermission, signToken };
