process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.JWT_EXPIRES_IN = '1h';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function tokenFor(role, id = '1', options = {}) {
  return jwt.sign({ userId: String(id), role }, SECRET, { expiresIn: '1h', ...options });
}

function bearer(role, id) {
  return `Bearer ${tokenFor(role, id)}`;
}

// Rule that makes authenticate() accept a user (id, role) as active.
function authRule(role, id = '1') {
  return ['SELECT role, is_active AS isActive FROM users', [{ role, isActive: 1 }], id];
}

// Auth rule, returned in the same [fragment, result] shape used by mockDb.setup
function asUser(role) {
  return ['SELECT role, is_active AS isActive FROM users', [{ role, isActive: 1 }]];
}

// Audit logging writes to the DB after login/admin calls; swallow it quietly.
const auditRule = ['INSERT INTO audit_logs', { affectedRows: 1 }];

module.exports = { tokenFor, bearer, authRule, asUser, auditRule, SECRET };
