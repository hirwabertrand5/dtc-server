const dayjs = require('dayjs');
const minMax = require('dayjs/plugin/minMax');
dayjs.extend(minMax);

const Assignment = require('../models/Assignment');
const AdminSettings = require('../models/AdminSettings');
const Bus = require('../models/Bus');
const Crew = require('../models/Crew');

// Safe helpers (work with or without minMax plugin)
const dMax = (...args) => (dayjs.max ? dayjs.max(...args) : args.reduce((a, b) => (a.isAfter(b) ? a : b)));
const dMin = (...args) => (dayjs.min ? dayjs.min(...args) : args.reduce((a, b) => (a.isBefore(b) ? a : b)));

function toKey(d) { return dayjs(d).format('YYYY-MM-DD'); }

function daysBetween(start, end) {
  const out = [];
  let cur = dayjs(start).startOf('day');
  const last = dayjs(end).startOf('day');
  while (cur.isBefore(last) || cur.isSame(last)) {
    out.push(cur.format('YYYY-MM-DD'));
    cur = cur.add(1, 'day');
  }
  return out;
}

function clipHoursToDay(aStart, aEnd, dayKey) {
  const s = dayjs(dayKey).startOf('day');
  const e = s.add(1, 'day');
  const start = dMax(dayjs(aStart), s);
  const end   = dMin(dayjs(aEnd), e);
  const h = end.diff(start, 'hour', true);
  return h > 0 ? h : 0;
}

function categorizeConflict(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('rest')) return 'Rest';
  if (m.includes('overlap') && m.includes('crew')) return 'Crew overlap';
  if (m.includes('overlap') && m.includes('bus')) return 'Bus overlap';
  if (m.includes('maintenance')) return 'Maintenance';
  if (m.includes('freeze')) return 'Freeze window';
  if (m.includes('qualified')) return 'Qualification';
  if (m.includes('weekly')) return 'Weekly hours';
  return 'Other';
}

