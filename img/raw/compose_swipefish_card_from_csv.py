from PIL import Image, ImageDraw, ImageFont
import textwrap
import csv
import os
import glob
import re
import platform
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
HORIZONTAL_PADDING = 200  # Left and right padding for text

# Fonts – Nunito for both title and body/tagline
if platform.system() == "Darwin":  # macOS
    # Title font (Nunito Bold)
    TITLE_FONT_PATH = "/Library/Fonts/Nunito-Bold.ttf"
    # Body font (Nunito Italic)
    BODY_FONT_PATH = "/Library/Fonts/Nunito-Italic.ttf"
    # Fallback locations if not found
    NUNITO_BOLD_PATHS = [
        "/Library/Fonts/Nunito-Bold.ttf",
        "~/Library/Fonts/Nunito-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Nunito-Bold.ttf",
    ]
    NUNITO_PATHS = [
        "/Library/Fonts/Nunito-Italic.ttf",
        "~/Library/Fonts/Nunito-Italic.ttf",
        "/System/Library/Fonts/Supplemental/Nunito-Italic.ttf",
        # Fallback to Regular if Italic not found
        "/Library/Fonts/Nunito-Regular.ttf",
        "~/Library/Fonts/Nunito-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Nunito-Regular.ttf",
    ]
else:  # Linux
    TITLE_FONT_PATH = "/usr/share/fonts/truetype/nunito/Nunito-Bold.ttf"
    BODY_FONT_PATH = "/usr/share/fonts/truetype/nunito/Nunito-Italic.ttf"
    NUNITO_BOLD_PATHS = [
        "/usr/share/fonts/truetype/nunito/Nunito-Bold.ttf",
        "/usr/share/fonts/opentype/nunito/Nunito-Bold.otf",
        "~/.fonts/Nunito-Bold.ttf",
    ]
    NUNITO_PATHS = [
        "/usr/share/fonts/truetype/nunito/Nunito-Italic.ttf",
        "/usr/share/fonts/opentype/nunito/Nunito-Italic.otf",
        "~/.fonts/Nunito-Italic.ttf",
        # Fallback to Regular if Italic not found
        "/usr/share/fonts/truetype/nunito/Nunito-Regular.ttf",
        "/usr/share/fonts/opentype/nunito/Nunito-Regular.otf",
        "~/.fonts/Nunito-Regular.ttf",
    ]

TITLE_FONT_SIZE = 120
BODY_FONT_SIZE = 64

# ------------- HELPERS -------------

