"""Generate the lazy, origin-clean texture used when opening local HTML,
and refresh the cache-busting hashes of the water asset references."""
import base64
import hashlib
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
assets = root / 'assets'
webp = assets / 'water-caustics.webp'
data_js = assets / 'water-caustics-data.js'

encoded = base64.b64encode(webp.read_bytes()).decode('ascii')
data_js.write_text(
    '// Generated from water-caustics.webp for origin-clean local WebGL textures.\n'
    f'window.Cet6WaterTexture = "data:image/webp;base64,{encoded}";\n',
    encoding='utf-8',
)

webp_hash = hashlib.sha256(webp.read_bytes()).hexdigest()[:12]
data_hash = hashlib.sha256(data_js.read_bytes()).hexdigest()[:12]
pattern_webp = re.compile(r'assets/water-caustics\.webp(?:\?v=[a-f0-9]+)?')
pattern_data = re.compile(r'assets/water-caustics-data\.js(?:\?v=[a-f0-9]+)?')
for name in ('appearance.css', 'glass-renderer.js'):
    path = root / name
    text = path.read_text(encoding='utf-8')
    text = pattern_webp.sub(f'assets/water-caustics.webp?v={webp_hash}', text)
    text = pattern_data.sub(f'assets/water-caustics-data.js?v={data_hash}', text)
    path.write_text(text, encoding='utf-8', newline='\n')

print(f'[texture] {webp.name} {webp.stat().st_size} bytes  webp?v={webp_hash}  data?v={data_hash}')
