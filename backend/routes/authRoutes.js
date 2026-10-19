const express = require('express');
const { body } = require('express-validator');
const { register, login } = require('../controllers/authController');
const { auditLogin } = require('../middleware/auditMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

const validEmail = body('email')
	.isString().withMessage('Email must be a string.')
	.bail()
	.trim()
	.isEmail().withMessage('Email must be valid.')
	.normalizeEmail();

router.post('/register', [
	validEmail,
	body('password')
		.isString().withMessage('Password must be a string.')
		.bail()
		.isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
		.bail()
		.custom((password) => Buffer.byteLength(password, 'utf8') <= 72)
		.withMessage('Password must be at most 72 UTF-8 bytes.'),
	body('firstName').isString().withMessage('First name must be a string.').bail().trim().isLength({ min: 1, max: 100 }),
	body('lastName').isString().withMessage('Last name must be a string.').bail().trim().isLength({ min: 1, max: 100 }),
	validateRequest,
], register);

router.post('/login', auditLogin, [
	validEmail,
	body('password')
		.isString().withMessage('Password must be a string.')
		.bail()
		.isLength({ min: 1 })
		.bail()
		.custom((password) => Buffer.byteLength(password, 'utf8') <= 72)
		.withMessage('Password must be at most 72 UTF-8 bytes.'),
	validateRequest,
], login);

module.exports = router;