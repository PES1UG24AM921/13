const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { getProfile, updateProfile } = require('../controllers/patientController');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

router.get('/me', authenticate, authorize('patient'), getProfile);
const profileValidators = [
	body('firstName').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('lastName').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('dateOfBirth').optional({ nullable: true }).isISO8601({ strict: true })
		.bail().custom((value) => value <= new Date().toISOString().slice(0, 10))
		.withMessage('dateOfBirth cannot be in the future.'),
	body('phone').optional({ nullable: true }).isString().bail().trim().isLength({ max: 32 })
		.bail()
		.matches(/^\+?[0-9][0-9\s().-]*$/)
		.bail().custom((value) => {
			const digitCount = value.replace(/\D/g, '').length;
			return digitCount >= 7 && digitCount <= 15;
		})
		.withMessage('phone must contain 7 to 15 digits and only standard phone separators.'),
	body('address').optional({ nullable: true }).isString().bail().trim().isLength({ max: 500 }),
	validateRequest,
];
router.put('/me', authenticate, authorize('patient'), profileValidators, updateProfile);
router.get('/:patientId', authenticate, authorize('patient', 'doctor', 'admin'), getProfile);
router.put('/:patientId', authenticate, authorize('patient'), profileValidators, updateProfile);

module.exports = router;