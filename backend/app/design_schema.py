"""Additive workspace tables, shared by SQLite and PostgreSQL installations."""

WORKSPACE_SCHEMA = """
CREATE TABLE IF NOT EXISTS design_systems (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, theme TEXT NOT NULL, guidelines TEXT NOT NULL DEFAULT '',
 components TEXT NOT NULL DEFAULT '[]', is_default INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_project_options (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL UNIQUE REFERENCES design_projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL DEFAULT 'prototype',
 design_system_id INTEGER REFERENCES design_systems(id) ON DELETE SET NULL,
 settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS design_members (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('viewer','commenter','editor')),
 UNIQUE(project_id,user_id)
);
CREATE TABLE IF NOT EXISTS design_sources (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
 filename TEXT NOT NULL, media_type TEXT NOT NULL,
 content TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
 screen_id INTEGER REFERENCES design_screens(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 selector TEXT, content TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_shares (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
 token TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_message_authors (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 message_id INTEGER NOT NULL UNIQUE REFERENCES design_messages(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS design_artboards (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 screen_id INTEGER NOT NULL UNIQUE REFERENCES design_screens(id) ON DELETE CASCADE,
 layout TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_design_comments_project ON design_comments(project_id,id);
CREATE INDEX IF NOT EXISTS idx_design_sources_project ON design_sources(project_id,id);
"""
WORKSPACE_TABLES = [
    "design_systems",
    "design_project_options",
    "design_members",
    "design_sources",
    "design_comments",
    "design_shares",
    "design_message_authors",
    "design_artboards",
]
