const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const ctrl = require('../controllers/assignmentController');
const { body } = require('express-validator');

const baseValidation = [
  body('crewId').notEmpty().withMessage('crewId required'),
  body('busId').notEmpty().withMessage('busId required'),
  body('routeId').notEmpty().withMessage('routeId required'),
  body('role').isIn(['Driver','Conductor']).withMessage('role must be Driver or Conductor'),
  body('startTime').notEmpty().withMessage('startTime required'),
  body('endTime').notEmpty().withMessage('endTime required'),
  body('dutyId').optional()
];

router.post('/conflicts', verifyToken, ctrl.checkConflicts);
router.post('/', verifyToken, baseValidation, ctrl.createAssignment);
router.get('/day', verifyToken, ctrl.listByDay);
router.get('/range', verifyToken, ctrl.listRange);
router.delete('/:id', verifyToken, ctrl.cancelAssignment);
router.post('/auto/linked', verifyToken, ctrl.autoAssignLinked);

module.exports = router;