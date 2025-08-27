const Route = require('../models/Route');
const Counter = require('../models/Counter');
const { validationResult } = require('express-validator');
const { createObjectCsvWriter } = require('csv-writer');

const formatRouteNumber = n => `DTC-R${String(n).padStart(3, '0')}`;

async function getNextRouteNumber() {
  let doc = await Counter.findOneAndUpdate({ name: 'routeNumber' }, { $inc: { seq: 1 } }, { new: true });
  if (!doc) {
    await Counter.create({ name: 'routeNumber', seq: 0 });
    doc = await Counter.findOneAndUpdate({ name: 'routeNumber' }, { $inc: { seq: 1 } }, { new: true });
  }
  return formatRouteNumber(doc.seq);
}

function sanitizeRunDays(runDays) {
  if (!Array.isArray(runDays)) return [1,2,3,4,5];
  const nums = runDays.map(Number).filter(n => n >= 0 && n <= 6);
  return nums.length ? nums : [1,2,3,4,5];
}

// GET active routes (paginated)
exports.getRoutes = async (req, res) => {
  try {
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 10, 10);
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    const query = {
      isArchived: false,
      $or: [
        { routeName: { $regex: search, $options: 'i' } },
        { routeNumber: { $regex: search, $options: 'i' } }
      ]
    };

    const total = await Route.countDocuments(query);
    const routes = await Route.find(query).skip(skip).limit(limit).sort({ createdAt: -1 });

    return res.status(200).json({ data: routes, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET archived
exports.getArchivedRoutes = async (req, res) => {
  try {
    const page = parseInt(req.query.page || 1, 10);
    const limit = parseInt(req.query.limit || 10, 10);
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    const query = {
      isArchived: true,
      $or: [
        { routeName: { $regex: search, $options: 'i' } },
        { routeNumber: { $regex: search, $options: 'i' } }
      ]
    };

    const total = await Route.countDocuments(query);
    const routes = await Route.find(query).skip(skip).limit(limit).sort({ updatedAt: -1 });

    return res.status(200).json({ data: routes, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// POST create
exports.createRoute = async (req, res) => {
  const errors = validationResult(req);
  if (!errors || !errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const { routeName, estimatedTime, distance, stops, geoJson, busTypeRequired, reliefPoints, priority, runDays } = req.body;

    if (!geoJson || geoJson.type !== 'LineString' || !Array.isArray(geoJson.coordinates) || geoJson.coordinates.length < 2)
      return res.status(400).json({ error: 'geoJson must be a LineString with at least two coordinate pairs.' });
    if (!Array.isArray(stops) || stops.length < 2)
      return res.status(400).json({ error: 'At least two stops are required.' });

    const existingName = await Route.findOne({ routeName });
    if (existingName) return res.status(409).json({ error: 'Route name already exists.' });

    const routeNumber = await getNextRouteNumber();
    const userIdOrEmail = req.user?.email || req.user?.id || 'unknown';

    const newRoute = await Route.create({
      routeName,
      routeNumber,
      estimatedTime,
      distance: Number(distance),
      stops,
      geoJson,
      busTypeRequired: busTypeRequired || undefined,
      reliefPoints: Array.isArray(reliefPoints) ? reliefPoints : [],
      priority: typeof priority === 'number' ? priority : (priority ? Number(priority) : 10),
      runDays: sanitizeRunDays(runDays),
      createdBy: userIdOrEmail,
      updatedBy: userIdOrEmail
    });

    return res.status(201).json(newRoute);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Duplicate routeName or routeNumber.' });
    return res.status(500).json({ error: err.message });
  }
};

// PUT update
exports.updateRoute = async (req, res) => {
  const errors = validationResult(req);
  if (!errors || !errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

  try {
    const { id } = req.params;
    const updateData = { ...req.body, updatedBy: (req.user?.email || req.user?.id || 'unknown') };
    if ('routeNumber' in updateData) delete updateData.routeNumber;
    if ('priority' in updateData) updateData.priority = Number(updateData.priority);
    if ('runDays' in updateData) updateData.runDays = sanitizeRunDays(updateData.runDays);

    const updated = await Route.findByIdAndUpdate(id, updateData, { new: true });
    if (!updated) return res.status(404).json({ error: 'Route not found.' });
    return res.json(updated);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Duplicate routeName or routeNumber.' });
    return res.status(500).json({ error: err.message });
  }
};

// DELETE archive
exports.archiveRoute = async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: 'Route not found.' });
    route.isArchived = true;
    route.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await route.save();
    res.json({ msg: 'Route archived' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT restore
exports.restoreRoute = async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: 'Route not found.' });
    route.isArchived = false;
    route.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await route.save();
    res.json({ msg: 'Route restored' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET export CSV
exports.exportRoutes = async (req, res) => {
  try {
    const routes = await Route.find({ isArchived: false });
    const csvWriter = createObjectCsvWriter({
      path: 'routes_export.csv',
      header: [
        { id: 'routeName', title: 'Route Name' },
        { id: 'routeNumber', title: 'Route Number' },
        { id: 'estimatedTime', title: 'Estimated Time' },
        { id: 'distance', title: 'Distance' },
        { id: 'stops', title: 'Stops' },
        { id: 'busTypeRequired', title: 'Bus Type Required' },
        { id: 'reliefPoints', title: 'Relief Points' },
        { id: 'priority', title: 'Priority' },
        { id: 'runDays', title: 'Run Days' },
        { id: 'createdBy', title: 'Created By' },
        { id: 'updatedBy', title: 'Updated By' },
        { id: 'createdAt', title: 'Created At' },
        { id: 'updatedAt', title: 'Updated At' }
      ]
    });
    await csvWriter.writeRecords(
      routes.map(r => ({
        routeName: r.routeName,
        routeNumber: r.routeNumber,
        estimatedTime: r.estimatedTime,
        distance: r.distance,
        stops: (r.stops || []).join(' → '),
        busTypeRequired: r.busTypeRequired || '',
        reliefPoints: Array.isArray(r.reliefPoints) ? r.reliefPoints.join(' | ') : '',
        priority: r.priority ?? 10,
        runDays: Array.isArray(r.runDays) ? r.runDays.join(',') : '',
        createdBy: r.createdBy || '',
        updatedBy: r.updatedBy || '',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      }))
    );
    res.download('routes_export.csv');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET counts for dashboard
exports.getCounts = async (req, res) => {
  try {
    const total = await Route.countDocuments({});
    const active = await Route.countDocuments({ isArchived: false });
    const archived = await Route.countDocuments({ isArchived: true });
    res.json({ total, active, archived });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};