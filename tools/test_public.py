"""Exercise the recorder with a fake microphone, without real participant data."""
import argparse
import csv
import io
import json
import hashlib
import math
import struct
from urllib.parse import urlsplit
from pathlib import Path
import wave
import zipfile

from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://localhost:8766/preview/')
    parser.add_argument('--output', type=Path, default=Path('/tmp/mogomogo-public-check'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=[
            '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        ])
        context = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
        page = context.new_page()
        errors = []
        requests = []
        page.on('request', lambda req: requests.append((req.method, req.url)))
        page.on('pageerror', lambda exc: errors.append(str(exc)))
        # An unversioned script may still be stale in an existing user's cache.
        # It must not be requested after this release.
        page.route('**/app.js', lambda route: route.fulfill(
            body='throw new Error("Stale unversioned app.js requested");',
            content_type='application/javascript'))
        page.goto(args.url)
        versions = page.evaluate("""() => [...document.querySelectorAll('script[src], link[rel="stylesheet"]')]
            .map(el => new URL(el.src || el.href))
            .filter(url => /\\/(app|spectrum)\\.js$|\\/(styles|public|spectrum)\\.css$/.test(url.pathname))
            .map(url => url.searchParams.get('v'))""")
        assert len(versions) == 5 and len(set(versions)) == 1 and versions[0], versions
        page.locator('#guide-dialog .primary').click()
        page.wait_for_function('() => document.querySelectorAll(".sentence-item").length === 15')
        assert page.locator('#sentence-text ruby').count() > 0
        assert page.locator('#reference-audio, #reference-file, .reference-section').count() == 0
        assert page.evaluate('() => !state.script.reference && !state.script.reference_sha256')
        page.screenshot(path=str(args.output / 'desktop-ready.png'), full_page=True)
        page.locator('#enable-microphone').click()
        page.wait_for_function('() => !document.querySelector("#record-button").disabled')
        page.locator('#countdown-toggle').uncheck()


        expect(page.locator('#frequency-status')).to_have_text('モニター中')
        # Verify the actual microphone branch before adding a separate test oscillator.
        page.wait_for_function('() => liveSpectrum.data && Math.max(...liveSpectrum.data) > -90', timeout=15000)
        # Inject known tones only into the visualization branch, not the PCM recorder.
        page.evaluate("""() => {
            state.source.disconnect(state.analyser);
            const oscillator = state.context.createOscillator();
            const gain = state.context.createGain();
            const sink = state.context.createGain();
            gain.gain.value = 0.2; sink.gain.value = 0;
            oscillator.connect(gain); gain.connect(state.analyser);
            state.analyser.connect(sink); sink.connect(state.context.destination);
            oscillator.frequency.value = 1000; oscillator.start();
            window.spectrumTest = {oscillator, gain, sink};
        }""")
        def check_tone(hz):
            page.evaluate('(hz) => spectrumTest.oscillator.frequency.value = hz', hz)
            page.wait_for_timeout(500)
            actual = page.evaluate("""() => {
                const data = liveSpectrum.data;
                const peak = data.indexOf(Math.max(...data));
                return peak * state.context.sampleRate / state.analyser.fftSize;
            }""")
            assert abs(actual - hz) < 60, (hz, actual)
            row = page.evaluate("""() => {
                const data = liveSpectrum.historyContext.getImageData(179, 0, 1, 128).data;
                let best = 0;
                for (let row = 1; row < 128; row++) {
                    if (data[row * 4] > data[best * 4]) best = row;
                }
                return best;
            }""")
            assert abs((127 - row) / 128 * 8000 - hz) < 160, (hz, row)

        check_tone(1000)
        before = page.locator('#frequency-canvas').evaluate('(c) => c.toDataURL()')
        check_tone(2000)
        after = page.locator('#frequency-canvas').evaluate('(c) => c.toDataURL()')
        assert before != after
        for width in [390, 1440]:
            page.set_viewport_size({'width': width, 'height': 1050})
            for mode in ['spectrum', 'spectrogram']:
                button = page.locator(f'[data-frequency-view="{mode}"]')
                button.click()
                expect(button).to_have_attribute('aria-pressed', 'true')
                page.wait_for_timeout(150)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                assert page.locator('#frequency-canvas').evaluate('(c) => c.clientHeight === 154 && c.clientWidth > 150')
                page.locator('.recording-surface').screenshot(path=str(args.output / f'{mode}-{width}.png'))
        page.evaluate("""() => {
            spectrumTest.oscillator.stop(); spectrumTest.gain.disconnect();
            state.analyser.disconnect(spectrumTest.sink); spectrumTest.sink.disconnect();
            state.source.connect(state.analyser); delete window.spectrumTest;
        }""")
        page.locator('#enable-microphone').click()
        expect(page.locator('#frequency-status')).to_have_text('マイク未接続')
        assert page.evaluate('() => liveSpectrum.historyContext.getImageData(0, 0, 180, 128).data.every(v => v === 0)')
        page.locator('#enable-microphone').click()
        expect(page.locator('#frequency-status')).to_have_text('モニター中')

        def record():
            page.locator('#record-button').click()
            page.wait_for_function('() => document.body.classList.contains("recording")')
            page.wait_for_timeout(1600)
            expect(page.locator('#frequency-status')).to_have_text('録音中')
            assert page.locator('#waveform').evaluate('(c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0)')
            page.locator('#stop-button').click()
            page.wait_for_function('() => !document.querySelector("#record-button").disabled')

        record()
        assert page.locator('#take-select option').count() == 1
        page.locator('#rating').select_option('2')
        page.wait_for_timeout(100)
        page.locator('#take-note').fill('テスト録音')
        page.locator('#take-note').blur()
        page.wait_for_timeout(100)
        with page.expect_download() as download_info:
            page.locator('#download-take').click()
        individual = args.output / download_info.value.suggested_filename
        download_info.value.save_as(individual)
        with wave.open(str(individual)) as audio:
            assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
            assert audio.getnframes() / audio.getframerate() > 1
            assert any(audio.readframes(audio.getnframes()))
        record()
        assert page.locator('#take-select option').count() == 2
        page.locator('#take-select').select_option(index=0)
        page.locator('#accept-next').click()
        page.wait_for_function('() => document.querySelector("#position-status").textContent === "H · 02 / 15"')
        assert page.locator('#progress-text').inner_text() == '1 / 30'
        page.locator('.sentence-item').first.click()
        page.locator('#mode-m').click()
        instruction = '「自分の喋っている内容を相手に伝える気がない」喋り方をする人を演じて，相手に伝わらないほど不明瞭に喋ってください'
        expect(page.locator('#mode-instruction')).to_have_text(instruction)
        expect(page.locator('.guide-entry').nth(1).locator('p')).to_have_text(instruction)
        record()
        page.locator('#rating').select_option('4')
        page.wait_for_timeout(100)
        page.locator('#accept-next').click()
        page.wait_for_function('() => document.querySelector("#progress-text").textContent === "2 / 30"')
        page.locator('#practice-button').click()
        page.locator('#practice-start').click()
        page.wait_for_function('() => document.body.classList.contains("recording")')
        page.wait_for_timeout(1100)
        page.locator('#practice-stop').click()
        page.wait_for_function('() => !document.querySelector("#practice-audio").hidden')
        page.locator('#practice-dialog .close-dialog').click()
        # Prior instruction versions must remain readable without restoring old references.
        page.evaluate("""async () => {
            state.session.scriptSha256 = state.script.compatible_script_sha256[0];
            await saveSession();
            state.takes[0].reference = {id: 'withdrawn', source: 'bundled'};
            await put('takes', state.takes[0]);
        }""")
        page.reload()
        page.wait_for_function('() => document.querySelectorAll(".sentence-item").length === 15')
        page.wait_for_function('() => document.querySelector("#progress-text").textContent === "2 / 30"')
        page.locator('#export-button').click()
        with page.expect_download() as download_info:
            page.locator('#confirm-export').click()
        archive = args.output / download_info.value.suggested_filename
        download_info.value.save_as(archive)
        with zipfile.ZipFile(archive) as zipped:
            wavs = [name for name in zipped.namelist() if name.endswith('.wav')]
            assert len(wavs) == 3, wavs
            rows = list(csv.DictReader(io.StringIO(zipped.read('manifest.csv').decode('utf-8-sig'))))
            assert len(rows) == 3 and sum(row['selected'] == 'true' for row in rows) == 2
            first_h = next(row for row in rows if row['condition'] == 'H' and row['take'] == '1')
            assert first_h['mumbling_rating'] == '2' and first_h['note'] == 'テスト録音'
            pairs = list(csv.DictReader(io.StringIO(zipped.read('pairs.csv').decode('utf-8-sig'))))
            assert len(pairs) == 15 and pairs[0]['complete'] == 'true'
            assert all(row['complete'] == 'false' for row in pairs[1:])
            assert pairs[0]['clean_wav'].endswith('H_take01.wav')
            assert pairs[0]['mumbling_wav'].endswith('M_take01.wav')
            meta = json.loads(zipped.read('session.json'))
            assert len(meta['takes']) == 3 and meta['scriptSha256']
            assert all('reference' not in take for take in meta['takes'])
            assert meta['exportedScriptSha256']
            assert '参考音声' not in zipped.read('script.txt').decode('utf-8')
            assert len(wavs) == 3
        page.locator('#include-all').uncheck()
        with page.expect_download() as download_info:
            page.locator('#confirm-export').click()
        accepted_archive = args.output / 'selected-only.zip'
        download_info.value.save_as(accepted_archive)
        with zipfile.ZipFile(accepted_archive) as zipped:
            assert sum(name.endswith('.wav') for name in zipped.namelist()) == 2
        page.locator('#export-dialog .close-dialog').click()
        page.locator('.sentence-item').first.click()
        page.screenshot(path=str(args.output / 'desktop-recorded.png'), full_page=True)
        original_session = page.locator('#session-select').input_value()
        page.locator('#new-session').click()
        page.wait_for_function('() => document.querySelector("#progress-text").textContent === "0 / 30"')
        page.locator('#session-select').select_option(original_session)
        page.wait_for_function('() => document.querySelector("#progress-text").textContent === "2 / 30"')
        for width in [390, 650, 1024, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            page.wait_for_timeout(150)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), width
            for sentence in [0, 9, 10, 11, 14]:
                page.locator('.sentence-item').nth(sentence).click()
                page.wait_for_timeout(100)
                assert page.locator('#sentence-text').evaluate('(e) => e.scrollWidth <= e.clientWidth'), (width, sentence)
            if width == 390:
                page.screenshot(path=str(args.output / 'mobile.png'), full_page=True)
        page.set_viewport_size({'width': 1440, 'height': 1050})
        page.locator('#enable-microphone').click()
        page.wait_for_function('() => !document.querySelector("#record-button").disabled')
        page.locator('#countdown-toggle').check()
        page.locator('#record-button').click()
        page.wait_for_function('() => !document.querySelector("#countdown").hidden')
        page.locator('#stop-button').click(force=True)
        page.wait_for_timeout(3300)
        assert not page.evaluate('document.body.classList.contains("recording")')
        second_tab = context.new_page()
        second_tab.goto(args.url)
        second_tab.wait_for_function('() => document.querySelector("#error-banner").textContent.includes("別のタブ")')
        assert second_tab.locator('#record-button').is_disabled()
        second_tab.close()
        origin = urlsplit(args.url).netloc
        assert all(method == 'GET' for method, url in requests), requests
        assert all(url.startswith('blob:') or urlsplit(url).netloc == origin for method, url in requests), requests
        assert not any(urlsplit(url).path.endswith(('.wav', '.mp3', '.m4a', '.ogg', '.flac')) for method, url in requests), requests
        assert not errors, errors
        denied = browser.new_context()
        denied_page = denied.new_page()
        denied_page.add_init_script("navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test rejection', 'NotAllowedError'); }")
        denied_page.goto(args.url)
        denied_page.locator('#guide-dialog .primary').click()
        denied_page.locator('#enable-microphone').click()
        denied_page.wait_for_function('() => document.querySelector("#error-banner").textContent.includes("許可されていません")')
        assert denied_page.locator('#record-button').is_disabled()
        denied.close()
        recovery = browser.new_context(accept_downloads=True)
        recovery_page = recovery.new_page()
        recovery_page.goto(args.url)
        recovery_page.locator('#guide-dialog .primary').click()
        recovery_page.locator('#enable-microphone').click()
        recovery_page.wait_for_function('() => !document.querySelector("#record-button").disabled')
        recovery_page.locator('#countdown-toggle').uncheck()
        recovery_page.locator('#record-button').click()
        recovery_page.wait_for_function('() => document.body.classList.contains("recording")')
        recovery_page.wait_for_timeout(1200)
        recovery_page.evaluate('state.db.close()')
        recovery_page.locator('#stop-button').click()
        recovery_page.wait_for_function('() => document.querySelector("#error-banner").textContent.includes("保存できませんでした")')
        assert recovery_page.locator('#new-session').is_disabled()
        assert recovery_page.locator('#record-button').is_disabled()
        with recovery_page.expect_download() as download_info:
            recovery_page.locator('#download-take').click()
        download_info.value.save_as(args.output / 'storage-failure-recovery.wav')
        recovery.close()
        browser.close()
        print(json.dumps({'status': 'passed', 'checks': ['no reference player or audio requests', 'legacy sessions retained without reference metadata', 'no upload requests', 'project-subpath URLs', '15 sentences with ruby', 'PCM16 recording', 'retakes', 'ratings and notes', 'selected H/M pair', 'practice excluded', 'reload recovery', 'ZIP and CSV', 'session switching', 'responsive layouts', 'countdown cancellation', 'single tab lock', 'microphone denial', 'storage-failure WAV recovery', 'nonblank waveform', 'versioned assets bypass stale recorder cache', 'live microphone FFT before test injection', 'live FFT tone peaks and heatmap pixels', 'spectrum view switching', 'disconnect clears spectrum', 'desktop/mobile spectrum canvases'], 'screenshots': str(args.output)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
