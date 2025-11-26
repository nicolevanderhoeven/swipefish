from PIL import Image, ImageDraw, ImageFont
import textwrap
import csv
import os
import glob
import re
from pathlib import Path

# ------------- CONFIG -------------

# CSV with your roles (relative to script location)
SCRIPT_DIR = Path(__file__).parent
CSV_PATH = SCRIPT_DIR.parent / "roles" / "swipefish_roles.csv"

# Blank template (white rounded card, transparent outside, 1080 x 1920)
TEMPLATE_PATH = SCRIPT_DIR / "swipefish_blank_template_1080x1920.png"

# Output directory (img/roles/)
OUTPUT_DIR = SCRIPT_DIR.parent / "roles"

# Canvas / layout
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
PADDING = 80

# Fonts – update paths if needed for your OS
TITLE_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BODY_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

TITLE_FONT_SIZE = 120
BODY_FONT_SIZE = 64

# ------------- HELPERS -------------

def load_font(path, size, fallback_bold=False):
    """Load a TTF font with simple fallbacks."""
    try:
        return ImageFont.truetype(path, size=size)
    except Exception:
        try:
            if fallback_bold:
                return ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                    size=size,
                )
            else:
                return ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                    size=size,
                )
        except Exception:
            return ImageFont.load_default()


def lookup_role_from_csv(csv_path, role_number):
    """Return (role_title, tagline) for a given Role Number from the CSV."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Role Number") == role_number:
                return row.get("Role", "").strip(), row.get("Tagline", "").strip()
    raise ValueError(f"Role Number {role_number} not found in {csv_path}")


def compose_card(
    template_path: str,
    illustration_path: str,
    role_title: str,
    tagline: str,
    output_path: str,
):
    # Load template
    template = Image.open(template_path).convert("RGBA")
    W, H = template.size

    if (W, H) != (CANVAS_WIDTH, CANVAS_HEIGHT):
        template = template.resize((CANVAS_WIDTH, CANVAS_HEIGHT), Image.LANCZOS)
        W, H = CANVAS_WIDTH, CANVAS_HEIGHT

    img = template.copy()
    draw = ImageDraw.Draw(img)

    # Fonts
    title_font = load_font(TITLE_FONT_PATH, TITLE_FONT_SIZE, fallback_bold=True)
    body_font = load_font(BODY_FONT_PATH, BODY_FONT_SIZE)

    # ---------- Top icons (X + heart) ----------

    icon_offset_y = 80
    icon_size = 80

    # Grey X
    x_center = PADDING + icon_size // 2
    y_center = icon_offset_y + icon_size // 2
    line_width = 10
    draw.line(
        (x_center - 25, y_center - 25, x_center + 25, y_center + 25),
        fill=(150, 150, 150, 255),
        width=line_width,
    )
    draw.line(
        (x_center + 25, y_center - 25, x_center - 25, y_center + 25),
        fill=(150, 150, 150, 255),
        width=line_width,
    )

    # Red heart
    heart_center_x = W - PADDING - icon_size // 2
    heart_center_y = y_center
    r = 26
    circle_box1 = [
        heart_center_x - r - 10,
        heart_center_y - r,
        heart_center_x - 10,
        heart_center_y + r,
    ]
    circle_box2 = [
        heart_center_x + 10,
        heart_center_y - r,
        heart_center_x + r + 10,
        heart_center_y + r,
    ]
    draw.ellipse(circle_box1, fill=(234, 84, 103, 255))
    draw.ellipse(circle_box2, fill=(234, 84, 103, 255))
    triangle = [
        (heart_center_x - r - 10, heart_center_y + 5),
        (heart_center_x + r + 10, heart_center_y + 5),
        (heart_center_x, heart_center_y + r + 35),
    ]
    draw.polygon(triangle, fill=(234, 84, 103, 255))

    # ---------- Title ----------

    title_text = role_title.upper()
    tw, th = draw.textsize(title_text, font=title_font)
    title_y = icon_offset_y + icon_size + 40
    draw.text(
        ((W - tw) / 2, title_y),
        title_text,
        font=title_font,
        fill=(25, 39, 52, 255),
    )

    # ---------- Illustration placement ----------

    illus_top = title_y + th + 60
    illus_bottom = int(H * 0.62)
    illus_height = illus_bottom - illus_top

    art = Image.open(illustration_path).convert("RGBA")
    aw, ah = art.size

    max_art_width = int(W * 0.70)
    max_art_height = int(illus_height)
    scale = min(max_art_width / aw, max_art_height / ah, 1.0)
    new_size = (int(aw * scale), int(ah * scale))
    art_resized = art.resize(new_size, Image.LANCZOS)

    aw2, ah2 = art_resized.size
    art_x = (W - aw2) // 2
    art_y = int(illus_top + (illus_height - ah2) / 2)

    img.alpha_composite(art_resized, (art_x, art_y))

    # ---------- Tagline (wrapped + centered) ----------

    wrapped = textwrap.fill(tagline, width=26)
    lines = wrapped.split("\n")

    line_heights = []
    for line in lines:
        _, lh = draw.textsize(line, font=body_font)
        line_heights.append(lh)
    total_height = sum(line_heights) + (len(lines) - 1) * 10

    tag_y = int(H - PADDING - total_height)
    current_y = tag_y
    for line in lines:
        lw, lh = draw.textsize(line, font=body_font)
        draw.text(
            ((W - lw) / 2, current_y),
            line,
            font=body_font,
            fill=(25, 39, 52, 255),
        )
        current_y += lh + 10

    img.save(output_path)
    print(f"Saved card to {output_path}")


# ------------- MAIN -------------

def find_role_images(directory):
    """Find all PNG files matching R###.png pattern in the given directory."""
    # Convert Path to string for glob
    dir_str = str(directory) if isinstance(directory, Path) else directory
    pattern = os.path.join(dir_str, "R*.png")
    files = glob.glob(pattern)
    role_images = []
    
    # Extract role numbers from filenames (e.g., R001.png -> R001)
    role_pattern = re.compile(r'R(\d+)\.png$', re.IGNORECASE)
    for file in files:
        filename = os.path.basename(file)
        match = role_pattern.search(filename)
        if match:
            role_number = f"R{match.group(1).zfill(3)}"  # Ensure 3 digits
            role_images.append((role_number, file))
    
    return sorted(role_images)  # Sort by role number


