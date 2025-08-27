const Bus = require('../models/Bus');
const { validationResult } = require('express-validator');
const { createObjectCsvWriter } = require('csv-writer');

function overlaps(aStart, aEnd, bStart, bEnd) {
  const A1 = new Date(aStart), A2 = new Date(aEnd);
  const B1 = new Date(bStart), B2 = new Date(bEnd);
  return A1 < B2 && B1 < A2;
}

// GET: All buses (non-archived) with pagination + search + filters
exports.getAllBuses = async (req, res) => {
  try {
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 10, 10);
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim();
    const type = (req.query.type || '').trim();

    const query = { isArchived: false };
    if (status) query.status = status;
    if (type) query.type = type;
    if (search) {
      query.$or = [
        { busNumber: { $regex: search, $options: 'i' } },
        { type: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
        { assignedCrew: { $regex: search, $options: 'i' } },
        { assignedRoute: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await Bus.countDocuments(query);
    const data = await Bus.find(query).skip(skip).limit(limit).sort({ createdAt: -1 });

    return res.json({
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// POST: Create bus
exports.createBus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors || !errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  try {
    const { busNumber, capacity, type, status, assignedCrew, assignedRoute } = req.body;
    const actor = req.user?.email || req.user?.id || 'unknown';

    const doc = await Bus.create({
      busNumber,
      capacity: Number(capacity),
      type,
      status,
      assignedCrew: assignedCrew || '',
      assignedRoute: assignedRoute || '',
      createdBy: actor,
      updatedBy: actor,
      isArchived: false
    });

    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Bus number already exists.' });
    }
    return res.status(500).json({ error: e.message });
  }
};

// PUT: Update bus
exports.updateBus = async (req, res) => {
  const errors = validationResult(req);
  if (!errors || !errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  try {
    const { id } = req.params;
    const payload = { ...req.body };
    if ('busNumber' in payload) delete payload.busNumber;
    payload.updatedBy = req.user?.email || req.user?.id || 'unknown';

    const updated = await Bus.findByIdAndUpdate(id, payload, { new: true });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    return res.json(updated);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Duplicate bus number.' });
    }
    return res.status(500).json({ error: e.message });
  }
};

// DELETE: Soft-delete (archive)
exports.archiveBus = async (req, res) => {
  try {
    const { id } = req.params;
    const bus = await Bus.findById(id);
    if (!bus) return res.status(404).json({ error: 'Not found' });
    bus.isArchived = true;
    bus.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await bus.save();
    return res.json({ msg: 'Archived' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// GET: Archived list
exports.getArchivedBuses = async (req, res) => {
  try {
    const rows = await Bus.find({ isArchived: true }).sort({ updatedAt: -1 });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// PUT: Restore archived
exports.restoreBus = async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ error: 'Not found' });
    bus.isArchived = false;
    bus.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await bus.save();
    res.json({ msg: 'Restored' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE: Permanently delete one archived
exports.deleteArchivedBus = async (req, res) => {
  try {
    const bus = await Bus.findById(req.params.id);
    if (!bus) return res.status(404).json({ error: 'Not found' });
    if (!bus.isArchived) return res.status(400).json({ error: 'Bus is not archived' });
    await Bus.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// DELETE: Clear all archived
exports.clearArchivedBuses = async (req, res) => {
  try {
    await Bus.deleteMany({ isArchived: true });
    res.json({ msg: 'Cleared' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// GET: Export CSV (non-archived)
exports.exportBuses = async (req, res) => {
  try {
    const rows = await Bus.find({ isArchived: false }).sort({ createdAt: -1 });
    const csvWriter = createObjectCsvWriter({
      path: 'buses_export.csv',
      header: [
        { id: 'busNumber', title: 'Bus Number' },
        { id: 'capacity', title: 'Capacity' },
        { id: 'type', title: 'Type' },
        { id: 'status', title: 'Status' },
        { id: 'assignedCrew', title: 'Assigned Crew' },
        { id: 'assignedRoute', title: 'Assigned Route' },
        { id: 'createdBy', title: 'Created By' },
        { id: 'updatedBy', title: 'Updated By' },
        { id: 'createdAt', title: 'Created At' },
        { id: 'updatedAt', title: 'Updated At' }
      ]
    });
    await csvWriter.writeRecords(
      rows.map(r => ({
        busNumber: r.busNumber,
        capacity: r.capacity,
        type: r.type,
        status: r.status,
        assignedCrew: r.assignedCrew || '',
        assignedRoute: r.assignedRoute || '',
        createdBy: r.createdBy || '',
        updatedBy: r.updatedBy || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
    );
    return res.download('buses_export.csv');
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// Availability: GET /api/buses/available?start=ISO&end=ISO&type=Standard|Mini|AC|EV|Articulated
exports.getAvailableBuses = async (req, res) => {
  try {
    const { start, end, type, limit } = req.query;
    const startTime = start ? new Date(start) : null;
    const endTime = end ? new Date(end) : null;

    const filter = { isArchived: false, status: { $in: ['Active','Idle'] } };
    if (type) filter.type = type;

    let rows = await Bus.find(filter).limit(Number(limit) || 200).lean();

    if (startTime && endTime) {
      rows = rows.filter(b => {
        const wins = Array.isArray(b.maintenanceWindows) ? b.maintenanceWindows : [];
        return !wins.some(mw => mw.status !== 'Completed' && overlaps(startTime, endTime, mw.startTime, mw.endTime));
      });
    }

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// GET: Counts for dashboard
exports.getCounts = async (req, res) => {
  try {
    const totalActive = await Bus.countDocuments({ isArchived: false });
    const byStatusAgg = await Bus.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byStatus = byStatusAgg.reduce((acc, x) => (acc[x._id] = x.count, acc), {});
    res.json({
      total: totalActive,
      byStatus: {
        Active: byStatus.Active || 0,
        Idle: byStatus.Idle || 0,
        Maintenance: byStatus.Maintenance || 0,
        'Out of Service': byStatus['Out of Service'] || 0
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};