from PIL import Image, ImageDraw, ImageFont
import textwrap
import csv
import os
import glob
import re
import platform
from pathlib import Path

# ------------- CONFIG -------------

# CSV with your personas (relative to script location)
SCRIPT_DIR = Path(__file__).parent
CSV_PATH = SCRIPT_DIR.parent / "personas" / "swipefish_personas.csv"

# Blank template (white rounded card, transparent outside, 1080 x 1920)
TEMPLATE_PATH = SCRIPT_DIR / "swipefish_blank_template_1080x1920.png"

# Output directory (img/personas/)
OUTPUT_DIR = SCRIPT_DIR.parent / "personas"

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


def lookup_persona_from_csv(csv_path, persona_number):
    """Return (persona_title, tagline) for a given Persona Number from the CSV."""
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Persona Number") == persona_number:
                return row.get("Persona", "").strip(), row.get("Tagline", "").strip()
    raise ValueError(f"Persona Number {persona_number} not found in {csv_path}")


def compose_card(
    template_path: str,
    illustration_path: str,
    persona_title: str,
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

    # ---------- DYNAMIC LAYOUT CALCULATION ----------
    # First, calculate all content sizes to determine optimal spacing
    
    # Fixed top padding (space for icons)
    TOP_PADDING = 400
    BOTTOM_PADDING = 80  # Bottom padding - increased to prevent visual bleeding
    MIN_GAP_TITLE_IMAGE = 30  # Minimum gap between title and image
    MIN_GAP_IMAGE_TAGLINE = 30  # Minimum gap between image and tagline
    
    # ---------- Title ----------
    title_text = persona_title.upper()
    title_y = TOP_PADDING
    
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
    
    # Actual title height (accounting for textbbox padding)
    title_bottom = title_y + int(th * 0.85)  # Compensate for textbbox extra space
    
    # ---------- Tagline size calculation (before image placement) ----------
    avg_char_width = BODY_FONT_SIZE * 0.6
    chars_per_line = int((W - (HORIZONTAL_PADDING * 2)) / avg_char_width)
    wrapped = textwrap.fill(tagline, width=chars_per_line)
    lines = wrapped.split("\n")
    
    LINE_SPACING = 10  # Spacing between tagline lines (must match drawing code)
    # Increased safety margin for italic fonts - they can extend beyond bbox due to slant
    TAGLINE_SAFETY_MARGIN = 40  # Large safety margin for italic text, descenders, and bbox inaccuracies
    
    # Measure tagline height accurately by simulating text placement
    # This gives us the actual height the text will take when drawn
    # We use the actual drawing y position (baseline) and measure the full bbox
    test_y = 0
    max_bottom = 0
    for i, line in enumerate(lines):
        # Measure bbox from the baseline position (test_y)
        bbox = draw.textbbox((0, test_y), line, font=body_font)
        # Track the maximum bottom we've seen
        max_bottom = max(max_bottom, bbox[3])
        # The bottom of the bbox (bbox[3]) is the actual bottom of the text including descenders
        if i < len(lines) - 1:
            test_y = bbox[3] + LINE_SPACING  # Move to next line
        else:
            test_y = bbox[3]  # Last line - this is the actual bottom
    
    # Use the maximum of measured height and add large safety margin
    # For italic fonts, add extra padding as characters can extend beyond bbox
    tagline_total_height = max(test_y, max_bottom) + TAGLINE_SAFETY_MARGIN
    
    # ---------- Illustration placement ----------
    art = Image.open(illustration_path).convert("RGBA")
    aw, ah = art.size

    # Use same horizontal padding as text
    max_art_width = W - (HORIZONTAL_PADDING * 2)
    
    # Calculate maximum image height to ensure tagline fits
    # Use TARGET limit of 170px from bottom (y=1750) to account for italic font extension beyond bbox
    # Italic fonts can extend significantly beyond textbbox measurements
    # We'll size images to ensure taglines end at y=1750 or earlier
    TARGET_BOTTOM_LIMIT = 170  # Target: taglines end at least 170px from bottom (y=1750)
    ABSOLUTE_BOTTOM_LIMIT = 120  # Absolute minimum: 120px from bottom (y=1800)
    max_art_height = (
        H 
        - title_bottom  # Space used by title
        - MIN_GAP_TITLE_IMAGE  # Gap between title and image
        - MIN_GAP_IMAGE_TAGLINE  # Gap between image and tagline
        - tagline_total_height  # Space needed for tagline
        - TARGET_BOTTOM_LIMIT  # Target bottom limit (ensures taglines end at y=1750 or earlier)
    )
    
    # Ensure we have at least some space for the image
    if max_art_height < 200:
        # If not enough space, reduce gaps proportionally
        print(f"  Warning: Limited space available ({max_art_height}px). Adjusting gaps...")
        # Reduce gaps to fit everything
        total_required = title_bottom + tagline_total_height + BOTTOM_PADDING
        available_for_gaps = H - total_required - 200  # Reserve 200px minimum for image
        if available_for_gaps > 0:
            # Distribute available gap space proportionally
            gap_ratio = available_for_gaps / (MIN_GAP_TITLE_IMAGE + MIN_GAP_IMAGE_TAGLINE)
            MIN_GAP_TITLE_IMAGE = max(10, int(MIN_GAP_TITLE_IMAGE * gap_ratio))
            MIN_GAP_IMAGE_TAGLINE = max(10, int(MIN_GAP_IMAGE_TAGLINE * gap_ratio))
            max_art_height = H - title_bottom - MIN_GAP_TITLE_IMAGE - MIN_GAP_IMAGE_TAGLINE - tagline_total_height - BOTTOM_PADDING
        else:
            # Extreme case: reduce bottom padding
            max_art_height = H - title_bottom - MIN_GAP_TITLE_IMAGE - MIN_GAP_IMAGE_TAGLINE - tagline_total_height - 20
            BOTTOM_PADDING = 20
    
    # Calculate scale to fit within bounds
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
    
    # Position image at the top of available space (not centered) to ensure predictable positioning
    illus_top = title_bottom + MIN_GAP_TITLE_IMAGE
    art_y = illus_top
    
    # Actual bottom of the image
    actual_image_bottom = art_y + ah2
    
    # Verify the image doesn't extend beyond what we calculated
    # The tagline needs: actual_image_bottom + gap + tagline_height + bottom_padding <= H
    max_allowed_image_bottom = H - MIN_GAP_IMAGE_TAGLINE - tagline_total_height - BOTTOM_PADDING
    
    if actual_image_bottom > max_allowed_image_bottom:
        # If image is too tall, we need to reduce it further
        print(f"  Warning: Image extends beyond calculated space (bottom={actual_image_bottom}, max={max_allowed_image_bottom}). Adjusting...")
        # Recalculate with stricter height constraint
        max_art_height = max_allowed_image_bottom - illus_top
        if max_art_height < 100:
            # If we can't fit even a small image, reduce bottom padding
            print(f"  Extreme case: Reducing bottom padding to fit content")
            BOTTOM_PADDING = 20
            max_allowed_image_bottom = H - MIN_GAP_IMAGE_TAGLINE - tagline_total_height - BOTTOM_PADDING
            max_art_height = max_allowed_image_bottom - illus_top
        
        scale_height = max_art_height / ah
        scale = min(scale_width, scale_height)
        new_size = (int(aw * scale), int(ah * scale))
        art_resized = art.resize(new_size, Image.LANCZOS)
        aw2, ah2 = art_resized.size
        actual_image_bottom = art_y + ah2
        print(f"  Adjusted image size: {new_size[0]}x{new_size[1]}, bottom={actual_image_bottom}")

    # Final verification: ensure tagline will fit
    expected_tagline_end = actual_image_bottom + MIN_GAP_IMAGE_TAGLINE + tagline_total_height
    if expected_tagline_end > H - BOTTOM_PADDING:
        # This is a critical error - we need to fix it
        print(f"  CRITICAL: Tagline won't fit! Expected end={expected_tagline_end}, max={H - BOTTOM_PADDING}")
        # Reduce image size to make room
        available_for_tagline = H - BOTTOM_PADDING - MIN_GAP_IMAGE_TAGLINE
        max_image_bottom = available_for_tagline - tagline_total_height
        if max_image_bottom > illus_top:
            max_art_height = max_image_bottom - illus_top
            scale_height = max_art_height / ah
            scale = min(scale_width, scale_height)
            new_size = (int(aw * scale), int(ah * scale))
            art_resized = art.resize(new_size, Image.LANCZOS)
            aw2, ah2 = art_resized.size
            actual_image_bottom = art_y + ah2
            print(f"  Reduced image to fit tagline: {new_size[0]}x{new_size[1]}, bottom={actual_image_bottom}")

    img.alpha_composite(art_resized, (art_x, art_y))
    
    print(f"  Title ends at y={title_bottom}, Image: y={art_y} to {actual_image_bottom} (height={ah2}px)")
    print(f"  Tagline height: {tagline_total_height}px, Gaps: title-image={MIN_GAP_TITLE_IMAGE}px, image-tagline={MIN_GAP_IMAGE_TAGLINE}px")

    # ---------- Title drawing ----------
    # Center text within the padded area
    text_x = HORIZONTAL_PADDING + (max_text_width - tw) / 2
    
    # Safety check: ensure text never goes outside padded area
    text_x = max(HORIZONTAL_PADDING, text_x)
    if text_x + tw > W - HORIZONTAL_PADDING:
        text_x = W - HORIZONTAL_PADDING - tw
    
    draw.text(
        (text_x, title_y),
        title_text,
        font=actual_font,
        fill=(25, 39, 52, 255),
    )

    # ---------- Tagline placement and drawing ----------
    # Recalculate tagline height more accurately by measuring the actual text positions
    # This accounts for any discrepancies in textbbox measurements
    max_tagline_width = W - (HORIZONTAL_PADDING * 2)
    
    # Re-measure actual tagline height by simulating the drawing (double-check)
    # This ensures we have the most accurate measurement
    test_y = 0
    max_measured_bottom = 0
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, test_y), line, font=body_font)
        max_measured_bottom = max(max_measured_bottom, bbox[3])
        if i < len(lines) - 1:
            test_y = bbox[3] + LINE_SPACING  # Move to next line
        else:
            test_y = bbox[3]  # Last line
    
    # Use the maximum of both measurements and add safety margin
    # This accounts for any discrepancies between measurements
    measured_tagline_height = max(test_y, max_measured_bottom) + TAGLINE_SAFETY_MARGIN
    
    # Position tagline after the image with the minimum gap
    tagline_start_y = actual_image_bottom + MIN_GAP_IMAGE_TAGLINE
    
    # Calculate where tagline should end to respect bottom padding
    tagline_end_y = H - BOTTOM_PADDING
    
    # Use the measured height (which is more accurate) to check if it fits
    if tagline_start_y + measured_tagline_height > tagline_end_y:
        # Move tagline up to fit - ensure it doesn't overlap with image
        tagline_start_y = tagline_end_y - measured_tagline_height
        # Ensure minimum gap from image
        min_tagline_y = actual_image_bottom + 10
        if tagline_start_y < min_tagline_y:
            # If we can't fit even with minimum gap, we need to reduce image size
            print(f"  WARNING: Tagline won't fit even with minimum gap. Image may be too large.")
            # Reduce image to make room
            available_for_tagline = H - BOTTOM_PADDING - 10  # 10px min gap
            max_image_bottom = available_for_tagline - measured_tagline_height
            if max_image_bottom > illus_top:
                max_art_height = max_image_bottom - illus_top
                scale_height = max_art_height / ah
                scale = min(scale_width, scale_height)
                new_size = (int(aw * scale), int(ah * scale))
                art_resized = art.resize(new_size, Image.LANCZOS)
                aw2, ah2 = art_resized.size
                actual_image_bottom = art_y + ah2
                tagline_start_y = actual_image_bottom + 10
                print(f"  Reduced image to {new_size[0]}x{new_size[1]} to fit tagline")
            else:
                tagline_start_y = min_tagline_y
                print(f"  ERROR: Cannot fit tagline even after reducing image!")
    
    # Final clamp: ensure tagline never exceeds canvas
    # Add extra margin to prevent any visual bleeding
    # Use larger margin for italic fonts which can extend beyond bbox
    MIN_TAGLINE_MARGIN = 30  # Minimum space between tagline bottom and canvas edge (increased for italic)
    max_allowed_tagline_end = H - BOTTOM_PADDING - MIN_TAGLINE_MARGIN
    if tagline_start_y + measured_tagline_height > max_allowed_tagline_end:
        tagline_start_y = max_allowed_tagline_end - measured_tagline_height
        print(f"  Clamped tagline to fit with margin: start_y={tagline_start_y}")
    
    current_y = tagline_start_y
    
    # Draw the tagline, but track the maximum extent
    max_drawn_bottom = 0
    for i, line in enumerate(lines):
        # Measure bbox from the current baseline position BEFORE drawing
        bbox_before = draw.textbbox((0, current_y), line, font=body_font)
        lw = bbox_before[2] - bbox_before[0]  # width = right - left
        # Center text within the padded area
        text_x = HORIZONTAL_PADDING + (max_tagline_width - lw) / 2
        
        # Draw the text
        draw.text(
            (text_x, current_y),
            line,
            font=body_font,
            fill=(25, 39, 52, 255),
        )
        
        # Measure bbox AFTER drawing to get actual extent
        bbox_after = draw.textbbox((text_x, current_y), line, font=body_font)
        max_drawn_bottom = max(max_drawn_bottom, bbox_after[3])
        
        # Move to next line using the actual bottom of the bbox (includes descenders)
        if i < len(lines) - 1:
            current_y = bbox_after[3] + LINE_SPACING  # Use actual bottom of bbox
        else:
            current_y = bbox_after[3]  # Last line - this is the actual bottom including descenders
    
    actual_tagline_end = max(current_y, max_drawn_bottom)
    
    # Final verification with HARD LIMIT to prevent any bleeding
    # Use a very conservative limit - taglines must end at least 120px from bottom
    # This accounts for italic font slant extending beyond bbox measurements
    ABSOLUTE_MAX_TAGLINE_Y = H - 120  # Hard limit: 120px from bottom (1800px on 1920px canvas)
    
    # Additional safety: ensure tagline ends well before the limit
    # Target: taglines should end at y=1750 or earlier (170px from bottom)
    TARGET_MAX_TAGLINE_Y = 1750
    if actual_tagline_end > TARGET_MAX_TAGLINE_Y:
        print(f"  WARNING: Tagline extends to y={actual_tagline_end}, exceeds target (y={TARGET_MAX_TAGLINE_Y})")
        # This shouldn't happen if our calculations are correct, but log it
    elif actual_tagline_end > ABSOLUTE_MAX_TAGLINE_Y:
        print(f"  CRITICAL: Tagline extends to y={actual_tagline_end}, exceeds absolute limit (y={ABSOLUTE_MAX_TAGLINE_Y})")
    else:
        space_remaining = ABSOLUTE_MAX_TAGLINE_Y - actual_tagline_end
        target_space = TARGET_MAX_TAGLINE_Y - actual_tagline_end
        if target_space < 0:
            print(f"  WARNING: Tagline exceeds target position (y={actual_tagline_end} > {TARGET_MAX_TAGLINE_Y})")
        print(f"  Tagline: y={tagline_start_y} to {actual_tagline_end} (target space: {target_space}px, absolute space: {space_remaining}px)")

    # Save (overwrites if file exists)
    if os.path.exists(output_path):
        print(f"Overwriting existing file: {output_path}")
    img.save(output_path)
    print(f"Saved card to {output_path}")


