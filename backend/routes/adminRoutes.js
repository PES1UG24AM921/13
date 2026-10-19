const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { auditAdminAction } = require('../middleware/auditMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');
const adminController = require('../controllers/adminController');

const router = express.Router();

router.use(authenticate, auditAdminAction, authorize('admin'));

const pagination = [
	query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
	query('offset').optional().isInt({ min: 0 }).toInt(),
	validateRequest,
];

router.get('/users', pagination, adminController.listUsers);
router.post('/users', [
	body('role').isString().bail().trim().toLowerCase().isIn(['doctor', 'patient']),
	body('email').isEmail().normalizeEmail(),
	body('password').isString().bail().isLength({ min: 8 })
		.bail().custom((password) => Buffer.byteLength(password, 'utf8') <= 72),
	body('firstName').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('lastName').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('licenseNumber').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('specialty').optional().isString().bail().trim().isLength({ min: 1, max: 150 }),
	body('dateOfBirth').optional({ nullable: true }).isString().bail().trim().isISO8601({ strict: true }),
	body('phone').optional({ nullable: true }).isString().bail().trim().isLength({ max: 32 }),
	validateRequest,
], adminController.createUser);
router.patch('/users/:id/status', [
	param('id').isInt({ min: 1 }),
	body('is_active').optional().isBoolean().toBoolean(),
	body('isActive').optional().isBoolean().toBoolean(),
	body().custom((value) => Boolean(value)
		&& (typeof value.is_active === 'boolean' || typeof value.isActive === 'boolean')),
	validateRequest,
], adminController.updateUserStatus);

router.get('/appointments', pagination, adminController.listAppointments);
router.get('/appointments/:appointmentId', param('appointmentId').isInt({ min: 1 }), validateRequest, adminController.getAppointment);
router.patch('/appointments/:appointmentId/cancel', adminController.cancelAppointment);

router.get('/overview', adminController.getOverview);
router.get('/audit-logs', query('limit').optional().isInt({ min: 1, max: 100 }).toInt(), validateRequest, adminController.listAuditLogs);

module.exports = router;