"""DonPepe machine shells and articulated components in simulation metres."""

import math

import bpy
from mathutils import Vector


def build(Part):
    def replace(name):
        old = bpy.data.objects.get(name)
        if old is not None:
            for obj in [*old.children_recursive, old]:
                bpy.data.objects.remove(obj, do_unlink=True)
        return Part(name)

    def bolt(part, point, direction, radius=.012):
        start = Vector(point)
        axis = Vector(direction)
        part.tube('zinc', start, start + axis*.004, radius*1.3, 12)
        part.tube('metal', start + axis*.004, start + axis*.012, radius, 6)

    def tube_path(part, key, points, radius):
        for start, end in zip(points, points[1:]):
            part.tube(key, start, end, radius, 12)

    # Profile below the buffer supports remains under 180 mm. Yellow denotes
    # replaceable safety corners, with charcoal paint on the body.
    p = replace('AMR')
    p.box('black',0,.060,0,.784,.083,1.106,.024)
    p.box('frame',0,.112,0,.766,.075,1.096,.018)
    p.box('metal',0,.151,0,.715,.012,1.013,.004)
    for side in (-1,1):
        for end in (-1,1):
            p.box('amber',side*.328,.115,end*.483,.12,.070,.151,.021)
            p.box('black',side*.319,.105,end*.559,.088,.044,.035,.009)
            p.box('optic',side*.319,.106,end*.578,.058,.027,.006,.003)
            p.box('lamp',side*.286,.134,end*.562,.038,.008,.012,.002)
            z=end*.357
            p.tube('black',(side*.355,.063,z),(side*.45,.063,z),.060,28)
            p.tube('zinc',(side*.448,.063,z),(side*.456,.063,z),.035,24)
            p.tube('metal',(side*.456,.063,z),(side*.465,.063,z),.018,18)
            bolt(p,(side*.25,.158,end*.405),(0,1,0),.008)
        p.box('black',side*.388,.093,0,.012,.04,.36,.004)
        for y in (.080,.092,.104):
            p.box('metal',side*.396,y,0,.005,.003,.29)
    for end in (-1,1):
        p.box('black',0,.105,end*.552,.35,.046,.028,.009)
        p.box('optic',0,.108,end*.569,.25,.023,.008,.003)
        p.box('white',0,.139,end*.550,.15,.011,.008)
    p.make()

    p=Part('AmrLiftDeck')
    p.box('frame',0,-.031,0,.74,.044,.62,.008)
    p.box('metal',0,-.010,0,.78,.020,.68,.005)
    for side in (-1,1):
        p.box('black',side*.24,-.007,0,.092,.014,.53,.003)
        for z in (-.284,.284):bolt(p,(side*.342,-.017,z),(0,-1,0),.009)
    p.make()

    p=replace('Shuttle')
    p.box('frame',0,.34,0,2.29,.49,2.33,.075)
    p.box('frame',0,.655,0,2.38,.15,2.36,.044)
    for side in (-1,1):
        p.box('amber',side*1.065,.52,0,.18,.24,2.34,.045)
        p.box('metal',side*.86,.777,0,.26,.085,2.22,.012)
        for end in (-1,1):
            z=end*.76
            p.tube('black',(side*.89,.19,z),(side*1.18,.19,z),.17,28)
            p.tube('zinc',(side*1.176,.19,z),(side*1.202,.19,z),.095,24)
            bolt(p,(side*1.2,.19,z),(side,0,0),.044)
            p.box('amber',side*1.04,.42,end*1.177,.24,.27,.02,.007)
            bolt(p,(side*.89,.52,end*1.191),(0,0,end),.025)
    for end in (-1,1):
        p.box('black',0,.51,end*1.173,1.63,.24,.043,.022)
        p.box('optic',0,.54,end*1.20,.62,.068,.013,.012)
        p.box('lamp',0,.431,end*1.201,.27,.036,.012,.007)
        for x in (-.76,-.48,.48,.76):bolt(p,(x,.49,end*1.202),(0,0,end),.022)
    p.make()

    p=replace('Charger')
    p.box('frame',0,.11,0,1.14,.20,.84,.041)
    p.box('metal',0,.19,.12,.98,.10,.64,.018)
    p.box('frame',0,.675,-.24,.94,1.07,.46,.052)
    p.box('black',0,.70,-.004,.78,.85,.035,.015)
    p.box('optic',0,.91,.027,.43,.14,.061,.012)
    p.box('lamp',0,.91,.061,.16,.018,.004,.002)
    for x in (-.30,.30):
        p.box('zinc',x,.172,.268,.14,.13,.446,.015)
        p.box('amber',x,.199,.229,.09,.036,.24,.006)
        for y in (.36,1.03):bolt(p,(x,y,.022),(0,0,1))
    tube_path(p,'black',[(.40,.87,-.40),(.52,.81,-.41),(.54,.33,-.41),(.49,.18,-.38),(.28,.14,-.31)],.038)
    for i in range(7):
        p.box('metal',0,.32+i*.031,.020,.54,.011,.024)
    p.make()

    p=replace('ReductionMotor')
    p.box('metal',0,-.15,0,.54,.08,.39,.017)
    p.tube('frame',(-.27,0,0),(.26,0,0),.151,32)
    p.tube('metal',(-.27,0,0),(-.238,0,0),.181,32)
    p.tube('frame',(.18,0,0),(.28,0,0),.175,32)
    p.tube('zinc',(.27,0,0),(.37,0,0),.048,28)
    for i in range(16):
        angle=i*math.tau/16
        y,z=math.cos(angle)*.151,math.sin(angle)*.151
        p.tube('frame',(-.208,y,z),(.16,y,z),.022,6)
        if i%2==0:bolt(p,(-.272,y,z),(-1,0,0),.012)
    p.box('metal',-.02,.164,0,.21,.084,.18,.018)
    tube_path(p,'black',[(-.09,.2,0),(-.17,.19,-.11),(-.21,.14,-.18),(-.21,-.16,-.20)],.016)
    p.make()

    p=Part('ConveyorBearing')
    p.box('frame',0,0,0,.24,.18,.073,.019)
    p.tube('zinc',(0,0,.024),(0,0,.054),.065,24)
    p.tube('metal',(0,0,.051),(0,0,.067),.036,20)
    for x in (-.086,.086):bolt(p,(x,0,.034),(0,0,1))
    p.make()

    p=Part('RollerDrive')
    p.box('frame',.02,-.087,0,.73,.18,.40,.036)
    p.tube('frame',(-.19,.016,0),(.22,.016,0),.153,32)
    p.tube('zinc',(.216,.016,0),(.26,.016,0),.112,32)
    for i in range(14):
        angle=i*math.tau/14
        y,z=.016+.151*math.cos(angle),.151*math.sin(angle)
        p.tube('metal',(-.16,y,z),(.187,y,z),.019,6)
    p.box('amber',-.268,.019,0,.152,.27,.31,.032)
    for z in (-.108,.108):bolt(p,(-.35,.014,z),(-1,0,0))
    p.make()

    p=Part('DistributorBase')
    p.box('frame',0,.064,0,.92,.084,.64,.018)
    p.box('black',0,.110,0,.90,.023,.59,.008)
    for side in (-1,1):
        p.box('amber',side*.407,.102,0,.075,.029,.59,.009)
        p.box('optic',side*.463,.08,0,.01,.027,.13,.004)
        for z in (-.25,.25):
            p.tube('black',(side*.42,.075,z),(side*.46,.075,z),.04,24)
            p.tube('zinc',(side*.458,.075,z),(side*.481,.075,z),.021,20)
    p.make()

    p=Part('PickerGripper')
    p.tube('metal',(0,.006,0),(0,-.265,0),.17,32)
    p.box('frame',0,-.308,0,.62,.106,.52,.028)
    p.box('zinc',0,-.364,0,.49,.025,.39,.009)
    p.box('optic',0,-.301,.269,.19,.047,.018,.006)
    for x in (-.19,.19):
        for z in (-.16,.16):
            bolt(p,(x,-.361,z),(0,-1,0),.017)
            p.tube('zinc',(x,-.36,z),(x,-.496,z),.029,24)
            for y in (-.414,-.446,-.477):
                p.tube('black',(x,y+.016,z),(x,y,z),.050,24,.041)
            p.tube('black',(x,-.492,z),(x,-.522,z),.064,32,.075)
            tube_path(p,'black',[(0,-.22,0),(x*.48,-.24,z*.5),(x,-.262,z),(x,-.36,z)],.014)
    p.make()

    p=Part('StackerLift')
    p.box('frame',0,.30,-.17,1.40,.60,.18,.024)
    p.box('amber',0,.31,-.063,1.23,.43,.045,.011)
    for x in (-.55,.55):
        p.tube('zinc',(x,.30,-.055),(x,.30,.15),.091,26)
        p.tube('metal',(x,.30,.144),(x,.30,.171),.057,26)
        for y in (.12,.49):bolt(p,(x,y,-.253),(0,0,-1),.025)
    p.box('black',0,.455,-.031,.24,.066,.028,.009)
    p.box('optic',0,.455,-.012,.165,.037,.009,.003)
    p.make()

    p=Part('BayGantry')
    for side in (-1,1):
        z=side*1.12
        p.box('frame',0,1.65,z,.19,3.3,.16,.014)
        p.box('metal',0,.054,z,.34,.106,.34,.013)
        p.box('amber',0,.53,z-side*.092,.178,.78,.052,.013)
        p.box('black',0,1.90,z-side*.088,.12,1.34,.034,.007)
        for y in (1.50,2.35):
            p.box('frame',0,y,z-side*.12,.19,.138,.104,.016)
            p.tube('optic',(0,y,z-side*.17),(0,y,z-side*.19),.038,24)
        for x in (-.115,.115):
            for dz in (-.116,.116):bolt(p,(x,.108,z+dz),(0,1,0))
    p.box('frame',0,3.26,0,.23,.24,2.44,.027)
    p.box('zinc',-.126,3.26,0,.027,.129,2.31,.006)
    p.box('lamp',0,3.129,0,.10,.021,1.55,.009)
    p.make()

    # Wheel with a sculpted radial tire profile and inset stamped rim. The
    # original contact radius and axle position are preserved by its caller.
    p=Part('IndustrialWheel')
    ring_profile=[(-.50,.70),(-.49,.82),(-.44,.91),(-.34,.97),(-.23,1),
                  (.23,1),(.34,.97),(.44,.91),(.49,.82),(.50,.70)]
    steps=48
    points=[(x,r*math.cos(i*math.tau/steps),r*math.sin(i*math.tau/steps))
            for x,r in ring_profile for i in range(steps)]
    faces=[tuple(reversed(range(steps)))]
    for r in range(len(ring_profile)-1):
        for i in range(steps):
            j=(i+1)%steps
            faces.append((r*steps+i,r*steps+j,(r+1)*steps+j,(r+1)*steps+i))
    faces.append(tuple(range(len(points)-steps,len(points))))
    p.mesh('black',points,faces,smooth=range(1,len(faces)-1))
    p.tube('metal',(.490,0,0),(.518,0,0),.693,48,.66)
    p.tube('zinc',(.514,0,0),(.547,0,0),.621,48,.535)
    p.tube('frame',(.548,0,0),(.555,0,0),.497,40)
    p.tube('metal',(.552,0,0),(.625,0,0),.245,32,.21)
    for i in range(8):
        angle=i*math.tau/8
        y,z=.355*math.cos(angle),.355*math.sin(angle)
        p.tube('zinc',(.554,y,z),(.568,y,z),.069,18)
        p.tube('metal',(.567,y,z),(.606,y,z),.051,6)
    p.make()

    # Install fabricated protective guards on each donor chassis at its own
    # assembly origin. The forks and the lifting coordinates stay independent.
    for name in ('Forklift','Stacker'):
        body=bpy.data.objects[name]
        p=Part(name+'Service')
        if name=='Forklift':
            for sign in (-1,1):
                p.box('frame',sign*.611,.713,-.21,.039,.30,.62,.012)
                p.box('amber',sign*.640,.71,-.24,.025,.226,.44,.014)
                p.box('black',sign*.655,.79,-.23,.007,.055,.31,.004)
                for z in (-.398,-.07):bolt(p,(sign*.657,.70,z),(sign,0,0))
                p.box('frame',sign*.54,2.47,-.76,.098,.21,.31,.022)
                p.box('lamp',sign*.54,2.46,-.925,.055,.108,.016,.006)
                tube_path(p,'black',[(sign*.51,.48,.42),(sign*.55,.52,.50),
                    (sign*.51,1.17,.575),(sign*.48,2.32,.575)],.016)
        else:
            for sign in (-1,1):
                p.box('metal',sign*.997,.52,0,.16,.24,1.31,.035)
                p.box('amber',sign*1.073,.54,0,.035,.13,1.16,.015)
                for z in (-.52,.52):
                    bolt(p,(sign*1.093,.55,z),(sign,0,0),.023)
                p.box('frame',sign*.609,4.74,-.077,.105,7.30,.13,.012)
                for y in (.95,2.75,4.55,6.35,8.15):
                    p.box('zinc',sign*.61,y,-.15,.136,.067,.072,.006)
                p.box('optic',sign*.689,.68,.55,.025,.087,.136,.012)
        assembly=p.make()
        for component in list(assembly.children):component.parent=body
        bpy.data.objects.remove(assembly,do_unlink=True)

    for name in ('DeliveryCab','SupplierCab'):
        body=bpy.data.objects[name]
        p=Part(name+'Service')
        for sign in (-1,1):
            # Windscreen wipers and articulated-looking mirror mounts, kept
            # below the original top clearance of the dock opening.
            tube_path(p,'black',[(sign*.18,2.30,9.397),(sign*.35,2.52,9.362),
                (sign*.55,2.78,9.304)],.016)
            p.box('frame',sign*.77,1.50,9.464,.14,.045,.017,.005)
            p.box('black',sign*1.09,1.24,9.504,.18,.16,.026,.014)
            p.box('amber',sign*1.285,2.17,8.97,.032,.069,.151,.011)
        assembly=p.make()
        for component in list(assembly.children):component.parent=body
        bpy.data.objects.remove(assembly,do_unlink=True)

    p=replace('ElectricalCabinet')
    p.box('frame',0,.11,0,.85,.15,.64,.020)
    p.box('zinc',0,.844,0,.89,1.43,.621,.029)
    p.box('frame',0,.851,-.319,.836,1.383,.031,.015)
    p.box('white',0,.854,-.344,.809,1.337,.037,.024)
    p.box('frame',-.035,1.16,-.369,.488,.338,.038,.023)
    p.box('optic',-.035,1.183,-.392,.399,.238,.018,.011)
    p.box('lamp',-.035,1.143,-.403,.217,.010,.004,.002)
    p.box('black',.328,.81,-.370,.068,.24,.050,.012)
    p.box('metal',.328,.828,-.402,.034,.147,.020,.007)
    for y in (.56,1.22):
        p.tube('metal',(-.428,y-.049,-.356),(-.428,y+.049,-.356),.028,24)
        bolt(p,(-.398,y,-.365),(0,0,-1))
    for i in range(9):
        p.box('frame',-.073,.319+i*.022,-.365,.35,.009,.010,.003)
    p.tube('amber',(.278,1.154,-.377),(.278,1.154,-.414),.038,24)
    p.tube('tail',(.278,1.154,-.414),(.278,1.154,-.445),.027,24)
    for x in (-.235,0,.235):
        p.tube('metal',(x,.183,.13),(x,.115,.13),.028,18)
        tube_path(p,'black',[(x,.127,.13),(x,.072,.13),(x,.046,.21),(x,.047,.30)],.018)
    p.make()

    p=replace('ConveyorSide')
    # One-metre moulding along X. Scene instances stretch it to the exact
    # length of each run, so discrete bearings are placed separately.
    p.box('frame',0,-.104,0,1,.17,.067,.009)
    p.box('metal',0,-.022,0,1,.030,.102,.004)
    p.box('zinc',0,.007,.023,1,.025,.037,.004)
    p.box('black',0,-.103,.040,1,.055,.016,.005)
    p.box('amber',0,-.047,.048,1,.026,.013,.004)
    p.box('metal',0,-.185,0,1,.035,.104,.005)
    p.make()
