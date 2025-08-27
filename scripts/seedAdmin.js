const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const bcrypt = require('bcryptjs');

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    const hashedPassword = await bcrypt.hash('admin123', 10);

    const admin = new User({
      name: 'Admin User',
      email: 'admin@dtc.com',
      password: hashedPassword,
      role: 'Admin',
    });

    await admin.save();
    console.log('✅ Admin user created');
    process.exit();
  })
  .catch(err => console.error(err));
