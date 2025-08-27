const dayjs = require('dayjs');

function overlaps(aStart, aEnd, bStart, bEnd) {
  return dayjs(aStart).isBefore(bEnd) && dayjs(bStart).isBefore(aEnd);
}

function diffHours(a, b) {
  return dayjs(b).diff(dayjs(a), 'hour', true);
}

async function evaluateConstraints({
  settings,
  crew,
  bus,
  route,
  existingCrewAssignments,
  existingBusAssignments,
  proposal
}, options = {}) {
  const reasons = [];
  const { role, startTime, endTime } = proposal;

  // Planning-mode toggles
  const {
    skipCrewStatus = false,   // ignore crew.status check (for batch/offline planning)
    ignoreFreezeWindow = false
  } = options;

  const minRestHours = settings?.minRestHours ?? 12;
  const maxShiftHours = settings?.maxShiftHours ?? 8;
  const maxWeeklyHours = settings?.maxWeeklyHours ?? 48;
  const freezeWindowHours = settings?.freezeWindowHours ?? 0;
  const conductorRequired = settings?.conductorRequired ?? false;

  if (!crew) reasons.push('Crew not found');
  if (!bus) reasons.push('Bus not found');
  if (!route) reasons.push('Route not found');
  if (reasons.length) return reasons;

  if (!skipCrewStatus && crew.status && crew.status !== 'Available') {
    reasons.push(`Crew status is ${crew.status}`);
  }

  if (['Maintenance','Out of Service'].includes(bus.status)) reasons.push(`Bus unavailable (${bus.status})`);

  if (existingCrewAssignments?.some(a => ['Planned','Live'].includes(a.status) && overlaps(startTime, endTime, a.startTime, a.endTime)))
    reasons.push('Crew has overlapping assignment');
  if (existingBusAssignments?.some(a => ['Planned','Live'].includes(a.status) && overlaps(startTime, endTime, a.startTime, a.endTime)))
    reasons.push('Bus has overlapping assignment');

  if (crew.lastDutyEnd) {
    const minStart = dayjs(crew.lastDutyEnd).add(minRestHours, 'hour');
    if (dayjs(startTime).isBefore(minStart)) reasons.push(`Min rest ${minRestHours}h not met`);
  }

  const shiftHours = diffHours(startTime, endTime);
  if (shiftHours > maxShiftHours) reasons.push(`Shift exceeds ${maxShiftHours}h`);

  if (existingCrewAssignments?.length) {
    const weekAgo = dayjs(startTime).subtract(7, 'day');
    const weekly = existingCrewAssignments
      .filter(a => dayjs(a.startTime).isAfter(weekAgo))
      .reduce((acc, a) => acc + diffHours(a.startTime, a.endTime), 0);
    if (weekly + shiftHours > maxWeeklyHours) reasons.push(`Weekly hours would exceed ${maxWeeklyHours}h`);
  }

  const requiredType = route?.busTypeRequired || null;
  if (role === 'Driver' && requiredType) {
    const quals = Array.isArray(crew.qualifications) ? crew.qualifications : [];
    if (quals.length > 0 && !quals.includes(requiredType)) reasons.push(`Driver not qualified for ${requiredType}`);
  }

  if (Array.isArray(bus.maintenanceWindows)) {
    if (bus.maintenanceWindows.some(mw => mw.status !== 'Completed' && overlaps(startTime, endTime, mw.startTime, mw.endTime)))
      reasons.push('Bus in maintenance window');
  }

  if (!ignoreFreezeWindow && freezeWindowHours && dayjs(startTime).diff(dayjs(), 'hour', true) < freezeWindowHours)
    reasons.push(`Inside freeze window (${freezeWindowHours}h)`);

  // Note: we do NOT block drivers when conductorRequired is true; pairing is handled in generator.
  return reasons;
}

module.exports = { evaluateConstraints, overlaps };