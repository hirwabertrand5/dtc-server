const Duty = require('../models/Duty');
const Crew = require('../models/Crew');
const mongoose = require('mongoose');

exports.getDuties = async (req, res) => {
  try {
    const duties = await Duty.find()
      .populate('crewId', 'name role status')
      .populate('busId', 'busNumber');
    res.json(duties);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createDuty = async (req, res) => {
  try {
    const { type, crewId, busId, route, startTime, endTime } = req.body;

    const parsedStart = new Date(startTime);
    const parsedEnd = new Date(endTime);

    // 1️⃣ Check for overlapping duties
    const conflicts = await Duty.findOne({
      crewId: new mongoose.Types.ObjectId(crewId),
      $or: [
        {
          startTime: { $lt: parsedEnd, $gte: parsedStart }
        },
        {
          endTime: { $gt: parsedStart, $lte: parsedEnd }
        },
        {
          startTime: { $lte: parsedStart },
          endTime: { $gte: parsedEnd }
        }
      ]
    });

    if (conflicts) {
      return res.status(409).json({
        status: 'Conflict',
        message: '⚠️ Crew already assigned to another duty during this time.',
        existingDuty: conflicts
      });
    }

    // 2️⃣ Check minimum 12-hours rest from last shift
    const previousDuty = await Duty.findOne({ crewId })
      .sort({ endTime: -1 }); // Get last duty

    if (previousDuty && previousDuty.endTime) {
      const hoursSinceLast = Math.abs(parsedStart - previousDuty.endTime) / 36e5; // ms to hours

      if (hoursSinceLast < 12) {
        return res.status(400).json({
          status: "No Rest",
          message: `Crew must rest at least 12 hours. Only ${hoursSinceLast.toFixed(2)} hrs have passed.`
        });
      }
    }

    // ✅ All checks passed — save duty
    const newDuty = new Duty({ type, crewId, busId, route, startTime: parsedStart, endTime: parsedEnd });
    await newDuty.save();

    // Auto-update crew status
    await Crew.findByIdAndUpdate(crewId, { status: "On Duty" });

    res.status(201).json({
      msg: "✅ Duty assigned successfully",
      duty: newDuty
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.completeDuty = async (req, res) => {
  try {
    const { id } = req.params;

    // 1️⃣ Find the duty to mark as completed
    const duty = await Duty.findById(id);
    if (!duty) {
      return res.status(404).json({ msg: 'Duty not found' });
    }

    // 2️⃣ Update duty status
    duty.status = 'Completed';
    await duty.save();

    // 3️⃣ Update crew to Resting and log duty end time
    await Crew.findByIdAndUpdate(duty.crewId, {
      status: 'Resting',
      lastDutyEnd: duty.endTime
    });

    res.status(200).json({
      msg: '✅ Duty marked as completed & crew moved to Resting',
      duty
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
