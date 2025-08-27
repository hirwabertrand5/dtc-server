const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// -----------------------
// Middleware
// -----------------------
// Enable CORS for your frontend
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // set FRONTEND_URL=https://dtc-frontend.vercel.app in Render env
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// -----------------------
// Static files
// -----------------------
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// -----------------------
// Health check
// -----------------------
app.get('/', (req, res) => {
  res.send('✅ DTC Backend API is working!');
});

// -----------------------
// Safe route mounting helper
// -----------------------
function safeUse(mountPath, routerModule) {
  if (!routerModule) return;
  if (routerModule.default && typeof routerModule.default === 'function') {
    routerModule = routerModule.default;
  }
  if (typeof routerModule !== 'function') {
    console.error(`❌ Router for ${mountPath} is not a function. Got:`, routerModule);
    return;
  }
  app.use(mountPath, routerModule);
}

// -----------------------
// Import and mount routes
// -----------------------
const routeFiles = [
  ['userRoutes', '/api/users'],
  ['busRoutes', '/api/buses'],
  ['crewRoutes', '/api/crew'],
  ['dutyRoutes', '/api/duties'],
  ['routeRoutes', '/api/routes'],
  ['settingsRoutes', '/api/settings'],
  ['assignmentRoutes', '/api/assignments'],
  ['scheduleRoutes', '/api/schedule']
];

routeFiles.forEach(([file, mountPath]) => {
  try {
    const router = require(`./routes/${file}`);
    safeUse(mountPath, router);
  } catch (err) {
    console.warn(`⚠️ ${file} not found or failed to load. Skipping ${mountPath}`);
  }
});

// -----------------------
// Initialize counters
// -----------------------
const { initRouteCounter, initCrewCounter } = require('./utils/initCounters');

// -----------------------
// Connect to DB and start server
// -----------------------
connectDB()
  .then(async () => {
    console.log('✅ MongoDB connected');
    await initRouteCounter();
    await initCrewCounter();
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Failed to connect to DB:', err);
    process.exit(1);
  });
