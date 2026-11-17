import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from app import db, masters
from app.main import RegenerateBody
from app.queue import worker


class RegenerationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, value in [('app.db.DB_PATH', self.root/'studio.db'),
                              ('app.db.PROJECTS_DIR', self.root/'projects'),
                              ('app.config.PROJECTS_DIR', self.root/'projects'),
                              ('app.masters.PROJECTS_DIR', self.root/'projects'),
                              ('app.masters.DELIVERABLES_DIR', self.root/'deliver'),
                              ('app.masters._COMFY_VIDEO', self.root/'comfy'),
                              ('app.masters._LEGACY_DELIVERABLES', []),
                              ('app.queue.worker._dispatch_lock', asyncio.Lock())]:
            mock = patch(target, value)
            mock.start()
            self.addCleanup(mock.stop)
        db.init_db()
        self.source = self.root/'master.mp4'
        self.source.write_bytes(b'previous movie')
        self.takes = [dict(n=n, kind='new' if n == 1 else 'continue', session='original',
                           seed=42, duration=5, prefix=f'video/test/t{n:02d}', prompt='Original prompt')
                      for n in (1,2)]
        self.project = db.create_project({'title':'Test', 'slug':'test', 'status':'done', 'takes':self.takes,
                                          'category':'footage', 'cctv_timestamp_enabled':False,
                                          'stats':{'master':str(self.source),'original_master':str(self.source)}})
        self.pid = self.project['id']
        self.state = {'completed':[1,2], 'session_checkpoints':{'original':'old-checkpoint'}}
        db.save_runner_state(self.pid, self.state)
        db.save_footage_export(dict(id='old',project_id=self.pid,path=str(self.source),source_path=str(self.source),
                                    start_time='2026-11-17T19:00:00',position='top-left',color='white',created_at=time.time()))
        for target in ['app.comfy.validation.check_runtime','app.queue.worker.broadcast']:
            mock = patch(target, new_callable=AsyncMock, return_value={'ok':True})
            mock.start()
            self.addCleanup(mock.stop)

    async def test_restart_clears_progress_and_reuses_script_with_new_seeds_and_sessions(self):
        job = await worker.regenerate_generation(self.pid)
        updated = db.get_project(self.pid)
        self.assertEqual(updated['status'], 'queued')
        self.assertEqual(db.get_runner_state(self.pid)['completed'], [])
        self.assertEqual(db.footage_exports(self.pid), [])
        self.assertEqual(job['project_id'], self.pid)
        self.assertNotEqual(updated['takes'][0]['seed'], 42)
        self.assertEqual(updated['takes'][0]['seed'], updated['takes'][1]['seed'])
        self.assertNotEqual(updated['takes'][0]['session'], 'original')
        self.assertEqual(updated['takes'][0]['session'], updated['takes'][1]['session'])
        self.assertEqual([t['prompt'] for t in updated['takes']], [t['prompt'] for t in self.takes])
        self.assertFalse(updated['cctv_timestamp_enabled'])
        self.assertEqual(updated['category'], 'footage')
        self.assertEqual(updated['width'], self.project['width'])
        self.assertIsNone(masters.resolve_master_path(updated))

    async def test_old_exports_cannot_be_selected_for_new_preview(self):
        folder = self.root/'comfy'/'test'
        folder.mkdir(parents=True)
        (folder/'t02_00001_audio.mp4').write_bytes(b'old full' * 1000)
        await worker.regenerate_generation(self.pid)
        p = db.get_project(self.pid)
        self.assertEqual(masters.collect_take_clips(p), [])
        prefix = p['takes'][0]['prefix'].rsplit('/',1)[1]
        fresh = folder/f'{prefix}_00001_audio.mp4'
        fresh.write_bytes(b'new full')
        self.assertEqual(masters.collect_take_clips(p), [fresh])

    async def test_invalid_runtime_does_not_replace_current_result(self):
        with patch('app.comfy.validation.check_runtime', new_callable=AsyncMock,
                   return_value={'ok':False,'errors':['missing node']}):
            with self.assertRaisesRegex(RuntimeError, 'missing node'):
                await worker.regenerate_generation(self.pid)
        self.assertEqual(db.get_project(self.pid)['status'], 'done')
        self.assertEqual(db.get_runner_state(self.pid), self.state)
        self.assertEqual(len(db.footage_exports(self.pid)), 1)
        self.assertEqual(db.jobs_for_project(self.pid), [])

    async def test_completed_video_cannot_bypass_confirmation_with_regular_enqueue(self):
        with self.assertRaisesRegex(RuntimeError, 'confirme'):
            await worker.enqueue_generation(self.pid)
        self.assertEqual(db.get_project(self.pid)['status'], 'done')
        self.assertEqual(db.get_runner_state(self.pid), self.state)
        self.assertEqual(db.jobs_for_project(self.pid), [])

    async def test_duplicate_requests_create_only_one_new_job(self):
        async def ready(project):
            await asyncio.sleep(0)
            return {'ok':True}
        with patch('app.comfy.validation.check_runtime', side_effect=ready):
            results = await asyncio.gather(worker.regenerate_generation(self.pid),
                                           worker.regenerate_generation(self.pid), return_exceptions=True)
        self.assertEqual(sum(isinstance(r, RuntimeError) for r in results), 1)
        self.assertEqual(len(db.jobs_for_project(self.pid)), 1)

    def test_confirmation_is_mandatory(self):
        for value in [{}, {'confirmed':False}]:
            with self.assertRaises(ValidationError):
                RegenerateBody(**value)
        self.assertTrue(RegenerateBody(confirmed=True).confirmed)

    def test_regenerated_and_three_digit_takes_are_identified_by_queue_monitor(self):
        from app.comfy.client import _parse_comfy_item
        for n in [1, 53, 101]:
            item = [0, 'prompt', {'1': {'inputs': {'filename_prefix': f'video/test/t{n:02d}_rabcdef012345'}}}, {}]
            parsed = _parse_comfy_item(item)
            self.assertEqual((parsed['slug'], parsed['take']), ('test', n))

    def test_reset_transaction_rolls_back_if_job_creation_fails(self):
        with self.assertRaises(KeyError):
            db.reset_project_generation(self.pid, self.takes, 123, {}, 1)
        self.assertEqual(db.get_project(self.pid)['status'], 'done')
        self.assertEqual(db.get_runner_state(self.pid), self.state)
        self.assertEqual(len(db.footage_exports(self.pid)), 1)
