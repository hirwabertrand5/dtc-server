const Crew = require('../models/Crew');
const Counter = require('../models/Counter');
const AdminSettings = require('../models/AdminSettings');
const { validationResult } = require('express-validator');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs');
const path = require('path');

const ALLOWED_QUALS = ['Standard','Mini','AC','EV','Articulated'];

function removeLocalFileIfExists(p) {
  try {
    if (!p) return;
    if (p.startsWith('/uploads')) {
      const abs = path.join(__dirname, '..', p.startsWith('/') ? p.slice(1) : p);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  } catch (e) {
    console.warn('File cleanup warning:', e.message);
  }
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  const A1 = new Date(aStart), A2 = new Date(aEnd);
  const B1 = new Date(bStart), B2 = new Date(bEnd);
  return A1 < B2 && B1 < A2;
}

function parseQualifications(body) {
  let vals = [];
  if (Array.isArray(body['qualifications[]'])) {
    vals = body['qualifications[]'];
  } else if (Array.isArray(body.qualifications)) {
    vals = body.qualifications;
  } else if (typeof body.qualifications === 'string') {
    try {
      const parsed = JSON.parse(body.qualifications);
      if (Array.isArray(parsed)) vals = parsed;
      else vals = body.qualifications.split(',').map(s => s.trim()).filter(Boolean);
    } catch {
      vals = body.qualifications.split(',').map(s => s.trim()).filter(Boolean);
    }
  } else if (typeof body['qualifications[]'] === 'string') {
    vals = body['qualifications[]'].split(',').map(s => s.trim()).filter(Boolean);
  }
  vals = vals.filter(v => ALLOWED_QUALS.includes(v));
  return [...new Set(vals)];
}

// Atomic next crewId: DTC-C###
async function getNextCrewId() {
  let doc = await Counter.findOneAndUpdate(
    { name: 'crewId' },
    { $inc: { seq: 1 } },
    { new: true }
  );
  if (!doc) {
    await Counter.create({ name: 'crewId', seq: 0 });
    doc = await Counter.findOneAndUpdate(
      { name: 'crewId' },
      { $inc: { seq: 1 } },
      { new: true }
    );
  }
  const num = String(doc.seq).padStart(3, '0');
  return `DTC-C${num}`;
}

// GET: All crew (pagination + search + filters), non-archived
exports.getAllCrew = async (req, res) => {
  try {
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 10, 10);
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();
    const status = (req.query.status || '').trim();

    const query = { isArchived: false };
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } },
        { status: { $regex: search, $options: 'i' } },
        { crewId: { $regex: search, $options: 'i' } }
      ];
    }

    const total = await Crew.countDocuments(query);
    const data = await Crew.find(query).skip(skip).limit(limit).sort({ createdAt: -1 });

    return res.json({
      data,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// POST: Create crew (auto crewId + avatar + quals)
exports.createCrew = async (req, res) => {
  const errors = validationResult(req);
  if (!errors || !errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  try {
    const { name, role, status } = req.body;
    const avatar = req.file ? `/uploads/${req.file.filename}` : (req.body.avatar || null);
    const qualifications = parseQualifications(req.body);
    const actor = req.user?.email || req.user?.id || 'unknown';

    const crewId = await getNextCrewId();

    const doc = await Crew.create({
      name,
      crewId,
      role,
      status,
      avatar,
      qualifications,
      isArchived: false,
      createdBy: actor,
      updatedBy: actor
    });

    return res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) {
      return res.status(409).json({ error: 'Duplicate crewId' });
    }
    return res.status(500).json({ error: e.message });
  }
};

// PUT: Update crew (avatar replace-safe; crewId not editable)
exports.updateCrew = async (req, res) => {
  const errors = validationResult(req);
  if (!errors || !errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  try {
    const { id } = req.params;
    const crew = await Crew.findById(id);
    if (!crew) return res.status(404).json({ error: 'Not found' });

    const actor = req.user?.email || req.user?.id || 'unknown';

    if (req.file) {
      removeLocalFileIfExists(crew.avatar);
      crew.avatar = `/uploads/${req.file.filename}`;
    }

    crew.name = req.body.name;
    crew.role = req.body.role;
    crew.status = req.body.status;

    if ('crewId' in req.body) delete req.body.crewId;

    const quals = parseQualifications(req.body);
    if (quals.length || 'qualifications' in req.body || 'qualifications[]' in req.body) {
      crew.qualifications = quals;
    }

    crew.updatedBy = actor;

    await crew.save();
    return res.json(crew);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// DELETE: Soft-delete (archive)
exports.deleteCrew = async (req, res) => {
  try {
    const { id } = req.params;
    const crew = await Crew.findById(id);
    if (!crew) return res.status(404).json({ error: 'Not found' });
    crew.isArchived = true;
    crew.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await crew.save();
    return res.json({ msg: 'Archived' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// GET: Export current (non-archived) to CSV
exports.exportCrew = async (req, res) => {
  try {
    const rows = await Crew.find({ isArchived: false }).sort({ createdAt: -1 });
    const csvWriter = createObjectCsvWriter({
      path: 'crew_export.csv',
      header: [
        { id: 'name', title: 'Name' },
        { id: 'crewId', title: 'Crew ID' },
        { id: 'role', title: 'Role' },
        { id: 'status', title: 'Status' },
        { id: 'qualifications', title: 'Qualifications' },
        { id: 'createdBy', title: 'Created By' },
        { id: 'updatedBy', title: 'Updated By' },
        { id: 'createdAt', title: 'Created At' },
        { id: 'updatedAt', title: 'Updated At' }
      ]
    });
    await csvWriter.writeRecords(
      rows.map(r => ({
        name: r.name,
        crewId: r.crewId || r._id,
        role: r.role,
        status: r.status,
        qualifications: Array.isArray(r.qualifications) ? r.qualifications.join('|') : '',
        createdBy: r.createdBy || '',
        updatedBy: r.updatedBy || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
    );
    return res.download('crew_export.csv');
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// Archived ops
exports.getArchivedCrew = async (req, res) => {
  try {
    const rows = await Crew.find({ isArchived: true }).sort({ updatedAt: -1 });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.restoreCrew = async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) return res.status(404).json({ error: 'Not found' });
    crew.isArchived = false;
    crew.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await crew.save();
    res.json({ msg: 'Restored' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.deleteArchivedCrew = async (req, res) => {
  try {
    const crew = await Crew.findById(req.params.id);
    if (!crew) return res.status(404).json({ error: 'Not found' });
    if (!crew.isArchived) return res.status(400).json({ error: 'Crew is not archived' });
    removeLocalFileIfExists(crew.avatar);
    await Crew.findByIdAndDelete(req.params.id);
    res.json({ msg: 'Deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.clearArchivedCrew = async (req, res) => {
  try {
    const archived = await Crew.find({ isArchived: true });
    archived.forEach(c => removeLocalFileIfExists(c.avatar));
    await Crew.deleteMany({ isArchived: true });
    res.json({ msg: 'Cleared' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Availability: GET /api/crew/available?start=ISO&end=ISO&role=Driver|Conductor&qualifiedFor=AC|EV|...
exports.getAvailableCrew = async (req, res) => {
  try {
    const { start, end, role, qualifiedFor, limit } = req.query;
    const startTime = start ? new Date(start) : null;
    const endTime = end ? new Date(end) : null;

    const filter = { isArchived: false, status: 'Available' };
    if (role) filter.role = role;

    let rows = await Crew.find(filter).limit(Number(limit) || 200).lean();

    if (qualifiedFor) {
      rows = rows.filter(c => {
        const quals = Array.isArray(c.qualifications) ? c.qualifications : [];
        if (quals.length === 0) return true; // no quals recorded => allow
        return quals.includes(qualifiedFor);
      });
    }

    const settings = await AdminSettings.findOne().lean();
    const minRest = settings?.minRestHours ?? 12;

    if (startTime && endTime) {
      rows = rows.filter(c => {
        if (c.lastDutyEnd) {
          const minStart = new Date(c.lastDutyEnd);
          minStart.setHours(minStart.getHours() + minRest);
          if (startTime < minStart) return false;
        }
        if (Array.isArray(c.unavailability)) {
          for (const u of c.unavailability) {
            if (overlaps(startTime, endTime, u.startTime, u.endTime)) return false;
          }
        }
        return true;
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
    const totalActive = await Crew.countDocuments({ isArchived: false });
    const byRoleAgg = await Crew.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    const byStatusAgg = await Crew.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);
    const byRole = byRoleAgg.reduce((acc, x) => (acc[x._id] = x.count, acc), {});
    const byStatus = byStatusAgg.reduce((acc, x) => (acc[x._id] = x.count, acc), {});
    res.json({
      total: totalActive,
      byRole: {
        Driver: byRole.Driver || 0,
        Conductor: byRole.Conductor || 0
      },
      byStatus: {
        Available: byStatus.Available || 0,
        'On Duty': byStatus['On Duty'] || 0,
        Resting: byStatus.Resting || 0
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};