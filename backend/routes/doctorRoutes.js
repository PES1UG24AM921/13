const express = require('express');
const { body } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  createAvailability,
  deleteAvailability,
  searchDoctors,
  getFreeSlots,
} = require('../controllers/doctorController');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

router.get('/', searchDoctors);
router.get('/:doctorId/slots', getFreeSlots);
router.post('/availability', authenticate, authorize('doctor'), [
  body('dayOfWeek').isInt({ min: 1, max: 7 }).toInt(),
  body('startTime').isString().bail().trim().matches(/^(?:[01]\d|2[0-3]):(?:00|30)(?::00)?$/),
  body('effectiveFrom').optional().isString().bail().trim().isISO8601({ strict: true }),
  body('effectiveTo').optional({ nullable: true }).isString().bail().trim().isISO8601({ strict: true }),
  validateRequest,
], createAvailability);
router.delete('/availability/:availabilityId', authenticate, authorize('doctor'), deleteAvailability);

module.exports = router;