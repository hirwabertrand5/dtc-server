const AdminSettings = require('../models/AdminSettings');

exports.getSettings = async (req, res) => {
  try {
    let s = await AdminSettings.findOne().lean();
    if (!s) s = (await AdminSettings.create({})).toObject();
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const payload = {
      // only allow known fields
      minRestHours: req.body.minRestHours,
      maxShiftHours: req.body.maxShiftHours,
      maxWeeklyHours: req.body.maxWeeklyHours,
      conductorRequired: req.body.conductorRequired,
      splitShiftsAllowed: req.body.splitShiftsAllowed,
      handoverStopsOnly: req.body.handoverStopsOnly,
      freezeWindowHours: req.body.freezeWindowHours,
      allowOverrides: req.body.allowOverrides,
      dutySlots: req.body.dutySlots,
      timeFormat: req.body.timeFormat,
      routeColorLogic: req.body.routeColorLogic,
      defaultLanguage: req.body.defaultLanguage,
      notificationPreferences: req.body.notificationPreferences
    };

    // Remove undefined values
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    const s = await AdminSettings.findOneAndUpdate({}, payload, { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json({ msg: 'Updated', data: s });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};