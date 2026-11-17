import asyncio
import tempfile
import unittest
import json
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app import db
from app.queue import worker


class PrioritizationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        for obj, name, value in [(db, 'DB_PATH', root/'studio.db'), (db, 'PROJECTS_DIR', root/'projects'),
                                 (worker, '_dispatch_lock', asyncio.Lock()),
                                 (worker, '_running_tasks', {}), (worker, '_pause', asyncio.Event())]:
            mock = patch.object(obj, name, value)
            mock.start()
            self.addCleanup(mock.stop)
        db.init_db()
        takes = [{'n': n, 'kind': 'new' if n == 1 else 'continue', 'session': 'test',
                  'duration': 5, 'prompt': 'test'} for n in range(1,4)]
        self.old = db.create_project({'title': 'Old', 'slug': 'old', 'takes': takes})
        self.target = db.create_project({'title': 'Target', 'slug': 'target', 'takes': takes})
        self.third = db.create_project({'title': 'Third', 'slug': 'third', 'takes': takes})
        for position, project in enumerate([self.old, self.third, self.target], 1):
            db.update_project(project['id'], status='queued', queue_pos=position)
            db.enqueue_job(project['id'], 'generate_video')
        self.old_job = db.jobs_for_project(self.old['id'])[0]
        db.update_job(self.old_job['id'], status='running', started_at=123)
        db.update_project(self.old['id'], status='generating')
        self.state = {'completed': [1,2], 'last_ok': {'n': 2, 'mp4': 'ready.mp4'}}
        db.save_runner_state(self.old['id'], self.state)
        self.task = asyncio.create_task(asyncio.Event().wait())
        worker._running_tasks[self.old['id']] = self.task
        self.client = AsyncMock()
        self.client.queue_snapshot.return_value = {'live': {'slug': self.old['slug'], 'prompt_id': 'current'}}
        for target, value in [('app.queue.worker.ComfyClient', self.client),
                              ('app.comfy.validation.check_runtime', {'ok': True})]:
            mock = patch(target, return_value=value) if 'ComfyClient' in target else patch(target, new_callable=AsyncMock, return_value=value)
            mock.start()
            self.addCleanup(mock.stop)
        self.broadcast_patch = patch.object(worker, 'broadcast', new_callable=AsyncMock)
        self.broadcast_patch.start()
        self.addCleanup(self.broadcast_patch.stop)
        self.start_patch = patch.object(worker, 'start_worker', new_callable=AsyncMock)
        self.start_patch.start()
        self.addCleanup(self.start_patch.stop)

    async def asyncTearDown(self):
        self.task.cancel()
        try:
            await self.task
        except asyncio.CancelledError:
            pass

    async def test_priority_stops_current_preserves_checkpoints_and_returns_it_as_next(self):
        result = await worker.prioritize_generation(self.target['id'])
        self.assertEqual(result['order'], [self.target['id'], self.old['id'], self.third['id']])
        self.assertEqual(result['interrupted_project_id'], self.old['id'])
        self.assertTrue(self.task.cancelled())
        self.client.interrupt.assert_awaited_once()
        self.assertEqual(db.get_runner_state(self.old['id']), self.state)
        self.assertEqual(db.get_project(self.old['id'])['status'], 'queued')
        self.assertEqual(db.get_job(self.old_job['id'])['status'], 'queued')
        self.assertEqual(db.next_queued_job()['project_id'], self.target['id'])
        self.assertTrue(worker._pause.is_set())
        target_job = db.next_queued_job()
        db.update_job(target_job['id'], status='done')
        db.update_project(self.target['id'], status='done')
        self.assertEqual(db.next_queued_job()['project_id'], self.old['id'])

    async def test_invalid_target_never_interrupts_current(self):
        db.update_project(self.target['id'], status='done')
        with self.assertRaisesRegex(RuntimeError, 'na fila'):
            await worker.prioritize_generation(self.target['id'])
        self.client.interrupt.assert_not_awaited()
        self.assertFalse(self.task.done())

    async def test_failed_readiness_never_interrupts_current(self):
        with patch('app.comfy.validation.check_runtime', new_callable=AsyncMock,
                   return_value={'ok': False, 'errors': ['missing model']}):
            with self.assertRaisesRegex(RuntimeError, 'missing model'):
                await worker.prioritize_generation(self.target['id'])
        self.client.interrupt.assert_not_awaited()

    async def test_current_video_priority_is_idempotent(self):
        result = await worker.prioritize_generation(self.old['id'])
        self.assertTrue(result['already_active'])
        self.client.interrupt.assert_not_awaited()
        self.assertFalse(self.task.done())

    async def test_external_render_is_not_interrupted(self):
        self.client.queue_snapshot.return_value = {'live': {'slug': 'external', 'prompt_id': 'external'}}
        with self.assertRaisesRegex(RuntimeError, 'fora do worker'):
            await worker.prioritize_generation(self.target['id'])
        self.client.interrupt.assert_not_awaited()
        self.assertFalse(self.task.done())

    async def test_no_current_video_just_starts_target_first(self):
        db.update_job(self.old_job['id'], status='queued')
        db.update_project(self.old['id'], status='queued')
        worker._running_tasks.clear()
        self.client.queue_snapshot.return_value = {}
        result = await worker.prioritize_generation(self.target['id'])
        self.assertIsNone(result['interrupted_project_id'])
        self.assertEqual(db.next_queued_job()['project_id'], self.target['id'])
        self.client.interrupt.assert_not_awaited()

    async def test_duplicate_target_jobs_are_not_run_twice(self):
        db.enqueue_job(self.target['id'], 'generate_video')
        await worker.prioritize_generation(self.target['id'])
        queued = [j for j in db.jobs_for_project(self.target['id']) if j['status'] == 'queued']
        self.assertEqual(len(queued), 1)

    def test_resume_ignores_uncommitted_checkpoint_created_by_interrupted_take(self):
        from app.continuity.runner import latest_ready_clip
        root = Path(self.temp.name) / 'checkpoints'
        for name, timestamp in [('committed', 100), ('unfinished_take', 200)]:
            folder = root / 'session' / name
            folder.mkdir(parents=True)
            path = folder / 'clip.json'
            path.write_text(json.dumps({'status': 'ready'}))
            os.utime(path, (timestamp, timestamp))
        with patch('app.continuity.runner.ckpt_root', return_value=root):
            self.assertEqual(latest_ready_clip('session', before_ts=150), 'committed')
            self.assertEqual(latest_ready_clip('session'), 'unfinished_take')
