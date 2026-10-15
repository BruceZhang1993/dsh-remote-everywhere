"""Collect actual Android archive notices for review; do not infer legal approval."""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

root = Path(__file__).resolve().parent.parent
inventory_file = root / '.cache/m4/android-dependencies.json'
inventory = json.loads(inventory_file.read_text())
supplement_file = root / 'docs/android-license-evidence.json'
supplement = json.loads(supplement_file.read_text())
evidence = {p['coordinate']: p for p in supplement['packages']}
destination = root / '.cache/m4/android-notices'
destination.mkdir(exist_ok=True)
texts, packages = {}, []
total_text_bytes = 0


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def retain(data, origin):
    global total_text_bytes
    if len(data) > 2 * 1024 * 1024:
        raise RuntimeError('individual notice exceeds budget')
    key = hashlib.sha256(data).hexdigest()
    if key not in texts:
        total_text_bytes += len(data)
        if len(texts) >= 256 or total_text_bytes > 16 * 1024 * 1024:
            raise RuntimeError('aggregate notices exceed budget')
        # Preserve original bytes/hash; fail instead of silently replacing text.
        data.decode('utf-8-sig')
        (destination / f'{key}.txt').write_bytes(data)
        texts[key] = {'origins': [], 'bytes': len(data)}
    texts[key]['origins'].append(origin)
    return key


def inspect(archive, origin, depth=0):
    notices, native, uninspected = [], [], []
    entries = archive.infolist()
    if len(entries) > 20000:
        raise RuntimeError('archive entry count exceeds budget')
    for entry in entries:
        if entry.is_dir():
            continue
        name = PurePosixPath(entry.filename).name
        location = f'{origin}!{entry.filename}'
        if re.match(r'^(licen[sc]e|notice|copying|copyright)(?:$|[._-])', name, re.I):
            if entry.file_size > 2 * 1024 * 1024:
                raise RuntimeError('notice entry exceeds budget')
            notices.append({'entry': location, 'sha256': retain(archive.read(entry), location)})
        elif name.endswith('.so'):
            if entry.file_size > 512 * 1024 * 1024:
                raise RuntimeError('native entry exceeds budget')
            with archive.open(entry) as stream:
                sha = hashlib.file_digest(stream, 'sha256').hexdigest()
            native.append({'entry': location, 'bytes': entry.file_size, 'sha256': sha})
        elif name.endswith('.jar'):
            if depth >= 1 or entry.file_size > 32 * 1024 * 1024:
                uninspected.append(location)
                continue
            with zipfile.ZipFile(io.BytesIO(archive.read(entry))) as nested:
                n, b, u = inspect(nested, location, depth + 1)
                notices.extend(n); native.extend(b); uninspected.extend(u)
    return notices, native, uninspected


if hashlib.sha256(inventory_file.read_bytes()).hexdigest() != supplement['inventorySha256']:
    raise RuntimeError('license supplement does not match the inventory')
for package in inventory['packages']:
    coordinate = package['coordinate']
    extra = evidence.get(coordinate)
    if extra and (extra['artifactSha256'] != [a['sha256'] for a in package['artifacts']]
                  or extra['pomSha256'] != package['pomSha256']):
        raise RuntimeError(f'stale supplemental evidence: {coordinate}')
    notices, native, uninspected = [], [], []
    for artifact in package['artifacts']:
        path = Path(artifact['file'])
        if digest(path) != artifact['sha256']:
            raise RuntimeError(f'artifact hash mismatch: {coordinate}')
        with zipfile.ZipFile(path) as archive:
            n, b, u = inspect(archive, f'{coordinate}/{path.name}')
            notices.extend(n); native.extend(b); uninspected.extend(u)
    licenses = package['licenses']
    names = [license['name'] for license in licenses]
    if extra and coordinate.startswith('io.flutter:'):
        category = 'flutter-aggregate'
    elif any('Terms of Service' in name for name in names):
        category = 'ml-kit-terms'
    elif 'Android Software Development Kit License' in names:
        category = 'android-sdk-license'
    elif (names and all('Apache' in name or name == 'BSD-3-Clause' for name in names)
          or extra and extra['license'] == 'Apache-2.0'):
        category = 'apache-with-bsd-review' if 'BSD-3-Clause' in names else 'apache'
    else:
        raise RuntimeError(f'unclassified license: {coordinate}')
    packages.append({'coordinate': coordinate, 'category': category, 'declaredLicenses': licenses,
                     'supplement': extra['evidence'] if extra else None,
                     'artifactSha256': [a['sha256'] for a in package['artifacts']],
                     'embeddedNotices': notices, 'nativeEntries': native, 'uninspectedArchives': uninspected})

apache = root / '.cache/m4/license-review/Apache-2.0.txt'
engine = root / '.cache/m4/license-review/sky_engine-LICENSE'
if digest(apache) != 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30':
    raise RuntimeError('canonical Apache license hash mismatch')
if digest(engine) != supplement['flutterEngine']['licenseSha256']:
    raise RuntimeError('engine license hash mismatch')
retain(apache.read_bytes(), 'https://www.apache.org/licenses/LICENSE-2.0.txt (canonical text; component notice review still required)')
retain(engine.read_bytes(), 'matching Flutter engine sky_engine/LICENSE; provenance in docs/android-license-evidence.json')
manifest = {'scope': 'actual external Android runtime archive metadata and notice preparation; excludes local plugins and Apple',
            'generatorSha256': digest(Path(__file__).resolve()),
            'inventorySha256': digest(inventory_file), 'supplementSha256': digest(supplement_file),
            'independentlyApproved': False, 'packages': packages, 'texts': texts}
bundle = ['ANDROID NOTICE REVIEW MATERIAL\n\nDeclarations and extracted texts are not distribution approval.\n']
for package in packages:
    bundle.append(f"{package['coordinate']} [{package['category']}]\n")
    for license in package['declaredLicenses']:
        bundle.append(f"  {license['name']}: {license['url']}\n")
for key, item in texts.items():
    bundle.append('\n' + '=' * 80 + '\n' + '\n'.join(item['origins']) + f'\nSHA-256: {key}\n\n')
    bundle.append((destination / f'{key}.txt').read_bytes().decode('utf-8-sig'))
(destination / 'THIRD_PARTY_NOTICES.txt').write_text(''.join(bundle))
(destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
counts = {category: sum(p['category'] == category for p in packages) for category in sorted({p['category'] for p in packages})}
print(json.dumps({'packages': len(packages), 'categories': counts, 'uniqueTexts': len(texts),
                  'packagesWithEmbeddedNotices': sum(bool(p['embeddedNotices']) for p in packages),
                  'nativeEntries': sum(len(p['nativeEntries']) for p in packages),
                  'uninspectedArchives': sum(len(p['uninspectedArchives']) for p in packages),
                  'bundleSha256': digest(destination / 'THIRD_PARTY_NOTICES.txt'),
                  'manifestSha256': digest(destination / 'manifest.json'), 'independentlyApproved': False}))
