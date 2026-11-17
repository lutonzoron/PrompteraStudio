import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import db
from app.activity import ActivityMiddleware
from app.events import broadcast


class ActivityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        db_patch = patch.object(db, 'DB_PATH', Path(self.temp.name) / 'logs.db')
        db_patch.start()
        self.addCleanup(db_patch.stop)
        db.init_db()

    def test_history_and_live_pages_have_no_gaps_and_filter_by_video(self):
        for n in range(9):
            db.add_log(str(n), project_id='a' if n % 2 == 0 else 'b')
        latest = db.list_logs(project_id='a', limit=2)
        self.assertEqual([r['message'] for r in latest['items']], ['6', '8'])
        self.assertTrue(latest['has_more'])
        older = db.list_logs(project_id='a', before=latest['items'][0]['id'], limit=2)
        self.assertEqual([r['message'] for r in older['items']], ['2', '4'])
        oldest = db.list_logs(project_id='a', before=older['items'][0]['id'], limit=2)
        self.assertEqual([r['message'] for r in oldest['items']], ['0'])
        self.assertFalse(oldest['has_more'])
        cursor = latest['items'][-1]['id']
        for n in range(5):
            db.add_log(f'new {n}', project_id='a')
        first = db.list_logs(project_id='a', after=cursor, limit=3)
        second = db.list_logs(project_id='a', after=first['items'][-1]['id'], limit=3)
        self.assertEqual([r['message'] for r in first['items'] + second['items']],
                         [f'new {n}' for n in range(5)])
        self.assertTrue(first['has_more'])
        self.assertFalse(second['has_more'])

    async def test_take_events_persist_even_without_listeners(self):
        await broadcast({'type': 'job_progress', 'project_id': 'video',
                         'message': 'Gerando t01_new', 'extra': {'take': 1, 'prompt_id': 'prompt'}})
        await broadcast({'type': 'job_failed', 'project_id': 'video', 'error': 'Sem memória'})
        logs = db.list_logs(project_id='video')['items']
        self.assertIn('Gerando t01_new', logs[0]['message'])
        self.assertIn('prompt_id: prompt', logs[0]['message'])
        self.assertEqual(logs[1]['level'], 'error')

    async def call_action(self, path, response, status=200, method='POST'):
        async def endpoint(scope, receive, send):
            await send({'type': 'http.response.start', 'status': status, 'headers': []})
            await send({'type': 'http.response.body', 'body': json.dumps(response).encode()})

        async def send(message):
            pass

        await ActivityMiddleware(endpoint)({'type': 'http', 'path': path, 'method': method}, None, send)

    async def test_failed_action_preserves_error_and_project(self):
        await self.call_action('/api/projects/video/enqueue', {'detail': 'Node não carregado'}, 400)
        logs = db.list_logs(project_id='video')['items']
        self.assertEqual(len(logs), 2)
        self.assertIn('Início:', logs[0]['message'])
        self.assertEqual(logs[1]['level'], 'error')
        self.assertIn('Node não carregado', logs[1]['message'])

    async def test_creation_is_linked_and_settings_response_is_not_dumped(self):
        await self.call_action('/api/projects', {'id': 'new-video', 'title': 'Vídeo'})
        self.assertEqual(len(db.list_logs(project_id='new-video')['items']), 1)
        await self.call_action('/api/llm', {'api_key': 'secret-value'}, method='PUT')
        self.assertNotIn('secret-value', str(db.list_logs()))
        before = len(db.list_logs()['items'])
        await self.call_action('/api/logs', {'items': []}, method='GET')
        self.assertEqual(len(db.list_logs()['items']), before)

    async def test_http_success_with_failed_result_and_unhandled_errors(self):
        await self.call_action('/api/comfy/start', {'ok': False, 'error': 'Python indisponível'})
        self.assertEqual(db.list_logs()['items'][-1]['level'], 'error')

        async def endpoint(scope, receive, send):
            raise RuntimeError('Falha inesperada')

        with self.assertRaisesRegex(RuntimeError, 'Falha inesperada'):
            await ActivityMiddleware(endpoint)({'type': 'http', 'path': '/api/projects/video/enqueue',
                                                'method': 'POST'}, None, None)
        self.assertIn('Falha inesperada', db.list_logs(project_id='video')['items'][-1]['message'])
