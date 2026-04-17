var express = require('express');
var db = require('../db');
var { authenticate, requireAdmin } = require('../middleware/auth');
var { validateExam } = require('../utils/validation');

var router = express.Router();

function formatExam(row) {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        timeLimitSecs: row.time_limit_secs,
        totalQuestions: row.total_questions,
        passingScore: row.passing_score,
        randomize: row.randomize,
        questionIds: row.question_ids || [],
        difficultyMix: row.difficulty_mix || {},
        totalAttempts: row.total_attempts || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

router.get('/published', authenticate, async function(req, res) {
    try {
        var result = await db.query('SELECT * FROM exams WHERE status = \$1 ORDER BY created_at DESC', ['PUBLISHED']);
        var exams = result.rows.map(formatExam);
        return res.json(exams);
    } catch (err) {
        console.error('Get published exams error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query('SELECT * FROM exams ORDER BY created_at DESC');
        var exams = result.rows.map(formatExam);
        return res.json(exams);
    } catch (err) {
        console.error('Get all exams error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/:id', authenticate, async function(req, res) {
    try {
        var result = await db.query('SELECT * FROM exams WHERE id = \$1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Exam not found' });
        return res.json(formatExam(result.rows[0]));
    } catch (err) {
        console.error('Get exam error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/', authenticate, requireAdmin, async function(req, res) {
    try {
        var errors = validateExam(req.body);
        if (errors.length > 0) return res.status(400).json({ message: errors[0] });

        var b = req.body;
        var result = await db.query(
            'INSERT INTO exams (title, description, status, time_limit_secs, total_questions, passing_score, randomize, question_ids, difficulty_mix) VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9) RETURNING *',
            [
                b.title, b.description || '', b.status || 'DRAFT',
                b.timeLimitSecs || 3600, b.totalQuestions || 0,
                b.passingScore || 60, b.randomize || false,
                JSON.stringify(b.questionIds || []),
                JSON.stringify(b.difficultyMix || {})
            ]
        );
        return res.status(201).json(formatExam(result.rows[0]));
    } catch (err) {
        console.error('Create exam error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:id', authenticate, requireAdmin, async function(req, res) {
    try {
        var b = req.body;
        var result = await db.query(
            'UPDATE exams SET title=\$1, description=\$2, time_limit_secs=\$3, total_questions=\$4, passing_score=\$5, randomize=\$6, question_ids=\$7, difficulty_mix=\$8, updated_at=NOW() WHERE id=\$9 RETURNING *',
            [
                b.title, b.description, b.timeLimitSecs || 3600,
                b.totalQuestions || 0, b.passingScore || 60,
                b.randomize || false,
                JSON.stringify(b.questionIds || []),
                JSON.stringify(b.difficultyMix || {}),
                req.params.id
            ]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Exam not found' });
        return res.json(formatExam(result.rows[0]));
    } catch (err) {
        console.error('Update exam error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query('DELETE FROM exams WHERE id = \$1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Exam not found' });
        return res.json({ message: 'Deleted' });
    } catch (err) {
        console.error('Delete exam error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.patch('/:id/publish', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query(
            'UPDATE exams SET status=\$1, updated_at=NOW() WHERE id=\$2 RETURNING *',
            ['PUBLISHED', req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Exam not found' });
        return res.json(formatExam(result.rows[0]));
    } catch (err) {
        console.error('Publish exam error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