async function computeRange(start, end) {
  const rangeDays = daysBetween(start, end);
  const rangeStart = dayjs(start).startOf('day').toDate();
  const rangeEnd = dayjs(end).endOf('day').toDate();

  const settings = await AdminSettings.findOne().lean();
  const maxShiftHours = settings?.maxShiftHours ?? 8;

  const operationalBusQuery = { isArchived: false, status: { $nin: ['Maintenance','Out of Service'] } };

  // Only count Driver assignments to avoid double counting with conductors
  const [assignments, totalOperationalBuses, driverCount] = await Promise.all([
    Assignment.find({
      role: 'Driver',
      startTime: { $lt: rangeEnd },
      endTime: { $gt: rangeStart },
      status: { $in: ['Planned','Live','Completed'] }
    }, { crewId: 1, busId: 1, startTime: 1, endTime: 1, conflicts: 1, createdAt: 1, updatedAt: 1 }).lean(),
    Bus.countDocuments(operationalBusQuery),
    Crew.countDocuments({ role: 'Driver', isArchived: false })
  ]);

  // Duty usage
  const dutyUsageByDay = rangeDays.map(d => ({
    date: d,
    dutyHours: 0,
    availableHours: driverCount * maxShiftHours
  }));
  const dutyMap = Object.fromEntries(dutyUsageByDay.map(r => [r.date, r]));

  // Overlaps and fleet utilization structures
  const overlapsByDay = Object.fromEntries(rangeDays.map(d => [d, 0]));
  const crewDayBuckets = {}; // date|crewId -> [{s,e}]
  const busDayBuckets = {};  // date|busId  -> [{s,e}]

  const fleetDaily = rangeDays.map(d => ({ date: d, used: 0, total: totalOperationalBuses || 0, utilizationPct: 0 }));
  const fleetUsedSets = Object.fromEntries(rangeDays.map(d => [d, new Set()]));

  // Conflicts
  const conflictBreakdown = {};
  let newConflicts24h = 0;
  const since24h = dayjs().subtract(24, 'hour');

  for (const a of assignments) {
    const aStart = a.startTime;
    const aEnd = a.endTime;

    // Allocate hours and buckets across days
    let cur = dayjs(aStart).startOf('day');
    const last = dayjs(aEnd).startOf('day');
    while (cur.isBefore(last) || cur.isSame(last)) {
      const key = cur.format('YYYY-MM-DD');
      if (dutyMap[key]) {
        dutyMap[key].dutyHours += clipHoursToDay(aStart, aEnd, key);
        if (a.busId) fleetUsedSets[key].add(String(a.busId));

        const ck = `${key}|${a.crewId || 'NA'}`;
        (crewDayBuckets[ck] ||= []).push({ s: aStart, e: aEnd });
        const bk = `${key}|${a.busId || 'NA'}`;
        (busDayBuckets[bk] ||= []).push({ s: aStart, e: aEnd });
      }
      cur = cur.add(1, 'day');
    }

    // Conflicts
    if (Array.isArray(a.conflicts) && a.conflicts.length) {
      for (const msg of a.conflicts) {
        const cat = categorizeConflict(msg);
        conflictBreakdown[cat] = (conflictBreakdown[cat] || 0) + 1;
      }
      if (dayjs(a.createdAt).isAfter(since24h) || dayjs(a.updatedAt).isAfter(since24h)) {
        newConflicts24h += 1;
      }
    }
  }

  // Compute fleet utilization per day
  for (const d of rangeDays) {
    const used = fleetUsedSets[d].size;
    const total = fleetDaily.find(r => r.date === d)?.total || 0;
    const pct = total ? (used / total) * 100 : 0;
    const row = fleetDaily.find(r => r.date === d);
    if (row) { row.used = used; row.utilizationPct = pct; }
  }

  // Count overlaps
  function countOverlaps(list) {
    if (!list || list.length <= 1) return 0;
    list.sort((a, b) => new Date(a.s) - new Date(b.s));
    let count = 0;
    let lastEnd = null;
    for (const it of list) {
      if (lastEnd && dayjs(it.s).isBefore(dayjs(lastEnd))) count++;
      lastEnd = dMax(dayjs(lastEnd || it.e), dayjs(it.e)).toDate();
    }
    return count;
  }

  for (const [key, list] of Object.entries(crewDayBuckets)) {
    const date = key.split('|')[0];
    overlapsByDay[date] = (overlapsByDay[date] || 0) + countOverlaps(list);
  }
  for (const [key, list] of Object.entries(busDayBuckets)) {
    const date = key.split('|')[0];
    overlapsByDay[date] = (overlapsByDay[date] || 0) + countOverlaps(list);
  }

  const overlapByDay = rangeDays.map(d => ({ date: d, count: overlapsByDay[d] || 0 }));
  const avgFleetUtil = fleetDaily.reduce((a, r) => a + r.utilizationPct, 0) / (fleetDaily.length || 1);

  return {
    range: { start: toKey(start), end: toKey(end), days: rangeDays },
    dutyUsageByDay: Object.values(dutyMap),
    overlapByDay,
    conflictSummary: { breakdown: conflictBreakdown, newLast24h: newConflicts24h },
    fleet: { daily: fleetDaily, averageUtilizationPct: avgFleetUtil }
  };
}

exports.summary = async (req, res) => {
  try {
    const startQ = req.query.start || dayjs().subtract(6, 'day').format('YYYY-MM-DD');
    const endQ = req.query.end || dayjs().format('YYYY-MM-DD');

    const cur = await computeRange(startQ, endQ);

    // Compare to previous period of equal length
    const days = cur.range.days.length;
    const prevEnd = dayjs(startQ).subtract(1, 'day').format('YYYY-MM-DD');
    const prevStart = dayjs(prevEnd).subtract(days - 1, 'day').format('YYYY-MM-DD');
    const prev = await computeRange(prevStart, prevEnd);

    const curDutyTotal = cur.dutyUsageByDay.reduce((a, r) => a + r.dutyHours, 0);
    const prevDutyTotal = prev.dutyUsageByDay.reduce((a, r) => a + r.dutyHours, 0);
    const dutyPctVsPrev = prevDutyTotal ? ((curDutyTotal - prevDutyTotal) / prevDutyTotal) * 100 : 0;

    const curOverlap = cur.overlapByDay.reduce((a, r) => a + r.count, 0);
    const prevOverlap = prev.overlapByDay.reduce((a, r) => a + r.count, 0);
    const overlapPctChange = prevOverlap ? ((curOverlap - prevOverlap) / prevOverlap) * 100 : 0;

    const fleetPctPrev = prev.fleet.averageUtilizationPct || 0;
    const fleetPctCur = cur.fleet.averageUtilizationPct || 0;
    const fleetCompare = fleetPctPrev ? (fleetPctCur - fleetPctPrev) : fleetPctCur;

    return res.json({
      ...cur,
      kpis: {
        dutyPctVsPrev: dutyPctVsPrev,
        overlapPctChange: overlapPctChange
      },
      fleet: {
        ...cur.fleet,
        comparePctVsPrev: fleetCompare
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};