var express = require('express');
var db = require('../db');
var { authenticate } = require('../middleware/auth');
var aiService = require('../services/aiService');

var router = express.Router();

function formatAttempt(row) {
    return {
        id: row.id,
        examId: row.exam_id,
        userId: row.user_id,
        examTitle: row.exam_title,
        score: row.score,
        totalScore: row.total_score,
        maxScore: row.max_score,
        passed: row.passed,
        timeTaken: row.time_taken,
        submittedAt: row.submitted_at,
        tabSwitchCount: row.tab_switch_count,
        questionResults: row.question_results || [],
        status: row.status,
        createdAt: row.created_at
    };
}

function stripAnswers(q) {
    return {
        id: q.id,
        type: q.type,
        title: q.title,
        topic: q.topic,
        difficulty: q.difficulty,
        tags: q.tags || [],
        points: q.points,
        content: q.content,
        options: q.options || [],
        starterCode: q.starter_code || q.starterCode || ''
    };
}

// ==================== POST /start ====================
router.post('/start', authenticate, async function(req, res) {
    try {
        var examId = req.body.examId;
        if (!examId) return res.status(400).json({ message: 'examId is required' });

        var examResult = await db.query('SELECT * FROM exams WHERE id = \$1', [examId]);
        if (examResult.rows.length === 0) return res.status(404).json({ message: 'Exam not found' });

        var exam = examResult.rows[0];
        var questionIds = exam.question_ids || [];
        var questions = [];

        if (questionIds.length > 0) {
            var qResult = await db.query('SELECT * FROM questions WHERE id = ANY(\$1)', [questionIds]);
            questions = qResult.rows;
            if (exam.randomize) {
                for (var i = questions.length - 1; i > 0; i--) {
                    var j = Math.floor(Math.random() * (i + 1));
                    var temp = questions[i];
                    questions[i] = questions[j];
                    questions[j] = temp;
                }
            }
        }

        var cleanQuestions = questions.map(stripAnswers);

        var attemptResult = await db.query(
            'INSERT INTO attempts (exam_id, user_id, exam_title, status) VALUES (\$1, \$2, \$3, \$4) RETURNING *',
            [examId, req.user.id, exam.title, 'IN_PROGRESS']
        );

        var attempt = attemptResult.rows[0];

        return res.status(201).json({
            attemptId: attempt.id,
            examId: examId,
            questions: cleanQuestions,
            timeLimitSecs: exam.time_limit_secs,
            examMeta: {
                title: exam.title,
                timeLimitSecs: exam.time_limit_secs,
                totalQuestions: cleanQuestions.length
            }
        });
    } catch (err) {
        console.error('Start attempt error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

// ==================== GET /all (ADMIN ONLY) ====================
router.get('/all', authenticate, async function(req, res) {
    try {
        if (req.user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Admin only' });
        }
        var result = await db.query(
            'SELECT a.*, u.name as user_name FROM attempts a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC LIMIT 50'
        );
        var formatted = result.rows.map(function(row) {
            var attempt = formatAttempt(row);
            attempt.userName = row.user_name || 'Unknown';
            return attempt;
        });
        return res.json(formatted);
    } catch (err) {
        console.error('Get all attempts error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

// ==================== GET /my ====================
router.get('/my', authenticate, async function(req, res) {
    try {
        var result = await db.query('SELECT * FROM attempts WHERE user_id = \$1 ORDER BY created_at DESC', [req.user.id]);
        return res.json(result.rows.map(formatAttempt));
    } catch (err) {
        console.error('Get my attempts error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

// ==================== POST /:attemptId/submit ====================
router.post('/:attemptId/submit', authenticate, async function(req, res) {
    try {
        var attemptId = req.params.attemptId;
        var answers = req.body.answers || {};
        var tabSwitchCount = req.body.tabSwitchCount || 0;

        var attemptResult = await db.query('SELECT * FROM attempts WHERE id = \$1 AND user_id = \$2', [attemptId, req.user.id]);
        if (attemptResult.rows.length === 0) return res.status(404).json({ message: 'Attempt not found' });

        var attempt = attemptResult.rows[0];
        var examResult = await db.query('SELECT * FROM exams WHERE id = \$1', [attempt.exam_id]);
        var exam = examResult.rows.length > 0 ? examResult.rows[0] : null;
        var questionIds = exam ? (exam.question_ids || []) : [];

        var questions = [];
        if (questionIds.length > 0) {
            var qResult = await db.query('SELECT * FROM questions WHERE id = ANY(\$1)', [questionIds]);
            questions = qResult.rows;
        }

        var totalScore = 0;
        var maxScore = 0;
        var questionResults = [];

        // Collect EXPLAIN_ME questions for AI grading
        var explainItems = [];
        for (var i = 0; i < questions.length; i++) {
            var question = questions[i];
            var answer = answers[question.id];
            if (question.type === 'EXPLAIN_ME' && answer && answer.writtenAnswer) {
                explainItems.push({ question: question, answerText: answer.writtenAnswer });
            }
        }

        // AI grade EXPLAIN_ME questions in parallel
        var aiGrades = {};
        if (explainItems.length > 0) {
            console.log('AI Grading ' + explainItems.length + ' EXPLAIN_ME question(s)...');

            var gradePromises = explainItems.map(function(item) {
                return aiService.gradeExplainAnswer(item.question, item.answerText)
                    .then(function(grade) {
                        return { questionId: item.question.id, grade: grade };
                    })
                    .catch(function(err) {
                        console.error('AI grade failed for question ' + item.question.id + ':', err.message);
                        return { questionId: item.question.id, grade: { score: 0, feedback: 'Grading failed.' } };
                    });
            });

            var gradeResults = await Promise.all(gradePromises);
            for (var g = 0; g < gradeResults.length; g++) {
                aiGrades[gradeResults[g].questionId] = gradeResults[g].grade;
            }
            console.log('AI Grading complete.');
        }

        // Grade all questions
        for (var i = 0; i < questions.length; i++) {
            var question = questions[i];
            var answer = answers[question.id];
            var points = question.points || 10;
            maxScore += points;

            var isCorrect = false;
            var earnedPoints = 0;
            var aiFeedback = null;

            if (answer) {
                if (question.type === 'MCQ') {
                    // MCQ: check correct_option (0-based)
                    isCorrect = answer.selectedOption === question.correct_option;
                    earnedPoints = isCorrect ? points : 0;

                } else if (question.type === 'WRITE_CODE') {
                    // WRITE_CODE: output prediction — same as MCQ grading
                    isCorrect = answer.selectedOption === question.correct_option;
                    earnedPoints = isCorrect ? points : 0;

                } else if (question.type === 'EXPLAIN_ME') {
                    // EXPLAIN_ME: AI grading
                    var aiGrade = aiGrades[question.id];
                    if (aiGrade) {
                        earnedPoints = aiGrade.score;
                        aiFeedback = aiGrade.feedback;
                        isCorrect = earnedPoints >= (points * 0.7);
                    } else {
                        earnedPoints = 0;
                        isCorrect = false;
                        aiFeedback = 'No answer provided.';
                    }
                }
            }

            totalScore += earnedPoints;

            var resultEntry = {
                questionId: question.id,
                question: {
                    id: question.id,
                    type: question.type,
                    title: question.title,
                    content: question.content,
                    points: question.points,
                    correctOption: question.correct_option,
                    explanation: question.explanation,
                    modelAnswer: question.model_answer,
                    expectedOutput: question.expected_output,
                    options: question.options,
                    starterCode: question.starter_code
                },
                answer: answer || null,
                isCorrect: isCorrect,
                pointsEarned: earnedPoints,
                pointsMax: points
            };

            if (question.type === 'EXPLAIN_ME' && aiFeedback) {
                resultEntry.aiFeedback = aiFeedback;
            }

            questionResults.push(resultEntry);
        }

        var pct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
        var passed = pct >= (exam ? exam.passing_score : 60);
        var timeTaken = Math.floor((Date.now() - new Date(attempt.created_at).getTime()) / 1000);

        await db.query(
            'UPDATE attempts SET score=\$1, total_score=\$2, max_score=\$3, passed=\$4, time_taken=\$5, submitted_at=NOW(), tab_switch_count=\$6, answers=\$7, question_results=\$8, status=\$9, updated_at=NOW() WHERE id=\$10',
            [pct, totalScore, maxScore, passed, timeTaken, tabSwitchCount, JSON.stringify(answers), JSON.stringify(questionResults), 'COMPLETED', attemptId]
        );

        await db.query('UPDATE users SET total_attempts = total_attempts + 1 WHERE id = \$1', [req.user.id]);
        await db.query('UPDATE exams SET total_attempts = total_attempts + 1 WHERE id = \$1', [attempt.exam_id]);

        return res.json({
            attemptId: attemptId,
            score: pct,
            totalScore: totalScore,
            maxScore: maxScore,
            passed: passed,
            timeTaken: timeTaken,
            submittedAt: new Date().toISOString(),
            tabSwitchCount: tabSwitchCount,
            questionResults: questionResults
        });
    } catch (err) {
        console.error('Submit attempt error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

// ==================== GET /:id/result ====================
router.get('/:id/result', authenticate, async function(req, res) {
    try {
        var result = await db.query('SELECT * FROM attempts WHERE id = \$1 AND user_id = \$2', [req.params.id, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Attempt not found' });
        return res.json(formatAttempt(result.rows[0]));
    } catch (err) {
        console.error('Get result error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

// ==================== PATCH /:attemptId/autosave ====================
router.patch('/:attemptId/autosave', authenticate, async function(req, res) {
    try {
        var attemptId = req.params.attemptId;
        var questionId = req.body.questionId;
        var answer = req.body.answer;

        var result = await db.query('SELECT answers FROM attempts WHERE id = \$1 AND user_id = \$2', [attemptId, req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'Attempt not found' });

        var answers = result.rows[0].answers || {};
        answers[questionId] = answer;

        await db.query('UPDATE attempts SET answers = \$1, updated_at = NOW() WHERE id = \$2', [JSON.stringify(answers), attemptId]);
        return res.json({ saved: true });
    } catch (err) {
        console.error('Autosave error:', err);
        return res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;