# ------------- MAIN -------------

def find_persona_images(directory):
    """Find all PNG files matching P###.png pattern in the given directory."""
    # Convert Path to string for glob
    dir_str = str(directory) if isinstance(directory, Path) else directory
    pattern = os.path.join(dir_str, "P*.png")
    files = glob.glob(pattern)
    persona_images = []
    
    # Extract persona numbers from filenames (e.g., P001.png -> P001, P001_something.png -> P001)
    persona_pattern = re.compile(r'^P(\d+)', re.IGNORECASE)
    for file in files:
        filename = os.path.basename(file)
        match = persona_pattern.search(filename)
        if match:
            persona_number = f"P{match.group(1).zfill(3)}"  # Ensure 3 digits
            persona_images.append((persona_number, file))
    
    return sorted(persona_images)  # Sort by persona number


if __name__ == "__main__":
    # Check template exists
    if not os.path.exists(TEMPLATE_PATH):
        raise FileNotFoundError(f"Template not found at {TEMPLATE_PATH}")
    
    # Find all persona images in the current directory
    persona_images = find_persona_images(SCRIPT_DIR)
    
    if not persona_images:
        print("No persona images found (P###.png pattern)")
        exit(1)
    
    print(f"Found {len(persona_images)} persona image(s) to process\n")
    
    # Process each image
    for persona_number, illustration_path in persona_images:
        try:
            # Look up persona + tagline from CSV
            persona_title, tagline = lookup_persona_from_csv(str(CSV_PATH), persona_number)
            print(f"Processing {persona_number}: {persona_title} — {tagline}")
            
            if not os.path.exists(illustration_path):
                print(f"  Warning: Illustration not found at {illustration_path}, skipping...")
                continue
            
            # Generate output filename: P001_Crypto_Bro.png
            # Replace spaces and other problematic characters with underscores
            persona_title_safe = re.sub(r'[^\w\s-]', '', persona_title)  # Remove special chars
            persona_title_safe = re.sub(r'[\s-]+', '_', persona_title_safe)  # Replace spaces/hyphens with underscore
            persona_title_safe = persona_title_safe.strip('_')  # Remove leading/trailing underscores
            output_filename = f"{persona_number}_{persona_title_safe}.png"
            output_path = OUTPUT_DIR / output_filename
            
            compose_card(
                template_path=str(TEMPLATE_PATH),
                illustration_path=illustration_path,
                persona_title=persona_title,
                tagline=tagline,
                output_path=str(output_path),
            )
            print(f"  ✓ Successfully created {output_path}\n")
            
        except ValueError as e:
            print(f"  Error: {e}, skipping...\n")
        except Exception as e:
            print(f"  Error processing {persona_number}: {e}, skipping...\n")
    
    print("Done!")
