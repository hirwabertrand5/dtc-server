const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
  crewId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Crew', required: true },
  busId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Bus', required: true },
  routeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Route', required: true },
  dutyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Duty', required: false }, // optional
  role:     { type: String, enum: ['Driver','Conductor'], required: true },

  startTime: { type: Date, required: true },
  endTime:   { type: Date, required: true },

  status: { type: String, enum: ['Planned','Live','Completed','Canceled'], default: 'Planned' },

  // Diagnostics
  conflicts: [String],
  overrideReason: { type: String },

  // Schedule metadata (used for undo/reporting)
  batchId: { type: String, index: true },      // unique id per "Generate"
  scheduledDate: { type: String },             // 'YYYY-MM-DD'
  slotKey: { type: String },                   // 'morning'/'evening'

  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

AssignmentSchema.index({ crewId: 1, startTime: 1, endTime: 1 });
AssignmentSchema.index({ busId: 1, startTime: 1, endTime: 1 });
AssignmentSchema.index({ startTime: 1, endTime: 1 });

module.exports = mongoose.model('Assignment', AssignmentSchema);