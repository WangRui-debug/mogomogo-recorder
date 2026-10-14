"""Fail deployment if files outside the reviewed public asset set are present."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
EXPECTED = {
    'index.html', 'app.js', 'spectrum.js', 'spectrum.css', 'styles.css', 'public.css', 'recorder-worklet.js',
    '.nojekyll', 'robots.txt', 'assets/script.json', 'assets/script.txt', 'assets/script-15.json',
    'vendor/lucide.min.js', 'vendor/lucide-LICENSE', 'vendor/jszip.min.js', 'vendor/jszip-LICENSE',
}
REPO_FILES = {
    'README.md', '.gitignore', '.github/workflows/pages.yml', 'preview.py',
    'tools/verify_public.py', 'tools/test_public.py', 'tools/package.py',
} | {f'site/{name}' for name in EXPECTED}


def main():
    actual = set()
    for path in ROOT.rglob('*'):
        relative = path.relative_to(ROOT)
        if '.git' in relative.parts or '__pycache__' in relative.parts:
            continue
        if path.is_symlink():
            raise ValueError(f'Symlink is not allowed: {relative}')
        if path.is_file():
            name = relative.as_posix()
            if name not in REPO_FILES:
                raise ValueError(f'Unreviewed file in public project: {name}')
            if name.startswith('site/'):
                actual.add(name.removeprefix('site/'))
                if name.endswith(('.html', '.js', '.json', '.txt')) and '/vendor/' not in name:
                    content = path.read_text(encoding='utf-8').lower()
                    for marker in ['hasegawa', '長谷川', 'softbank', '/home/rui.wang', '0aj4wjqrniwdbuk9pva', 'data:audio/']:
                        if marker in content:
                            raise ValueError(f'Private reference marker in {name}: {marker}')
    if actual != EXPECTED:
        raise ValueError(f'Public asset mismatch: missing={EXPECTED - actual}, extra={actual - EXPECTED}')
    script = json.loads((SITE / 'assets/script.json').read_text(encoding='utf-8'))
    assert len(script['sentences']) == 22
    assert [s['id'] for s in script['sentences']] == [f'{i:02d}' for i in range(1, 23)]
    assert not script['compatible_script_sha256']
    legacy = json.loads((SITE / 'assets/script-15.json').read_text(encoding='utf-8'))
    assert len(legacy['sentences']) == 15
    assert legacy['sentences'] == script['sentences'][:15]
    assert 'reference' not in legacy and 'reference_sha256' not in legacy
    assert hashlib.sha256(legacy['source_text'].encode('utf-8')).hexdigest() == legacy['script_sha256']
    assert 'reference' not in script and 'reference_sha256' not in script
    source = (SITE / 'assets/script.txt').read_bytes()
    assert hashlib.sha256(source).hexdigest() == script['script_sha256']
    assert source.decode('utf-8') == script['source_text']
    assert 'noindex' in (SITE / 'index.html').read_text(encoding='utf-8')
    print(f'PASS: {len(actual)} public assets, 22 sentences plus legacy 15-sentence script, no reference recordings or private assets.')


if __name__ == '__main__':
    main()
