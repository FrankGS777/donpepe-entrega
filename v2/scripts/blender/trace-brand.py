from PIL import Image
import numpy as np,json
from pathlib import Path
root=Path(__file__).resolve().parents[3]
im=Image.open(root/'public/images/donpepe-logo-final-gold.png').convert('RGBA');im.thumbnail((1500,600))
a=np.asarray(im);m=a[:,:,3]>210;h,w=m.shape
# Retain connected strokes and letters; discard isolated extraction noise.
seen=set();keep=set()
for y,x in zip(*np.nonzero(m)):
 if (int(x),int(y)) in seen:continue
 stack=[(int(x),int(y))];seen.add(stack[0]);component=[]
 while stack:
  p=stack.pop();component.append(p)
  for q in ((p[0]-1,p[1]),(p[0]+1,p[1]),(p[0],p[1]-1),(p[0],p[1]+1)):
   xx,yy=q
   if 0<=xx<w and 0<=yy<h and m[yy,xx] and q not in seen:seen.add(q);stack.append(q)
 if len(component)>55:keep.update(component)
edges={}
for x,y in keep:
 for neighbor,start,end in [((x,y-1),(x,y),(x+1,y)),((x+1,y),(x+1,y),(x+1,y+1)),((x,y+1),(x+1,y+1),(x,y+1)),((x-1,y),(x,y+1),(x,y))]:
  if neighbor not in keep:edges.setdefault(start,[]).append(end)
loops=[]
while edges:
 start=next(iter(edges));p=start;loop=[]
 while True:
  loop.append(p);choices=edges.get(p)
  if not choices:break
  q=choices.pop()
  if not choices:del edges[p]
  p=q
  if p==start:break
 if p==start and len(loop)>8:
  simple=[point for i,point in enumerate(loop) if (point[0]-loop[i-1][0],point[1]-loop[i-1][1])!=(loop[(i+1)%len(loop)][0]-point[0],loop[(i+1)%len(loop)][1]-point[1])]
  area=sum(simple[i-1][0]*q[1]-q[0]*simple[i-1][1] for i,q in enumerate(simple))/2
  if abs(area)>4:loops.append(simple)
paths=['M'+'L'.join(f'{x},{y}' for x,y in loop)+'Z' for loop in loops]
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><path fill="#b48b26" fill-rule="evenodd" d="'+''.join(paths)+'"/></svg>'
(root/'public/images/donpepe-mark-light.svg').write_text(svg)
normalized=[[[round((x-w/2)/w,6),round((h/2-y)/w,6)] for x,y in loop] for loop in loops]
(root/'v2/frontend/brand-contours.js').write_text('export default '+json.dumps(normalized,separators=(',',':'))+';\n')
print(len(loops),'closed outlines',sum(map(len,loops)),'vertices')
