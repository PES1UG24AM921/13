const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  bookAppointment,
  getMyAppointments,
  getAppointment,
  rescheduleAppointment,
  cancelAppointment,
} = require('../controllers/appointmentController');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

router.use(authenticate);
const validStartTime = body('startsAt')
  .isString().withMessage('startsAt must be a string.')
  .bail()
  .trim()
  .custom((value) => {
    const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(00|30)(?::(00))?$/.exec(value);
    if (!match) return false;
    const date = new Date(`${match[1]}T00:00:00.000Z`);
    return Number.isFinite(date.getTime())
      && date.toISOString().slice(0, 10) === match[1]
      && Number(match[2]) <= 23;
  })
  .withMessage('startsAt must be a valid date and half-hour-aligned time.');
const validAppointmentId = param('appointmentId').isInt({ min: 1 });
const validPagination = [
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  validateRequest,
];

router.post('/', authorize('patient'), [
  body('doctorId').isInt({ min: 1 }).toInt(),
  validStartTime,
  body('reason').optional({ nullable: true }).isString().bail().trim().isLength({ max: 1000 }),
  body('patientId').optional().isInt({ min: 1 }).toInt(),
  validateRequest,
], bookAppointment);
router.get('/', authorize('patient', 'doctor', 'admin'), validPagination, getMyAppointments);
router.get('/:appointmentId', authorize('patient', 'doctor', 'admin'), validAppointmentId, validateRequest, getAppointment);
router.put('/:appointmentId/reschedule', authorize('patient'), [
  validAppointmentId,
  validStartTime,
  validateRequest,
], rescheduleAppointment);
router.patch('/:appointmentId/cancel', authorize('patient'), validAppointmentId, validateRequest, cancelAppointment);

module.exports = router;