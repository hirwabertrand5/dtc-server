const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const Crew = require('../models/Crew');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const Duty = require('../models/Duty');
const AdminSettings = require('../models/AdminSettings');
const { evaluateConstraints } = require('../utils/rules/engine');

const overlapsQuery = (startTime, endTime) => ({
  $or: [{ startTime: { $lt: endTime }, endTime: { $gt: startTime } }]
});

function hoursBetween(a, b) {
  return (new Date(b) - new Date(a)) / 36e5;
}

exports.checkConflicts = async (req, res) => {
  try {
    const { crewId, busId, routeId, role, startTime, endTime } = req.body;

    const [settings, crew, bus, route] = await Promise.all([
      AdminSettings.findOne().sort({ createdAt: -1 }),
      Crew.findById(crewId),
      Bus.findById(busId),
      Route.findById(routeId)
    ]);

    const [existingCrewAssignments, existingBusAssignments] = await Promise.all([
      Assignment.find({ crewId, status: { $in: ['Planned','Live'] }, ...overlapsQuery(startTime, endTime) }),
      Assignment.find({ busId,  status: { $in: ['Planned','Live'] }, ...overlapsQuery(startTime, endTime) })
    ]);

    const conflicts = await evaluateConstraints({
      settings, crew, bus, route,
      existingCrewAssignments, existingBusAssignments,
      proposal: { role, startTime, endTime }
    });

    return res.json({ conflicts });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

exports.createAssignment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { crewId, busId, routeId, dutyId, role, startTime, endTime, overrideReason, batchId, scheduledDate, slotKey } = req.body;
    const actor = req.user?.email || req.user?.id || 'unknown';

    const [settings, crew, bus, route] = await Promise.all([
      AdminSettings.findOne().session(session),
      Crew.findById(crewId).session(session),
      Bus.findById(busId).session(session),
      Route.findById(routeId).session(session)
    ]);
    if (dutyId) await Duty.findById(dutyId).session(session).catch(() => null);

    const [existingCrewAssignments, existingBusAssignments] = await Promise.all([
      Assignment.find({ crewId, status: { $in: ['Planned','Live'] }, ...overlapsQuery(startTime, endTime) }).session(session),
      Assignment.find({ busId,  status: { $in: ['Planned','Live'] }, ...overlapsQuery(startTime, endTime) }).session(session)
    ]);

    const conflicts = await evaluateConstraints({
      settings, crew, bus, route,
      existingCrewAssignments, existingBusAssignments,
      proposal: { role, startTime, endTime }
    });

    if (conflicts.length) {
      const canOverride = settings?.allowOverrides && overrideReason;
      if (!canOverride) {
        await session.abortTransaction();
        return res.status(409).json({ conflicts, message: 'Constraints violated' });
      }
    }

    const [assignment] = await Assignment.create([{
      crewId, busId, routeId, dutyId: dutyId || undefined,
      role, startTime, endTime,
      status: 'Planned',
      conflicts,
      overrideReason: conflicts.length ? overrideReason : undefined,
      batchId, scheduledDate, slotKey,
      createdBy: actor, updatedBy: actor
    }], { session });

    if (crew && (!crew.lastDutyEnd || new Date(endTime) > new Date(crew.lastDutyEnd))) {
      crew.lastDutyEnd = endTime;
      crew.updatedBy = actor;
      await crew.save({ session });
    }

    await session.commitTransaction();
    return res.status(201).json(assignment);
  } catch (e) {
    await session.abortTransaction();
    return res.status(500).json({ error: e.message });
  } finally {
    session.endSession();
  }
};

