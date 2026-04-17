CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DROP TABLE IF EXISTS attempts CASCADE;
DROP TABLE IF EXISTS questions CASCADE;
DROP TABLE IF EXISTS exams CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'STUDENT',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    avatar_url TEXT,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_attempts INTEGER DEFAULT 0
);

CREATE TABLE exams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    time_limit_secs INTEGER NOT NULL DEFAULT 3600,
    total_questions INTEGER DEFAULT 0,
    passing_score INTEGER DEFAULT 60,
    randomize BOOLEAN DEFAULT false,
    question_ids JSONB DEFAULT '[]',
    difficulty_mix JSONB DEFAULT '{}',
    total_attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(20) NOT NULL,
    title VARCHAR(255) NOT NULL,
    topic VARCHAR(255),
    difficulty VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
    tags JSONB DEFAULT '[]',
    points INTEGER DEFAULT 10,
    content TEXT NOT NULL,
    options JSONB DEFAULT '[]',
    correct_option INTEGER,
    explanation TEXT,
    model_answer TEXT,
    starter_code TEXT,
    expected_output TEXT,
    test_cases JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    exam_title VARCHAR(255),
    score INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    max_score INTEGER DEFAULT 0,
    passed BOOLEAN DEFAULT false,
    time_taken INTEGER DEFAULT 0,
    submitted_at TIMESTAMP WITH TIME ZONE,
    tab_switch_count INTEGER DEFAULT 0,
    answers JSONB DEFAULT '{}',
    question_results JSONB DEFAULT '[]',
    status VARCHAR(20) DEFAULT 'IN_PROGRESS',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO users (name, email, password_hash, role, status)
VALUES ('Admin User', 'admin@test.com', '\$2a$10$xVqYLGEMBmRkMdqq5RkYxOZGh5sByZFxQrVHmJxWGo6g5bJzFvmTa', 'ADMIN', 'active');
