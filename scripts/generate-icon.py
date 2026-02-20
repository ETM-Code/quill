from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SRC_TAURI_ICONS = ROOT / "src-tauri" / "icons"
PUBLIC_DIR = ROOT / "public"


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def make_gradient(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        ty = y / (size - 1)
        for x in range(size):
            tx = x / (size - 1)
            t = (tx * 0.45) + (ty * 0.55)
            r = lerp(18, 36, t)
            g = lerp(34, 94, t)
            b = lerp(54, 142, t)
            px[x, y] = (r, g, b, 255)
    return img


def make_icon(size: int = 1024) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    margin = int(size * 0.08)
    corner = int(size * 0.22)
    box = (margin, margin, size - margin, size - margin)

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (box[0], box[1] + int(size * 0.018), box[2], box[3] + int(size * 0.018)),
        radius=corner,
        fill=(0, 0, 0, 120),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(size * 0.02)))
    canvas.alpha_composite(shadow)

    plate = make_gradient(size)
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(box, radius=corner, fill=255)
    canvas.paste(plate, (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    stroke = int(size * 0.046)
    shaft = [
        (int(size * 0.24), int(size * 0.77)),
        (int(size * 0.77), int(size * 0.24)),
    ]
    draw.line(shaft, fill=(230, 244, 255, 255), width=stroke, joint="curve")

    nib = [
        (int(size * 0.67), int(size * 0.25)),
        (int(size * 0.78), int(size * 0.14)),
        (int(size * 0.88), int(size * 0.24)),
        (int(size * 0.77), int(size * 0.35)),
    ]
    draw.polygon(nib, fill=(255, 255, 255, 255))
    draw.polygon(
        [
            (int(size * 0.775), int(size * 0.195)),
            (int(size * 0.81), int(size * 0.23)),
            (int(size * 0.775), int(size * 0.265)),
            (int(size * 0.74), int(size * 0.23)),
        ],
        fill=(27, 53, 74, 210),
    )

    draw.ellipse(
        (
            int(size * 0.15),
            int(size * 0.67),
            int(size * 0.31),
            int(size * 0.83),
        ),
        fill=(118, 208, 244, 230),
    )
    draw.ellipse(
        (
            int(size * 0.2),
            int(size * 0.72),
            int(size * 0.26),
            int(size * 0.78),
        ),
        fill=(15, 74, 112, 255),
    )

    return canvas


def main() -> None:
    SRC_TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    icon = make_icon()
    source_png = SRC_TAURI_ICONS / "app-icon.png"
    icon.save(source_png, format="PNG")

    (icon.resize((32, 32), Image.Resampling.LANCZOS)).save(PUBLIC_DIR / "favicon-32x32.png")
    (icon.resize((16, 16), Image.Resampling.LANCZOS)).save(PUBLIC_DIR / "favicon-16x16.png")
    icon.resize((48, 48), Image.Resampling.LANCZOS).save(
        PUBLIC_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    icon.resize((180, 180), Image.Resampling.LANCZOS).save(PUBLIC_DIR / "apple-touch-icon.png")

    print(f"Generated icon source at {source_png}")


if __name__ == "__main__":
    main()
