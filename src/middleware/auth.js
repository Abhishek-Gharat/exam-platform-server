var jwt = require('jsonwebtoken');
var config = require('../config');
var db = require('../db');

var authenticate = async function(req, res, next) {
    try {
        var authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token provided' });
        }
        var token = authHeader.split(' ')[1];
        var decoded = jwt.verify(token, config.jwtSecret);
        var result = await db.query('SELECT id, name, email, role, status, avatar_url, joined_at, total_attempts FROM users WHERE id = \$1', [decoded.userId]);
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }
        req.user = result.rows[0];
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

var requireAdmin = function(req, res, next) {
    if (!req.user || req.user.role !== 'ADMIN') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

module.exports = { authenticate: authenticate, requireAdmin: requireAdmin };
