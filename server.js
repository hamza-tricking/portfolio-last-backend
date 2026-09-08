require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

const app = express();

app.use(cors({
  origin: [
    'https://hamza.dmtart.pro',
    'https://hamza-portfolio-lemon.vercel.app',
    'http://localhost:3000',
  ],
  credentials: true,
}));
app.use(express.json());

// Serve static assets with CORS and 1-year immutable caching
const staticOptions = {
  maxAge: '1y',
  immutable: true,
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Timing-Allow-Origin', '*');
  },
};
app.use(express.static(path.join(__dirname, 'public'), staticOptions));
app.use('/assets', express.static(path.join(__dirname, 'public'), staticOptions));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/referrals', require('./routes/referral'));
app.use('/api/qa', require('./routes/qa'));
app.use('/api/leaks', require('./routes/leaks'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