if __name__ == "__main__":
    # Check template exists
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Template not found at {TEMPLATE_PATH}")
    
    # Find all role images in the current directory
    role_images = find_role_images(SCRIPT_DIR)
    
    if not role_images:
        print("No role images found (R###.png pattern)")
        exit(1)
    
    print(f"Found {len(role_images)} role image(s) to process\n")
    
    # Process each image
    for role_number, illustration_path in role_images:
        try:
            # Look up role + tagline from CSV
            role_title, tagline = lookup_role_from_csv(str(CSV_PATH), role_number)
            print(f"Processing {role_number}: {role_title} — {tagline}")
            
            if not os.path.exists(illustration_path):
                print(f"  Warning: Illustration not found at {illustration_path}, skipping...")
                continue
            
            # Generate output filename: R001_Crypto_Bro.png
            # Replace spaces and other problematic characters with underscores
            role_title_safe = re.sub(r'[^\w\s-]', '', role_title)  # Remove special chars
            role_title_safe = re.sub(r'[\s-]+', '_', role_title_safe)  # Replace spaces/hyphens with underscore
            role_title_safe = role_title_safe.strip('_')  # Remove leading/trailing underscores
            output_filename = f"{role_number}_{role_title_safe}.png"
            output_path = OUTPUT_DIR / output_filename
            
            compose_card(
                template_path=str(TEMPLATE_PATH),
                illustration_path=illustration_path,
                role_title=role_title,
                tagline=tagline,
                output_path=str(output_path),
            )
            print(f"  ✓ Successfully created {output_path}\n")
            
        except ValueError as e:
            print(f"  Error: {e}, skipping...\n")
        except Exception as e:
            print(f"  Error processing {role_number}: {e}, skipping...\n")
    
    print("Done!")
