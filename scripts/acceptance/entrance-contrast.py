"""Light type over the ring: the WCAG ratio at the worst patch behind it."""
import json, sys
from PIL import Image

def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rel(rgb):
    return 0.2126*lin(rgb[0]) + 0.7152*lin(rgb[1]) + 0.0722*lin(rgb[2])

def ratio(a, b):
    la, lb = rel(a), rel(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

root = sys.argv[1]
boxes = json.load(open(f"{root}/boxes.json"))
INK = (255, 255, 255)
worst_overall = 99
for chapter, blocks in boxes.items():
    im = Image.open(f"{root}/{chapter}.png").convert("RGB")
    for b in blocks:
        crop = im.crop(tuple(b["box"]))
        px = list(crop.getdata())
        if not px: continue
        by = sorted(px, key=rel)
        hot = by[int(len(by) * 0.98)]
        r = ratio(INK, hot)
        worst_overall = min(worst_overall, r)
        flag = "ok  " if r >= 4.5 else ("LOW " if r >= 3 else "FAIL")
        print(f"{chapter}  {flag} {r:5.2f}:1  {b['t']}")
print(f"\nworst on the entrance: {worst_overall:.2f}:1  "
      f"({'passes 4.5:1' if worst_overall >= 4.5 else 'below 4.5:1'})")
