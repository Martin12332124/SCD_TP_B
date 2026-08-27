const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { JWT_SECRET } = require('../middleware/auth');

// Token dura 12 horas (suficiente para un turno de trabajo completo)
const TOKEN_EXPIRY = '12h';

// ─────────────────────────────────────────────────────────────
// POST /api/auth/login
// Body: { username: string, password: string }
// ─────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Se requieren usuario y contraseña.' });
  }

  try {
    const usuario = db.prepare('SELECT * FROM usuarios WHERE username = ?').get(username);

    // Misma respuesta para usuario inexistente y contraseña incorrecta
    // (evita enumerar usuarios válidos)
    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.password_hash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const token = jwt.sign({ id: usuario.id, username: usuario.username }, JWT_SECRET, {
      expiresIn: TOKEN_EXPIRY
    });

    res.json({
      token,
      usuario: { id: usuario.id, username: usuario.username }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me — Validar token y obtener datos del usuario actual
// (requiere token válido en el header Authorization)
// ─────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  // req.usuario ya fue inyectado por el middleware verificarToken
  // Este endpoint está protegido en index.js con el middleware global
  res.json({ usuario: req.usuario });
});

// ─────────────────────────────────────────────────────────────
// POST /api/auth/logout — Sin estado (el cliente descarta el token)
// ─────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.json({ mensaje: 'Sesión cerrada correctamente.' });
});

module.exports = router;
