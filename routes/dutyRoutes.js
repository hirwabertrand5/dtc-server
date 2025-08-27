const express = require('express');
const router = express.Router();
const {
  getDuties,
  createDuty,
  completeDuty
} = require('../controllers/dutyController');

const { verifyToken } = require('../middleware/auth');
const Duty = require('../models/Duty');

// 🗓️ Duty Routes
router.get('/', verifyToken, getDuties);
router.post('/', verifyToken, createDuty);
router.put('/:id/complete', verifyToken, completeDuty);

// ✅ Count
router.get('/count', verifyToken, async (req, res) => {
  try {
    const total = await Duty.countDocuments();
    res.json({ total });
  } catch (err) {
    res.status(500).json({ error: "Failed to count duties" });
  }
});

module.exports = router;
