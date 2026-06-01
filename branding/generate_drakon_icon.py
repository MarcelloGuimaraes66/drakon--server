from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter


FRAME_SPECS: dict[int, dict[str, float | int | tuple[int, int]]] = {
    256: {"pad": 0, "gamma": 1.00, "cutoff": 0, "harden": 1.00, "unsharp": (1, 20)},
    128: {"pad": 0, "gamma": 0.98, "cutoff": 2, "harden": 1.01, "unsharp": (1, 30)},
    96: {"pad": 0, "gamma": 0.97, "cutoff": 3, "harden": 1.02, "unsharp": (1, 40)},
    64: {"pad": 0, "gamma": 0.95, "cutoff": 4, "harden": 1.03, "unsharp": (1, 50)},
    48: {"pad": 0, "gamma": 0.95, "cutoff": 4, "harden": 1.03, "unsharp": (1, 60)},
    40: {"pad": 0, "gamma": 0.92, "cutoff": 6, "harden": 1.04, "unsharp": (1, 70)},
    32: {"pad": 0, "gamma": 0.85, "cutoff": 10, "harden": 1.08, "unsharp": (1, 120)},
    24: {"pad": 0, "gamma": 0.90, "cutoff": 10, "harden": 1.06, "unsharp": (1, 60)},
    20: {"pad": 1, "gamma": 0.92, "cutoff": 8, "harden": 1.04, "unsharp": (1, 40)},
    16: {"pad": 1, "gamma": 0.94, "cutoff": 8, "harden": 1.04, "unsharp": (1, 30)},
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate the Drakon .ico with hand-tuned small frames."
    )
    parser.add_argument(
        "--debug-dir",
        type=Path,
        default=None,
        help="Optional directory for keeping the generated per-size PNG frames.",
    )
    return parser.parse_args()


def alpha_curve(image: Image.Image, gamma: float, cutoff: int, harden: float) -> Image.Image:
    red, green, blue, alpha = image.split()
    lut: list[int] = []
    for value in range(256):
        if value <= cutoff:
            lut.append(0)
            continue
        adjusted = (value / 255.0) ** gamma
        adjusted = max(0.0, min(1.0, adjusted * harden))
        lut.append(int(round(adjusted * 255)))
    return Image.merge("RGBA", (red, green, blue, alpha.point(lut)))


def split_layers(source: Image.Image) -> tuple[Image.Image, Image.Image]:
    white = Image.new("RGBA", source.size, (255, 255, 255, 0))
    cyan = Image.new("RGBA", source.size, (31, 185, 201, 0))
    source_pixels = source.load()
    white_pixels = white.load()
    cyan_pixels = cyan.load()

    for y in range(source.height):
        for x in range(source.width):
            red, green, blue, alpha = source_pixels[x, y]
            if alpha == 0:
                continue
            if green > 100 and blue > 100 and red < 100:
                cyan_pixels[x, y] = (31, 185, 201, alpha)
            else:
                white_pixels[x, y] = (255, 255, 255, alpha)

    return white, cyan


def render_frame(
    white_layer: Image.Image,
    cyan_layer: Image.Image,
    size: int,
    pad: int,
    gamma: float,
    cutoff: int,
    harden: float,
    unsharp: tuple[int, int],
) -> Image.Image:
    inner_height = size - (2 * pad)
    inner_width = max(1, round(white_layer.width * inner_height / white_layer.height))
    target_size = (inner_width, inner_height)

    white = white_layer.resize(target_size, Image.Resampling.LANCZOS)
    cyan = cyan_layer.resize(target_size, Image.Resampling.LANCZOS)
    white = alpha_curve(white, gamma=gamma, cutoff=cutoff, harden=harden)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    left = (size - white.width) // 2
    top = (size - white.height) // 2
    canvas.alpha_composite(white, (left, top))
    canvas.alpha_composite(cyan, (left, top))
    return canvas.filter(
        ImageFilter.UnsharpMask(radius=unsharp[0], percent=unsharp[1], threshold=0)
    )


def generate_frames(source_png: Path, output_dir: Path) -> list[Path]:
    source = Image.open(source_png).convert("RGBA")
    trimmed = source.crop(source.getbbox())
    white_layer, cyan_layer = split_layers(trimmed)

    frame_paths: list[Path] = []
    for size in sorted(FRAME_SPECS, reverse=True):
        spec = FRAME_SPECS[size]
        frame = render_frame(
            white_layer,
            cyan_layer,
            size=size,
            pad=int(spec["pad"]),
            gamma=float(spec["gamma"]),
            cutoff=int(spec["cutoff"]),
            harden=float(spec["harden"]),
            unsharp=tuple(spec["unsharp"]),  # type: ignore[arg-type]
        )
        frame_path = output_dir / f"drakon-{size}.png"
        frame.save(frame_path)
        frame_paths.append(frame_path)
    return frame_paths


def build_ico(frame_paths: list[Path], target_ico: Path) -> None:
    magick = shutil.which("magick")
    if not magick:
        raise FileNotFoundError("ImageMagick `magick` was not found on PATH.")

    target_ico.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([magick, *map(str, frame_paths), str(target_ico)], check=True)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sync_icon(primary_ico: Path, workspace_root: Path) -> list[Path]:
    targets = [
        workspace_root / "AppHost" / "Resources" / "drakon.ico",
        workspace_root / "AppHost" / "generated" / "current_app_icon.ico",
        workspace_root
        / "Perceptrum"
        / "Perceptrum"
        / "generated"
        / "current_app_icon.ico",
        workspace_root / "Perceptrum" / "Perceptrum" / "Perceptrum.ico",
        workspace_root / "Perceptrum" / "Perceptrum" / "small.ico",
    ]

    for target in targets:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.resolve() == primary_ico.resolve():
            continue
        if target.exists() and file_sha256(target) == file_sha256(primary_ico):
            continue
        shutil.copy2(primary_ico, target)

    return targets


def main() -> None:
    args = parse_args()
    workspace_root = Path(__file__).resolve().parent.parent
    source_png = workspace_root / "AppHost" / "Resources" / "drakon_white.png"
    if not source_png.exists():
        raise FileNotFoundError(f"Source PNG not found: {source_png}")

    if args.debug_dir:
        args.debug_dir.mkdir(parents=True, exist_ok=True)
        frame_dir = args.debug_dir
        cleanup_dir = None
    else:
        cleanup_dir = tempfile.TemporaryDirectory(prefix="drakon-icon-")
        frame_dir = Path(cleanup_dir.name)

    try:
        frame_paths = generate_frames(source_png, frame_dir)
        primary_ico = workspace_root / "AppHost" / "Resources" / "drakon.ico"
        build_ico(frame_paths, primary_ico)
        synced_paths = sync_icon(primary_ico, workspace_root)
    finally:
        if cleanup_dir is not None:
            cleanup_dir.cleanup()

    print(f"Source PNG: {source_png}")
    print(f"Generated ICO: {workspace_root / 'AppHost' / 'Resources' / 'drakon.ico'}")
    print("Synced targets:")
    for path in synced_paths:
        print(f" - {path}")


if __name__ == "__main__":
    main()
