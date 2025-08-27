const express = require('express');
const router = express.Router();
const {
  getRoutes,
  createRoute,
  updateRoute,
  archiveRoute,
  getArchivedRoutes,
  restoreRoute,
  exportRoutes,
  getCounts
} = require('../controllers/routeController');

const { verifyToken } = require('../middleware/auth');
const { body } = require('express-validator');

const createValidation = [
  body('routeName').trim().notEmpty().withMessage('Route name is required.'),
  body('estimatedTime').trim().notEmpty().withMessage('Estimated time is required.'),
  body('distance').notEmpty().withMessage('Distance is required.').isFloat({ min: 0.1 }),
  body('stops').isArray({ min: 2 }).withMessage('At least two stops are required.'),
  body('geoJson').notEmpty().withMessage('Route path (geoJson) is required.'),
  body('busTypeRequired').optional().isIn(['Standard','Mini','AC','EV','Articulated']).withMessage('Invalid busTypeRequired.'),
  body('reliefPoints').optional().isArray().withMessage('reliefPoints should be an array'),
  body('priority').optional().isInt({ min: 1 }).withMessage('priority must be a positive integer'),
  body('runDays').optional().isArray().withMessage('runDays must be an array of 0..6')
];

const updateValidation = [
  body('routeName').trim().notEmpty().withMessage('Route name is required.'),
  body('estimatedTime').trim().notEmpty().withMessage('Estimated time is required.'),
  body('distance').notEmpty().withMessage('Distance is required.').isFloat({ min: 0.1 }),
  body('stops').isArray({ min: 2 }).withMessage('At least two stops are required.'),
  body('geoJson').notEmpty().withMessage('Route path (geoJson) is required.'),
  body('busTypeRequired').optional().isIn(['Standard','Mini','AC','EV','Articulated']).withMessage('Invalid busTypeRequired.'),
  body('reliefPoints').optional().isArray().withMessage('reliefPoints should be an array'),
  body('priority').optional().isInt({ min: 1 }).withMessage('priority must be a positive integer'),
  body('runDays').optional().isArray().withMessage('runDays must be an array of 0..6')
];

// Specific routes first
router.get('/', verifyToken, getRoutes);
router.get('/count', verifyToken, getCounts);
router.get('/archived', verifyToken, getArchivedRoutes);
router.post('/', verifyToken, createValidation, createRoute);
router.put('/:id', verifyToken, updateValidation, updateRoute);
router.delete('/:id', verifyToken, archiveRoute);
router.put('/restore/:id', verifyToken, restoreRoute);
router.get('/export', verifyToken, exportRoutes);

// ORS proxy
router.post('/ors-directions', async (req, res) => {
  try {
    const { start, end } = req.body;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required' });
    const orsApiKey = process.env.ORS_API_KEY;
    const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
    const payload = { coordinates: [[start.lng, start.lat], [end.lng, end.lat]] };

    const orsRes = await fetch(url, {
      method: 'POST',
      headers: { Authorization: orsApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await orsRes.json();
    return res.status(orsRes.ok ? 200 : 500).json(data);
  } catch (err) {
    console.error('ORS proxy error:', err);
    return res.status(500).json({ error: 'Failed to fetch route from ORS' });
  }
});

module.exports = router;