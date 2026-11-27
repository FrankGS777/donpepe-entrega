import * as THREE from 'three';
import contours from './brand-contours.js';

function contains(polygon, point) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function dimensionalBrandGeometry() {
  const area=p=>p.reduce((sum,v,i)=>sum+p[(i+p.length-1)%p.length][0]*v[1]-v[0]*p[(i+p.length-1)%p.length][1],0)/2;
  const outer=contours.filter(p=>area(p)<0).map(p=>({polygon:p,area:Math.abs(area(p)),shape:new THREE.Shape(p.map(([x,y])=>new THREE.Vector2(x,y)))}));
  for(const hole of contours.filter(p=>area(p)>0)) {
    const parent=outer.filter(p=>contains(p.polygon,hole[0])).sort((a,b)=>a.area-b.area)[0];
    if(parent)parent.shape.holes.push(new THREE.Path(hole.map(([x,y])=>new THREE.Vector2(x,y))));
  }
  const geometry=new THREE.ExtrudeGeometry(outer.map(p=>p.shape),{
    depth:.004,steps:1,bevelEnabled:true,bevelSegments:2,bevelSize:.00018,bevelThickness:.00018,curveSegments:3,
  });
  geometry.computeBoundingBox();return geometry;
}
