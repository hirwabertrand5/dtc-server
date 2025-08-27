const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/reports', require('./routes/reports'));
// Health check
app.get('/', (req, res) => {
  res.send('✅ DTC Backend API is working!');
});

// Helper to safely mount routers and report issues
function safeUse(mountPath, routerModule) {
  if (!routerModule) {
    console.error(`❌ Router for ${mountPath} is missing (undefined). Check your require path and export.`);
    process.exit(1);
  }
  if (routerModule.default && typeof routerModule.default === 'function') {
    routerModule = routerModule.default;
  }
  if (typeof routerModule !== 'function') {
    console.error(`❌ Router for ${mountPath} is not a function. Got:`, routerModule);
    console.error('   Make sure your routes file ends with: module.exports = router');
    process.exit(1);
  }
  app.use(mountPath, routerModule);
}

// Import routes with try/catch for clearer errors
let userRoutes, busRoutes, crewRoutes, dutyRoutes, routeRoutes, settingsRoutes, assignmentRoutes, scheduleRoutes;

try { userRoutes = require('./routes/userRoutes'); } catch (e) { console.error('❌ Failed to require userRoutes:', e.message); process.exit(1); }
try { busRoutes = require('./routes/busRoutes'); } catch (e) { console.error('❌ Failed to require busRoutes:', e.message); process.exit(1); }
try { crewRoutes = require('./routes/crewRoutes'); } catch (e) { console.error('❌ Failed to require crewRoutes:', e.message); process.exit(1); }
try { dutyRoutes = require('./routes/dutyRoutes'); } catch (e) { console.error('❌ Failed to require dutyRoutes:', e.message); process.exit(1); }
try { routeRoutes = require('./routes/routeRoutes'); } catch (e) { console.error('❌ Failed to require routeRoutes:', e.message); process.exit(1); }
try { settingsRoutes = require('./routes/settingsRoutes'); } catch (e) { settingsRoutes = null; console.warn('⚠️ settingsRoutes not found; skipping /api/settings'); }
try { assignmentRoutes = require('./routes/assignmentRoutes'); } catch (e) { assignmentRoutes = null; console.warn('⚠️ assignmentRoutes not found; skipping /api/assignments'); }
try { scheduleRoutes = require('./routes/scheduleRoutes'); } catch (e) { scheduleRoutes = null; console.warn('⚠️ scheduleRoutes not found; skipping /api/schedule'); }

// Mount routes
safeUse('/api/users', userRoutes);
safeUse('/api/buses', busRoutes);
safeUse('/api/crew', crewRoutes);
safeUse('/api/duties', dutyRoutes);
safeUse('/api/routes', routeRoutes);
if (settingsRoutes) safeUse('/api/settings', settingsRoutes);
if (assignmentRoutes) safeUse('/api/assignments', assignmentRoutes);
if (scheduleRoutes) safeUse('/api/schedule', scheduleRoutes);

// Init counters
const { initRouteCounter, initCrewCounter } = require('./utils/initCounters');

// DB then start server
connectDB().then(async () => {
  await initRouteCounter();
  await initCrewCounter();
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('❌ Failed to connect to DB:', err);
  process.exit(1);
});