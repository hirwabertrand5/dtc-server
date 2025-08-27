const router = require('express').Router();
const { verifyToken } = require('../middleware/auth');
const ctrl = require('../controllers/reports');

// If you wired RBAC, you can add: const { authorize } = require('../middleware/role');

router.get('/summary', verifyToken, /* authorize('reports:read'), */ ctrl.summary);

module.exports = router;