# Step 0: downscale the 2000px official artwork into the 900x900 work canvas used by build.py
from PIL import Image
im = Image.open('orig.png').convert('RGBA').resize((1000, 1000), Image.LANCZOS)
c = Image.new('RGBA', (900, 900)); c.alpha_composite(im, (-33, -10)); c.save('work2.png')
