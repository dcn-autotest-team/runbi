#!/usr/bin/env python3
"""
scripts/generate_icons.py
Generate multi-size PNG icons for Runbi Chrome Extension from assets/icon_app.jpg.
Sizes: 16x16, 32x32, 48x48, 128x128.
"""

from PIL import Image
import os
import sys

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    root_dir = os.path.dirname(script_dir)
    source_icon = os.path.join(root_dir, "assets", "icon_app.jpg")
    output_dir = os.path.join(root_dir, "public", "icons")
    sizes = [16, 32, 48, 128]

    if not os.path.exists(source_icon):
        print(f"Error: source icon not found at {source_icon}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)
    img = Image.open(source_icon)

    for size in sizes:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        out_path = os.path.join(output_dir, f"icon-{size}.png")
        resized.save(out_path, "PNG")
        print(f"Generated: {out_path} ({size}x{size} px)")

    print("All Chrome Extension icons generated successfully!")

if __name__ == "__main__":
    main()
