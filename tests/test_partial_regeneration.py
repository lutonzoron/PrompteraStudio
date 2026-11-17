import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from app import db, masters
from app.continuity.cascade import cascade_from_take, cascade_ns
from app.main import RegenerateFromBody
from app.queue import worker


def _take(n, kind, session, seed=None, prompt=None):
    return {
        'n': n,
        'kind': kind,
        'session': session,
        'seed': 100 + n if seed is None else seed,
        'duration': 5,
        'prefix': f'video/partial/t{n:02d}',
        'prompt': prompt or f'Prompt for take {n}',
    }


class CascadeHelperTests(unittest.TestCase):
    def test_cascade_same_session_only(self):
        takes = [
            _take(1, 'new', 's1'),
            _take(2, 'continue', 's1'),
            _take(3, 'new', 's2'),
        ]
        self.assertEqual(cascade_ns(takes, 2), [2])
        self.assertEqual([int(t['n']) for t in cascade_from_take(takes, 1)], [1, 2])
        self.assertEqual(cascade_ns(takes, 3), [3])


class PartialRegenerationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, value in [
            ('app.db.DB_PATH', self.root / 'studio.db'),
            ('app.db.PROJECTS_DIR', self.root / 'projects'),
            ('app.config.PROJECTS_DIR', self.root / 'projects'),
            ('app.masters.PROJECTS_DIR', self.root / 'projects'),
            ('app.masters.DELIVERABLES_DIR', self.root / 'deliver'),
            ('app.masters._COMFY_VIDEO', self.root / 'comfy'),
            ('app.masters._LEGACY_DELIVERABLES', []),
            ('app.queue.worker._dispatch_lock', asyncio.Lock()),
        ]:
            mock = patch(target, value)
            mock.start()
            self.addCleanup(mock.stop)
        db.init_db()
        self.source = self.root / 'master.mp4'
        self.source.write_bytes(b'previous movie')
        self.takes = [
            _take(1, 'new', 's1', seed=11),
            _take(2, 'continue', 's1', seed=12),
            _take(3, 'new', 's2', seed=21),
        ]
        self.project = db.create_project({
            'title': 'Partial',
            'slug': 'partial',
            'status': 'done',
            'takes': self.takes,
            'category': 'general',
            'stats': {'master': str(self.source), 'original_master': str(self.source)},
        })
        self.pid = self.project['id']
        self.state = {
            'completed': [1, 2, 3],
            'session_checkpoints': {'s1': 'clip-s1-final', 's2': 'clip-s2'},
        }
        db.save_runner_state(self.pid, self.state)
        db.save_footage_export(dict(
            id='old', project_id=self.pid, path=str(self.source), source_path=str(self.source),
            start_time='2026-11-17T19:00:00', position='top-left', color='white', created_at=time.time(),
        ))
        for target in ['app.comfy.validation.check_runtime', 'app.queue.worker.broadcast']:
            mock = patch(target, new_callable=AsyncMock, return_value={'ok': True})
            mock.start()
            self.addCleanup(mock.stop)
        # Avoid touching real Continuity checkpoint dirs during CONTINUE cascade.
        mock = patch(
            'app.continuity.cascade.checkpoint_after_quarantine',
            return_value='clip-s1-t1',
        )
        mock.start()
        self.addCleanup(mock.stop)

    async def test_regenerate_continue_keeps_other_sessions(self):
        job = await worker.regenerate_from_take(self.pid, 2)
        updated = db.get_project(self.pid)
        state = db.get_runner_state(self.pid)
        takes = updated['takes']
        self.assertEqual(updated['status'], 'queued')
        self.assertEqual(state['completed'], [1, 3])
        self.assertEqual(state['partial_regen_from'], 2)
        self.assertEqual(takes[0]['session'], 's1')
        self.assertEqual(takes[0]['seed'], 11)
        self.assertEqual(takes[0]['prefix'], 'video/partial/t01')
        self.assertEqual(takes[1]['session'], 's1')
        self.assertNotEqual(takes[1]['seed'], 12)
        self.assertIn('_r', takes[1]['prefix'])
        self.assertEqual(takes[2]['session'], 's2')
        self.assertEqual(takes[2]['seed'], 21)
        self.assertEqual(takes[2]['prefix'], 'video/partial/t03')
        self.assertEqual(db.footage_exports(self.pid), [])
        self.assertEqual(job['payload']['regenerate_from'], 2)
        self.assertIsNone(masters.resolve_master_path(updated))

    async def test_regenerate_new_renames_only_that_session(self):
        await worker.regenerate_from_take(self.pid, 1)
        updated = db.get_project(self.pid)
        state = db.get_runner_state(self.pid)
        takes = updated['takes']
        self.assertEqual(state['completed'], [3])
        self.assertNotEqual(takes[0]['session'], 's1')
        self.assertEqual(takes[0]['session'], takes[1]['session'])
        self.assertTrue(str(takes[0]['session']).startswith('regen_'))
        self.assertEqual(takes[2]['session'], 's2')
        self.assertEqual(takes[2]['seed'], 21)

    async def test_prompt_override_only_target_take(self):
        await worker.regenerate_from_take(self.pid, 2, prompt='  Fresh English lock  ')
        takes = db.get_project(self.pid)['takes']
        self.assertEqual(takes[1]['prompt'], 'Fresh English lock')
        self.assertEqual(takes[0]['prompt'], 'Prompt for take 1')

    async def test_confirmation_body_required(self):
        with self.assertRaises(ValidationError):
            RegenerateFromBody(take_n=2)
        with self.assertRaises(ValidationError):
            RegenerateFromBody(take_n=2, confirmed=False)
        body = RegenerateFromBody(take_n=2, confirmed=True, prompt='x')
        self.assertEqual(body.take_n, 2)

    async def test_old_cascade_prefix_ignored_after_partial(self):
        folder = self.root / 'comfy' / 'partial'
        folder.mkdir(parents=True)
        (folder / 't02_00001_audio.mp4').write_bytes(b'old full' * 1000)
        (folder / 't01_00001_audio.mp4').write_bytes(b'keep' * 1000)
        (folder / 't03_00001_audio.mp4').write_bytes(b's2' * 1000)
        await worker.regenerate_from_take(self.pid, 2)
        p = db.get_project(self.pid)
        indexed = masters.index_take_files(p)
        self.assertIn(1, indexed)
        self.assertIn(3, indexed)
        self.assertNotIn(2, indexed)
        prefix = p['takes'][1]['prefix'].rsplit('/', 1)[-1]
        fresh = folder / f'{prefix}_00001_audio.mp4'
        fresh.write_bytes(b'new full')
        indexed2 = masters.index_take_files(p)
        self.assertEqual(indexed2[2].name, fresh.name)


if __name__ == '__main__':
    unittest.main()
