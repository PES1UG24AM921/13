const jwt = require('jsonwebtoken');
const pool = require('../db');
const { getJwtSecret, USER_ROLES } = require('../config/env');

async function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = jwt.verify(match[1], getJwtSecret());
    if (
      typeof payload !== 'object'
      || typeof payload.userId !== 'string'
      || !USER_ROLES.includes(payload.role)
    ) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    const [users] = await pool.execute(
      'SELECT role, is_active AS isActive FROM users WHERE id = ?',
      [payload.userId],
    );
    const user = users[0];
    if (!user || !user.isActive || user.role !== payload.role) {
      return res.status(401).json({ error: 'Account is inactive or token is no longer valid.' });
    }

    req.user = { id: payload.userId, role: user.role };
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    return next(error);
  }
}

function authorize(...allowedRoles) {
  const normalizedRoles = allowedRoles;
  if (normalizedRoles.some((role) => !USER_ROLES.includes(role))) {
    throw new Error('authorize received an unknown user role.');
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!normalizedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return next();
  };
}

module.exports = { authenticate, authorize };