const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const { getProfile, updateProfile } = require('../controllers/patientController');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

router.use(authenticate, authorize('patient'));
router.get('/me', getProfile);
const profileValidators = [
	body('firstName').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('lastName').optional().isString().bail().trim().isLength({ min: 1, max: 100 }),
	body('dateOfBirth').optional({ nullable: true }).isISO8601({ strict: true }),
	body('phone').optional({ nullable: true }).isString().bail().trim().isLength({ max: 32 }),
	body('address').optional({ nullable: true }).isString().bail().trim().isLength({ max: 500 }),
	validateRequest,
];
router.put('/me', profileValidators, updateProfile);
router.get('/:patientId', getProfile);
router.put('/:patientId', profileValidators, updateProfile);

module.exports = router;