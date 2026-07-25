const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const User = require('../models/User');
const { signToken, requireAuth, COOKIE_OPTS } = require('../middleware/auth');

const router = express.Router();

const upload = multer({

  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {

      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

function publicUser(user) {
  return { username: user.username, photo: user.photo };
}

router.post('/register', (req, res) => {
  upload.single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }
      const trimmed = username.trim();
      if (trimmed.length < 3 || trimmed.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }

      const existing = await User.findOne({ username: trimmed });
      if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const photo = req.file
        ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
        : null;

      const user = await User.create({ username: trimmed, passwordHash, photo });

      res.cookie('token', signToken(user), COOKIE_OPTS);
      res.json(publicUser(user));
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      console.error('Register error:', err);
      res.status(500).json({ error: 'Registration failed' });
    }
  });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username: username.trim() });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid username or password' });

    res.cookie('token', signToken(user), COOKIE_OPTS);
    res.json(publicUser(user));
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', COOKIE_OPTS);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(publicUser(user));
});

module.exports = router;
