"""Author the DonPepe map kit in Blender. Coordinates match the simulation in metres.

blender -b -t 4 --factory-startup --python v2/scripts/blender/build_scene.py
"""
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Vector

V2 = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def linear(channel):
    return channel / 12.92 if channel <= .04045 else ((channel + .055) / 1.055) ** 2.4


def rgba(rgb):
    return (*[linear(((rgb >> shift) & 255) / 255) for shift in (16, 8, 0)], 1)


def material(name, rgb, roughness, metal=0, emission=None, strength=1, vertex=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(rgb)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = mat.diffuse_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metal
    if vertex:
        attr = mat.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Finish"
        mat.node_tree.links.new(attr.outputs["Color"], shader.inputs["Base Color"])
    if emission is not None:
        shader.inputs["Emission Color"].default_value = rgba(emission)
        shader.inputs["Emission Strength"].default_value = strength
    return mat


M = {
    "zinc": material("Acero galvanizado", 0xA7AEB1, .38, .72),
    "metal": material("Chapa laminada", 0x555B60, .33, .64),
    "frame": material("Esmalte antracita", 0x242D35, .39, .42),
    "black": material("Caucho industrial", 0x16191B, .86),
    "amber": material("Seguridad ocre", 0xD6A02F, .38, .24),
    "white": material("Esmalte de equipo marfil", 0xD8D7CB, .39, .24),
    "cab": material("Pintura azul mineral", 0x263E56, .24, .35),
    "supplier": material("Pintura del proveedor", 0xD9DDE0, .31, .32),
    "roof": material("Chapa prepintada · azul cobalto", 0x164777, .39, .46),
    "seam": material("Junta de chapa azul", 0x1C507E, .33, .52),
    "glass": material("Vidrio ahumado", 0x273C4A, .19, .31),
    "glass_day": material("Ventanal reflectante", 0x405469, .23, .28),
    "glass_warm": material("Iluminación detrás de vidrio", 0x6E5E46, .46, .12, 0xF5AD50, .52),
    "lamp": material("Difusor cálido", 0xE9D6AC, .38, 0, 0xFFC473, 3),
    "optic": material("Óptica ahumada", 0x293A42, .17, .31, 0x69B0CA, .12),
    "tail": material("Óptica roja", 0x681C1D, .26, .15, 0xDC2422, .75),
    "orange": material("Acero lacado bermellón", 0xB94B29, .45, .34),
    "paint": material("Chapa con variación de fábrica", 0xFFFFFF, .55, .18, vertex=True),
    "stucco": material("Estuco y ladrillo mineral", 0xFFFFFF, .86, vertex=True),
    "wood": material("Madera de palé", 0xFFFFFF, .87, vertex=True),
}
FRONTS = ((-50.5, -39), (-31, 25.3), (30.7, 41.3), (46.7, 50.5))
DOCKS = ((-35, 4), (28, 2.7), (44, 2.7))
LUMINAIRES = (-47, -23, 4, 19, 35.5, 49)


class Part:
    """Accumulate parts by material so each material needs one mesh per kit model."""
    def __init__(self, name):
        self.root = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(self.root)
        self.batches = defaultdict(lambda: ([], [], []))

    def mesh(self, key, vertices, faces, color=0xFFFFFF, smooth=()):
        points, polygons, colors = self.batches[key]
        start = len(points)
        points.extend((x, -z, y) for x, y, z in vertices)
        for idx, face in enumerate(faces):
            polygons.append(([start + i for i in face], idx in smooth))
        colors.extend([rgba(color)] * len(vertices))

    def box(self, key, x, y, z, w, h, d, edge=0, rotation=0, color=0xFFFFFF):
        # Chamfered horizontal silhouette with short bevel faces at top and bottom.
        if edge:
            w, d = w / 2, d / 2
            e = min(edge, w * .45, d * .45, h * .24)
            profile = [(-w + e, -d), (w - e, -d), (w, -d + e), (w, d - e),
                       (w - e, d), (-w + e, d), (-w, d - e), (-w, -d + e)]
            rings = [(-h / 2, .72), (-h / 2 + e, 1), (h / 2 - e, 1), (h / 2, .72)]
            # Inset by a fixed amount so long panels keep their full silhouette.
            pts = [(x + xx - (1-scale)*e*math.copysign(1, xx), y + yy,
                    z + zz - (1-scale)*e*math.copysign(1, zz))
                   for yy, scale in rings for xx, zz in profile]
            faces = [tuple(range(8)), tuple(range(31, 23, -1))]
            faces.extend((base+i, base+i+8, base+j+8, base+j)
                         for base in (0, 8, 16) for i in range(8) for j in [(i+1) % 8])
        else:
            pts = [(x+xx*w/2, y+yy*h/2, z+zz*d/2) for yy in (-1,1)
                   for xx,zz in ((-1,-1),(1,-1),(1,1),(-1,1))]
            faces = [(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]
        if rotation:
            cs, sn = math.cos(rotation), math.sin(rotation)
            pts = [(x+(xx-x)*cs-(yy-y)*sn, y+(xx-x)*sn+(yy-y)*cs, zz) for xx, yy, zz in pts]
        self.mesh(key, pts, faces, color)

    def tube(self, key, a, b, r, sides=14, top=None):
        start, end = Vector(a), Vector(b)
        axis = (end - start).normalized()
        u = axis.cross(Vector((0, 1, 0)) if abs(axis.y) < .9 else Vector((1, 0, 0))).normalized()
        v = axis.cross(u)
        vertices = [tuple(p + radius * (u * math.cos(i*math.tau/sides) + v * math.sin(i*math.tau/sides)))
                    for p, radius in ((start, r), (end, r if top is None else top)) for i in range(sides)]
        faces = [tuple(reversed(range(sides))), tuple(range(sides, sides*2))]
        faces.extend((i, (i+1) % sides, (i+1) % sides+sides, i+sides) for i in range(sides))
        self.mesh(key, vertices, faces, smooth=range(2, sides+2))

    def make(self):
        for key, (vertices, faces, colors) in self.batches.items():
            mesh = bpy.data.meshes.new(self.root.name + " · " + key)
            mesh.from_pydata(vertices, [], [face for face, _ in faces])
            mesh.materials.append(M[key])
            for poly, (_, smooth) in zip(mesh.polygons, faces):
                poly.use_smooth = smooth
            if key in ("paint", "stucco", "wood"):
                layer = mesh.color_attributes.new(name="Finish", type="FLOAT_COLOR", domain="POINT")
                layer.data.foreach_set("color", [value for color in colors for value in color])
            mesh.update()
            obj = bpy.data.objects.new(mesh.name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.parent = self.root
        return self.root


def front():
    p = Part("DepotFront")
    rng = random.Random(108)
    for left, right in FRONTS:
        p.box("paint", (left+right)/2, 5.6, 0, right-left, 11.2, .54, color=0x9DA0A2)
        p.box("stucco", (left+right)/2, .47, .31, right-left, .94, .14, .03, color=0x8E8A80)
        count = math.ceil((right-left)/.73)
        for index in range(count):
            width = (right-left)/count
            x = left + (index+.5)*width
            tint = rng.choice((0xCDCDC2, 0xC4C6C1, 0xBCC0BC, 0xD1D0C3, 0xC3C4B9))
            p.box("paint", x, 5.99, .302, width-.025, 10.08, .085, .01, color=tint)
            for y in (1.08, 4.25, 7.1, 10.85):
                p.tube("zinc", (x-width*.36,y,.345),(x-width*.36,y,.352),.026,5)
    for x, half in DOCKS:
        p.box("paint", x, 8.53, 0, half*2, 5.34, .57, color=0xCBC9BF)
        count = math.ceil(half*2/.71)
        for i in range(count):
            w = half*2/count
            p.box("paint",x-half+(i+.5)*w,8.53,.31,w-.025,5.32,.08,.012,color=0xC5C7BF)
        for side in (-1,1):
            cx = x + side*half
            p.box("frame",cx,2.83,.53,.51,5.66,.95,.075)
            p.box("black",cx-side*.15,2.73,.99,.19,5.42,.23,.045)
            p.box("zinc",cx+side*.15,2.87,1.01,.065,5.56,.065)
            p.box("black",cx+side*.09,.5,1.19,.51,1,.33,.065)
            for y in (.29,.75):
                p.tube("zinc",(cx+side*.2,y,1.32),(cx+side*.2,y,1.39),.06,6)
            p.tube("amber",(cx+side*.67,.01,1.12),(cx+side*.67,1.24,1.12),.13,14,.115)
            p.tube("frame",(cx+side*.67,.79,1.12),(cx+side*.67,.95,1.12),.134)
            p.box("zinc",cx+side*.67,.056,1.12,.36,.09,.36,.035)
        p.box("frame",x,5.61,.59,half*2+.51,.51,1.12,.08)
        p.box("metal",x,5.97,.67,half*2+.46,.22,.72,.06)
        p.box("lamp",x,5.36,.96,half*1.48,.06,.11,.015)
        p.box("frame",x+half+.74,2.72,.39,.34,.65,.19,.043)
        p.box("optic",x+half+.74,2.82,.49,.22,.23,.04,.015)
    p.box("amber", 0, 10.96, .39, 101.8, .105, .14)
    for x in (-50.72, 50.72):
        p.box("roof",x,5.61,.03,.41,11.22,.75,.04)
    for x in LUMINAIRES:
        p.box("black",x,8.04,.44,.58,.39,.22,.035)
        p.box("frame",x,7.97,.71,.67,.23,.47,.06)
        p.box("lamp",x,7.84,.73,.53,.06,.30,.02)
        p.tube("metal",(x+.24,8.12,.37),(x+.24,10.85,.37),.026,8)
    p.make()


def roof():
    p = Part("DepotRoof")
    slope = math.atan2(3.5, 20.4)
    p.box("roof",0,1.75,0,math.hypot(20.4,3.5),.2,1,rotation=slope)
    # Wide structural seams stay readable from the aerial camera. Fine ridges
    # at this distance create aliasing even with multisampling.
    for i in range(16):
        x = -9.57 + i*1.276
        y = 1.868 + x*3.5/20.4
        p.box("seam",x,y,0,.059,.025,.997,rotation=slope)
    for x, y in ((-10.2,.015),(10.2,3.48)):
        p.box("frame",x,y,0,.25,.19,1)
    p.make()
    panel = Part("Clerestory")
    panel.box("glass_warm",0,1.75,0,.13,3.28,.96)
    for y in (.1,1.04,2.47,3.42):
        panel.box("frame",0,y,0,.21,.09,1)
    for z in (-.485,.0):
        panel.box("zinc",0,1.75,z,.18,3.36,.025)
    panel.make()



def side_wall():
    p = Part("DepotSide")
    for j in range(5):
        z = (j-2)*.197
        tint=(0xC9CCC4,0xC2C5BD,0xC1C4BE,0xC9C9C3,0xB9BDB9)[j]
        p.box("paint",.307,5.87,z,.072,10.40,.187,color=tint)
        p.box("metal",.348,5.88,z-.091,.024,10.42,.014)
    p.box("stucco",.32,.315,0,.11,.63,.995,color=0x777773)
    p.box("frame",.372,.733,0,.054,.135,.993)
    p.box("amber",.376,10.97,0,.075,.114,.998)
    p.make()
    p = Part("Downpipe")
    points=[(.1,10.78,0),(.30,10.63,0),(.43,10.47,0),(.43,.40,0),(.52,.19,0)]
    for a,b in zip(points,points[1:]):
        p.tube("metal",a,b,.077,13)
    for y in (1.2,3.6,6.9,9.6):
        p.box("zinc",.35,y,0,.25,.051,.19,.012)
    p.make()


def wall_light():
    """Bake the indirect wall and yard spill into a small linear HDR-compatible atlas."""
    path = V2 / "public/textures/industrial/dock-spill.png"
    size = 128
    image = bpy.data.images.new("Mapa de luz del muelle", size, size, alpha=True)
    pixels = []
    for row in range(size):
        distance = row/(size-1)
        for column in range(size):
            side = (column/(size-1)-.5)*2
            aperture = .19 + distance*.81
            falloff = math.exp(-1.65*(side/aperture)**2) * math.exp(-1.8*distance) * (1-distance)**1.18
            near = min(1, distance * 21)
            pixels.extend((1., .62, .28, falloff*near*.93))
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()
    image.pack()
    image.use_fake_user = True


def city():
    for variant, kind in enumerate(("IndustrialHangar","IndustrialWorkshop","ResidentialBrick","ResidentialTerraces","OfficeCorner","MarketSheds")):
        p = Part(kind)
        rng = random.Random(521+variant)
        industrial = variant < 2 or variant == 5
        stories = (1,2,4,5,3,1)[variant]
        wall = (0xA6A5A1,0xC3AC8F,0xA67360,0xC3B799,0x858C91,0xA19A8B)[variant]
        p.box("stucco",0,.19,0,1.07,.38,1.06,color=0x777572)
        p.box("stucco",0,1.11,0,1,1.78,.99,.017,color=wall)
        p.box("metal",0,2.008,0,1.025,.055,1.025,.012)
        for s in (-1,1):
            p.box("stucco",s*.497,2.048,0,.027,.099,1.02,color=wall)
            p.box("stucco",0,2.048,s*.505,1.02,.099,.022,color=wall)
        for row in range(stories):
            y = .58+(row+.5)*1.35/stories
            if industrial:
                y = 1.56 if stories == 1 else y
            grid = (-.39,-.26,-.13,0,.13,.26,.39)
            for x in grid:
                if variant == 1 and abs(x) < .15 and row == 0:
                    continue
                for side in (-1,1):
                    lit = "glass_warm" if rng.random()<.15 else rng.choice(("glass","glass_day"))
                    depth = side*.501
                    p.box("frame",x,y,depth,.087,.221,.017)
                    p.box(lit,x,y,depth+side*.011,.070,.179,.012)
                    p.box("metal",x,y,depth+side*.019,.006,.18,.005)
                    p.box("stucco",x,y-.11,depth+side*.011,.095,.025,.045,color=0xA6A19A)
                    if variant == 3 and abs(x) > .12:
                        p.box("stucco",x,y-.144,depth+side*.038,.109,.028,.082,color=0x877B70)
                        p.box("metal",x,y-.095,depth+side*.074,.102,.045,.011)
            for z in (-.37,-.185,.185,.37):
                for side in (-1,1):
                    p.box("glass_warm" if rng.random()<.12 else "glass",side*.505,y,z,.016,.188,.084)
            if variant in (2,3,4):
                p.box("stucco",0,y-.19,0,1.021,.044,1.01,color=0x817A72)
        if industrial:
            for x in (-.28,.0,.28):
                p.box("frame",x,.57,.509,.18,.95,.026)
                for i in range(8):
                    p.box("zinc",x,.17+i*.104,.526,.156,.091,.014)
                p.box("metal",x,1.07,.568,.217,.062,.175,.018)
            for x in (-.43,.43):
                for i in range(8):
                    p.box("stucco",x,.27+i*.195,.51,.09,.13,.026,color=0x8A8376)
        else:
            p.box("glass",0,.44,.508,.14,.65,.033)
            p.box("frame",0,.82,.557,.22,.078,.15,.016)
        p.box("stucco",-.30,2.14,-.23,.21,.24,.28,.025,color=0x8C867D)
        p.tube("black",(.32,2.035,.24),(.32,2.18,.24),.047,12)
        for x in (-.43,.43):
            p.box("metal",x,1.12,.522,.009,1.75,.016)
        p.make()


def truck_cab(name, coat):
    p=Part(name)
    rings=[(6.61,1.02,1.04,3.53),(6.90,1.25,.96,3.67),(7.75,1.27,.92,3.70),
           (8.68,1.24,.91,3.58),(9.16,1.19,1.01,3.32),(9.40,1.09,1.11,2.19)]
    profile=lambda w,lo,hi: [(-w*.80,lo),(w*.80,lo),(w,lo+.18),(w,hi-.37),
                             (w*.80,hi),(-w*.80,hi),(-w,hi-.37),(-w,lo+.18)]
    points=[(x,y,z) for z,w,lo,hi in rings for x,y in profile(w,lo,hi)]
    faces=[tuple(range(7,-1,-1)),tuple(range(40,48))]
    faces.extend((i+j,i+(j+1)%8,i+8+(j+1)%8,i+8+j) for i in range(0,40,8) for j in range(8))
    p.mesh(coat,points,faces)
    p.mesh("glass", [(-1.07,2.23,9.401),(1.07,2.23,9.401),(1.02,3.14,9.20),(-1.02,3.14,9.20)], [(0,1,2,3)])
    for side in (-1,1):
        p.mesh("glass_day",[(side*1.262,2.38,7.48),(side*1.255,2.38,8.76),
                             (side*1.179,2.92,9.17),(side*1.242,3.08,8.59),(side*1.27,3.12,7.48)],
               [(0,1,2,3,4)] if side<0 else [(4,3,2,1,0)])
        p.box("black",side*1.198,1.14,8.1,.22,.48,1.24,.06)
        for y in (1.02,1.28):
            p.box("zinc",side*1.307,y,8.14,.19,.05,.78,.012)
        p.box("zinc",side*1.266,2.19,7.65,.026,.065,.2,.008)
        p.box("frame",side*1.34,2.89,8.79,.26,.07,.12,.02)
        p.box("black",side*1.49,2.84,8.8,.11,.33,.19,.045)
        p.box("glass",side*1.49,2.84,8.696,.079,.25,.008,.01)
        p.box("lamp",side*.89,1.53,9.432,.33,.17,.055,.03)
        p.box("amber",side*1.05,1.53,9.438,.066,.14,.044,.016)
    p.box("black",0,1.58,9.423,1.26,.68,.061,.03)
    for i in range(8):
        p.box("zinc",0,1.3+i*.075,9.457,1.17,.024,.025)
    p.box("metal",0,1.07,9.433,2.36,.23,.12,.048)
    p.box("black",0,2.256,9.405,1.99,.027,.024)
    p.box("white",0,1.034,9.506,.38,.10,.026)
    p.make()


def trailer():
    p=Part("TrailerSides")
    for side in (-1,1):
        p.box("white",side*1.34,2.65,-.2,.075,2.9,14,.011)
        p.box("zinc",side*1.391,1.31,-.2,.06,.24,14.12,.012)
        p.box("zinc",side*1.391,4.04,-.2,.052,.09,14.12,.01)
        p.box("amber",side*1.425,1.53,-.2,.036,.104,13.91)
        for j in range(22):
            z=-6.86+j*.63
            if abs(z+.2) > 3:
                p.box("white",side*1.391,2.78,z,.026,2.43,.49,.012)
                for y in (1.65,3.97):
                    p.tube("zinc",(side*1.406,y,z),(side*1.421,y,z),.017,6)
        for z in (-6.64,-4.8,-2.6,0,2.6,4.8,6.52):
            p.box("amber",side*1.433,1.45,z,.022,.06,.17,.01)
        p.box("black",side*1.10,.69,-6.36,.36,.67,.075,.015)
        p.box("tail",side*1.03,1.03,-7.278,.28,.16,.059,.025)
    p.box("white",0,2.65,6.80,2.71,2.9,.11,.022)
    p.make()


def vehicles():
    truck_cab("DeliveryCab","cab")
    truck_cab("SupplierCab","supplier")
    trailer()
    p=Part("Forklift")
    p.box("frame",0,.46,-.28,1.24,.43,2.05,.105)
    p.box("amber",0,.79,-.78,1.21,.60,.95,.125)
    p.box("amber",0,.63,.12,1.29,.44,.63,.09)
    p.box("black",0,.92,-.17,.77,.095,.59,.035)
    p.box("glass",0,1.06,-.69,.66,.18,.28,.04)
    for side in (-1,1):
        for z in (-.98,.40):
            p.box("frame",side*.533,1.79,z,.085,1.6,.091,.016)
        p.box("frame",side*.51,1.42,.696,.14,2.53,.18,.02)
        p.box("zinc",side*.445,1.42,.755,.046,2.49,.064,.008)
        p.tube("metal",(side*.33,.36,.622),(side*.33,1.89,.622),.059)
        p.tube("zinc",(side*.33,1.8,.622),(side*.33,2.56,.622),.026)
        p.box("black",side*.605,.85,-.77,.018,.29,.49,.01)
        for i in range(8):
            p.box("metal",side*.621,.85,-.97+i*.053,.017,.233,.017)
        p.box("lamp",side*.49,2.51,.47,.135,.105,.089,.023)
    for z in (-1,-.52,-.03,.43):
        p.box("frame",0,2.614,z,1.15,.1,.088,.016)
    for x in (-.54,.54):
        p.box("metal",x,2.61,-.31,.1,.11,1.52,.023)
    p.make()
    p=Part("Stacker")
    p.box("frame",0,.44,0,2.2,.70,1.4,.095)
    p.box("amber",0,.77,-.1,2.01,.15,1.23,.038)
    p.box("amber",0,8.8,0,1.72,.31,.54,.044)
    p.box("white",0,2.07,-.328,.73,2.39,.39,.04)
    p.box("frame",.01,2.48,-.535,.45,.46,.043,.018)
    p.box("optic",.01,2.51,-.566,.3,.21,.029,.01)
    for x in (-.55,.55):
        p.box("frame",x,4.49,0,.17,8.75,.25,.023)
        p.box("zinc",x,4.49,.138,.067,8.59,.066)
        p.box("zinc",x,4.49,-.129,.054,8.59,.041)
        for i in range(15):
            p.box("metal",x,1+i*.505,-.143,.09,.11,.058,.01)
    for y in (1.4,3.2,5.0,6.8,8.55):
        p.box("frame",0,y,-.13,1.08,.105,.10,.017)
    p.make()
    p=Part("Shuttle")
    p.box("frame",0,.29,0,2.29,.41,2.33,.088)
    p.box("amber",0,.55,0,2.38,.27,2.37,.072)
    p.box("metal",0,.725,0,2.37,.13,2.36,.038)
    for x in (-.86,.86):
        p.box("zinc",x,.78,0,.26,.086,2.22,.02)
        for z in (-.76,.76):
            s=math.copysign(1,x)
            p.tube("black",(s*.89,.19,z),(s*1.19,.19,z),.17,16)
            p.tube("zinc",(s*1.17,.19,z),(s*1.20,.19,z),.084,12)
    for z in (-1.201,1.201):
        p.box("black",0,.54,z,.59,.16,.034,.024)
        p.box("optic",0,.55,z*1.018,.42,.047,.015,.01)
    p.make()
    p=Part("AMR")
    p.box("black",0,.063,0,.79,.09,1.12,.022)
    p.box("amber",0,.112,0,.79,.086,1.12,.02)
    for side in (-1,1):
        p.box("frame",0,.106,side*.575,.62,.074,.05,.014)
        p.box("optic",0,.113,side*.604,.32,.027,.012,.004)
        for z in (-.365,.365):
            p.tube("black",(side*.35,.066,z),(side*.445,.066,z),.064,14)
            p.tube("zinc",(side*.443,.066,z),(side*.451,.066,z),.033,10)
    p.make()


def rack():
    p=Part("RackUpright")
    p.box("zinc",0,.5,-.084,.20,1,.042)
    for x in (-.082,.082):
        p.box("zinc",x,.5,0,.036,1,.185)
    p.make()
    p=Part("RackFoot")
    p.box("zinc",0,.058,0,.35,.111,.36,.02)
    p.box("amber",0,.37,0,.253,.51,.252,.027)
    for x in (-.125,.125):
        for z in (-.121,.121):
            p.tube("metal",(x,.11,z),(x,.143,z),.032,6)
    p.make()
    p=Part("RackBeam")
    p.box("orange",0,.0,.0,1,.215,.155,.02)
    p.box("orange",0,.087,-.033,1,.064,.219,.012)
    p.box("metal",0,-.091,.08,.995,.021,.015)
    p.make()


def automation():
    p=Part("ElectricalCabinet")
    p.box("frame",0,.10,0,.85,.13,.71,.025)
    p.box("white",0,.86,0,.91,1.48,.63,.045)
    p.box("zinc",0,.86,-.327,.82,1.39,.041,.026)
    p.box("frame",0,1.15,-.355,.47,.35,.043,.022)
    p.box("optic",-.05,1.18,-.385,.26,.19,.023,.012)
    p.tube("tail",(.145,1.20,-.378),(.145,1.20,-.404),.043,12)
    p.tube("amber",(.145,1.10,-.378),(.145,1.10,-.4),.03,12)
    p.box("black",.31,.78,-.358,.065,.22,.052,.018)
    for y in (.23,.29,.35,.41,.47,.53):
        p.box("frame",-.16,y,-.35,.45,.017,.012)
    for x in (-.35,.35):
        for z in (-.24,.24):
            p.box("metal",x,.069,z,.22,.13,.19,.016)
    p.make()
    p=Part("ReductionMotor")
    p.box("zinc",0,-.15,0,.55,.08,.41,.033)
    p.tube("frame",(-.27,0,0),(.27,0,0),.161,20)
    p.tube("zinc",(-.25,0,0),(-.21,0,0),.196,20)
    p.tube("metal",(.21,0,0),(.28,0,0),.178,20,.14)
    for i in range(12):
        a=i*math.tau/12
        p.tube("metal",(-.20,math.cos(a)*.157,math.sin(a)*.157),(.215,math.cos(a)*.157,math.sin(a)*.157),.023,6)
    p.box("frame",.07,.17,0,.21,.13,.19,.025)
    p.make()
    for name,length,width in (("RobotUpper",3.4,.38),("RobotForearm",3.2,.30)):
        p=Part(name)
        p.tube("amber",(0,.14,0),(0,length-.15,0),width*.73,14,width*.49)
        p.box("frame",0,length*.48,-width*.5,width*.73,length*.71,.09,.034)
        for y in (.15,length-.15):
            p.tube("metal",(0,y,-width*.74),(0,y,width*.74),width*.70,18)
            for side in (-1,1):
                p.tube("zinc",(0,y,side*width*.73),(0,y,side*width*.87),width*.47,16)
                for j in range(7):
                    a=j*math.tau/7
                    p.tube("black",(math.cos(a)*width*.36,y+math.sin(a)*width*.36,side*width*.87),
                           (math.cos(a)*width*.36,y+math.sin(a)*width*.36,side*width*.91),.022,6)
        p.tube("black",(-width*.62,.35,-.07),(-width*.46,length-.27,-.07),.042,10)
        p.make()
    p=Part("VisionSensor")
    p.box("frame",0,0,0,.38,.28,.41,.035)
    p.box("zinc",0,.13,0,.42,.075,.45,.024)
    p.tube("black",(0,-.125,0),(0,-.22,0),.116,20,.10)
    p.tube("optic",(0,-.218,0),(0,-.226,0),.077,20)
    for x in (-.134,.134):
        p.box("lamp",x,-.145,0,.046,.032,.19,.01)
    p.make()
    p=Part("Charger")
    p.box("frame",0,.18,0,1.17,.32,.88,.073)
    p.box("white",0,.67,-.24,.95,1.09,.47,.068)
    p.box("frame",0,.83,.018,.73,.37,.114,.036)
    p.box("optic",0,.9,.081,.48,.15,.021,.011)
    for x in (-.30,.3):
        p.box("zinc",x,.172,.268,.14,.13,.446,.026)
    p.make()


def plinths():
    p=Part("PalletWood")
    rng=random.Random(55)
    for side in (-1,0,1):
        for z in (-.385,0,.385):
            p.box("wood",side*.49,.064,z,.165,.115,.152,.014,color=rng.choice((0xA77F55,0xB6956C,0x8F6D4B)))
        p.box("wood",side*.49,.017,0,.17,.031,.94,.009,color=0x90734F)
    for z in (-.39,-.195,0,.195,.39):
        p.box("wood",0,.156,z,1.16,.048,.157,.009,color=rng.choice((0xA98357,0xB99C75,0xA1845C)))
    p.make()



def store_facades():
    for i, name in enumerate(("StoreArcade", "StoreCorner", "StoreStreet")):
        p=Part(name)
        accents=(0xC8B180,0xD4C9BB,0xA6A39B)[i]
        p.box("stucco",0,2.24,0,14,4.49,9,.045,color=accents)
        p.box("frame",0,.24,0,14.14,.45,9.15,.019)
        p.box("frame",0,4.74,0,14.94,.61,9.95,.062)
        p.box("metal",0,5.075,0,14.44,.109,9.40,.013)
        p.box("amber",0,4.79,5.005,14.87,.089,.096,.012)
        for x in (-7.015,7.015):
            p.box("amber",x,4.79,0,.099,.089,9.91,.014)
        for x in (-6.60,-4.08,-1.37,1.37,4.08,6.60):
            p.box("stucco",x,2.08,4.60,.25,3.63,.19,.018,color=accents)
        for x in (-5.35,-2.73,0,2.73,5.35):
            p.box("frame",x,2.06,4.571,2.43,3.49,.19,.025)
            p.box("glass_warm",x,2.08,4.677,2.29,3.23,.051,.018)
            p.box("metal",x,2.81,4.708,2.31,.044,.032)
            p.box("metal",x,1.95,4.712,.058,3.10,.032)
            if x:
                for y in (1.1,1.47):
                    p.box("frame",x,y,4.72,2.23,.079,.017)
            else:
                for k in (-.12,.12):
                    p.box("zinc",k,1.6,4.756,.023,.30,.055,.009)
        depth=.82+i*.25
        p.box("frame",0,3.81,4.59+depth/2,14.08,.16,depth,.023)
        for x in (-5.1,-2.7,0,2.7,5.1):
            p.box("lamp",x,3.711,4.60+depth*.65,.28,.035,.13,.007)
        for x in (-4.8,4.8):
            p.box("white",x,5.26,-1.8,1.28,.24,.83,.05)
            for a in range(5):
                p.box("frame",x-.43+a*.2,5.39,-1.8,.035,.026,.58)
        p.make()


def accessories():
    p=Part("ConveyorSide")
    p.box("frame",0,-.181,0,1,.20,.136)
    p.box("zinc",0,.002,0,1,.052,.076)
    p.box("zinc",0,-.253,0,1,.035,.138)
    p.make()
    p=Part("ConveyorLeg")
    p.box("zinc",0,.50,0,.113,1,.111)
    p.box("frame",0,.76,0,.15,.14,.15,.011)
    p.box("zinc",0,.08,0,.268,.112,.24,.024)
    for x,z in ((.084,.075),(-.084,-.075)):
        p.tube("metal",(x,.13,z),(x,.18,z),.029,6)
    p.make()
    p=Part("PendantLamp")
    p.box("white",0,0,0,2.68,.11,.50,.042)
    p.box("lamp",0,-.059,0,2.4,.023,.32,.012)
    for x in (-.94,.94):
        p.tube("metal",(x,.05,0),(x,.73,0),.019,8)
    p.make()



def prepare_editable_kit(roots):
    """Save named collections and space the reusable parts out for editing."""
    categories = {
        "Centro de distribución": ("Depot", "Clerestory", "Downpipe"),
        "Distrito industrial y tiendas": ("Industrial", "Residential", "Office", "Market", "Store"),
        "Racks, muelles y cargas": ("Rack", "Pallet", "Pendant"),
        "Flota": ("Delivery", "Supplier", "Trailer", "Fork", "Stacker", "Shuttle", "AMR", "AmrLift", "IndustrialWheel"),
        "Automatización": ("Electrical", "Reduction", "Robot", "Vision", "Charger", "Conveyor", "AutoID", "Inspection", "RollerDrive", "Distributor", "Picker", "BayGantry"),
    }
    for row, (label, prefixes) in enumerate(categories.items()):
        collection = bpy.data.collections.new(label)
        bpy.context.scene.collection.children.link(collection)
        cursor = 0
        for root in [obj for obj in roots if obj.name.startswith(prefixes)]:
            objects = [root, *root.children_recursive]
            bounds = [corner[0] for mesh in root.children if mesh.type == "MESH" for corner in mesh.bound_box]
            root.location = (cursor-min(bounds), 19*row, 0)
            cursor += max(bounds)-min(bounds)+4
            for obj in objects:
                for owner in tuple(obj.users_collection):
                    owner.objects.unlink(obj)
                collection.objects.link(obj)

    bpy.ops.object.select_all(action="DESELECT")
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                space.region_3d.view_location = (37, 26, 1)
                space.region_3d.view_distance = 112
                space.clip_end = 1800
                space.shading.type = "SOLID"
                space.shading.color_type = "MATERIAL"


def export():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import high_fidelity
    high_fidelity.install(Part, M, V2)
    front()
    roof()
    side_wall()
    city()
    vehicles()
    rack()
    automation()
    plinths()
    store_facades()
    accessories()
    high_fidelity.rebuild(Part, M)
    import portal_assemblies
    portal_assemblies.build(Part)
    import production_machines
    production_machines.build(Part)
    high_fidelity.bake_cavities()
    wall_light()
    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    prepare_editable_kit(roots)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(V2/"assets/donpepe-industrial.blend"), compress=True)
    for root in roots:
        root.location = (0, 0, 0)
    destination=V2/"public/models/donpepe-industrial-v1.glb"
    temporary=destination.with_name('donpepe-industrial-v1.build.glb')
    bpy.ops.export_scene.gltf(filepath=str(temporary),
                              export_format="GLB", export_yup=True, export_texcoords=True,
                              export_animations=False, export_normals=True, export_extras=True)
    temporary.replace(destination)


if __name__ == "__main__":
    (V2/"assets").mkdir(exist_ok=True)
    (V2/"public/models").mkdir(exist_ok=True)
    export()
