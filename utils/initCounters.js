const Counter = require('../models/Counter');
const Route = require('../models/Route');
const Crew = require('../models/Crew');

function extractMax(list, field, re) {
  let max = 0;
  for (const doc of list) {
    const v = doc[field];
    if (typeof v !== 'string') continue;
    const m = v.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return max;
}

async function initRouteCounter() {
  const existing = await Counter.findOne({ name: 'routeNumber' });
  if (existing) return;
  const routes = await Route.find({}, { routeNumber: 1 }).lean();
  const max = extractMax(routes, 'routeNumber', /^DTC-R(\d+)$/);
  await Counter.create({ name: 'routeNumber', seq: max });
  console.log(`Initialized routeNumber counter at ${max}`);
}

async function initCrewCounter() {
  const existing = await Counter.findOne({ name: 'crewId' });
  if (existing) return;
  const crews = await Crew.find({}, { crewId: 1 }).lean();
  const max = extractMax(crews, 'crewId', /^DTC-C(\d+)$/);
  await Counter.create({ name: 'crewId', seq: max });
  console.log(`Initialized crewId counter at ${max}`);
}

module.exports = { initRouteCounter, initCrewCounter };