exports.listByDay = async (req, res) => {
  try {
    const d = req.query.date ? new Date(req.query.date) : new Date();
    const dayStart = new Date(d); dayStart.setHours(0,0,0,0);
    const next = new Date(dayStart); next.setDate(dayStart.getDate() + 1);

    const rows = await Assignment.find({
      startTime: { $lt: next },
      endTime: { $gt: dayStart }
    })
    .populate('crewId', 'name role status')
    .populate('busId', 'busNumber type status')
    .populate('routeId', 'routeName routeNumber geoJson') // include geometry
    .populate('dutyId', 'type startTime endTime');

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.listRange = async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required' });
    const rows = await Assignment.find({
      startTime: { $lt: new Date(end) },
      endTime:   { $gt: new Date(start) }
    })
    .populate('crewId', 'name role status')
    .populate('busId', 'busNumber type status')
    .populate('routeId', 'routeName routeNumber geoJson') // include geometry
    .populate('dutyId', 'type startTime endTime');

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

exports.cancelAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const a = await Assignment.findById(id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    a.status = 'Canceled';
    a.updatedBy = req.user?.email || req.user?.id || 'unknown';
    await a.save();
    res.json({ msg: 'Canceled' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

// Auto-Assign Linked with optional noTxn + metadata
exports.autoAssignLinked = async (req, res) => {
  const useTxn = !req.body?.noTxn;
  // Planning mode: when called from batch generator (noTxn) or explicitly
  const planningMode = req.body?.planningMode === true || req.body?.noTxn === true;

  const actor = req.user?.email || req.user?.id || 'unknown';
  const { routeId, startTime, endTime, includeConductor, batchId, scheduledDate, slotKey } = req.body;

  if (!routeId || !startTime || !endTime) {
    return res.status(400).json({ error: 'routeId, startTime, endTime are required' });
  }
  const start = new Date(startTime), end = new Date(endTime);
  if (!(start < end)) {
    return res.status(400).json({ error: 'startTime must be before endTime' });
  }

  let session = null;
  try {
    if (useTxn) {
      session = await mongoose.startSession();
      session.startTransaction();
    }

    const [settingsRaw, route] = await Promise.all([
      useTxn ? AdminSettings.findOne().session(session) : AdminSettings.findOne(),
      useTxn ? Route.findById(routeId).session(session) : Route.findById(routeId)
    ]);
    if (!route) {
      if (useTxn) await session.abortTransaction();
      return res.status(404).json({ error: 'Route not found' });
    }
    const settings = planningMode ? { ...settingsRaw?.toObject?.() ?? settingsRaw, freezeWindowHours: 0 } : settingsRaw;
    const reqType = route.busTypeRequired || undefined;

    // Buses (Active/Idle)
    const busFilter = { isArchived: false, status: { $in: ['Active','Idle'] } };
    if (reqType) busFilter.type = reqType;
    const buses = useTxn ? await Bus.find(busFilter).session(session).lean() : await Bus.find(busFilter).lean();

    // Drivers: in planning mode, ignore status filter
    const crewFilter = planningMode
      ? { isArchived: false, role: 'Driver' }
      : { isArchived: false, status: 'Available', role: 'Driver' };
    let drivers = useTxn ? await Crew.find(crewFilter).session(session).lean() : await Crew.find(crewFilter).lean();

    if (reqType) {
      drivers = drivers.filter(c => {
        const quals = Array.isArray(c.qualifications) ? c.qualifications : [];
        return quals.length === 0 || quals.includes(reqType);
      });
    }

    if (!buses.length || !drivers.length) {
      if (useTxn) await session.abortTransaction();
      return res.status(409).json({ error: 'No available buses or drivers matching requirements' });
    }

    // Preload overlapping assignments for all candidate drivers and buses (single DB call)
    const crewIds = drivers.map(c => c._id);
    const busIds = buses.map(b => b._id);
    const overlapsQ = {
      status: { $in: ['Planned','Live'] },
      ...overlapsQuery(start, end),
      $or: [{ crewId: { $in: crewIds } }, { busId: { $in: busIds } }]
    };
    const overlaps = useTxn
      ? await Assignment.find(overlapsQ).session(session).lean()
      : await Assignment.find(overlapsQ).lean();

    // Build busy maps
    const crewBusy = new Map();
    const busBusy  = new Map();
    for (const a of overlaps) {
      if (a.crewId) {
        const key = a.crewId.toString();
        if (!crewBusy.has(key)) crewBusy.set(key, []);
        crewBusy.get(key).push(a);
      }
      if (a.busId) {
        const key = a.busId.toString();
        if (!busBusy.has(key)) busBusy.set(key, []);
        busBusy.get(key).push(a);
      }
    }

    // Filter free buses (no time overlap + maintenance windows)
    const freeBuses = buses
      .filter(b => !busBusy.has(b._id.toString()))
      .filter(b => {
        const wins = Array.isArray(b.maintenanceWindows) ? b.maintenanceWindows : [];
        return !wins.some(mw => mw.status !== 'Completed' && (new Date(mw.startTime) < end && new Date(mw.endTime) > start));
      });

    // Filter free drivers (no overlap + meets rest)
    let freeDrivers = drivers
      .filter(c => !crewBusy.has(c._id.toString()))
      .filter(c => {
        const minRest = settings?.minRestHours ?? 12;
        if (c.lastDutyEnd) {
          const minStart = new Date(c.lastDutyEnd);
          minStart.setHours(minStart.getHours() + minRest);
          if (start < minStart) return false;
        }
        return true;
      });

    if (!freeBuses.length || !freeDrivers.length) {
      if (useTxn) await session.abortTransaction();
      return res.status(409).json({ error: 'No conflict-free buses or drivers in time window' });
    }

    // Fairness: least weekly hours first, then oldest lastDutyEnd
    const weekAgo = new Date(start); weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAssignmentsQ = { crewId: { $in: freeDrivers.map(c => c._id) }, startTime: { $gt: weekAgo } };
    const weekAssignments = useTxn
      ? await Assignment.find(weekAssignmentsQ).session(session).lean()
      : await Assignment.find(weekAssignmentsQ).lean();

    const weeklyHours = new Map();
    for (const c of freeDrivers) weeklyHours.set(c._id.toString(), 0);
    for (const a of weekAssignments) {
      const key = a.crewId?.toString();
      if (!key) continue;
      const h = hoursBetween(a.startTime, a.endTime);
      weeklyHours.set(key, (weeklyHours.get(key) || 0) + h);
    }

    freeDrivers.sort((a, b) => {
      const wa = weeklyHours.get(a._id.toString()) || 0;
      const wb = weeklyHours.get(b._id.toString()) || 0;
      if (wa !== wb) return wa - wb;
      const ra = a.lastDutyEnd ? new Date(a.lastDutyEnd).getTime() : 0;
      const rb = b.lastDutyEnd ? new Date(b.lastDutyEnd).getTime() : 0;
      return ra - rb;
    });

    freeBuses.sort((a, b) => {
      const sa = a.status === 'Idle' ? 0 : 1;
      const sb = b.status === 'Idle' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return 0;
    });

    // Candidate search (reuse precomputed overlaps; planning mode: force status=Available, freeze=0 for checks)
    let chosen = null;
    for (const drv of freeDrivers) {
      const crewCandidate = planningMode ? { ...drv, status: 'Available' } : drv;

      for (const bus of freeBuses) {
        const existingCrewAssignments = crewBusy.get(drv._id.toString()) || [];
        const existingBusAssignments  = busBusy.get(bus._id.toString())  || [];

        const conflicts = await evaluateConstraints({
          settings: planningMode ? { ...settings, freezeWindowHours: 0 } : settings,
          crew: crewCandidate,
          bus,
          route,
          existingCrewAssignments,
          existingBusAssignments,
          proposal: { role: 'Driver', startTime: start, endTime: end }
        });

        if (!conflicts.length) { chosen = { driver: drv, bus }; break; }
      }
      if (chosen) break;
    }

    if (!chosen) {
      if (useTxn) await session.abortTransaction();
      return res.status(409).json({ error: 'No conflict-free driver/bus combination found' });
    }

    // Create driver assignment
    const insert = {
      crewId: chosen.driver._id,
      busId: chosen.bus._id,
      routeId: route._id,
      role: 'Driver',
      startTime: start,
      endTime: end,
      status: 'Planned',
      batchId, scheduledDate, slotKey,
      createdBy: actor, updatedBy: actor
    };

    const [driverAssignment] = useTxn
      ? await Assignment.create([insert], { session })
      : await Assignment.create([insert]);

    // Update driver's lastDutyEnd
    if (useTxn) {
      if (!chosen.driver.lastDutyEnd || end > new Date(chosen.driver.lastDutyEnd)) {
        await Crew.findByIdAndUpdate(chosen.driver._id, { $set: { lastDutyEnd: end, updatedBy: actor } }, { session });
      }
    } else {
      if (!chosen.driver.lastDutyEnd || end > new Date(chosen.driver.lastDutyEnd)) {
        await Crew.findByIdAndUpdate(chosen.driver._id, { $set: { lastDutyEnd: end, updatedBy: actor } });
      }
    }

    // Optional conductor pairing
    let conductorAssignment = null;
    const needConductor = !!includeConductor || !!settings?.conductorRequired;
    if (needConductor) {
      const conFilter = planningMode
        ? { isArchived: false, role: 'Conductor' }
        : { isArchived: false, status: 'Available', role: 'Conductor' };

      const conductors = useTxn
        ? await Crew.find(conFilter).session(session).lean()
        : await Crew.find(conFilter).lean();

      const conIds = conductors.map(c => c._id);
      const conOverlapsQ = { status: { $in: ['Planned','Live'] }, ...overlapsQuery(start, end), crewId: { $in: conIds } };
      const conOverlaps = useTxn
        ? await Assignment.find(conOverlapsQ).session(session).lean()
        : await Assignment.find(conOverlapsQ).lean();

      const conBusyMap = new Map();
      for (const a of conOverlaps) {
        const key = a.crewId?.toString();
        if (!key) continue;
        if (!conBusyMap.has(key)) conBusyMap.set(key, []);
        conBusyMap.get(key).push(a);
      }

      // Filter free conductors (no overlap + rest)
      const freeConductors = conductors
        .filter(c => !(conBusyMap.get(c._id.toString()) || []).length)
        .filter(c => {
          const minRest = settings?.minRestHours ?? 12;
          if (c.lastDutyEnd) {
            const minStart = new Date(c.lastDutyEnd);
            minStart.setHours(minStart.getHours() + minRest);
            if (start < minStart) return false;
          }
          return true;
        })
        .sort((a, b) => {
          const ra = a.lastDutyEnd ? new Date(a.lastDutyEnd).getTime() : 0;
          const rb = b.lastDutyEnd ? new Date(b.lastDutyEnd).getTime() : 0;
          return ra - rb;
        });

      for (const c of freeConductors) {
        const existingC = conBusyMap.get(c._id.toString()) || [];
        const crewCandidate = planningMode ? { ...c, status: 'Available' } : c;

        const conflicts = await evaluateConstraints({
          settings: planningMode ? { ...settings, freezeWindowHours: 0 } : settings,
          crew: crewCandidate,
          bus: chosen.bus,
          route,
          existingCrewAssignments: existingC,
          existingBusAssignments: [],
          proposal: { role: 'Conductor', startTime: start, endTime: end }
        });

        if (!conflicts.length) {
          const doc = {
            crewId: c._id, busId: chosen.bus._id, routeId: route._id,
            role: 'Conductor', startTime: start, endTime: end,
            status: 'Planned', batchId, scheduledDate, slotKey,
            createdBy: actor, updatedBy: actor
          };

          const [a2] = useTxn
            ? await Assignment.create([doc], { session })
            : await Assignment.create([doc]);

          conductorAssignment = a2;

          // Update lastDutyEnd for conductor
          if (useTxn) {
            if (!c.lastDutyEnd || end > new Date(c.lastDutyEnd)) {
              await Crew.findByIdAndUpdate(c._id, { $set: { lastDutyEnd: end, updatedBy: actor } }, { session });
            }
          } else {
            if (!c.lastDutyEnd || end > new Date(c.lastDutyEnd)) {
              await Crew.findByIdAndUpdate(c._id, { $set: { lastDutyEnd: end, updatedBy: actor } });
            }
          }
          break;
        }
      }

      if (!conductorAssignment && settings?.conductorRequired) {
        if (useTxn) await session.abortTransaction();
        return res.status(409).json({ error: 'No conductor available to satisfy conductorRequired' });
      }
    }

    if (useTxn) {
      await session.commitTransaction();
      session.endSession();
    }

    return res.status(201).json({
      bus: { _id: chosen.bus._id, busNumber: chosen.bus.busNumber, type: chosen.bus.type },
      driver: { _id: chosen.driver._id, name: chosen.driver.name },
      conductor: conductorAssignment ? { _id: conductorAssignment.crewId, name: 'Conductor' } : null,
      assignments: [driverAssignment, ...(conductorAssignment ? [conductorAssignment] : [])]
    });
  } catch (e) {
    if (session) {
      try { await session.abortTransaction(); } catch {}
      session.endSession();
    }
    return res.status(500).json({ error: e.message });
  }
};