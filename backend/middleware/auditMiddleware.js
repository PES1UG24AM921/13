const db = require('../db');
const { writeAudit } = require('../services/auditLogger');

function logAudit(entry) {
  writeAudit(db, entry).catch((error) => {
    console.error('Audit logging failed:', error.message);
  });
}

function auditLogin(req, res, next) {
  let responseUser = null;
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    responseUser = body?.user || null;
    return sendJson(body);
  };

  res.once('finish', () => {
    const success = res.statusCode >= 200 && res.statusCode < 300 && responseUser;
    logAudit({
      req,
      actorId: success ? responseUser.id : null,
      actorRole: success ? responseUser.role : null,
      actorEmail: success ? responseUser.email : req.body?.email,
      action: success ? 'login_success' : 'login_failure',
      targetType: 'user',
      targetId: success ? responseUser.id : null,
      metadata: { statusCode: res.statusCode },
    });
  });
  return next();
}

function auditAdminAction(req, res, next) {
  res.once('finish', () => {
    const route = req.route?.path || req.path;
    logAudit({
      req,
      actorId: req.user?.id || null,
      actorRole: req.user?.role || null,
      action: `admin_${req.method.toLowerCase()}_${String(route).replace(/[^a-zA-Z0-9]+/g, '_')}`.slice(0, 100),
      targetType: req.path.startsWith('/appointments') ? 'appointment' : 'user',
      targetId: req.params.id || req.params.appointmentId || null,
      metadata: { statusCode: res.statusCode },
    });
  });
  return next();
}

module.exports = { auditLogin, auditAdminAction };