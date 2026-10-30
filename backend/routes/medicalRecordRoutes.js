const express = require('express');
const { body, param, query } = require('express-validator');
const { authenticate, authorize } = require('../middleware/authMiddleware');
const {
  createMedicalRecord,
  getMedicalRecord,
  updateMedicalRecord,
  getMedicalRecords,
} = require('../controllers/medicalRecordController');
const { validateRequest } = require('../middleware/validationMiddleware');

const router = express.Router();

router.get('/', authenticate, authorize('patient', 'doctor'), [
  query('patientId').optional().isInt({ min: 1 }),
  validateRequest,
], getMedicalRecords);
router.get('/:recordId', authenticate, authorize('patient', 'doctor'), [
  param('recordId').isInt({ min: 1 }),
  validateRequest,
], getMedicalRecord);
router.post('/', authenticate, authorize('doctor'), [
  body('appointmentId').isInt({ min: 1 }).toInt(),
  body('diagnosis').isString().bail().trim().isLength({ min: 1, max: 65000 }),
  body('treatment').optional({ nullable: true }).isString().bail().trim().isLength({ max: 65000 }),
  body('notes').optional({ nullable: true }).isString().bail().trim().isLength({ max: 65000 }),
  validateRequest,
], createMedicalRecord);
router.put('/:recordId', authenticate, authorize('doctor'), [
  param('recordId').isInt({ min: 1 }),
  body('diagnosis').isString().bail().trim().isLength({ min: 1, max: 65000 }),
  body('treatment').optional({ nullable: true }).isString().bail().trim().isLength({ max: 65000 }),
  body('notes').optional({ nullable: true }).isString().bail().trim().isLength({ max: 65000 }),
  validateRequest,
], updateMedicalRecord);
router.delete('/:recordId', authenticate, authorize('doctor'), (req, res) => (
  res.status(405).json({ error: 'Medical records cannot be deleted.' })
));

module.exports = router;