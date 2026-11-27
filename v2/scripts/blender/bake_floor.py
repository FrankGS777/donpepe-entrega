"""Bake static rack-to-floor occlusion; moving loads remain realtime geometry."""
import json
import os
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT=Path(__file__).resolve().parents[2]
layout=json.loads((ROOT/'assets/warehouse-layout-lighting.json').read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

with bpy.data.libraries.load(str(ROOT/'assets/donpepe-industrial.blend'),link=False) as (src,dst):
    dst.objects=[name for name in src.objects if name.startswith(('RackFoot','RackUpright','RackBeam'))]
templates={obj.name:obj for obj in dst.objects if obj and obj.parent is None}
for obj in dst.objects:
    if obj:
        obj.location=(0,0,0) if obj.parent is None else obj.location

def place(name,x,y,z,sx=1,sy=1,sz=1):
    root=templates[name]
    for part in root.children:
        obj=bpy.data.objects.new(name,part.data)
        bpy.context.collection.objects.link(obj)
        obj.matrix_world=Matrix.Translation((x,-z,y)) @ Matrix.Diagonal((sx,sz,sy,1)) @ part.matrix_local

signature=[]
for rack in layout['racks']:
    x,z=rack['x'],rack['z']
    w,d=rack.get('width',7),rack.get('depth',3.8)
    signature.append([rack['id'],x,z,w,d])
    for dx in (-w/2,w/2):
        for dz in (-d/2,d/2):
            place('RackFoot',x+dx,0,z+dz)
            # Occlusion beyond 2.8 m contributes nothing to this bake. The
            # lower sections are sufficient and avoid needless BVH memory.
            for y in range(3):
                place('RackUpright',x+dx,y,z+dz)
    for y in sorted({loc.get('y',.8) for loc in layout['locations'] if loc.get('rackId')==rack['id']}):
        if y>3:
            continue
        for dz in (-d/2,d/2):
            place('RackBeam',x,y,z+dz,w+.02)

rear=-82 if layout.get('rearExpansionVersion') else -33
depth=35-rear
mesh=bpy.data.meshes.new('Floor lightmap')
mesh.from_pydata([(-52,-35,.032),(52,-35,.032),(52,-rear,.032),(-52,-rear,.032)],[],[(0,1,2,3)])
uv=mesh.uv_layers.new(name='OcclusionUV')
for index,coord in enumerate(((0,0),(1,0),(1,1),(0,1))):
    uv.data[index].uv=coord
floor=bpy.data.objects.new('Floor bake target',mesh)
bpy.context.collection.objects.link(floor)
mat=bpy.data.materials.new('Static occlusion')
mat.use_nodes=True
mesh.materials.append(mat)
image=bpy.data.images.new('Warehouse floor occlusion',width=2048,height=2048,alpha=False)
image.colorspace_settings.name='Non-Color'
tex=mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image=image
mat.node_tree.nodes.active=tex
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=24
scene.world.color=(1,1,1)
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(1,1,1,1)
scene.render.bake.margin=8
scene.world.light_settings.distance=2.8
scene.cycles.device='CPU'
try:
    if os.environ.get('DONPEPE_BAKE_METAL') != '1':
        raise RuntimeError('Use deterministic CPU baking by default')
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use=device.type=='METAL'
    if any(device.use for device in prefs.devices):
        scene.cycles.device='GPU'
except Exception:
    pass
bpy.ops.object.select_all(action='DESELECT')
floor.select_set(True)
bpy.context.view_layer.objects.active=floor
print('Baking static floor contact shadows on',scene.cycles.device,flush=True)
bpy.ops.object.bake(type='AO')
target=ROOT/'public/textures/industrial/floor-occlusion.png'
image.filepath_raw=str(target)
image.file_format='PNG'
image.save()
metadata={'rear':rear,'width':104,'depth':depth,'racks':signature,'resolution':2048,'method':'Cycles AO, static rack supports only'}
(target.parent/'floor-occlusion-layout.json').write_text(json.dumps(metadata,separators=(',',':')))
print('Floor contact occlusion saved:',target)
