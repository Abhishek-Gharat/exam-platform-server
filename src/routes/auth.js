var express = require('express');
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var db = require('../db');
var config = require('../config');
var { authenticate } = require('../middleware/auth');
var { validateLogin, validateRegister } = require('../utils/validation');

var router = express.Router();

function generateToken(userId) {
    return jwt.sign({ userId: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

function sanitizeUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        avatarUrl: row.avatar_url || null,
        joinedAt: row.joined_at,
        totalAttempts: row.total_attempts || 0
    };
}

router.post('/login', async function(req, res) {
    try {
        var errors = validateLogin(req.body);
        if (errors.length > 0) return res.status(400).json({ message: errors[0] });

        var result = await db.query('SELECT * FROM users WHERE email = \$1', [req.body.email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        var user = result.rows[0];
        var validPassword = await bcrypt.compare(req.body.password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        var token = generateToken(user.id);
        return res.json({ token: token, user: sanitizeUser(user) });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/register', async function(req, res) {
    try {
        var errors = validateRegister(req.body);
        if (errors.length > 0) return res.status(400).json({ message: errors[0] });

        var existing = await db.query('SELECT id FROM users WHERE email = \$1', [req.body.email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ message: 'Email already in use' });
        }

        var salt = await bcrypt.genSalt(10);
        var hash = await bcrypt.hash(req.body.password, salt);

        var result = await db.query(
            'INSERT INTO users (name, email, password_hash, role, status) VALUES (\$1, \$2, \$3, \$4, \$5) RETURNING *',
            [req.body.name, req.body.email, hash, 'STUDENT', 'active']
        );

        var user = result.rows[0];
        var token = generateToken(user.id);
        return res.status(201).json({ token: token, user: sanitizeUser(user) });
    } catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/me', authenticate, function(req, res) {
    return res.json({ user: sanitizeUser(req.user) });
});

module.exports = router;
