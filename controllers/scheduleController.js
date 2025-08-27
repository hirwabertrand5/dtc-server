const mongoose = require('mongoose');
const AdminSettings = require('../models/AdminSettings');
const Route = require('../models/Route');
const Assignment = require('../models/Assignment');
const { autoAssignLinked } = require('./assignmentController');

function toWindow(dateISO, slot) {
  const base = new Date(dateISO);
  const [sh, sm] = slot.start.split(':').map(Number);
  const [eh, em] = slot.end.split(':').map(Number);
  const start = new Date(base); start.setHours(sh, sm || 0, 0, 0);
  const end = new Date(base); end.setHours(eh, em || 0, 0, 0);
  return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function isRouteRunningToday(route, dateISO) {
  const d = new Date(dateISO);
  const dow = d.getDay(); // 0..6
  const days = Array.isArray(route.runDays) ? route.runDays : [1,2,3,4,5];
  return days.includes(dow);
}

// Preview a day
exports.preview = async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().slice(0,10);
    const settings = await AdminSettings.findOne().lean();
    const slots = settings?.dutySlots?.length ? settings.dutySlots : [
      { key: 'morning', start: '06:00', end: '14:00' },
      { key: 'evening', start: '14:00', end: '22:00' }
    ];

    const routes = await Route.find({ isArchived: false }).lean();
    const dayRoutes = routes
      .filter(r => isRouteRunningToday(r, date))
      .sort((a,b) => (a.priority ?? 10) - (b.priority ?? 10));

    const plan = [];
    for (const slot of slots) {
      const { startTime, endTime } = toWindow(date, slot);
      for (const route of dayRoutes) {
        plan.push({
          slot: slot.key,
          routeId: route._id,
          routeName: route.routeName,
          routeNumber: route.routeNumber,
          busTypeRequired: route.busTypeRequired || null,
          startTime, endTime
        });
      }
    }

    return res.json({ date, slots, total: plan.length, plan });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// Generate + commit (batch)
exports.generate = async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().slice(0,10);
    const includeConductor = !!req.body.includeConductor;

    const settings = await AdminSettings.findOne().lean();
    const slots = settings?.dutySlots?.length ? settings.dutySlots : [
      { key: 'morning', start: '06:00', end: '14:00' },
      { key: 'evening', start: '14:00', end: '22:00' }
    ];

    const routes = await Route.find({ isArchived: false }).lean();
    const dayRoutes = routes
      .filter(r => isRouteRunningToday(r, date))
      .sort((a,b) => (a.priority ?? 10) - (b.priority ?? 10));

    const results = [];
    const failures = [];
    const batchId = new mongoose.Types.ObjectId().toString();

    for (const slot of slots) {
      const { startTime, endTime } = toWindow(date, slot);
      for (const route of dayRoutes) {
        const reqStub = {
          body: {
            routeId: route._id.toString(),
            startTime, endTime,
            includeConductor,
            noTxn: true,                 // Batch mode: no transaction
            batchId,
            scheduledDate: date,
            slotKey: slot.key
          },
          user: req.user
        };
        const resStub = {
          status: (code) => ({
            json: (payload) => {
              if (code >= 200 && code < 300) {
                results.push({ slot: slot.key, routeId: route._id, routeName: route.routeName, ...payload });
              } else {
                failures.push({ slot: slot.key, routeId: route._id, routeName: route.routeName, error: payload?.error || 'unknown' });
              }
            }
          })
        };
        // eslint-disable-next-line no-await-in-loop
        await autoAssignLinked(reqStub, resStub);
      }
    }

    return res.json({ date, slots, ok: results.length, failed: failures.length, results, failures, batchId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// Undo by batchId: mode=cancel|delete
exports.undoBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const mode = (req.query.mode || 'cancel').toLowerCase();
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });

    if (mode === 'delete') {
      const r = await Assignment.deleteMany({ batchId });
      return res.json({ msg: 'Deleted batch', deleted: r.deletedCount });
    } else {
      const r = await Assignment.updateMany({ batchId }, { $set: { status: 'Canceled' } });
      return res.json({ msg: 'Canceled batch', modified: r.modifiedCount });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// Undo by day: mode=cancel|delete
exports.undoDay = async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
    const mode = (req.query.mode || 'cancel').toLowerCase();

    const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
    const next = new Date(dayStart); next.setDate(dayStart.getDate() + 1);

    if (mode === 'delete') {
      const r = await Assignment.deleteMany({ startTime: { $lt: next }, endTime: { $gt: dayStart } });
      return res.json({ msg: 'Deleted day', deleted: r.deletedCount });
    } else {
      const r = await Assignment.updateMany({ startTime: { $lt: next }, endTime: { $gt: dayStart } }, { $set: { status: 'Canceled' } });
      return res.json({ msg: 'Canceled day', modified: r.modifiedCount });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// proxy to assignments/day
exports.day = async (req, res) => {
  const date = req.query.date || '';
  res.redirect(`/api/assignments/day?date=${encodeURIComponent(date)}`);
};