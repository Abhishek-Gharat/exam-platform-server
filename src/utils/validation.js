var validateEmail = function(email) {
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

var validateRegister = function(body) {
    var errors = [];
    if (!body.name || body.name.trim().length < 2) errors.push('Name must be at least 2 characters');
    if (!body.email || !validateEmail(body.email)) errors.push('Valid email is required');
    if (!body.password || body.password.length < 6) errors.push('Password must be at least 6 characters');
    return errors;
};

var validateLogin = function(body) {
    var errors = [];
    if (!body.email || !validateEmail(body.email)) errors.push('Valid email is required');
    if (!body.password) errors.push('Password is required');
    return errors;
};

var validateExam = function(body) {
    var errors = [];
    if (!body.title || body.title.trim().length < 1) errors.push('Title is required');
    return errors;
};

var validateQuestion = function(body) {
    var errors = [];
    if (!body.type) errors.push('Type is required');
    if (!body.title) errors.push('Title is required');
    if (!body.content) errors.push('Content is required');
    if (body.type === 'MCQ') {
        if (!body.options || body.options.length < 2) errors.push('MCQ needs at least 2 options');
        if (body.correctOption === undefined || body.correctOption === null) errors.push('Correct option is required');
    }
    return errors;
};

module.exports = {
    validateEmail: validateEmail,
    validateRegister: validateRegister,
    validateLogin: validateLogin,
    validateExam: validateExam,
    validateQuestion: validateQuestion
};
