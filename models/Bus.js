const mongoose = require('mongoose');

const MaintenanceWindowSchema = new mongoose.Schema({
  startTime: { type: Date, required: true },
  endTime:   { type: Date, required: true },
  type:      { type: String }, // e.g., 'Service', 'Repair', 'Inspection'
  status:    { type: String, enum: ['Scheduled','In Progress','Completed'], default: 'Scheduled' }
}, { _id: false });

const BusSchema = new mongoose.Schema({
  busNumber: { type: String, required: true, unique: true, trim: true },
  capacity:  { type: Number, required: true },
  type:      { type: String, enum: ['Standard','Mini','AC','EV','Articulated'], default: 'Standard' },
  status:    { type: String, enum: ['Active','Idle','Maintenance','Out of Service'], default: 'Idle' },

  // Existing simple assignment fields (strings). We’ll switch to IDs later.
  assignedCrew:  { type: String, default: '' },
  assignedRoute: { type: String, default: '' },

  // New fields
  depot: { type: String },
  maintenanceWindows: [MaintenanceWindowSchema],

  // System/meta
  isArchived: { type: Boolean, default: false },
  createdBy: { type: String },
  updatedBy: { type: String }
}, { timestamps: true });

BusSchema.index({ isArchived: 1, status: 1, type: 1 });
BusSchema.index({ 'maintenanceWindows.startTime': 1, 'maintenanceWindows.endTime': 1 });

module.exports = mongoose.model('Bus', BusSchema);