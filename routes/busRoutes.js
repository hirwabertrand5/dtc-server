const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { verifyToken } = require('../middleware/auth');

const {
  getAllBuses,
  createBus,
  updateBus,
  archiveBus,
  getArchivedBuses,
  restoreBus,
  deleteArchivedBus,
  clearArchivedBuses,
  exportBuses,
  getAvailableBuses,
  getCounts
} = require('../controllers/busController');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." }
});

const createValidation = [
  body('busNumber').trim().notEmpty().withMessage('Bus number is required.'),
  body('capacity').notEmpty().withMessage('Capacity is required.').isInt({ min: 1 }).withMessage('Capacity must be a positive integer.'),
  body('type').notEmpty().withMessage('Type is required.').isIn(['Standard', 'Mini', 'AC', 'EV', 'Articulated']).withMessage('Invalid type.'),
  body('status').notEmpty().withMessage('Status is required.').isIn(['Active', 'Idle', 'Maintenance', 'Out of Service']).withMessage('Invalid status.'),
  body('assignedCrew').optional().isString(),
  body('assignedRoute').optional().isString()
];

const updateValidation = [
  body('capacity').optional().isInt({ min: 1 }).withMessage('Capacity must be a positive integer.'),
  body('type').optional().isIn(['Standard', 'Mini', 'AC', 'EV', 'Articulated']).withMessage('Invalid type.'),
  body('status').optional().isIn(['Active', 'Idle', 'Maintenance', 'Out of Service']).withMessage('Invalid status.'),
  body('assignedCrew').optional().isString(),
  body('assignedRoute').optional().isString()
];

// Specific routes first
router.get('/', verifyToken, limiter, getAllBuses);
router.get('/count', verifyToken, getCounts);
router.get('/available', verifyToken, getAvailableBuses);
router.get('/archived', verifyToken, getArchivedBuses);
router.put('/restore/:id', verifyToken, restoreBus);
router.delete('/archived/:id', verifyToken, deleteArchivedBus);
router.delete('/archived/clear', verifyToken, clearArchivedBuses);
router.get('/export', verifyToken, exportBuses);

router.post('/', verifyToken, createValidation, createBus);
router.put('/:id', verifyToken, updateValidation, updateBus);
router.delete('/:id', verifyToken, archiveBus);

module.exports = router;