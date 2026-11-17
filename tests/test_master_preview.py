import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import masters


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.deliver = root / 'deliver'
        self.comfy = root / 'comfy'
        self.projects = root / 'projects'
        for name, value in [('DELIVERABLES_DIR', self.deliver), ('_COMFY_VIDEO', self.comfy),
                            ('PROJECTS_DIR', self.projects), ('_LEGACY_DELIVERABLES', [])]:
            mock = patch.object(masters, name, value)
            mock.start()
            self.addCleanup(mock.stop)
        self.project = {'id': 'video', 'slug': 'story', 'stats': {}, 'status': 'generating',
                        'takes': [{'n': n, 'kind': 'new' if n % 3 == 1 else 'continue',
                                   'session': f'session_{(n-1)//3}'} for n in range(1,55)]}
        self.state = {'completed': list(range(1,54))}
        for target, value in [('get_project', self.project), ('get_runner_state', self.state)]:
            mock = patch.object(masters.db, target, return_value=value)
            mock.start()
            self.addCleanup(mock.stop)

    def clip(self, n, root=None, name=None):
        path = (root or self.comfy) / 'story' / (name or f't{n:02d}_00001_audio.mp4')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'video')
        return path

    def test_53_takes_use_18_session_finals_not_only_latest_or_all_takes(self):
        for n in range(1,55):
            self.clip(n)  # t54 exists on disk but has not been confirmed complete
        sources = masters._preview_sources(self.project)
        self.assertEqual([int(p.name.split('_')[0][1:]) for p in sources], list(range(3,52,3)) + [53])
        self.assertEqual(len(sources), 18)

    def test_short_review_is_never_a_master_or_persisted_as_one(self):
        review = self.clip(53, self.deliver, 'review_t53.mp4')
        self.project['stats']['master'] = str(review)
        with patch.object(masters.db, 'update_project') as update:
            self.assertIsNone(masters.resolve_master_path(self.project))
            self.assertFalse(masters.project_master_info('video')['has_master'])
            update.assert_not_called()

    def test_current_only_files_are_not_cumulative_full_sources(self):
        self.clip(53, self.deliver, 'current_t53.mp4')
        self.assertEqual(masters._preview_sources(self.project), [])
        review = self.clip(53, self.deliver, 'review_t53.mp4')
        self.assertEqual(masters._preview_sources(self.project), [review])

    def test_partial_canonical_master_is_not_advertised_as_final(self):
        self.clip(1, self.deliver, 'master.mp4')
        self.assertFalse(masters.project_master_info('video')['has_master'])
        with self.assertRaisesRegex(RuntimeError, 'preview parcial'):
            masters.build_master('video', force=True)

    def test_three_digit_takes_are_indexed_in_order(self):
        self.project['takes'] = [{'n': n, 'kind': 'new', 'session': str(n)} for n in range(98,103)]
        self.state['completed'] = list(range(98,103))
        for n in range(98,103):
            self.clip(n)
        self.assertEqual([p.name for p in masters._preview_sources(self.project)],
                         [f't{n:02d}_00001_audio.mp4' for n in range(98,103)])

    def test_preview_cache_is_immutable_and_changes_when_sources_advance(self):
        self.clip(51)
        self.clip(53)
        def concat(clips, destination):
            destination.write_bytes(b'joined:' + b','.join(p.name.encode() for p in clips))
            return destination
        with patch('app.continuity.runner.concat_master', side_effect=concat) as join, \
                patch.object(masters.db, 'update_project') as update:
            first_info = masters.project_preview_info(self.project)
            first = masters.build_preview('video')
            self.assertEqual(masters.build_preview('video'), first)
            self.assertEqual(join.call_count, 1)
            self.clip(54)
            self.state['completed'].append(54)
            second_info = masters.project_preview_info(self.project)
            self.assertNotEqual(first_info['preview_url'], second_info['preview_url'])
            second = masters.build_preview('video')
            self.assertNotEqual(first, second)
            old_version = first_info['preview_url'].split('v=')[1]
            self.assertEqual(masters.build_preview('video', old_version), first)
            self.assertIn(b't53_', first.read_bytes())
            self.assertIn(b't54_', second.read_bytes())
            update.assert_not_called()

    def test_no_completed_takes_does_not_read_unfinished_exports(self):
        self.clip(1)
        self.state['completed'] = []
        self.assertFalse(masters.project_preview_info(self.project)['has_preview'])
        with self.assertRaisesRegex(RuntimeError, 'Nenhum take'):
            masters.build_preview('video')

    def test_active_project_without_state_does_not_read_unconfirmed_files(self):
        self.state.clear()
        self.clip(3)
        self.assertEqual(masters._preview_sources(self.project), [])

    def test_legacy_independent_takes_still_concatenate_in_order(self):
        self.state.clear()
        self.project['status'] = 'done'
        self.project['takes'] = [{'n': n, 'kind': 'new', 'session': f's{n}'} for n in range(1,4)]
        paths = [self.clip(n) for n in range(1,4)]
        self.assertEqual(masters._preview_sources(self.project), paths)

    def test_final_master_requires_every_sessions_final_full(self):
        self.state['completed'] = list(range(1,55))
        for n in range(3,52,3):
            self.clip(n)
        with self.assertRaisesRegex(RuntimeError, '54'):
            masters.build_master('video', force=True)

    def test_master_url_changes_after_rebuild(self):
        self.state['completed'] = list(range(1,55))
        master = self.clip(1, self.deliver, 'master.mp4')
        first = masters.project_master_info('video')['master_url']
        master.write_bytes(b'new longer master')
        second = masters.project_master_info('video')['master_url']
        self.assertNotEqual(first, second)

    def test_atomic_master_does_not_publish_failed_partial_output(self):
        from app.continuity.runner import concat_master
        target = self.deliver / 'story' / 'master.mp4'
        target.parent.mkdir(parents=True)
        target.write_bytes(b'previous complete movie')
        def fail(clips, staged):
            staged.write_bytes(b'broken partial data')
            raise RuntimeError('encoder failed')
        with patch('app.continuity.runner._concat_master_files', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'encoder failed'):
                concat_master([Path('source')], target)
        self.assertEqual(target.read_bytes(), b'previous complete movie')

    def test_atomic_master_replaces_only_after_success(self):
        from app.continuity.runner import concat_master
        target = self.deliver / 'story' / 'master.mp4'
        target.parent.mkdir(parents=True)
        target.write_bytes(b'old movie')
        def complete(clips, staged):
            self.assertEqual(target.read_bytes(), b'old movie')
            staged.write_bytes(b'new complete movie')
        with patch('app.continuity.runner._concat_master_files', side_effect=complete):
            concat_master([Path('source')], target)
        self.assertEqual(target.read_bytes(), b'new complete movie')

    def test_windows_player_lock_publishes_new_file_without_overwriting_playback(self):
        from app.continuity.runner import concat_master
        target = self.deliver / 'story' / 'master.mp4'
        target.parent.mkdir(parents=True)
        target.write_bytes(b'playing old movie')
        def complete(clips, staged):
            staged.write_bytes(b'new complete movie')
        original_replace = Path.replace
        def replace(path, destination):
            if destination == target:
                raise PermissionError('Windows player holds this file open')
            return original_replace(path, destination)
        with patch('app.continuity.runner._concat_master_files', side_effect=complete), \
                patch.object(Path, 'replace', replace):
            published = concat_master([Path('source')], target)
        self.assertNotEqual(published, target)
        self.assertEqual(target.read_bytes(), b'playing old movie')
        self.assertEqual(published.read_bytes(), b'new complete movie')
