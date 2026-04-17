var express = require('express');
var cors = require('cors');
var config = require('./config');

var authRoutes = require('./routes/auth');
var examsRoutes = require('./routes/exams');
var questionsRoutes = require('./routes/questions');
var attemptsRoutes = require('./routes/attempts');
var analyticsRoutes = require('./routes/analytics');
const aiRoutes = require('./routes/ai');
const executeRoutes = require('./routes/execute');

var app = express();

app.use(cors({
  origin: [
    'http://localhost:3000',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', function(req, res) {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
app.use('/api/ai', aiRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/exams', examsRoutes);
app.use('/api/questions', questionsRoutes);
app.use('/api/attempts', attemptsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/execute', executeRoutes);
app.use(function(err, req, res, next) {
    console.error('Unhandled error:', err);
    res.status(500).json({ message: 'Internal server error' });
});

app.listen(config.port, function() {
    console.log('Server running on port ' + config.port);
});
