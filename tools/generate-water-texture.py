"""Generate the lazy, origin-clean texture used when opening local HTML."""
import base64
from pathlib import Path

assets = Path(__file__).resolve().parent.parent / 'assets'
encoded = base64.b64encode((assets / 'water-caustics.webp').read_bytes()).decode('ascii')
(assets / 'water-caustics-data.js').write_text(
    '// Generated from water-caustics.webp for origin-clean local WebGL textures.\n'
    f'window.Cet6WaterTexture = "data:image/webp;base64,{encoded}";\n',
    encoding='utf-8',
)
