// ── Gestionnaire d'erreurs global ────────────────────────────
const errorHandler = (err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Erreur de validation Mongoose
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ message: messages.join('. ') });
  }

  // Duplicate key (index unique)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({ message: `${field} déjà utilisé.` });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ message: 'Token invalide.' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ message: 'Session expirée. Veuillez vous reconnecter.' });
  }

  // Erreur générique
  res.status(err.statusCode || 500).json({
    message: err.message || 'Erreur interne du serveur.',
  });
};

module.exports = errorHandler;
