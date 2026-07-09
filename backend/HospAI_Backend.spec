# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from pathlib import Path

ROOT = Path.cwd()
APP = ROOT / 'app.py'

datas = []

# Include Rapha logo in packaged build so PDF header works offline
_logo_sources = [
    # backend/assets/ — highest priority (beside app.py)
    (ROOT / 'assets' / 'rapha_logo.jpg', 'assets'),
    (ROOT / 'assets' / 'rapha_logo.png', 'assets'),
    # project root assets/
    (ROOT.parent / 'assets' / 'rapha_logo.jpg', 'assets'),
    (ROOT.parent / 'assets' / 'rapha_logo.png', 'assets'),
    # frontend/public/
    (ROOT.parent / 'frontend' / 'public' / 'rapha_logo.jpg', 'frontend/public'),
    (ROOT.parent / 'frontend' / 'public' / 'rapha_logo.png', 'frontend/public'),
]
for _src, _dest in _logo_sources:
    if _src.exists():
        datas.append((str(_src), _dest))

hiddenimports = collect_submodules('utils')

a = Analysis(
    [str(APP)],
    pathex=[str(ROOT), str(ROOT.parent)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter','matplotlib','pytest','tests'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='HospAI_Backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
