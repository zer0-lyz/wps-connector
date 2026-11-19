#!/usr/bin/env bash
set -euo pipefail

runtime="${WPS_CONNECTOR_RUNTIME_ROOT:-$HOME/.local/share/wps-connector/runtime}"
profile="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
if [[ ! -f "$runtime/deepseek/index.js" || ! -f "$runtime/apps/shared/toolSchemas.js" ]]; then
  echo "WPS Connector runtime is missing; install or deploy it first." >&2
  exit 1
fi
if [[ ! -f "$profile/cordis.patch.yml" || ! -d "$profile/node_modules/@local" ]]; then
  echo "DeepSeek Desktop profile is missing; start DeepSeek Harness once first." >&2
  exit 1
fi
python3 - "$runtime" "$profile" <<'PY'
import os, re, shutil, sys, tempfile, time
from pathlib import Path
runtime, profile = map(Path, sys.argv[1:])
plugin = (runtime / 'deepseek').resolve()
link = profile / 'node_modules' / '@local' / 'wps-connector-deepseek'
patch = profile / 'cordis.patch.yml'
original = patch.read_bytes()
matches = list(re.finditer(rb'(?m)^[ \t]*- id:[ \t]*wps-connector-deepseek[ \t]*$', original))
if len(matches) > 1:
    raise SystemExit('Multiple WPS connector entries exist; repair the profile manually.')
if matches and not re.match(rb'[ \t]*name:[ \t]*["\']?@local/wps-connector-deepseek["\']?[ \t]*$', original[matches[0].end():].splitlines()[1] if len(original[matches[0].end():].splitlines()) > 1 else b''):
    raise SystemExit('Existing WPS connector entry has a different package; repair it manually.')
if link.is_symlink():
    allowed = {plugin, (runtime.parent / 'source' / 'deepseek').resolve()}
    if link.resolve() not in allowed or not (link.resolve() / 'index.js').is_file():
        raise SystemExit('Existing WPS connector link points elsewhere; repair it manually.')
elif link.exists():
    raise SystemExit('A different DeepSeek connector already occupies the target path.')
else:
    link.symlink_to(plugin, target_is_directory=True)
entry = b'\n- insert:\n    - id: wps-connector-deepseek\n      name: "@local/wps-connector-deepseek"\n      config: {}\n'
if not matches:
    backup = patch.with_name(patch.name + '.backup-wps-' + time.strftime('%Y%m%d-%H%M%S'))
    if backup.exists():
        raise SystemExit('A backup with this timestamp exists; retry later.')
    shutil.copy2(patch, backup)
    with tempfile.NamedTemporaryFile(dir=profile, prefix='.wps-patch-', delete=False) as f:
        temporary = Path(f.name)
        f.write(entry.lstrip(b'\n') if original.strip() == b'[]' else original + entry)
    try:
        os.chmod(temporary, patch.stat().st_mode & 0o777)
        if patch.read_bytes() != original:
            raise SystemExit('DeepSeek profile changed concurrently; retry setup.')
        os.replace(temporary, patch)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'DeepSeek configuration updated; backup: {backup}')
else:
    print('DeepSeek connector entry already exists; retained existing settings.')
print(f'Plugin link: {link}')
PY
