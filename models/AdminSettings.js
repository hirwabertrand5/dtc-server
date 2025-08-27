const mongoose = require('mongoose');

const AdminSettingsSchema = new mongoose.Schema({
  minRestHours: { type: Number, default: 12 },
  maxShiftHours: { type: Number, default: 8 },
  maxWeeklyHours: { type: Number, default: 48 },
  conductorRequired: { type: Boolean, default: false },
  splitShiftsAllowed: { type: Boolean, default: true },
  handoverStopsOnly: { type: Boolean, default: true },
  freezeWindowHours: { type: Number, default: 12 },
  allowOverrides: { type: Boolean, default: true },

  // NEW: duty slots used by the scheduler
  dutySlots: {
    type: [
      {
        key: { type: String, required: true },   // e.g., "morning"
        start: { type: String, required: true }, // "06:00"
        end: { type: String, required: true }    // "14:00"
      }
    ],
    default: [
      { key: 'morning', start: '06:00', end: '14:00' },
      { key: 'evening', start: '14:00', end: '22:00' }
    ]
  }
}, { timestamps: true });

module.exports = mongoose.model('AdminSettings', AdminSettingsSchema);