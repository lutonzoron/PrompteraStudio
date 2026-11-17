import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.queue import worker
from app.external_sync import reconcile_generating_statuses


class CancellationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        for name, value in [('_dispatch_lock', asyncio.Lock()), ('_running_tasks', {}),
                            ('_worker_task', None), ('_pause', asyncio.Event())]:
            mock = patch.object(worker, name, value)
            mock.start()
            self.addCleanup(mock.stop)
        worker._pause.set()

    async def test_cancel_removes_only_own_pending_and_interrupts_own_live_render(self):
        client = AsyncMock()
        client.queue_snapshot.return_value = {
            'live': {'slug': 'old', 'prompt_id': 'active-old'},
            'pending_items': [{'slug': 'old', 'prompt_id': 'old-next'},
                              {'slug': 'new', 'prompt_id': 'new-next'}]}
        with patch.object(worker.db, 'get_project', return_value={'id': 'old-id', 'slug': 'old'}), \
                patch.object(worker, 'ComfyClient', return_value=client), \
                patch.object(worker, 'broadcast', new_callable=AsyncMock):
            await worker.cancel_generation('old-id')
        client.delete_prompts.assert_awaited_once_with(['old-next'])
        client.interrupt.assert_awaited_once()

    async def test_cancel_does_not_interrupt_another_video(self):
        client = AsyncMock()
        client.queue_snapshot.return_value = {'live': {'slug': 'new', 'prompt_id': 'other'}}
        with patch.object(worker.db, 'get_project', return_value={'id': 'old-id', 'slug': 'old'}), \
                patch.object(worker, 'ComfyClient', return_value=client), \
                patch.object(worker, 'broadcast', new_callable=AsyncMock):
            await worker.cancel_generation('old-id')
        client.interrupt.assert_not_awaited()

    async def test_render_finishing_during_cancel_does_not_interrupt_next_prompt(self):
        client = AsyncMock()
        client.queue_snapshot.side_effect = [
            {'live': {'slug': 'old', 'prompt_id': 'old-prompt'}},
            {'live': {'slug': 'new', 'prompt_id': 'new-prompt'}}]
        with patch.object(worker.db, 'get_project', return_value={'id': 'old-id', 'slug': 'old'}), \
                patch.object(worker, 'ComfyClient', return_value=client), \
                patch.object(worker, 'broadcast', new_callable=AsyncMock):
            await worker.cancel_generation('old-id')
        client.interrupt.assert_not_awaited()

    async def test_cancel_child_keeps_worker_alive_and_dispatches_next_job(self):
        old_started = asyncio.Event()
        next_started = asyncio.Event()
        jobs = iter([{'id': 'old-job', 'project_id': 'old'}, {'id': 'new-job', 'project_id': 'new'}])
        async def run(job):
            if job['project_id'] == 'old':
                old_started.set()
                await asyncio.Event().wait()
            else:
                next_started.set()
        client = AsyncMock()
        client.queue_snapshot.return_value = {}
        with patch.object(worker.db, 'next_queued_job', side_effect=lambda: next(jobs, None)), \
                patch.object(worker.db, 'get_project', return_value={'id': 'old', 'slug': 'old'}), \
                patch.object(worker, '_run_job', side_effect=run), \
                patch.object(worker, 'ComfyClient', return_value=client), \
                patch.object(worker, 'broadcast', new_callable=AsyncMock):
            loop = asyncio.create_task(worker._loop())
            try:
                await asyncio.wait_for(old_started.wait(), 1)
                await worker.cancel_generation('old')
                await asyncio.wait_for(next_started.wait(), 1)
                self.assertFalse(loop.done())
            finally:
                loop.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await loop
        self.assertEqual(worker._running_tasks, {})

    async def test_remove_queued_project_still_works_when_comfy_is_offline(self):
        client = AsyncMock()
        client.queue_snapshot.side_effect = httpx.ConnectError('offline')
        with patch.object(worker.db, 'get_project', return_value={'id': 'old-id', 'slug': 'old'}), \
                patch.object(worker, 'ComfyClient', return_value=client), \
                patch.object(worker, 'broadcast', new_callable=AsyncMock):
            await worker.cancel_generation('old')
        client.interrupt.assert_not_awaited()

    async def test_already_running_worker_is_not_recovered_or_requeued(self):
        task = asyncio.create_task(asyncio.Event().wait())
        worker._worker_task = task
        try:
            with patch.object(worker.db, 'recover_orphaned_jobs') as recover, \
                    patch.object(worker.db, 'ensure_jobs_for_queued_projects') as ensure:
                await worker.start_worker()
            recover.assert_not_called()
            ensure.assert_not_called()
        finally:
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

    async def test_cancelled_job_cannot_be_started_from_stale_queue_read(self):
        with patch.object(worker.db, 'get_job', return_value={'status': 'cancelled'}), \
                patch.object(worker.db, 'update_job') as update:
            await worker._run_job({'id': 'old', 'project_id': 'old'})
        update.assert_not_called()

    def test_queued_project_is_not_falsely_marked_generating(self):
        project = {'id': 'new', 'slug': 'new', 'status': 'queued', 'queue_pos': 1}
        with patch('app.external_sync.db.list_projects', return_value=[project]), \
                patch('app.external_sync.db.active_job', return_value=None), \
                patch('app.external_sync.db.update_project') as update:
            changes = reconcile_generating_statuses(live_slug='removed-old')
        self.assertEqual(changes, [])
        update.assert_not_called()
