"""Verify that the fuzz oracle detects injected faults and replays a fix."""
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urljoin

root = Path(__file__).resolve().parent.parent
project = root / 'packages/core/dart'
dart = os.environ.get('DART_BIN', 'dart')
config_path = project / '.dart_tool/package_config.json'
config = json.loads(config_path.read_text())

with TemporaryDirectory(prefix='dsh-dart-fuzz-') as temporary:
    fixture = Path(temporary)
    target = fixture / 'packages/core/dart'
    (target / 'bin').mkdir(parents=True)
    shutil.copytree(project / 'lib', target / 'lib')
    shutil.copy(project / 'bin/coverage_fuzz.dart', target / 'bin')
    shutil.copy(project / 'pubspec.lock', target)
    for package in config['packages']:
        package['rootUri'] = (target.as_uri() + '/' if package['name'] == 'dsh_remote_core'
                              else urljoin(config_path.as_uri(), package['rootUri']))
    (target / 'package_config.json').write_text(json.dumps(config))
    guard = target / 'lib/bounded_websocket.dart'
    original = guard.read_text()
    report = fixture / '.cache/dart-fuzz/report.json'
    replay = fixture / 'replay.json'

    def run(value):
        replay.write_text(json.dumps({'input': base64.b64encode(bytes(value)).decode()}))
        result = subprocess.run([dart, '--enable-vm-service=0', '--no-serve-devtools',
                                 '--packages=' + str(target / 'package_config.json'),
                                 str(target / 'bin/coverage_fuzz.dart'), '--replay', str(replay)],
                                capture_output=True, text=True, timeout=30)
        # Do not print the VM service URL/auth code captured from the subprocess.
        data = json.loads(report.read_text())
        return result.returncode, data

    sample = [3, 1, 2, 3, 4]
    status, data = run(sample)
    assert status == 0 and data['passed'] and data['replayed'], 'valid reassembly failed'

    marker = '    if (_opcode < 8 && !_fin) return;'
    assert original.count(marker) == 1
    guard.write_text(original.replace(marker, '    if (_opcode == 9) _message.clear();\n' + marker))
    status, failure = run(sample)
    assert status != 0 and failure['passed'] is False, 'data-loss mutant escaped the oracle'
    assert base64.b64decode(failure['input']) == bytes(sample), 'failure input was not preserved'

    guard.write_text(original)
    status, data = run(base64.b64decode(failure['input']))
    assert status == 0 and data['passed'], 'saved failure did not replay after restoring the fix'

    marker = "    if (_failed) throw const FormatException('WebSocket guard already failed');"
    assert original.count(marker) == 1
    guard.write_text(original.replace(marker, "    throw StateError('synthetic unexpected parser error');"))
    status, data = run([1, 130, 0])
    assert status != 0 and data['passed'] is False and data['error'] == 'StateError', 'unexpected error was swallowed'

print(json.dumps({'oracleChecks': 4, 'passed': True, 'productionFilesModified': False}))
