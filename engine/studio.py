"""TAKATAKSTUDIO production records and queue. No external provider calls yet."""
import json
import sqlite3
import uuid
from datetime import datetime, timezone

TRACKS = ('video', 'book', 'music')
NAMES = ('Macyna', 'Mariella', 'Matthys')


def now():
    return datetime.now(timezone.utc).isoformat()


class Studio:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as db:
            db.executescript('''
            CREATE TABLE IF NOT EXISTS characters (
              name TEXT PRIMARY KEY, profile TEXT NOT NULL DEFAULT '');
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL,
              language TEXT NOT NULL, audience TEXT NOT NULL, created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
              track TEXT NOT NULL, status TEXT NOT NULL, draft TEXT NOT NULL DEFAULT '',
              target_date TEXT NOT NULL DEFAULT '', attempts INTEGER NOT NULL DEFAULT 0,
              error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
              UNIQUE(project_id, track));
            CREATE TABLE IF NOT EXISTS project_characters (
              project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, profile TEXT NOT NULL,
              PRIMARY KEY(project_id, name));
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY, job_id TEXT, action TEXT NOT NULL,
              detail TEXT NOT NULL, created_at TEXT NOT NULL);
            ''')
            db.executemany('INSERT OR IGNORE INTO characters(name) VALUES (?)', [(n,) for n in NAMES])

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        return db

    @staticmethod
    def event(db, job, action, detail):
        db.execute('INSERT INTO events(job_id,action,detail,created_at) VALUES (?,?,?,?)',
                   (job, action, detail, now()))

    def snapshot(self):
        with self.connect() as db:
            result = {key: [dict(r) for r in db.execute(sql)] for key, sql in {
                'characters': 'SELECT * FROM characters ORDER BY rowid',
                'projects': 'SELECT * FROM projects ORDER BY created_at DESC',
                'jobs': 'SELECT * FROM jobs ORDER BY created_at DESC',
                'events': 'SELECT * FROM events ORDER BY id DESC LIMIT 60',
            }.items()}
        result['providers'] = [
            {'name': 'YouTube', 'status': 'Not connected', 'purpose': 'OAuth and automatic upload'},
            {'name': 'Songer / Songr', 'status': 'Not verified', 'purpose': 'Confirm product, API and commercial rights'},
            {'name': 'Amazon KDP', 'status': 'Export workflow pending', 'purpose': 'Book files and submission review'},
            {'name': 'AI generation', 'status': 'Not connected', 'purpose': 'Writing, illustrations, voice and music'},
        ]
        return result

    def create_project(self, data, characters=None):
        fields = {}
        for key in ('title', 'brief', 'language', 'audience'):
            value = data.get(key, '')
            if not isinstance(value, str) or not value.strip() or len(value) > (12000 if key == 'brief' else 240):
                raise ValueError('Enter a valid ' + key)
            fields[key] = value.strip()
        pid = str(uuid.uuid4())
        with self.connect() as db:
            db.execute('INSERT INTO projects VALUES (?,?,?,?,?,?)',
                       (pid, fields['title'], fields['brief'], fields['language'], fields['audience'], now()))
            snapshot = characters if characters is not None else [dict(r) for r in db.execute('SELECT * FROM characters ORDER BY rowid')]
            db.executemany('INSERT INTO project_characters(project_id,name,profile) VALUES (?,?,?)',
                           [(pid, c['name'], c['profile']) for c in snapshot])
            for track in TRACKS:
                jid = str(uuid.uuid4())
                db.execute('INSERT INTO jobs(id,project_id,track,status,created_at) VALUES (?,?,?,?,?)',
                           (jid, pid, track, 'queued', now()))
                self.event(db, jid, 'queued', track + ' track created')
        return pid

    def import_pack(self, pack):
        if not isinstance(pack, dict) or pack.get('studio') != 'TAKATAKSTUDIO' or pack.get('version') != 1 or pack.get('kind') != 'production_request_pack':
            raise ValueError('Unsupported Studio request pack')
        project = pack.get('project')
        if not isinstance(project, dict) or project.get('language') not in ('en', 'fr'):
            raise ValueError('Choose en or fr for the imported production')
        characters = pack.get('characters')
        if not isinstance(characters, list) or len(characters) > 3:
            raise ValueError('Import supports up to three character profiles')
        clean = []
        for c in characters:
            if not isinstance(c, dict):
                raise ValueError('Invalid character')
            name, profile = c.get('name'), c.get('profile')
            if not isinstance(name, str) or not name.strip() or len(name) > 60 or not isinstance(profile, str) or len(profile) > 250:
                raise ValueError('Invalid character profile')
            if any(old['name'].casefold() == name.strip().casefold() for old in clean):
                raise ValueError('Duplicate character')
            clean.append({'name': name.strip(), 'profile': profile})
        # Import creative data only. Caller-supplied IDs, jobs, approvals and tenant claims are discarded.
        return self.create_project(project, characters=clean)

    def character(self, name, profile):
        if name not in NAMES or not isinstance(profile, str) or len(profile) > 12000:
            raise ValueError('Invalid character profile')
        with self.connect() as db:
            db.execute('UPDATE characters SET profile=? WHERE name=?', (profile, name))
            self.event(db, None, 'character_updated', name)

    def job(self, jid, action, data):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone()
            if row is None:
                raise ValueError('Job not found')
            status = row['status']
            if action == 'save':
                draft = data.get('draft', '')
                if not isinstance(draft, str) or len(draft) > 100000:
                    raise ValueError('Draft must be text under 100,000 characters')
                db.execute("UPDATE jobs SET draft=?,status='draft',error='' WHERE id=?", (draft, jid))
                detail = 'Draft saved; previous approval cleared'
            elif action == 'review':
                if status != 'draft' or not row['draft'].strip():
                    raise ValueError('Save a nonempty draft before requesting review')
                db.execute("UPDATE jobs SET status='review' WHERE id=?", (jid,))
                detail = 'Editorial review requested'
            elif action == 'approve':
                if status != 'review' or data.get('reviewed') is not True:
                    raise ValueError('Review the draft and confirm approval first')
                db.execute("UPDATE jobs SET status='approved' WHERE id=?", (jid,))
                detail = 'Draft approved by local operator; media generation and publishing still pending'
            elif action == 'plan':
                date = data.get('target_date', '')
                try:
                    datetime.strptime(date, '%Y-%m-%d')
                except (ValueError, TypeError):
                    raise ValueError('Choose a valid target date')
                db.execute('UPDATE jobs SET target_date=? WHERE id=?', (date, jid))
                detail = 'Target date set to ' + date + '; no publication scheduled'
            elif action == 'dispatch':
                if status not in ('queued', 'blocked'):
                    raise ValueError('Dispatch applies only to queued or blocked jobs')
                db.execute("UPDATE jobs SET status='blocked', attempts=attempts+1,error=? WHERE id=?",
                           ('Generation provider is not connected. Export the request pack or add a draft manually.', jid))
                detail = 'Blocked before external work; no provider request made and no charge incurred'
            else:
                raise ValueError('Unknown action')
            self.event(db, jid, action, detail)

    def request_pack(self, pid):
        with self.connect() as db:
            row = db.execute('SELECT * FROM projects WHERE id=?', (pid,)).fetchone()
            if row is None:
                raise ValueError('Project not found')
            project = dict(row)
            characters = [dict(r) for r in db.execute('SELECT name,profile FROM project_characters WHERE project_id=? ORDER BY rowid', (pid,))]
            jobs = [dict(r) for r in db.execute('SELECT * FROM jobs WHERE project_id=?', (pid,))]
        return {'studio': 'TAKATAKSTUDIO', 'version': 1, 'kind': 'production_request_pack',
                'project': project, 'characters': characters, 'jobs': jobs,
                'instructions': {
                    'video': 'Create a distinct original script, storyboard, narration and shot list. Render and review before upload.',
                    'book': 'Create an original manuscript and illustration plan. Layout, proof and verify print files before KDP submission.',
                    'music': 'Create original lyrics and a composition brief. Verify provider commercial rights before generation/distribution.'},
                'notice': 'This is a planning export, not generated media or a publishing receipt.'}
