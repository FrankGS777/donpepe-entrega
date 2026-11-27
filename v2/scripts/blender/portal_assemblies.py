"""Custom inspection gantries; the original conveyor opening stays unobstructed."""
import math


def build(Part):
    def fastener(p,x,y,z):
        p.tube('zinc',(x,y,z),(x,y+.004,z),.027,20)
        p.tube('metal',(x,y+.004,z),(x,y+.022,z),.019,6)

    for name,xs,height,half in (('AutoIDGantry',(0,),3.85,1.55),('InspectionGantry',(-2,2),3.9,1.65)):
        p=Part(name)
        for x in xs:
            for side in (-1,1):
                z=side*half
                # Folded steel channels, detachable covers and external feet.
                p.box('frame',x-.085,height/2,z,.055,height,.26,.01)
                p.box('frame',x+.085,height/2,z,.055,height,.26,.01)
                p.box('frame',x,height/2,z+side*.11,.19,height,.045,.008)
                p.box('metal',x,.055,z,.48,.11,.48,.014)
                for dx in (-.17,.17):
                    for dz in (-.17,.17):fastener(p,x+dx,.111,z+dz)
                p.box('amber',x,.61,z-side*.14,.22,1.05,.065,.025)
                p.box('black',x,height*.61,z-side*.14,.17,1.4,.035,.01)
                for y in (.25,.92,1.35,2.25,3.5):
                    p.tube('zinc',(x,y,z-side*.16),(x,y,z-side*.171),.017,6)
                for y in [i*.09+.25 for i in range(int((height-.5)/.09))]:
                    p.box('black',x+.116,y,z,.007,.035,.13,.002)
                # Protection conduit is fixed to the outside of each mast.
                p.tube('black',(x+.14,.3,z+side*.13),(x+.14,height-.1,z+side*.13),.019,12)
                for y in (.5,1.3,2.1,2.9,3.6):
                    p.box('zinc',x+.14,y,z+side*.13,.055,.022,.055,.004)
                for y in (1.45,2.5):
                    p.box('metal',x,y,z-side*.18,.25,.11,.17,.012)
                    p.box('frame',x,y+.12,z-side*.22,.21,.18,.13,.02)
                    p.tube('optic',(x,y+.12,z-side*.29),(x,y+.12,z-side*.304),.047,32)
            p.box('frame',x,height-.04,0,.24,.21,half*2+.26,.025)
            p.box('zinc',x-.135,height-.04,0,.025,.11,half*2+.14,.006)
            p.box('lamp',x,height-.16,0,.11,.025,half*1.5,.005)
            for z in (-half,half):
                for dx in (-.075,.075):fastener(p,x+dx,height+.067,z)
        if len(xs)>1:
            for z in (-half,half):
                p.box('frame',0,height-.04,z,4.2,.18,.22,.024)
        p.make()
