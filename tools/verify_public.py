"""Fail deployment if files outside the reviewed public asset set are present."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
EXPECTED = {
    'index.html', 'app.js', 'styles.css', 'public.css', 'recorder-worklet.js',
    '.nojekyll', 'robots.txt', 'assets/script.json', 'assets/script.txt', 'assets/reference006.wav',
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
    assert len(script['sentences']) == 15
    reference = script['reference']
    assert reference['id'] == '006' and reference['url'] == 'assets/reference006.wav'
    audio = (SITE / reference['url']).read_bytes()
    assert hashlib.sha256(audio).hexdigest() == reference['sha256']
    assert reference['sha256'] == 'fdcd76606fb62d71de7242004847fba4052fc0c4b1c4dee5eba93f493a153182'
    assert len(audio) == reference['bytes']
    assert 'reference_sha256' not in script
    source = (SITE / 'assets/script.txt').read_bytes()
    assert hashlib.sha256(source).hexdigest() == script['script_sha256']
    assert source.decode('utf-8') == script['source_text']
    assert 'noindex' in (SITE / 'index.html').read_text(encoding='utf-8')
    print(f'PASS: {len(actual)} public assets, 15 sentences, only the specifically approved 006 audio; no other private assets.')


if __name__ == '__main__':
    main()
