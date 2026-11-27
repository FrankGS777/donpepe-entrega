"""Industrial assemblies authored in metres, with the simulation's original pivots.

No visual body changes the load contact surfaces or a vehicle's operational envelope.
Repeated fasteners are merged by material before glTF export.
"""
import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def install(Part, materials, root):
    texture_dir = root / 'assets' / 'industrial-finishes'
    texture_dir.mkdir(exist_ok=True)

    def raster(name, pixels, noncolor=True):
        image = bpy.data.images.new(name, width=pixels.shape[1], height=pixels.shape[0], alpha=False)
        if noncolor:
            image.colorspace_settings.name = 'Non-Color'
        image.pixels.foreach_set(pixels.astype(np.float32).ravel())
        image.filepath_raw = str(texture_dir / (name + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        return image

    # Fine orange-peel and brushed grain are surface responses, not camouflage
    # colour noise. Periodic fields avoid seams and glinting white pixels.
    size = 512
    y, x = np.mgrid[0:size, 0:size] / size
    grain = .018*np.sin(x*math.tau*187) + .012*np.sin(y*math.tau*173 + np.sin(x*math.tau*11))
    rough = np.ones((size, size, 4))
    rough[:, :, :3] = (.79 + grain + .05*np.sin(y*math.tau*5)*np.sin(x*math.tau*7))[:, :, None]
    rough_image = raster('powder-coat-roughness', rough)
    normal = np.ones((size, size, 4))
    normal[:, :, 0] = .5 + .022*np.sin(x*math.tau*117)*np.cos(y*math.tau*93)
    normal[:, :, 1] = .5 + .018*np.cos(x*math.tau*117)*np.sin(y*math.tau*93)
    normal[:, :, 2] = .999
    normal_image = raster('powder-coat-normal', normal)

    def image_node(mat, image, output):
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        tex.extension = 'REPEAT'
        if output == 'Normal':
            normal_node = nodes.new('ShaderNodeNormalMap')
            normal_node.inputs['Strength'].default_value = .32
            links.new(tex.outputs['Color'], normal_node.inputs['Color'])
            links.new(normal_node.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])
        else:
            links.new(tex.outputs['Color'], nodes.get('Principled BSDF').inputs[output])

    for key in ('amber', 'white', 'frame', 'cab', 'supplier', 'orange', 'roof', 'seam'):
        shader = materials[key].node_tree.nodes.get('Principled BSDF')
        shader.inputs['Metallic'].default_value = 0  # dielectric paint over metal
        shader.inputs['Roughness'].default_value = .42 if key not in ('roof', 'seam') else .59
        shader.inputs['Coat Weight'].default_value = .22
        shader.inputs['Coat Roughness'].default_value = .31
        image_node(materials[key], rough_image, 'Roughness')
        image_node(materials[key], normal_image, 'Normal')
    for key in ('zinc', 'metal'):
        shader = materials[key].node_tree.nodes.get('Principled BSDF')
        shader.inputs['Metallic'].default_value = 1
        shader.inputs['Roughness'].default_value = .43 if key == 'zinc' else .36
        image_node(materials[key], rough_image, 'Roughness')
        image_node(materials[key], normal_image, 'Normal')

    # The same licensed scan already used in the browser now reaches the native
    # pallet geometry too. It is packed into the editable .blend and the GLB.
    wood = materials['wood']
    for suffix, socket in (('diff', 'Base Color'), ('nor_gl', 'Normal'), ('rough', 'Roughness')):
        src = root / 'public' / 'textures' / 'industrial' / ('brown_planks_03_' + suffix + '_2k.jpg')
        image = bpy.data.images.load(str(src), check_existing=False)
        image.name = 'pallet-timber-' + suffix
        if suffix != 'diff':
            image.colorspace_settings.name = 'Non-Color'
        image.scale(1024, 1024)
        image.filepath_raw = str(texture_dir / (image.name + '.jpg'))
        image.file_format = 'JPEG'
        image.save()
        image.pack()
        image_node(wood, image, socket)

    # Local cavity shading travels with articulated parts. Vertex colours avoid
    # a separate lightmap texture and UV atlas for every screw and housing.
    for key,mat in materials.items():
        if key in ('glass','glass_day','glass_warm','lamp','optic','tail'):
            continue
        nodes,links=mat.node_tree.nodes,mat.node_tree.links
        shader=nodes.get('Principled BSDF')
        attr=nodes.new('ShaderNodeVertexColor')
        attr.layer_name='Finish'
        if key=='wood':
            source=shader.inputs['Base Color'].links[0].from_socket
            multiply=nodes.new('ShaderNodeMixRGB')
            multiply.blend_type='MULTIPLY'
            multiply.inputs[0].default_value=1
            links.new(source,multiply.inputs[1])
            links.new(attr.outputs['Color'],multiply.inputs[2])
            links.new(multiply.outputs[0],shader.inputs['Base Color'])
        else:
            links.new(attr.outputs['Color'],shader.inputs['Base Color'])

    # Every mesh has real UVs. Previously export_texcoords=False discarded the
    # coordinates entirely, leaving the authored kit as untextured flat colours.
    original_make = Part.make

    def make(self):
        result = original_make(self)
        machine = result.name.startswith(('AMR', 'Fork', 'Stack', 'Shuttle', 'Robot', 'Vision',
                                         'Electrical', 'Reduction', 'Charger', 'Pallet', 'Rack', 'Conveyor', 'AutoID', 'Inspection'))
        for obj in result.children:
            if obj.type != 'MESH':
                continue
            mesh = obj.data
            if 'Finish' not in mesh.color_attributes:
                layer=mesh.color_attributes.new(name='Finish',type='FLOAT_COLOR',domain='POINT')
                coat=mesh.materials[0].diffuse_color
                layer.data.foreach_set('color',list(coat)*len(mesh.vertices))
            mesh.update()
            uv = mesh.uv_layers.new(name='IndustrialUV')
            for poly in mesh.polygons:
                axis = max(range(3), key=lambda a: abs(poly.normal[a]))
                axes = ((1, 2), (0, 2), (0, 1))[axis]
                for loop in poly.loop_indices:
                    point = mesh.vertices[mesh.loops[loop].vertex_index].co
                    uv.data[loop].uv = (point[axes[0]] * 1.7, point[axes[1]] * 1.7)
            if machine:
                # Geometry, rather than a screen-space outline, catches the
                # highlight around cast housings, fork edges and steel flanges.
                bpy.context.view_layer.objects.active = obj
                if result.name not in ('RackUpright', 'PalletWood'):
                    bevel = obj.modifiers.new('Machined edge radii', 'BEVEL')
                    bevel.width = .0016 if result.name.startswith('AMR') else .004
                    bevel.segments = 3
                    bevel.limit_method = 'ANGLE'
                    bevel.angle_limit = .58
                    bevel.harden_normals = True
                    bpy.ops.object.modifier_apply(modifier=bevel.name)
                for face in obj.data.polygons:
                    face.use_smooth = True
                obj.data.set_sharp_from_angle(angle=math.radians(38))
                weighted = obj.modifiers.new('Weighted industrial normals', 'WEIGHTED_NORMAL')
                weighted.keep_sharp = True
                weighted.weight = 50
                bpy.ops.object.modifier_apply(modifier=weighted.name)
        return result

    Part.make = make


def bake_cavities():
    names=('AMR','Forklift','ForkCarriage','Stacker','Shuttle','RobotUpper','RobotForearm',
           'VisionSensor','Charger','ElectricalCabinet','ReductionMotor','AutoIDGantry','InspectionGantry')
    directions=[]
    for i in range(10):
        r=math.sqrt((i+.5)/10)
        angle=i*2.3999632297
        directions.append((r*math.cos(angle),r*math.sin(angle),math.sqrt(1-r*r)))
    for name in names:
        root=bpy.data.objects.get(name)
        if not root:
            continue
        meshes=[obj for obj in root.children if obj.type=='MESH']
        vertices,polygons=[],[]
        for obj in meshes:
            offset=len(vertices)
            vertices.extend(tuple(vertex.co) for vertex in obj.data.vertices)
            polygons.extend(tuple(offset+v for v in face.vertices) for face in obj.data.polygons)
        tree=BVHTree.FromPolygons(vertices,polygons)
        cache={}
        for obj in meshes:
            layer=obj.data.color_attributes.get('Finish')
            if not layer:
                continue
            count=len(obj.data.vertices)
            positions=np.empty((count,3),dtype=np.float32)
            normals=np.empty((count,3),dtype=np.float32)
            colours=np.empty((count,4),dtype=np.float32)
            obj.data.vertices.foreach_get('co',positions.ravel())
            obj.data.vertices.foreach_get('normal',normals.ravel())
            layer.data.foreach_get('color',colours.ravel())
            for index in range(count):
                point,normal=Vector(positions[index]),Vector(normals[index])
                if normal.length_squared<.01:
                    continue
                key=tuple(round(value,4) for value in (*point,*normal))
                if key not in cache:
                    tangent=normal.cross(Vector((0,0,1)) if abs(normal.z)<.9 else Vector((1,0,0))).normalized()
                    bitangent=normal.cross(tangent)
                    origin=point+normal*.002
                    distance=.055 if name=='AMR' else .16
                    covered=0
                    for x,y,z in directions:
                        hit=tree.ray_cast(origin,tangent*x+bitangent*y+normal*z,distance)
                        if hit[0] is not None:
                            covered+=max(0,1-hit[3]/distance)
                    cache[key]=max(.44,1-covered/len(directions)*.78)
                strength=cache[key]
                colours[index,:3]*=strength
            layer.data.foreach_set('color',colours.ravel())
        print('Baked local cavity shading:',name,len(cache),'surface samples',flush=True)


def rebuild(Part, materials):
    def replace(name):
        old = bpy.data.objects.get(name)
        if old:
            for obj in [*old.children_recursive, old]:
                bpy.data.objects.remove(obj, do_unlink=True)
        return Part(name)

    def rounded(p, key, center, dimensions, radius, steps=8):
        x, y, z = center
        w, h, d = dimensions
        radius = min(radius, w*.47, d*.47)
        profile = []
        for cx, cz, angle in ((w/2-radius, d/2-radius, 0), (-w/2+radius, d/2-radius, 90),
                              (-w/2+radius, -d/2+radius, 180), (w/2-radius, -d/2+radius, 270)):
            for i in range(steps+1):
                a = math.radians(angle + i*90/steps)
                profile.append((cx + radius*math.cos(a), cz + radius*math.sin(a)))
        ring_size = len(profile)
        bevel = min(h*.17, .025, radius*.3)
        rings = ((-h/2, .008), (-h/2+bevel, 0), (h/2-bevel, 0), (h/2, .008))
        points = [(x+xx-math.copysign(inset, xx), y+dy, z+zz-math.copysign(inset, zz))
                  for dy, inset in rings for xx, zz in profile]
        faces = [tuple(reversed(range(ring_size))), tuple(range(3*ring_size, 4*ring_size))]
        for ring in range(3):
            for i in range(ring_size):
                j = (i+1) % ring_size
                faces.append((ring*ring_size+i, ring*ring_size+j, (ring+1)*ring_size+j, (ring+1)*ring_size+i))
        # The rounded rectangle profile goes anticlockwise viewed from above.
        # This coordinate convention needs a consistent outward winding.
        p.mesh(key, points, [tuple(reversed(face)) for face in faces], smooth=range(2, len(faces)))

    def line(p, key, points, radius=.012, sides=10):
        for a, b in zip(points, points[1:]):
            if Vector(a) != Vector(b):
                p.tube(key, a, b, radius, sides)

    def bolt(p, point, axis=(0, 0, 1), radius=.013):
        a = Vector(point)
        direction = Vector(axis)
        p.tube('zinc', a, a + direction*.004, radius*1.38, 20)
        p.tube('metal', a + direction*.004, a + direction*.014, radius, 6)
        p.tube('black', a + direction*.014, a + direction*.0145, radius*.35, 6)

    def seam_panel(p, x, y, z, w, h, d, coat='amber'):
        rounded(p, 'black', (x, y, z), (w+.009, h+.008, d+.012), .035)
        rounded(p, coat, (x, y+.004, z+.003), (w, h, d), .035)

    def vent(p, center, width, height, axis='z', count=10):
        x, y, z = center
        for i in range(count):
            yy = y - height/2 + (i+.5)*height/count
            if axis == 'z':
                p.box('black', x, yy, z, width, height/count*.38, .008, .002)
            else:
                p.box('black', x, yy, z, .008, height/count*.38, width, .002)

    # Low under-pallet AGV: maintain the 155 mm body and lifting contact. A
    # tall photographic AMR would collide with the existing buffer supports.
    p = replace('AMR')
    rounded(p, 'black', (0,.059,0), (.79,.078,1.12), .095)
    rounded(p, 'amber', (0,.113,0), (.785,.077,1.115), .09)
    rounded(p, 'frame', (0,.154,0), (.73,.009,1.02), .075)
    for end in (-1, 1):
        rounded(p, 'black', (0,.099,end*.552), (.55,.059,.061), .025)
        p.box('optic', 0,.109,end*.584,.285,.023,.009,.003)
        for side in (-1,1):
            p.box('lamp',side*.295,.128,end*.534,.07,.009,.012,.002)
            bolt(p,(side*.30,.159,end*.385),(0,1,0),.009)
        vent(p,(0,.071,end*.588),.20,.024,count=4)
    for side in (-1,1):
        for z in (-.365,.365):
            p.tube('black',(side*.35,.066,z),(side*.445,.066,z),.064,32)
            p.tube('metal',(side*.444,.066,z),(side*.451,.066,z),.038,32)
            for i in range(5):
                a=i*math.tau/5
                bolt(p,(side*.452,.066+math.cos(a)*.023,z+math.sin(a)*.023),(side,0,0),.004)
        vent(p,(side*.397,.101,0),.20,.037,'x',6)
        p.box('white',side*.398,.124,.16,.004,.020,.091)
    p.make()

    p = replace('Forklift')
    rounded(p,'frame',(0,.44,-.28),(1.24,.40,2.05),.15)
    rounded(p,'amber',(0,.79,-.78),(1.21,.59,.95),.22)
    rounded(p,'amber',(0,.63,.12),(1.29,.44,.63),.10)
    rounded(p,'black',(0,.92,-.19),(.78,.08,.63),.10)
    seam_panel(p,0,1.04,-.72,.71,.10,.42,'frame')
    vent(p,(0,.84,-1.258),.70,.23,count=10)
    for side in (-1,1):
        # Welded overhead guard, optical navigation tower and machined mast.
        for z in (-.98,.40):
            rounded(p,'frame',(side*.533,1.79,z),(.085,1.6,.091),.022)
            bolt(p,(side*.58,1.02,z),(side,0,0),.024)
        p.box('frame',side*.51,1.42,.696,.14,2.53,.18,.018)
        p.box('zinc',side*.445,1.42,.755,.046,2.49,.064,.005)
        p.tube('metal',(side*.33,.36,.622),(side*.33,1.89,.622),.059,32)
        p.tube('zinc',(side*.33,1.78,.622),(side*.33,2.56,.622),.026,32)
        for y in (.38,1.30,2.40):
            p.tube('metal',(side*.46,y,.58),(side*.46,y,.80),.061,24)
            bolt(p,(side*.46,y,.808),(0,0,1),.021)
        for y in np.arange(.38,2.43,.085):
            p.box('metal',side*.40,float(y),.588,.025,.039,.028,.003)
        # A flexible hydraulic line follows the stationary mast, clear of forks.
        line(p,'black',[(side*.37,.60,.57),(side*.39,2.35,.57),(side*.35,2.52,.57),
                       (side*.26,2.53,.57),(side*.22,2.41,.57),(side*.23,.85,.57)],.018,12)
        for yy, zz in ((.80,-1.13),(.66,-.32),(.55,.33)):
            bolt(p,(side*.615,yy,zz),(side,0,0),.019)
        p.box('black',side*.613,.83,-.80,.009,.31,.46,.007)
        vent(p,(side*.622,.83,-.80),.40,.25,'x',9)
        p.box('white',side*.621,.59,-.72,.007,.11,.32,.006)
        p.box('lamp',side*.49,2.51,.472,.135,.105,.089,.018)
    for z in (-1,-.71,-.42,-.13,.16,.43):
        rounded(p,'frame',(0,2.614,z),(1.15,.095,.078),.020)
    for x in (-.54,.54):
        rounded(p,'metal',(x,2.61,-.31),(.10,.11,1.52),.022)
    p.tube('frame',(0,.94,-.45),(0,1.22,-.45),.12,32)
    p.tube('optic',(0,1.18,-.45),(0,1.26,-.45),.124,48)
    p.tube('metal',(0,1.26,-.45),(0,1.29,-.45),.12,48)
    for a in np.arange(0,math.tau,math.tau/16):
        p.tube('frame',(.125*math.cos(a),1.20,-.45+.125*math.sin(a)),
               (.125*math.cos(a),1.25,-.45+.125*math.sin(a)),.004,6)
    p.make()

    p = Part('ForkCarriage')
    p.box('metal',0,.18,.79,1.05,.40,.13,.018)
    for x in (-.40,.40):
        # Forged L forks: top contact and reach exactly match previous geometry.
        p.box('metal',x,-.055,1.32,.12,.09,.90,.018)
        p.box('metal',x,.145,.755,.12,.36,.10,.018)
        p.box('metal',x,-.055,.835,.12,.09,.18,.018)
        bolt(p,(x,.24,.810),(0,0,1),.024)
    for x in (-.24,0,.24):
        p.box('frame',x,.46,.79,.026,.32,.050,.006)
    p.box('frame',0,.61,.79,1.03,.035,.060,.008)
    for x in (-.49,.49):
        p.tube('zinc',(x,.18,.68),(x,.18,.74),.072,32)
    p.make()

    p = replace('Stacker')
    rounded(p,'frame',(0,.44,0),(2.2,.70,1.4),.12)
    rounded(p,'amber',(0,.77,-.1),(2.01,.15,1.23),.08)
    rounded(p,'amber',(0,8.8,0),(1.72,.31,.54),.08)
    seam_panel(p,0,2.07,-.328,.73,2.39,.39,'white')
    p.box('frame',.01,2.48,-.535,.45,.46,.043,.018)
    p.box('optic',.01,2.51,-.566,.30,.21,.029,.008)
    vent(p,(0,1.35,-.537),.52,.46,count=12)
    for x in (-.55,.55):
        p.box('frame',x,4.49,0,.17,8.75,.25,.018)
        p.box('zinc',x,4.49,.138,.067,8.59,.066,.007)
        p.box('zinc',x,4.49,-.129,.054,8.59,.041,.005)
        for y in np.arange(.36,8.6,.13):
            p.box('metal',x,float(y),-.152,.078,.060,.035,.005)
        for y in (1.0,3.2,5.0,6.8,8.5):
            bolt(p,(x,y,.177),(0,0,1),.027)
    for y in (1.4,3.2,5.0,6.8,8.55):
        p.box('frame',0,y,-.13,1.08,.105,.10,.013)
    # Cable carrier stays in the protected spine, not across the pallet lane.
    for y in np.arange(.85,8.7,.10):
        p.box('black',.23,float(y),-.23,.13,.066,.12,.008)
    for x in (-.96,.96):
        p.tube('black',(x,.25,-.42),(x,.25,.42),.21,32)
        p.tube('metal',(x,.25,-.44),(x,.25,-.42),.13,32)
    p.make()

    p = replace('Shuttle')
    rounded(p,'frame',(0,.29,0),(2.29,.41,2.33),.13)
    rounded(p,'amber',(0,.55,0),(2.38,.27,2.37),.12)
    rounded(p,'metal',(0,.725,0),(2.37,.13,2.36),.07)
    for x in (-.86,.86):
        p.box('zinc',x,.78,0,.26,.086,2.22,.018)
        for z in (-.76,.76):
            side=math.copysign(1,x)
            p.tube('black',(side*.89,.19,z),(side*1.19,.19,z),.17,32)
            p.tube('zinc',(side*1.17,.19,z),(side*1.20,.19,z),.084,32)
        for z in np.arange(-.9,1,.30):
            bolt(p,(x,.826,float(z)),(0,1,0),.018)
    for z in (-1.201,1.201):
        rounded(p,'black',(0,.54,z),(.59,.16,.034),.012)
        p.box('optic',0,.55,z*1.018,.42,.047,.015,.006)
        for x in (-.8,.8):
            bolt(p,(x,.55,z),(0,0,math.copysign(1,z)),.022)
        vent(p,(.82,.36,z),.35,.16,count=6)
    p.make()

    for name,length,width in (('RobotUpper',3.4,.38),('RobotForearm',3.2,.30)):
        p=replace(name)
        # Tapered castings, separate servo caps and real flange fasteners.
        p.tube('amber',(0,.14,0),(0,length-.15,0),width*.69,40,width*.42)
        rounded(p,'amber',(0,length*.48,0),(width*1.15,length*.66,width*.91),width*.32)
        rounded(p,'frame',(0,length*.48,-width*.49),(width*.77,length*.55,.08),.028)
        for y in (.15,length-.15):
            p.tube('frame',(0,y,-width*.80),(0,y,width*.80),width*.72,48)
            for side in (-1,1):
                p.tube('metal',(0,y,side*width*.80),(0,y,side*width*.85),width*.57,48)
                p.tube('amber',(0,y,side*width*.855),(0,y,side*width*.94),width*.48,48)
                for j in range(10):
                    a=j*math.tau/10
                    bolt(p,(math.cos(a)*width*.52,y+math.sin(a)*width*.52,side*width*.86),(0,0,side),width*.04)
        points=[(-width*.8, .35+i*(length-.7)/22, -.06-width*.22*math.sin(i*math.pi/22)) for i in range(23)]
        line(p,'black',points,.041,12)
        for i,point in enumerate(points[::3]):
            p.tube('metal',Vector(point)+Vector((-.002,-.018,0)),Vector(point)+Vector((-.002,.018,0)),.047,12)
        p.make()

    p=replace('VisionSensor')
    rounded(p,'frame',(0,0,0),(.38,.28,.41),.04)
    p.box('zinc',0,.13,0,.42,.075,.45,.018)
    p.tube('metal',(0,-.125,0),(0,-.17,0),.116,48)
    p.tube('black',(0,-.17,0),(0,-.22,0),.103,48)
    p.tube('optic',(0,-.218,0),(0,-.226,0),.077,48)
    p.tube('zinc',(0,-.226,0),(0,-.229,0),.083,48)
    p.tube('optic',(0,-.229,0),(0,-.230,0),.073,48)
    for x in (-.134,.134):
        p.box('lamp',x,-.145,0,.046,.032,.19,.008)
        for z in (-.16,.16):
            bolt(p,(x,.172,z),(0,1,0),.011)
    for z in (-.12,-.06,0,.06,.12):
        p.box('metal',.193,0,z,.017,.22,.025,.006)
    p.tube('black',(.05,.02,.20),(.05,.02,.25),.025,20)
    p.make()

    # One-metre upright sections retain hole spacing as the rack height grows.
    p=replace('RackUpright')
    for x in (-.082,.082):
        p.box('zinc',x,.5,0,.036,1,.185,.004)
    # Open perforations, not black decals. The two web strips and the bridges
    # between holes are solid sheet steel; no hidden face fills an opening.
    for x in (-.06175,.06175):
        p.box('zinc',x,.5,-.084,.0765,1,.042)
    cursor=0
    for yy in np.arange(.06,1,.10):
        lower,upper=float(yy)-.0235,float(yy)+.0235
        if lower>cursor:
            p.box('zinc',0,(cursor+lower)/2,-.084,.047,lower-cursor,.042)
        cursor=upper
    if cursor<1:
        p.box('zinc',0,(cursor+1)/2,-.084,.047,1-cursor,.042)
    p.make()
    p=Part('RackConnector')
    p.box('orange',0,0,0,.105,.35,.22,.01)
    for y in (-.105,.105):
        bolt(p,(0,y,.116),(0,0,1),.022)
    p.make()

    p=replace('PalletWood')
    for side in (-1,0,1):
        for z in (-.385,0,.385):
            p.box('wood',side*.49,.064,z,.165,.115,.152,.008)
        p.box('wood',side*.49,.017,0,.17,.031,.94,.004)
    for z in (-.39,-.195,0,.195,.39):
        p.box('wood',0,.156,z,1.16,.048,.157,.005)
        for x in (-.49,0,.49):
            for dz in (-.038,.038):
                p.tube('metal',(x,.1801,z+dz),(x,.1808,z+dz),.005,8)
    p.make()

    # Existing cabinets and charger bodies get door hardware, glands and plinth
    # fixings without changing their footprints or charging contacts.
    for name in ('ElectricalCabinet','Charger'):
        old=bpy.data.objects.get(name)
        p=Part(name+'Hardware')
        if name=='ElectricalCabinet':
            for x in (-.37,.37):
                for y in (.23,1.48):
                    bolt(p,(x,y,-.354),(0,0,-1),.018)
            for y in (.42,1.30):
                p.box('metal',-.455,y,-.23,.026,.12,.08,.007)
            for x in (-.20,0,.20):
                p.tube('black',(x,.15,.05),(x,.075,.05),.025,20)
            line(p,'black',[(.28,.18,.10),(.28,.09,.10),(.38,.03,.10),(.48,.03,.10)],.022,12)
        else:
            vent(p,(0,.51,.002),.56,.20,count=8)
            for x in (-.37,.37):
                for y in (.35,1.06):
                    bolt(p,(x,y,.01),(0,0,1),.017)
            p.tube('frame',(-.34,1.12,.01),(-.34,1.12,.05),.044,24)
            p.tube('tail',(-.34,1.12,.05),(-.34,1.12,.07),.030,24)
        hardware=p.make()
        for child in list(hardware.children):
            child.parent=old
        bpy.data.objects.remove(hardware,do_unlink=True)

    # GLB extents and pivot metadata are consumed by a small asset validation
    # step; they document the mechanical interfaces rather than inventing them.
    for obj in bpy.context.scene.objects:
        if obj.parent is None:
            obj['units']='metres'
            obj['finish_version']='industrial-2026-11-22'

