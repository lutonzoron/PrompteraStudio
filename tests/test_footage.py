import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
import asyncio
from datetime import datetime
from pathlib import Path
from unittest.mock import patch, AsyncMock
from threading import Event

from app import db
from app.categories import infer_category, default_footage_time
from app.footage import clock_subtitles, export_timestamp


class FootageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for target, value in [('app.db.DB_PATH', self.root/'studio.db'),
                              ('app.db.PROJECTS_DIR', self.root/'projects'),
                              ('app.footage.PROJECTS_DIR', self.root/'projects')]:
            mock = patch(target, value)
            mock.start()
            self.addCleanup(mock.stop)
        db.init_db()

    def test_category_inference_is_scoped_to_footage(self):
        self.assertEqual(infer_category('strange_footages_01_sombra_sem_dono'), 'footage')
        self.assertEqual(infer_category('lorena_pterodactilo_silhueta_horizontal_12s_v3'), 'footage')
        self.assertEqual(infer_category('chapeuzinho_intro_mae_cena_unica_v2'), 'general')
        self.assertEqual(infer_category('a_historia_de_lorena'), 'general')

    def test_default_clock_and_explicit_override_survive_restart(self):
        p = db.create_project({'title': 'Footage', 'slug': 'strange_footages_04_reflexo_no_vidro'})
        self.assertEqual(p['category'], 'footage')
        self.assertFalse(p['cctv_timestamp_enabled'])
        self.assertEqual(p['cctv_timestamp_start'], '2026-11-09T02:14:27')
        db.update_project(p['id'], category='general', cctv_timestamp_enabled=False)
        db.init_db()
        self.assertEqual(db.get_project(p['id'])['category'], 'general')
        self.assertFalse(db.get_project(p['id'])['cctv_timestamp_enabled'])

    def test_existing_projects_migrate_only_once(self):
        p = db.create_project({'title': 'Old footage', 'slug': 'lorena_camera_seguranca_old', 'category': 'general'})
        c = db._conn()
        c.execute("DELETE FROM settings WHERE key='migration_footage_v1'")
        c.commit()
        c.close()
        db.init_db()
        migrated = db.get_project(p['id'])
        self.assertEqual(migrated['category'], 'footage')
        self.assertTrue(migrated['cctv_timestamp_start'])

    def test_clock_advances_and_rolls_over_at_midnight(self):
        text = clock_subtitles(datetime(2026,11,16,23,59,59), 2.25, 1024, 576)
        self.assertIn('2026-11-16 23:59:59', text)
        self.assertIn('2026-11-17 00:00:00', text)
        self.assertIn('2026-11-17 00:00:01', text)
        self.assertIn('0:00:02.00,0:00:02.25', text)
        self.assertEqual(text.count('Dialogue:'), 3)

    def test_clock_rejects_invalid_positions_and_colors(self):
        with self.assertRaises(ValueError):
            clock_subtitles(datetime(2026,11,16), 12, 1024,576, position='invalid')
        with self.assertRaises(ValueError):
            clock_subtitles(datetime(2026,11,16), 12, 1024,576, color='invalid')

    def test_cancelled_export_never_changes_the_project(self):
        cancel = Event()
        cancel.set()
        with patch.object(db, 'get_project') as get:
            with self.assertRaisesRegex(RuntimeError, 'cancelada'):
                export_timestamp('video', cancel_event=cancel)
        get.assert_not_called()

    def test_worker_never_applies_clock_automatically_even_with_legacy_enabled_flag(self):
        from app.queue import worker
        for category, enabled, expected in [('footage', True, 0), ('footage', False, 0), ('general', True, 0)]:
            with self.subTest(category=category, enabled=enabled):
                p = db.create_project({'title': 'Clock default', 'category': category, 'cctv_timestamp_enabled': enabled})
                db.update_project(p['id'], cctv_timestamp_enabled=enabled)
                job = db.enqueue_job(p['id'], 'generate_video')
                original = str(self.root/'master.mp4')
                clocked = str(self.root/'master_cctv.mp4')
                fake_runner = AsyncMock()
                fake_runner.run_all.return_value = {'master': original}
                with patch.object(worker, 'ContinuityRunner', return_value=fake_runner), \
                        patch.object(worker, 'load_or_detect_profile', return_value={'watts':150}), \
                        patch.object(worker, 'estimate_project', return_value={}), \
                        patch.object(worker, 'broadcast', new_callable=AsyncMock), \
                        patch('app.footage.export_timestamp', return_value={'path': clocked}) as export:
                    asyncio.run(worker._run_job(job))
                self.assertEqual(export.call_count, expected)
                updated = db.get_project(p['id'])
                self.assertEqual(updated['status'], 'done')
                self.assertEqual(updated['stats']['master'], clocked if expected else original)
                if expected:
                    self.assertEqual(updated['stats']['original_master'], original)

    @unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
    def test_real_export_preserves_source_audio_duration_and_does_not_double_stamp(self):
        source = self.root/'master.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=navy:s=320x180:r=24:d=2',
                        '-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','2','-c:v','libx264',
                        '-threads','2','-pix_fmt','yuv420p','-c:a','aac',str(source)], check=True, capture_output=True)
        original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        p = db.create_project({'title':'Footage', 'category':'footage', 'slug':'clock_test',
                               'cctv_timestamp_start':'2026-11-16T23:59:59', 'stats':{'master':str(source)}})
        first = export_timestamp(p['id'])
        second = export_timestamp(p['id'], datetime(2026,11,15,19,30))
        self.assertEqual(second['source_path'], str(source.resolve()))
        self.assertNotEqual(first['path'], second['path'])
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original_hash)
        self.assertEqual(len(db.footage_exports(p['id'])), 2)
        info = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries',
                         'format=duration:stream=codec_type,width,height','-of','json',second['path']], text=True))
        self.assertAlmostEqual(float(info['format']['duration']), 2, delta=.15)
        self.assertTrue(any(s['codec_type']=='audio' for s in info['streams']))
        self.assertTrue(any(s.get('width')==320 and s.get('height')==180 for s in info['streams']))
