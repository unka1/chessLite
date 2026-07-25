const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '10d';

function signToken(user) {
  return jwt.sign({ id: user._id.toString(), username: user.username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function verifyToken(token) {
  // Throws if token is missing, expired, or invalid 
  return jwt.verify(token, JWT_SECRET);
}


function requireAuth(req, res, next) {
  try {
    const payload = verifyToken(req.cookies.token);
    req.userId = payload.id;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 10 * 24 * 60 * 60 * 1000, // 10 days
};

module.exports = { signToken, verifyToken, requireAuth, COOKIE_OPTS };
