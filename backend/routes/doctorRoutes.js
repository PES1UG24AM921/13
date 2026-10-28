const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  createAvailability,
  deleteAvailability,
  getDoctorProfile,
  searchDoctors,
  getFreeSlots,
  updateAvailability,
} = require('../controllers/doctorController');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

const availabilityValidators = [
  body('dayOfWeek').isInt({ min: 1, max: 7 }).toInt(),
  body('startTime').isString().bail().trim().matches(/^(?:[01]\d|2[0-3]):(?:00|30)(?::00)?$/),
  body('effectiveFrom').optional().isString().bail().trim().isISO8601({ strict: true }),
  body('effectiveTo').optional({ nullable: true }).isString().bail().trim().isISO8601({ strict: true }),
  validateRequest,
];

router.get('/', authenticate, authorize('patient', 'doctor', 'admin'), searchDoctors);
router.get('/:doctorId/slots', authenticate, authorize('patient', 'doctor', 'admin'), getFreeSlots);
router.get('/:doctorId', authenticate, authorize('patient', 'doctor', 'admin'), getDoctorProfile);
router.post('/availability', authenticate, authorize('doctor'), availabilityValidators, createAvailability);
router.put('/availability/:availabilityId', authenticate, authorize('doctor'), availabilityValidators, updateAvailability);
router.delete('/availability/:availabilityId', authenticate, authorize('doctor'), deleteAvailability);

module.exports = router;