const mongoose = require('mongoose');

const routeSchema = new mongoose.Schema({
  routeName:     { type: String, required: true, unique: true },
  routeNumber:   { type: String, required: true, unique: true },
  estimatedTime: { type: String, required: true },
  distance:      { type: Number, required: true },
  stops:         [{ type: String, required: true }],
  geoJson:       { type: Object, required: true },

  busTypeRequired: { type: String, enum: ['Standard','Mini','AC','EV','Articulated'], default: undefined },
  reliefPoints:    [{ type: String }],

  priority: { type: Number, default: 10 },
  runDays:  { type: [Number], default: [1,2,3,4,5] },

  createdBy: { type: String },
  updatedBy: { type: String },
  isArchived: { type: Boolean, default: false }
}, { timestamps: true });

// Remove duplicates like:
// routeSchema.index({ routeName: 1 });
// routeSchema.index({ routeNumber: 1 });

module.exports = mongoose.model('Route', routeSchema);