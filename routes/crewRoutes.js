const express = require('express');
const router = express.Router();
const {
  getAllCrew,
  createCrew,
  updateCrew,
  deleteCrew,
  exportCrew,
  getArchivedCrew,
  restoreCrew,
  deleteArchivedCrew,
  clearArchivedCrew,
  getAvailableCrew,
  getCounts
} = require('../controllers/crewController');

const { verifyToken } = require('../middleware/auth');
const { body } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." }
});

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + file.originalname)
});
const upload = multer({ storage });

const crewValidation = [
  body('name').trim().notEmpty().withMessage('Name is required.')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters.')
    .matches(/^[a-zA-Z\s.'-]+$/).withMessage('Name contains invalid characters.'),
  body('role').notEmpty().withMessage('Role is required.').isIn(['Driver', 'Conductor']).withMessage('Role must be Driver or Conductor.'),
  body('status').notEmpty().withMessage('Status is required.').isIn(['Available', 'On Duty', 'Resting']).withMessage('Invalid status.')
];

// Specific routes first
router.get('/', verifyToken, limiter, getAllCrew);
router.get('/count', verifyToken, getCounts);
router.get('/available', verifyToken, getAvailableCrew);
router.get('/archived', verifyToken, getArchivedCrew);
router.put('/restore/:id', verifyToken, restoreCrew);
router.delete('/archived/:id', verifyToken, deleteArchivedCrew);
router.delete('/archived/clear', verifyToken, clearArchivedCrew);
router.get('/export', verifyToken, exportCrew);

router.post('/', verifyToken, upload.single('avatar'), crewValidation, createCrew);
router.put('/:id', verifyToken, upload.single('avatar'), crewValidation, updateCrew);
router.delete('/:id', verifyToken, deleteCrew);

module.exports = router;