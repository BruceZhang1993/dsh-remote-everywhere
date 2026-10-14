"""Attach cached Maven POM license declarations and hashes to resolved artifacts."""
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from concurrent.futures import ThreadPoolExecutor
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parent.parent
options = set(sys.argv[1:])
if options - {'--osv', '--fetch-poms'}:
    raise RuntimeError('usage: android-inventory.py [--fetch-poms] [--osv]')
source = root / '.cache/m4/android-artifacts.json'
inventory = json.loads(source.read_text())
cache = Path.home() / '.gradle/caches/modules-2/files-2.1'
pom_cache = root / '.cache/m4/maven-poms'
pom_cache.mkdir(exist_ok=True)
fetch_errors = []
if '--fetch-poms' in options:
    coordinates = {(a['group'], a['name'], a['version']) for a in inventory['artifacts']}
    def fetch_pom(coordinate):
        group, name, version = coordinate
        if list((cache / group / name / version).glob('*/*.pom')):
            return
        path = pom_cache / f'{group}--{name}--{version}.pom'
        if path.exists():
            return
        base = 'https://dl.google.com/dl/android/maven2' if group.startswith(('androidx.', 'com.google.android.')) else 'https://repo.maven.apache.org/maven2'
        url = f'{base}/{group.replace(".", "/")}/{name}/{version}/{name}-{version}.pom'
        try:
            with urlopen(url, timeout=15) as response:
                data = response.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                raise RuntimeError('POM exceeds size budget')
            ET.fromstring(data)
            path.write_bytes(data)
        except MemoryError:
            raise
        except Exception as error:
            return {'coordinate': ':'.join(coordinate), 'error': str(error), 'url': url}
    with ThreadPoolExecutor(max_workers=4) as executor:
        fetch_errors = [error for error in executor.map(fetch_pom, sorted(coordinates)) if error]
packages = {}
for artifact in inventory['artifacts']:
    coordinate = f"{artifact['group']}:{artifact['name']}:{artifact['version']}"
    if coordinate in packages:
        packages[coordinate]['artifacts'].append({k: artifact[k] for k in ('file', 'sha256')})
        continue
    poms = sorted((cache / artifact['group'] / artifact['name'] / artifact['version']).glob('*/*.pom'))
    fetched = pom_cache / f"{artifact['group']}--{artifact['name']}--{artifact['version']}.pom"
    if not poms and fetched.exists():
        poms = [fetched]
    licenses, hashes = [], []
    for pom in poms:
        data = pom.read_bytes()
        document = ET.fromstring(data)
        hashes.append(hashlib.sha256(data).hexdigest())
        for license_node in document.findall('.//{*}licenses/{*}license'):
            licenses.append({key: license_node.findtext('{*}' + key) for key in ('name', 'url')})
    packages[coordinate] = {
        'coordinate': coordinate, 'licenses': licenses, 'pomSha256': hashes,
        'artifacts': [{k: artifact[k] for k in ('file', 'sha256')}],
        'mavenMetadataPresent': bool(poms),
    }
result = {
    'scope': 'resolved external Android release runtime artifacts; excludes local Flutter plugin projects, Gradle/SDK toolchain and Apple packages',
    'excludedProjectComponents': inventory['excludedProjectComponents'],
    'pomFetchErrors': fetch_errors,
    'sourceInventorySha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'packages': list(packages.values()),
    'note': 'POM license declarations and file hashes are evidence, not an independent license/security review',
}
(root / '.cache/m4/android-dependencies.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({
    'packages': len(packages),
    'missingArtifacts': [p['coordinate'] for p in packages.values() if any(not a['sha256'] for a in p['artifacts'])],
    'withoutPom': [p['coordinate'] for p in packages.values() if not p['mavenMetadataPresent']],
    'withoutLicenseDeclaration': [p['coordinate'] for p in packages.values() if p['mavenMetadataPresent'] and not p['licenses']],
}))
if '--osv' in options:
    scanned = list(packages.values())
    if not scanned or len(scanned) > 512:
        raise RuntimeError('unexpected Maven inventory size')
    queries = []
    for package in scanned:
        name, version = package['coordinate'].rsplit(':', 1)
        queries.append({'package': {'name': name, 'ecosystem': 'Maven'}, 'version': version})
    request = Request('https://api.osv.dev/v1/querybatch', data=json.dumps({'queries': queries}).encode(),
                      headers={'Content-Type': 'application/json'}, method='POST')
    with urlopen(request, timeout=30) as response:
        data = response.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise RuntimeError('OSV response exceeds size budget')
    results = json.loads(data)['results']
    if len(results) != len(scanned) or any(r.get('next_page_token') for r in results):
        raise RuntimeError('incomplete OSV response; do not treat as a clean audit')
    matches = [{'coordinate': p['coordinate'], 'vulnerabilities': r.get('vulns', [])}
               for p, r in zip(scanned, results) if r.get('vulns')]
    report = {'queriedAt': datetime.now(timezone.utc).isoformat(), 'source': 'https://api.osv.dev/v1/querybatch',
              'scanned': len(scanned), 'missingLicenseMetadata': [p['coordinate'] for p in packages.values() if not p['mavenMetadataPresent']],
              'matches': matches, 'note': 'Known advisory snapshot only; absence of matches does not prove package safety'}
    (root / '.cache/m4/android-osv.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'osvScanned': len(scanned), 'matches': len(matches)}))
    if matches:
        sys.exit(1)
