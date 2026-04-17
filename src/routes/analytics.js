var express = require('express');
var db = require('../db');
var { authenticate, requireAdmin } = require('../middleware/auth');

var router = express.Router();

router.get('/overview', authenticate, requireAdmin, async function(req, res) {
    try {
        var students = await db.query("SELECT COUNT(*) FROM users WHERE role = 'STUDENT'");
        var exams = await db.query('SELECT COUNT(*) FROM exams');
        var attempts = await db.query('SELECT COUNT(*) FROM attempts WHERE status = \$1', ['COMPLETED']);
        var passedAttempts = await db.query('SELECT COUNT(*) FROM attempts WHERE passed = true');
        var totalAttempts = parseInt(attempts.rows[0].count) || 1;
        var passRate = Math.round((parseInt(passedAttempts.rows[0].count) / totalAttempts) * 100);

        return res.json({
            totalStudents: parseInt(students.rows[0].count),
            totalExams: parseInt(exams.rows[0].count),
            totalAttempts: parseInt(attempts.rows[0].count),
            overallPassRate: passRate
        });
    } catch (err) {
        console.error('Analytics overview error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/exams/:examId', authenticate, requireAdmin, async function(req, res) {
    try {
        var examId = req.params.examId;
        var attemptsResult = await db.query('SELECT * FROM attempts WHERE exam_id = \$1 AND status = \$2', [examId, 'COMPLETED']);
        var rows = attemptsResult.rows;

        var totalAttempts = rows.length;
        var passedCount = rows.filter(function(r) { return r.passed; }).length;
        var passRate = totalAttempts > 0 ? Math.round((passedCount / totalAttempts) * 100) : 0;
        var avgScore = totalAttempts > 0 ? Math.round(rows.reduce(function(sum, r) { return sum + r.score; }, 0) / totalAttempts) : 0;

        var distribution = [
            { range: '0-20', count: 0 }, { range: '21-40', count: 0 },
            { range: '41-60', count: 0 }, { range: '61-80', count: 0 },
            { range: '81-100', count: 0 }
        ];
        for (var i = 0; i < rows.length; i++) {
            var s = rows[i].score;
            if (s <= 20) distribution[0].count++;
            else if (s <= 40) distribution[1].count++;
            else if (s <= 60) distribution[2].count++;
            else if (s <= 80) distribution[3].count++;
            else distribution[4].count++;
        }

        var sorted = rows.slice().sort(function(a, b) { return b.score - a.score; });
        var leaderboard = [];
        for (var j = 0; j < Math.min(sorted.length, 10); j++) {
            var userResult = await db.query('SELECT name FROM users WHERE id = \$1', [sorted[j].user_id]);
            leaderboard.push({
                rank: j + 1,
                name: userResult.rows.length > 0 ? userResult.rows[0].name : 'Unknown',
                score: sorted[j].score,
                timeTaken: sorted[j].time_taken
            });
        }

        return res.json({
            examId: examId, passRate: passRate, averageScore: avgScore,
            totalAttempts: totalAttempts, scoreDistribution: distribution,
            leaderboard: leaderboard
        });
    } catch (err) {
        console.error('Exam analytics error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/topics', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query('SELECT topic, COUNT(*) as total_questions FROM questions GROUP BY topic ORDER BY topic');
        var topics = result.rows.map(function(r) {
            return { topic: r.topic || 'Uncategorized', avgScore: 0, totalQuestions: parseInt(r.total_questions) };
        });
        return res.json(topics);
    } catch (err) {
        console.error('Topic analytics error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/exam-scores', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query(
            "SELECT e.title as name, COALESCE(AVG(a.score), 0) as avg_score FROM exams e LEFT JOIN attempts a ON a.exam_id = e.id AND a.status = 'COMPLETED' GROUP BY e.id, e.title ORDER BY e.title"
        );
        var data = result.rows.map(function(r) {
            return { name: r.name, avgScore: Math.round(parseFloat(r.avg_score)) };
        });
        return res.json(data);
    } catch (err) {
        console.error('Exam scores error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/attempts-per-day', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query(
            "SELECT DATE(submitted_at) as date, COUNT(*) as attempts FROM attempts WHERE submitted_at IS NOT NULL AND submitted_at >= NOW() - INTERVAL '30 days' GROUP BY DATE(submitted_at) ORDER BY date"
        );
        var data = result.rows.map(function(r) {
            return { date: r.date.toISOString().split('T')[0], attempts: parseInt(r.attempts) };
        });
        return res.json(data);
    } catch (err) {
        console.error('Attempts per day error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/question-types', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query('SELECT type, COUNT(*) as value FROM questions GROUP BY type');
        var mapping = { 'MCQ': 'MCQ', 'EXPLAIN_ME': 'Explain Me', 'WRITE_CODE': 'Write Code' };
        var data = result.rows.map(function(r) {
            return { name: mapping[r.type] || r.type, value: parseInt(r.value) };
        });
        return res.json(data);
    } catch (err) {
        console.error('Question types error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.get('/export/:examId', authenticate, requireAdmin, async function(req, res) {
    try {
        var examId = req.params.examId;
        var rows = (await db.query(
            "SELECT a.score, a.time_taken, u.name FROM attempts a JOIN users u ON a.user_id = u.id WHERE a.exam_id = \$1 AND a.status = 'COMPLETED' ORDER BY a.score DESC",
            [examId]
        )).rows;

        var csv = 'Rank,Name,Score,TimeTaken\n';
        for (var i = 0; i < rows.length; i++) {
            csv += (i + 1) + ',' + rows[i].name + ',' + rows[i].score + ',' + rows[i].time_taken + '\n';
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=results-' + examId + '.csv');
        return res.send(csv);
    } catch (err) {
        console.error('Export error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
