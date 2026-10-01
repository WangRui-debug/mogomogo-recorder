"""Create a verified repository archive, excluding git history and local recordings."""
from zipfile import ZIP_DEFLATED, ZipFile
from verify_public import ROOT, REPO_FILES, main as verify


if __name__ == '__main__':
    verify()
    output = ROOT.parent / 'recording_studio_github_pages.zip'
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for name in sorted(REPO_FILES):
            archive.write(ROOT / name, name)
    with ZipFile(output) as archive:
        assert archive.testzip() is None
    print(output)
