const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const ctrl = require('../controllers/scheduleController');

router.post('/preview', verifyToken, ctrl.preview);
router.post('/generate', verifyToken, ctrl.generate);
router.get('/day', verifyToken, ctrl.day);

// Undo endpoints
router.delete('/batch/:batchId', verifyToken, ctrl.undoBatch);
router.delete('/day', verifyToken, ctrl.undoDay);

module.exports = router;