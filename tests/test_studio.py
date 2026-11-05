import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
from engine.studio import Studio
from server import handler_for


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.db'
        self.s = Studio(self.path)
        self.pid = self.s.create_project(dict(title='Pilot', brief='Original story', language='TBD', audience='TBD'))
        self.jobs = self.s.snapshot()['jobs']

    def tearDown(self):
        self.tmp.cleanup()

    def test_parallel_tracks_and_persistence(self):
        self.assertEqual({j['track'] for j in self.jobs}, {'video','book','music'})
        restored = Studio(self.path).snapshot()
        self.assertEqual(len(restored['jobs']),3)
        self.assertEqual([c['name'] for c in restored['characters']], ['Macyna','Mariella','Matthys'])
        self.assertTrue(all(c['profile']=='' for c in restored['characters']))

    def test_blocked_dispatch_does_not_complete_other_tracks(self):
        self.s.job(self.jobs[0]['id'],'dispatch',{})
        states = self.s.snapshot()['jobs']
        self.assertEqual(sum(j['status']=='blocked' for j in states),1)
        self.assertEqual(sum(j['status']=='queued' for j in states),2)
        self.assertEqual(states[0]['attempts'],1)

    def test_approval_requires_review_and_edit_invalidates_it(self):
        jid = self.jobs[0]['id']
        for action in ('review','approve'):
            with self.assertRaises(ValueError): self.s.job(jid,action,{'reviewed':True})
        self.s.job(jid,'save',{'draft':'Original lyrics'})
        self.s.job(jid,'review',{})
        with self.assertRaises(ValueError): self.s.job(jid,'approve',{})
        self.s.job(jid,'approve',{'reviewed':True})
        self.assertEqual(self.s.snapshot()['jobs'][0]['status'],'approved')
        self.s.job(jid,'save',{'draft':'Revised lyrics'})
        self.assertEqual(self.s.snapshot()['jobs'][0]['status'],'draft')

    def test_plan_is_not_publication(self):
        jid=self.jobs[0]['id']
        with self.assertRaises(ValueError): self.s.job(jid,'plan',{'target_date':'2026-99-99'})
        self.s.job(jid,'plan',{'target_date':'2026-12-01'})
        self.assertEqual(self.s.snapshot()['jobs'][0]['status'],'queued')
        self.assertEqual(self.s.request_pack(self.pid)['kind'],'production_request_pack')

    def test_invalid_project_is_atomic(self):
        with self.assertRaises(ValueError): self.s.create_project({'title':'Empty'})
        self.assertEqual(len(self.s.snapshot()['projects']),1)
        self.assertEqual(len(self.s.snapshot()['jobs']),3)

    def test_http_boundary_and_roundtrip(self):
        server = ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.s))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        origin='http://127.0.0.1:'+str(server.server_port)
        try:
            with urlopen(origin+'/api/state') as r: self.assertEqual(len(json.load(r)['jobs']),3)
            body=json.dumps({'name':'Macyna','profile':'Confirmed test profile'}).encode()
            for headers in ({'Content-Type':'application/json'}, {'Content-Type':'application/json','Origin':'https://evil.example'}):
                with self.assertRaises(HTTPError) as cm: urlopen(Request(origin+'/api/characters',body,headers))
                self.assertEqual(cm.exception.code,403)
            with urlopen(Request(origin+'/api/characters',body,{'Content-Type':'application/json','Origin':origin})) as r:
                self.assertTrue(json.load(r)['ok'])
            with self.assertRaises(HTTPError): urlopen(Request(origin+'/',headers={'Host':'evil.example'}))
            with urlopen(origin+'/') as r: self.assertIn('TAKATAKSTUDIO',r.read().decode())
        finally:
            server.shutdown();server.server_close();thread.join()


if __name__=='__main__': unittest.main()
