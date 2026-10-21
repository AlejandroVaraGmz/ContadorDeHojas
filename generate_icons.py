from PIL import Image, ImageDraw, ImageFont

def create_app_icon(size, output_path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Scale factor
    s = size / 512.0
    
    # Rounded background
    rx = int(110 * s)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=rx, fill='#0a0e17', outline='#334155', width=max(1, int(4 * s)))
    
    # Industrial safety stripes in corner
    draw.polygon([(int(60*s), int(40*s)), (int(100*s), int(40*s)), (int(40*s), int(100*s)), (int(40*s), int(60*s))], fill='#eab308')
    draw.polygon([(int(120*s), int(40*s)), (int(160*s), int(40*s)), (int(40*s), int(160*s)), (int(40*s), int(120*s))], fill='#eab308')
    
    # Sheets stack
    y_coords = [140, 176, 212, 248, 284, 320]
    for y in y_coords:
        sy = int(y * s)
        sh = int(22 * s)
        sw = int(320 * s)
        sx = int(96 * s)
        # Metal sheet body
        draw.rounded_rectangle([sx, sy, sx + sw, sy + sh], radius=int(3*s), fill='#94a3b8', outline='#cbd5e1', width=1)
        # Reflective edge highlight
        draw.line([sx, sy + 1, sx + sw, sy + 1], fill='#ffffff', width=max(1, int(2*s)))
        # Shadow bottom seam
        draw.line([sx, sy + sh - 1, sx + sw, sy + sh - 1], fill='#1e293b', width=max(1, int(2*s)))
        
    # Caliper / ROI brackets (Cyan)
    roi_col = '#00f0ff'
    w_roi = max(2, int(5 * s))
    # Left bracket
    draw.line([(int(110*s), int(120*s)), (int(76*s), int(120*s))], fill=roi_col, width=w_roi)
    draw.line([(int(76*s), int(120*s)), (int(76*s), int(360*s))], fill=roi_col, width=w_roi)
    draw.line([(int(76*s), int(360*s)), (int(110*s), int(360*s))], fill=roi_col, width=w_roi)
    
    # Right bracket
    draw.line([(int(402*s), int(120*s)), (int(436*s), int(120*s))], fill=roi_col, width=w_roi)
    draw.line([(int(436*s), int(120*s)), (int(436*s), int(360*s))], fill=roi_col, width=w_roi)
    draw.line([(int(436*s), int(360*s)), (int(402*s), int(360*s))], fill=roi_col, width=w_roi)
    
    # Laser Scan line (Neon Green)
    draw.line([(int(60*s), int(235*s)), (int(452*s), int(235*s))], fill='#22c55e', width=max(2, int(4*s)))
    
    # Marker dots
    for y in y_coords:
        cy = int((y + 11) * s)
        cx = int(256 * s)
        r = max(2, int(6 * s))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill='#22c55e', outline='#ffffff', width=1)
        
    # Count pill at bottom
    pill_w = int(200 * s)
    pill_h = int(52 * s)
    pill_x = int((512 - 200) / 2 * s)
    pill_y = int(405 * s)
    draw.rounded_rectangle([pill_x, pill_y, pill_x + pill_w, pill_y + pill_h], radius=int(26*s), fill='#0f172a', outline='#22c55e', width=max(1, int(3*s)))
    
    img.save(output_path, 'PNG')
    print(f"Generated icon: {output_path} ({size}x{size})")

create_app_icon(192, 'assets/icons/icon-192.png')
create_app_icon(512, 'assets/icons/icon-512.png')
