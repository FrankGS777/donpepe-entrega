import * as THREE from 'three';

// Visual context only. Delivery roads, receiving bays and inventory remain
// owned by the simulation; no scenery is inserted into their operating area.
export function buildExteriorContext(scene, parent) {
  const group = new THREE.Group();
  group.name = 'Lima · entorno industrial';
  group.userData.batches = new Map(); parent.add(group); scene.exteriorContext = group;
  const box = (x,y,z,w,h,d,material,rotation) => scene._box(group,x,y,z,w,h,d,material,rotation,{castShadow:false,squareEdges:true});
  const mat = (color,options={}) => scene._mat(color,{roughness:.82,metalness:0,...options});
  const concrete = mat(0xb3ada0,{texture:'concrete',repeat:[8,8]});
  const asphalt = mat(0x545754,{texture:'asphalt',repeat:[3,35]});
  const curb = mat(0xc3bfb2), dark = mat(0x3b4140), steel = mat(0x8c9290,{metalness:.45,roughness:.5});
  const dusk = Boolean(scene.models);
  const glass = mat(0x34464e,{metalness:.3,roughness:.28});
  const glazing = [glass,mat(0x66685d,{metalness:.25,roughness:.3}),mat(0x878274,{metalness:.3,roughness:.3})];
  const plaster = [0xd7d0bf,0xbab8b0,0xc3ae91,0xaaa69d].map(c=>mat(c,{texture:'wall'}));
  const roof = mat(0x9a9b93,{texture:'roof',metalness:.3,repeat:[6,4]});
  const warm = mat(0xd0b17d,{emissive:0x5a3a13,emissiveIntensity:dusk?2.2:.25});
  let buildings=0,sidewalkPanels=0,parkedVehicles=0,streetlights=0;
  // A continuous earth base replaces the finite blue-grey void at map edges.
  box(0,-.39,0,1450,.24,1450,mat(dusk?0x79736d:0xb1aa96));
  const mesh = (key,createGeometry,material) => {
    if(!scene.geometry.has(key)) scene.geometry.set(key,createGeometry());
    const object=new THREE.Mesh(scene._materialGeometry(scene.geometry.get(key),material),material);
    object.receiveShadow=false;object.castShadow=false;group.add(object);return object;
  };
  // Continuous, gently folded coastal foothills rather than isolated cones.
  const reliefMaterial = mat(0xffffff,{vertexColors:true,roughness:1,texture:"concrete",repeat:[35,35]});
  mesh('lima-coastal-relief',()=>{
    const geometry=new THREE.PlaneGeometry(1450,1450,144,144);geometry.rotateX(-Math.PI/2);
    const pos=geometry.attributes.position,colors=[];
    for(let i=0;i<pos.count;i++) {
      // Keep the complete urban rectangle level, including its corner lots.
      const x=pos.getX(i),z=pos.getZ(i),r=Math.max(Math.abs(x)*.96,Math.abs(z)*1.12);
      const ramp=THREE.MathUtils.smoothstep(r,265,435);
      const broad=27+23*Math.sin(x*.011+Math.cos(z*.007)*1.5)+17*Math.cos(z*.016-x*.005);
      const ridges=14*(1-Math.abs(Math.sin(x*.035+Math.sin(z*.023)*1.7)));
      const ravines=9*Math.abs(Math.sin(z*.065+x*.038))+4*Math.sin(x*.11-z*.07);
      const height=Math.max(2,broad+ridges-ravines)*ramp;
      pos.setY(i,height-.29);
      const shade=.83+.12*Math.sin(x*.034+z*.019)+.07*Math.cos(z*.063)+Math.min(height/400,.12);
      const color=new THREE.Color(dusk?0x717180:0xa79b82).multiplyScalar(shade); colors.push(color.r,color.g,color.b);
    }
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeVertexNormals();return geometry;
  },reliefMaterial);
  // A low-cost atmospheric dome provides a horizon when users orbit low down.
  const skyMaterial = new THREE.MeshBasicMaterial({vertexColors:!scene.exteriorSky,map:scene.exteriorSky || null,
    side:THREE.BackSide,depthWrite:false,fog:false,toneMapped:Boolean(scene.exteriorSky)});
  scene.generatedMaterials ||= new Set(); scene.generatedMaterials.add(skyMaterial);
  const sky=mesh('lima-atmosphere',()=>{
    const geometry=new THREE.SphereGeometry(980,40,24),pos=geometry.attributes.position,colors=[];
    const horizon=new THREE.Color(dusk?0x657b9c:0xd9d6c8),zenith=new THREE.Color(dusk?0x102644:0x91aabb);
    const afterglow=new THREE.Color(0xa68a8f);
    for(let i=0;i<pos.count;i++) {
      const altitude=pos.getY(i)/980;
      const c=horizon.clone().lerp(zenith,THREE.MathUtils.smoothstep(altitude,-.025,.30));
      if (dusk) c.lerp(afterglow, Math.exp(-Math.pow((altitude-.025)/.059,2)) * (.15 + .23*Math.max(0,-pos.getX(i)/980)));
      colors.push(c.r,c.g,c.b);
    }
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geometry;
  },skyMaterial); sky.rotation.y=.7; sky.renderOrder=-10; sky.frustumCulled=false; scene.atmosphereMesh=sky;

  const sidewalk=(x,z,w,d)=>{
    box(x,.01,z,w,.32,d,curb);
    box(x,.19,z,w-.22,.035,d-.22,concrete);
    if(d>w)for(let dz=-d/2+2;dz<d/2;dz+=2.8){box(x,.213,z+dz,w-.2,.006,.025,dark);sidewalkPanels++;}
    else for(let dx=-w/2+2;dx<w/2;dx+=2.8){box(x+dx,.213,z,.025,.006,d-.2,dark);sidewalkPanels++;}
  };
  const street=(x,z,w,d)=>{
    box(x,-.08,z,w,.16,d,asphalt);
    const vertical=d>w;
    for(let step=-(vertical?d:w)/2+4;step<(vertical?d:w)/2-2;step+=7)
      box(x+(vertical?0:step),.011,z+(vertical?step:0),vertical?.12:3,.016,vertical?3:.12,0xe4dfcb);
    if(vertical){sidewalk(x-w/2-2,z,3.6,d);sidewalk(x+w/2+2,z,3.6,d);}
    else {sidewalk(x,z-d/2-2,w,3.6);sidewalk(x,z+d/2+2,w,3.6);}
  };
  // Public streets stay outside the protected warehouse and store network.
  street(-130,9,10,282); street(128,9,10,282);
  street(0,-107,246,12);street(0,162,246,12);
  street(0,-169,505,10);street(0,227,505,10);
  const lamp=(x,z,rotation=0)=>{
    const dx=Math.cos(rotation),dz=Math.sin(rotation);
    box(x,.22,z,.65,.4,.65,concrete);
    scene._shape(group,'cylinder',steel,[x,3.8,z],[.07,7.2,.07]);
    box(x+dx*.8,7.4,z+dz*.8,1.7,.1,.12,steel,[0,-rotation,0]);
    box(x+dx*1.45,7.34,z+dz*1.45,.8,.12,.36,dark,[0,-rotation,0]);
    box(x+dx*1.45,7.265,z+dz*1.45,.65,.03,.27,warm,[0,-rotation,0]); streetlights++;
  };
  for(let z=-95;z<150;z+=27){lamp(-122,z,Math.PI);lamp(120,z);}
  for(let x=-108;x<119;x+=30){lamp(x,-116,Math.PI/2);lamp(x,171,-Math.PI/2);}
  const building=(x,z,w,d,h,index,industrial=false)=>{
    buildings++;
    const wall=plaster[index%plaster.length];
    box(x,-.08,z,w+3,.18,d+3,concrete);
    const models = industrial
      ? ['IndustrialHangar','IndustrialWorkshop','MarketSheds']
      : ['ResidentialBrick','ResidentialTerraces','OfficeCorner'];
    const angle = index % 3 === 0 ? Math.PI : 0;
    if (scene.models?.place(group, models[index % models.length], [x,.01,z], [w,h/2,d], angle, false)) return;
    box(x,h/2,z,w,h,d,wall);
    box(x,.38,z,w+.1,.65,d+.1,dark);
    box(x,h+.12,z,w+.4,.24,d+.4,roof);
    // Parapets, roof flashing and different front/side elevations.
    for(const side of [-1,1]){
      box(x+side*w/2,h+.42,z,.18,.6,d+.4,curb);
      box(x,h+.42,z+side*d/2,w,.6,.18,curb);
    }
    const floorHeight=industrial?4.2:3.15;
    for(let y=2;y<h-1;y+=floorHeight) {
      for(let dx=-w/2+2;dx<w/2-1;dx+=3.4)for(const side of [-1,1]) {
        box(x+dx,y,z+side*(d/2+.045),1.65,1.65,.08,glazing[((index+Math.round(dx+10))%3+3)%3]);
        box(x+dx,y-.88,z+side*(d/2+.14),1.85,.1,.28,curb);
        box(x+dx,y,z+side*(d/2+.1),.055,1.7,.06,steel);
      }
      for(let dz=-d/2+2;dz<d/2-1;dz+=3.8)for(const side of [-1,1]){
        box(x+side*(w/2+.045),y,z+dz,.08,1.55,1.7,glass);
        box(x+side*(w/2+.14),y-.83,z+dz,.28,.1,1.9,curb);
      }
    }
    if(industrial){
      // Actual-looking loading shutters and a projecting entrance canopy.
      for(const dx of [-w*.23,w*.23]){
        box(x+dx,1.5,z+d/2+.13,4,3,.12,steel);
        for(let dy=.4;dy<3;dy+=.28)box(x+dx,dy,z+d/2+.21,3.9,.035,.035,dark);
        box(x+dx,3.35,z+d/2+.7,4.7,.18,1.9,dark);
      }
    }else{
      box(x,1.2,z+d/2+.12,1.7,2.4,.13,glass);
      box(x,2.65,z+d/2+.7,3,.18,1.8,dark);
    }
    for(let k=0;k<2;k++){
      const px=x+(k?1:-1)*w*.22,pz=z+(k?2:-2);
      box(px,h+.9,pz,2.4,1.1,1.6,steel);
      for(let slat=-.6;slat<.7;slat+=.22)box(px+slat,h+.92,pz+.82,.05,.8,.04,dark);
    }
    // Roof services: water tank, ducts and small satellite mast.
    scene._shape(group,'cylinder',dark,[x+w*.3,h+1.2,z-d*.27],[.75,1.6,.75]);
    box(x-w*.27,h+.85,z-d*.28,.12,1.5,.12,steel);
    box(x-w*.27,h+1.5,z-d*.28,1.4,.07,.08,steel);
    for(const side of [-1,1])box(x+side*(w/2+.12),h/2,z-d*.35,.1,h,.1,steel);
  };
  // Varied local industrial and residential fabric with yards between blocks.
  for(let i=0;i<9;i++)building(-236+i*54,-136,24+(i%3)*6,30,7+(i%4)*3,i,i%2===0);
  for(let i=0;i<12;i++)building(-257+i*45,-202,24+(i%2)*7,27,8+(i%5)*3,i+3,i%3===0);
  for(const side of [-1,1])for(let i=0;i<7;i++){
    building(side*160,-85+i*36,22+(i%2)*4,24,8+(i%4)*3,i+4,i%3===0);
    building(side*214,-86+i*41,27,29,9+(i%3)*4,i+7,i%2===0);
  }
  for(let i=0;i<8;i++)building(-239+i*63,196,30+(i%3)*5,25,8+(i%3)*3,i+1,true);

  // Detailed parked cars; these are not pretend autonomous fleet members.
  const car=(x,z,index,angle=0)=>{
    const cos=Math.cos(angle),sin=Math.sin(angle);
    const position=(a,y,c)=>[x+a*cos+c*sin,y,z-a*sin+c*cos];
    // Every parked car shares the district's instance buffers. One group per
    // car would repeat hundreds of identical draw calls and GPU bindings.
    const b=(a,y,c,w,h,d,m)=>scene._shape(group,'box',m,position(a,y,c),[w,h,d],[0,angle,0],true,{castShadow:false,squareEdges:true});
    b(0,.65,0,1.8,.72,4.1,plaster[index%4]);b(0,1.16,-.1,1.63,.68,2.15,glass);
    b(0,1.53,-.18,1.67,.12,1.8,plaster[index%4]);
    b(0,.49,2.05,1.85,.17,.1,steel);b(0,.49,-2.05,1.85,.17,.1,steel);
    for(const side of [-1,1])for(const dz of [-1.28,1.28]){
      scene._shape(group,'cylinder',dark,position(side*.89,.4,dz),[.33,.16,.33],[0,angle,Math.PI/2],true,{castShadow:false});
      scene._shape(group,'cylinder',steel,position(side*.99,.4,dz),[.19,.025,.19],[0,angle,Math.PI/2],true,{castShadow:false});
    }
    for(const side of [-1,1]){b(side*.55,.81,2.08,.48,.18,.045,warm);b(side*.55,.81,-2.08,.4,.17,.045,0x8d3d35);}
    parkedVehicles++;
  };
  for(let i=0;i<13;i++)car(i%2?-121:119,-82+i*17,i,Math.PI);
  for(let i=0;i<8;i++)car(-203+i*55,-116,i,Math.PI/2);
  // Side yards: visitor parking and utility buildings, outside every live route.
  box(-96,-.015,-17,22,.12,104,asphalt);
  for(let z=-62;z<32;z+=5.8){
    box(-96,.052,z,18,.02,.1,0xdcd6be);
    car(-100,z+2.7,Math.round(z+70),Math.PI/2);
  }
  for(let z=-68;z<32;z+=12){box(-83,.09,z,.18,.12,5,curb);}
  building(86,-66,19,12,4,2,true);
  building(87,-42,17,13,3.5,1,true);
  box(87,-.015,2,26,.12,53,asphalt);
  for(let z=-20;z<27;z+=5.8){
    box(87,.052,z,22,.02,.1,0xdcd6be);
    car(91,z+2.7,Math.round(z+28),-Math.PI/2);
  }
  sidewalk(70,-8,3.2,139);
  for(let z=-68;z<52;z+=18){
    box(65,.2,z,4,.4,9,curb);box(65,.42,z,3.7,.035,8.7,0x77775b);
    for(let dz=-3;dz<4;dz+=2)box(65,.6,z+dz,2.6,.35,1.3,mat(0x6b7452));
    lamp(73,z,0);
  }
  // Courtyard objects remain beyond the fence: planters, benches, cycle racks,
  // electrical cabinets, drainage grates and tactile crossing paving.
  for(const side of [-1,1])for(let i=0;i<7;i++){
    const x=side===1?119:-121,z=-83+i*35;
    box(x,.35,z,2.6,.7,3.5,curb);box(x,.72,z,2.3,.05,3.2,0x77745c);
    if(i%2===0)scene._tree(group,x,z);
    const bx=x+(side===1?-1:1)*3.4;
    box(bx,.62,z,1.1,.13,2.4,mat(0x72644e));box(bx,1,z-1.12,1.1,.8,.12,mat(0x72644e));
    for(const dz of [-.8,.8])box(bx,.3,z+dz,.16,.6,.18,dark);
    box(x,.42,z+6,.7,.85,.7,dark);box(x,.88,z+6,.75,.07,.75,steel);
    box(x-side*3,.025,z+8,.8,.04,1.4,dark);
    for(let slit=-.5;slit<.6;slit+=.15)box(x-side*3,.049,z+8+slit,.74,.012,.04,steel);
  }
  for(const z of [-104,158])for(const x of [-130,128]){
    for(let k=-3;k<=3;k++)box(x+k*.9,.025,z,.5,.025,8,0xe3dfcf);
    for(const dz of [-6,6])box(x,.23,z+dz,3.5,.045,.7,mat(0xc1a268));
  }
  for(let i=0;i<5;i++){
    const x=-113+i*2;box(x,1,-119,.09,1.7,.09,steel);box(x+.65,1,-119,.09,1.7,.09,steel);box(x+.32,1.85,-119,.74,.09,.09,steel);
  }
  box(112,1,-116,2.4,2,1.2,steel);box(112,1,-115.38,2,.9,.035,dark);
  if (dusk) {
    // Distant clusters supply depth without expanding the active road network.
    // A single emissive batch draws the scattered, low-rise background lights.
    const district = new THREE.Group(); district.userData.batches = new Map(); group.add(district);
    let seed = 12061996;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let lane = 0; lane < 5; lane++) for (let i = 0; i < 62; i++) {
      const x = -292 + i*9.6 + rand()*7.5;
      const z = -233 - lane*7.2 - rand()*5;
      const h = .9 + rand()*4;
      scene._box(district,x,h/2,z,2+rand()*4,h,2.7,mat(0x535860),undefined,{castShadow:false,squareEdges:true});
      if (rand() > .16) scene._box(district,x,h*.61,z+1.37,.16+rand()*.27,.13,.025,warm,undefined,{castShadow:false,squareEdges:true});
    }
    scene._finish(district);
  }
  scene._finish(group);
  return {buildings,parkedVehicles,streetlights,sidewalkPanels,terrain:'coastal-foothills',bounds:1450,sceneryOnly:true};
}