def load_font(path, size, fallback_bold=False):
    """Load font (Poppins for title, Nunito for body) with fallbacks."""
    import os
    
    # Determine font name based on path
    font_name = "Nunito" if "Nunito" in path else "Poppins"
    
    # Expand user home directory in paths
    expanded_path = os.path.expanduser(path)
    
    # Try the provided path first
    try:
        font = ImageFont.truetype(expanded_path, size=size)
        print(f"  Loaded {font_name} from: {expanded_path} (size: {size})")
        return font
    except Exception as e:
        print(f"  Could not load {font_name} from {expanded_path}: {e}")
    
    # Try Nunito in common locations (Bold for title, Italic for body)
    if fallback_bold:
        font_paths = NUNITO_BOLD_PATHS
        font_name = "Nunito Bold"
    else:
        font_paths = NUNITO_PATHS
        font_name = "Nunito Italic"
    
    for font_path in font_paths:
        expanded = os.path.expanduser(font_path)
        try:
            font = ImageFont.truetype(expanded, size=size)
            print(f"  Loaded {font_name} from: {expanded} (size: {size})")
            return font
        except Exception:
            continue
    
    # Fallback to system fonts
    if platform.system() == "Darwin":  # macOS
        fallback_paths = [
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if fallback_bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
        ]
    else:  # Linux
        fallback_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if fallback_bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if fallback_bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
    
    for font_path in fallback_paths:
        try:
            font = ImageFont.truetype(font_path, size=size)
            print(f"  Loaded fallback font: {font_path} (size: {size})")
            return font
        except Exception:
            continue
    
    # Last resort: default font
    print(f"  Warning: Using default font (size may not be accurate)")
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
    print(f"Loading title font (size: {TITLE_FONT_SIZE})...")
    title_font = load_font(TITLE_FONT_PATH, TITLE_FONT_SIZE, fallback_bold=True)
    print(f"Loading body font (size: {BODY_FONT_SIZE})...")
    body_font = load_font(BODY_FONT_PATH, BODY_FONT_SIZE)

    # Note: X and heart icons are included in the template image
    # Leave space for icons at the top

    # ---------- Title ----------

    title_text = role_title.upper()
    title_y = 400  # Position below the icons in template (reduced top padding)
    
    # Calculate maximum width with horizontal padding
    max_text_width = W - (HORIZONTAL_PADDING * 2)
    
    # Measure text with current font
    bbox = draw.textbbox((0, 0), title_text, font=title_font)
    tw = bbox[2] - bbox[0]  # width = right - left
    th = bbox[3] - bbox[1]  # height = bottom - top
    
    # If text is too wide, scale down the font
    actual_font = title_font
    if tw > max_text_width:
        # Calculate scale factor to fit within max width
        scale_factor = max_text_width / tw
        new_font_size = int(TITLE_FONT_SIZE * scale_factor)
        actual_font = load_font(TITLE_FONT_PATH, new_font_size, fallback_bold=True)
        # Re-measure with scaled font
        bbox = draw.textbbox((0, 0), title_text, font=actual_font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
    
    # Ensure text fits within padded area (clamp to max width)
    tw = min(tw, max_text_width)
    
    # Center text within the padded area
    # Available space: from HORIZONTAL_PADDING to (W - HORIZONTAL_PADDING)
    # Center the text width within that space
    text_x = HORIZONTAL_PADDING + (max_text_width - tw) / 2
    
    # Safety check: ensure text never goes outside padded area
    # Left edge must be at least HORIZONTAL_PADDING
    text_x = max(HORIZONTAL_PADDING, text_x)
    # Right edge must be at most (W - HORIZONTAL_PADDING)
    if text_x + tw > W - HORIZONTAL_PADDING:
        text_x = W - HORIZONTAL_PADDING - tw
    
    draw.text(
        (text_x, title_y),
        title_text,
        font=actual_font,
        fill=(25, 39, 52, 255),
    )

    # ---------- Illustration placement ----------

    # Gap between title and image - adjust this value to change spacing
    # Note: textbbox includes extra space, so we use the baseline position instead
    # The bbox[3] (bottom) includes descenders and extra space, so we'll use a smaller value
    # Try using just the text height without the extra padding
    gap_between_title_and_image = 30  # 30px spacing between role title and image
    # Use title_y + actual_text_height (th) but subtract extra space
    # textbbox often includes ~20-30% extra space, so we'll compensate
    illus_top = title_y + int(th * 0.85) + gap_between_title_and_image
    illus_bottom = int(H * 0.85)  # Increased to 85% to maximize vertical space
    illus_height = illus_bottom - illus_top
    
    print(f"  Title ends at y={title_y + th}, Image starts at y={illus_top}, Gap={gap_between_title_and_image}px")

    art = Image.open(illustration_path).convert("RGBA")
    aw, ah = art.size

    # Use same horizontal padding as text
    max_art_width = W - (HORIZONTAL_PADDING * 2)  # Same padding as text (200px on each side)
    max_art_height = int(illus_height * 1.0)  # Use full available height
    
    # Calculate scale to fit within bounds (allow scaling up if image is smaller)
    scale_width = max_art_width / aw
    scale_height = max_art_height / ah
    scale = min(scale_width, scale_height)  # Use the smaller scale to maintain aspect ratio
    
    new_size = (int(aw * scale), int(ah * scale))
    art_resized = art.resize(new_size, Image.LANCZOS)
    
    print(f"  Original image size: {aw}x{ah}")
    print(f"  Max allowed size: {max_art_width}x{max_art_height}")
    print(f"  Scale factor: {scale:.2f}")
    print(f"  Final image size: {new_size[0]}x{new_size[1]}")

    aw2, ah2 = art_resized.size
    art_x = (W - aw2) // 2
    # Position image at the top of available space (not centered) so gap is visible
    art_y = illus_top

    img.alpha_composite(art_resized, (art_x, art_y))

    # ---------- Tagline (wrapped + centered with padding) ----------

    # Calculate characters per line based on available width with padding
    # Approximate character width (rough estimate for Poppins at body font size)
    avg_char_width = BODY_FONT_SIZE * 0.6
    chars_per_line = int((W - (HORIZONTAL_PADDING * 2)) / avg_char_width)
    wrapped = textwrap.fill(tagline, width=chars_per_line)
    lines = wrapped.split("\n")

    line_heights = []
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=body_font)
        lh = bbox[3] - bbox[1]  # height = bottom - top
        line_heights.append(lh)
    total_height = sum(line_heights) + (len(lines) - 1) * 12

    # Gap between image and tagline - reduced for tighter spacing
    gap_between_image_and_tagline = gap_between_title_and_image - 200  # 30px - 200px = -170px for tighter spacing
    
    # Calculate bottom padding - reduced to give more space for tagline
    # Top padding is where title_y starts (400px)
    bottom_padding = title_y - 400  # Reduced by 400px to give more space (0px from bottom, essentially at edge)
    
    # Position tagline with the gap (includes additional top padding)
    # The gap is applied similarly - start tagline at image bottom + gap
    # But account for text bounding box similar to how we did for title
    tagline_start_y = illus_bottom + gap_between_image_and_tagline
    
    # Calculate where tagline should end to respect bottom padding
    tagline_end_y = H - bottom_padding
    
    # Start tagline at the calculated position
    current_y = tagline_start_y
    
    # Ensure tagline doesn't exceed bottom padding - if it would, move it up
    if current_y + total_height > tagline_end_y:
        # If tagline would exceed bottom padding, position it to end at bottom padding
        current_y = tagline_end_y - total_height
    
    max_tagline_width = W - (HORIZONTAL_PADDING * 2)
    
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=body_font)
        lw = bbox[2] - bbox[0]  # width = right - left
        lh = bbox[3] - bbox[1]  # height = bottom - top
        # Center text within the padded area
        text_x = HORIZONTAL_PADDING + (max_tagline_width - lw) / 2
        draw.text(
            (text_x, current_y),
            line,
            font=body_font,
            fill=(25, 39, 52, 255),
        )
        current_y += lh + 10

    # Save (overwrites if file exists)
    if os.path.exists(output_path):
        print(f"Overwriting existing file: {output_path}")
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
