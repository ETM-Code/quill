import subprocess
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SRC_TAURI_ICONS = ROOT / "src-tauri" / "icons"
PUBLIC_DIR = ROOT / "public"
SOURCE_SVG = ROOT / "quill.svg"
SOURCE_SIZE = 1024


def render_svg_to_png(svg_path: Path, png_path: Path, size: int) -> None:
    if not svg_path.exists():
        raise FileNotFoundError(f"Missing source logo: {svg_path}")

    command = [
        "rsvg-convert",
        "-w",
        str(size),
        "-h",
        str(size),
        "-o",
        str(png_path),
        str(svg_path),
    ]
    subprocess.run(command, check=True)

def main() -> None:
    SRC_TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    source_png = SRC_TAURI_ICONS / "app-icon.png"
    render_svg_to_png(SOURCE_SVG, source_png, SOURCE_SIZE)
    icon = Image.open(source_png).convert("RGBA")

    (icon.resize((32, 32), Image.Resampling.LANCZOS)).save(PUBLIC_DIR / "favicon-32x32.png")
    (icon.resize((16, 16), Image.Resampling.LANCZOS)).save(PUBLIC_DIR / "favicon-16x16.png")
    icon.resize((48, 48), Image.Resampling.LANCZOS).save(
        PUBLIC_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(PUBLIC_DIR / "apple-touch-icon.png")

    print(f"Generated icon source from {SOURCE_SVG} at {source_png}")


if __name__ == "__main__":
    main()
