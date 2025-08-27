const mongoose = require('mongoose');

const UnavailabilitySchema = new mongoose.Schema({
  startTime: { type: Date, required: true },
  endTime:   { type: Date, required: true },
  reason:    { type: String }
}, { _id: false });

const CrewSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  crewId: { type: String }, // auto-generated like DTC-C001
  role: { type: String, enum: ['Driver','Conductor'], required: true },
  status: { type: String, enum: ['Available','On Duty','Resting'], default: 'Available' },
  avatar: { type: String },

  // Optional driver quals
  qualifications: [{ type: String, enum: ['Standard','Mini','AC','EV','Articulated'] }],

  // Rest/availability helpers
  lastDutyEnd: { type: Date },
  unavailability: [UnavailabilitySchema],

  // Meta
  isArchived: { type: Boolean, default: false },
  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

// Indexes
CrewSchema.index({ isArchived: 1, status: 1, role: 1 });
CrewSchema.index({ lastDutyEnd: 1 });
CrewSchema.index({ name: 'text', crewId: 'text' });

// Unique only when crewId exists and is non-empty string
CrewSchema.index(
  { crewId: 1 },
  { unique: true, partialFilterExpression: { crewId: { $exists: true, $type: 'string', $ne: '' } } }
);

module.exports = mongoose.model('Crew', CrewSchema);