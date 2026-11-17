FOOTAGE_PREFIXES = ('strange_footages_', 'lorena_camera_seguranca_', 'lorena_pterodactilo_')


def infer_category(slug: str) -> str:
    return 'footage' if slug.lower().startswith(FOOTAGE_PREFIXES) else 'general'


def default_footage_time(slug: str) -> str:
    # Fictional production clocks, selected to match each script's lighting.
    cases = {
        '01': '2026-11-12T19:08:12', '02': '2026-11-10T23:17:04',
        '03': '2026-11-11T21:06:38', '04': '2026-11-09T02:14:27',
        '05': '2026-11-13T18:48:16', '06': '2026-11-08T21:32:09',
        '07': '2026-11-14T00:46:52', '08': '2026-11-12T22:11:33',
        '09': '2026-11-07T20:39:18', '10': '2026-11-15T01:23:45',
    }
    if slug.startswith('strange_footages_'):
        return cases.get(slug.removeprefix('strange_footages_')[:2], '2026-11-12T19:08:12')
    return '2026-11-13T18:47:10'
