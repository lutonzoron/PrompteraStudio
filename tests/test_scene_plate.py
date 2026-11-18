import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.comfy.client import ComfyClient
from app.continuity.runner import ContinuityRunner
from app.inbox.service import _normalize_imported_takes
from app.story.service import validate_takes


def runner_without_gpu():
    runner = object.__new__(ContinuityRunner)
    runner.project = {'id': 'example'}
    runner.on_progress = None
    runner.width, runner.height = 1024, 576
    runner.overlap, runner.steps = 22, 8
    runner.unet, runner.clip, runner.vae_v, runner.vae_a = 'unet', 'clip', 'video', 'audio'
    runner.slug = 'anchored'
    runner.client = AsyncMock()
    runner.client.upload_scene_plate.return_value = 'promptera/scene_plates/frame.png'
    runner.client.queue_prompt.return_value = 'prompt-id'
    return runner


class ScenePlateTests(unittest.IsolatedAsyncioTestCase):
    def take(self, kind='new', **extras):
        return {'n': 1, 'kind': kind, 'session': 'forest', 'duration': 6,
                'seed': 90217, 'prefix': 'video/anchored/t01', 'prompt': 'One action', **extras}

    def test_inbox_retains_anchor_instead_of_silently_dropping_it(self):
        take = self.take(first_frame='story_assets/red/forest.png')
        normalized = _normalize_imported_takes([take], 'anchored')
        self.assertEqual(normalized[0]['first_frame'], take['first_frame'])
        self.assertEqual(validate_takes(normalized, 6), [])

    def test_continue_cannot_reinject_a_scene_plate(self):
        takes = [self.take(), {**self.take('continue', first_frame='forest.png'), 'n': 2}]
        self.assertTrue(any('quadro-base' in warning for warning in validate_takes(takes, 12)))

    async def test_new_uploads_plate_and_uses_i2va_slot_zero(self):
        runner = runner_without_gpu()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / 'forest.png'
            image.write_bytes(b'fixture')
            with patch('app.continuity.runner.DATA_DIR', root), patch('app.continuity.runner.find_output_mp4', return_value=root/'out.mp4'):
                await runner.run_take(self.take(first_frame='forest.png'))
            runner.client.upload_scene_plate.assert_awaited_once_with(image.resolve())
            graph = runner.client.queue_prompt.call_args.args[0]
            self.assertEqual(graph['5']['inputs']['mode'], 'I2VA')
            timeline = json.loads(graph['5']['inputs']['timeline_data'])
            self.assertEqual(timeline['items'], [{'type': 'image', 'slot': 0, 'value': 'promptera/scene_plates/frame.png'}])
            self.assertEqual(timeline['builder_state']['mode'], 'I2VA')

    async def test_continue_uses_checkpoint_without_reuploading_plate(self):
        runner = runner_without_gpu()
        state = {'session_checkpoints': {'forest': 'ready-checkpoint'}}
        with patch('app.continuity.runner.db.get_runner_state', return_value=state), patch('app.continuity.runner.find_output_mp4', return_value=Path('out.mp4')):
            await runner.run_take(self.take('continue'))
        runner.client.upload_scene_plate.assert_not_awaited()
        graph = runner.client.queue_prompt.call_args.args[0]
        timeline = json.loads(graph['5']['inputs']['timeline_data'])
        self.assertEqual(timeline['items'], [])
        self.assertEqual(timeline['continuity']['source_id'], 'ready-checkpoint')
        self.assertIs(timeline['continuity']['use_references'], False)

    async def test_existing_text_only_new_remains_t2va(self):
        runner = runner_without_gpu()
        with patch('app.continuity.runner.find_output_mp4', return_value=Path('out.mp4')):
            await runner.run_take(self.take())
        runner.client.upload_scene_plate.assert_not_awaited()
        graph = runner.client.queue_prompt.call_args.args[0]
        self.assertEqual(graph['5']['inputs']['mode'], 'T2VA')
        self.assertEqual(json.loads(graph['5']['inputs']['timeline_data'])['items'], [])

    async def test_missing_or_outside_asset_never_queues_gpu_work(self):
        runner = runner_without_gpu()
        with tempfile.TemporaryDirectory() as tmp, patch('app.continuity.runner.DATA_DIR', Path(tmp)):
            for filename in ['missing.png', '../outside.png', 'file.txt']:
                with self.subTest(filename=filename), self.assertRaises(RuntimeError):
                    await runner.run_take(self.take(first_frame=filename))
        runner.client.queue_prompt.assert_not_awaited()
        runner.client.upload_scene_plate.assert_not_awaited()

    async def test_upload_is_content_addressed_and_returns_comfy_relative_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'image.png'
            path.write_bytes(b'fixture')
            response = unittest.mock.Mock()
            response.json.return_value = {'name': 'scene.png', 'subfolder': 'promptera/scene_plates'}
            http = AsyncMock()
            http.post.return_value = response
            context = AsyncMock()
            context.__aenter__.return_value = http
            with patch('app.comfy.client.httpx.AsyncClient', return_value=context):
                result = await ComfyClient('http://local').upload_scene_plate(path)
            self.assertEqual(result, 'promptera/scene_plates/scene.png')
            files = http.post.call_args.kwargs['files']
            self.assertTrue(files['image'][0].startswith('scene_'))
            self.assertEqual(http.post.call_args.kwargs['data']['type'], 'input')


if __name__ == '__main__':
    unittest.main()
