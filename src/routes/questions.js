var express = require('express');
var multer = require('multer');
var { parse } = require('csv-parse/sync');
var fs = require('fs');
var db = require('../db');
var { authenticate, requireAdmin } = require('../middleware/auth');
var { validateQuestion } = require('../utils/validation');

var router = express.Router();
var upload = multer({ dest: 'uploads/' });

function formatQuestion(row) {
    return {
        id: row.id,
        type: row.type,
        title: row.title,
        topic: row.topic,
        difficulty: row.difficulty,
        tags: row.tags || [],
        points: row.points,
        content: row.content,
        options: row.options || [],
        correctOption: row.correct_option,
        explanation: row.explanation,
        modelAnswer: row.model_answer,
        starterCode: row.starter_code,
        expectedOutput: row.expected_output,
        testCases: row.test_cases || [],
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

router.get('/', authenticate, async function(req, res) {
    try {
        var where = [];
        var params = [];
        var idx = 1;

        if (req.query.type) {
            where.push('type = $' + idx);
            params.push(req.query.type);
            idx++;
        }
        if (req.query.difficulty) {
            where.push('difficulty = $' + idx);
            params.push(req.query.difficulty);
            idx++;
        }
        if (req.query.search) {
            where.push('LOWER(title) LIKE $' + idx);
            params.push('%' + req.query.search.toLowerCase() + '%');
            idx++;
        }

        var whereClause = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';
        var page = parseInt(req.query.page) || 1;
        var limit = 10;
        var offset = (page - 1) * limit;

        var countResult = await db.query('SELECT COUNT(*) FROM questions' + whereClause, params);
        var total = parseInt(countResult.rows[0].count);

        var dataParams = params.slice();
        dataParams.push(limit);
        dataParams.push(offset);
        var dataResult = await db.query(
            'SELECT * FROM questions' + whereClause + ' ORDER BY created_at DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1),
            dataParams
        );

        return res.json({
            questions: dataResult.rows.map(formatQuestion),
            total: total,
            page: page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('Get questions error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/', authenticate, requireAdmin, async function(req, res) {
    try {
        var errors = validateQuestion(req.body);
        if (errors.length > 0) return res.status(400).json({ message: errors[0] });

        var b = req.body;
        var result = await db.query(
            'INSERT INTO questions (type, title, topic, difficulty, tags, points, content, options, correct_option, explanation, model_answer, starter_code, expected_output, test_cases) VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14) RETURNING *',
            [
                b.type, b.title, b.topic || '', b.difficulty || 'MEDIUM',
                JSON.stringify(b.tags || []), b.points || 10, b.content,
                JSON.stringify(b.options || []), b.correctOption || null,
                b.explanation || '', b.modelAnswer || '',
                b.starterCode || '', b.expectedOutput || '',
                JSON.stringify(b.testCases || [])
            ]
        );
        return res.status(201).json(formatQuestion(result.rows[0]));
    } catch (err) {
        console.error('Create question error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:id', authenticate, requireAdmin, async function(req, res) {
    try {
        var b = req.body;
        var result = await db.query(
            'UPDATE questions SET type=\$1, title=\$2, topic=\$3, difficulty=\$4, tags=\$5, points=\$6, content=\$7, options=\$8, correct_option=\$9, explanation=\$10, model_answer=\$11, starter_code=\$12, expected_output=\$13, test_cases=\$14, updated_at=NOW() WHERE id=\$15 RETURNING *',
            [
                b.type, b.title, b.topic, b.difficulty,
                JSON.stringify(b.tags || []), b.points || 10, b.content,
                JSON.stringify(b.options || []), b.correctOption || null,
                b.explanation || '', b.modelAnswer || '',
                b.starterCode || '', b.expectedOutput || '',
                JSON.stringify(b.testCases || []),
                req.params.id
            ]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'Question not found' });
        return res.json(formatQuestion(result.rows[0]));
    } catch (err) {
        console.error('Update question error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/:id', authenticate, requireAdmin, async function(req, res) {
    try {
        var result = await db.query('DELETE FROM questions WHERE id = \$1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Question not found' });
        return res.json({ message: 'Deleted' });
    } catch (err) {
        console.error('Delete question error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

router.post('/bulk-import', authenticate, requireAdmin, upload.single('file'), async function(req, res) {
    try {
        if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

        var fileContent = fs.readFileSync(req.file.path, 'utf-8');
        var imported = 0;
        var failed = 0;

        if (req.file.originalname.endsWith('.csv')) {
            var records = parse(fileContent, { columns: true, skip_empty_lines: true });
            for (var i = 0; i < records.length; i++) {
                try {
                    var r = records[i];
                    await db.query(
                        'INSERT INTO questions (type, title, topic, difficulty, points, content, options, correct_option, explanation) VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9)',
                        [
                            r.type || 'MCQ', r.title, r.topic || '',
                            r.difficulty || 'MEDIUM', parseInt(r.points) || 10,
                            r.content, JSON.stringify(r.options ? r.options.split('|') : []),
                            parseInt(r.correctOption) || 0, r.explanation || ''
                        ]
                    );
                    imported++;
                } catch (e) { failed++; }
            }
        } else if (req.file.originalname.endsWith('.json')) {
            var questions = JSON.parse(fileContent);
            if (!Array.isArray(questions)) questions = [questions];
            for (var j = 0; j < questions.length; j++) {
                try {
                    var q = questions[j];
                    await db.query(
                        'INSERT INTO questions (type, title, topic, difficulty, tags, points, content, options, correct_option, explanation, model_answer, starter_code, expected_output, test_cases) VALUES (\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13,\$14)',
                        [
                            q.type, q.title, q.topic || '', q.difficulty || 'MEDIUM',
                            JSON.stringify(q.tags || []), q.points || 10, q.content,
                            JSON.stringify(q.options || []), q.correctOption || null,
                            q.explanation || '', q.modelAnswer || '',
                            q.starterCode || '', q.expectedOutput || '',
                            JSON.stringify(q.testCases || [])
                        ]
                    );
                    imported++;
                } catch (e) { failed++; }
            }
        } else {
            return res.status(400).json({ message: 'Only CSV and JSON files are supported' });
        }

        fs.unlinkSync(req.file.path);
        return res.json({ imported: imported, failed: failed });
    } catch (err) {
        console.error('Bulk import error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
