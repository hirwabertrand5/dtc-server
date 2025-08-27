const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const { authorize } = require('../middleware/role'); // if you added RBAC
const ctrl = require('../controllers/settingsController');

router.get('/', verifyToken, /*authorize('settings:read'),*/ ctrl.getSettings);
router.put('/', verifyToken, /*authorize('settings:update'),*/ ctrl.updateSettings);

module.exports = router;