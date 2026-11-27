import * as THREE from 'three';
import { caseParts, LOAD, truckLoadPoint } from './scene-motion.js';
import mechanicalTiming from '../core/mechanical-timing.js';
import packagingQuality from '../core/packaging-quality.js';
import { inboundForkPose, automationSample, automationProgress, automationPosition, receivingBufferPath, packingBufferPath, packingDestinationSlot,
  bufferMechanismPose, receivingMechanismPose, storeMechanismPose, storeReceiptCycle, mechanicalGuideSegments } from './scene-automation-motion.js';

// This layer is a read-only mechanical observer. It reconstructs the reported
// device phases; its animation never receives, splits or transfers inventory.
const C = Object.freeze({ graphite: 0x263139, steel: 0x9ba8ad, bright: 0xd3dadd,
  gold: 0xc59d42, safety: 0xe3b642, blue: 0x365c75, white: 0xe9edef,
  dark: 0x151d23, red: 0xc24c3b, green: 0x63b591, screen: 0x112c35,
  carton: 0xc7a477, wood: 0xae8656 });
const { caseDamageKind } = packagingQuality;
const array = (v) => Array.isArray(v) ? v : [];
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v) => Math.max(0, Math.min(1, number(v)));
const ease = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };

export default class SceneAutomation {
  constructor(scene) {
    this.scene = scene;
    this.rollerRuns = [];
    this.devices = new Map(); this.loads = new Map(); this.offsets = new Map();
    this.histories = new Map(); this.phaseStates = new Map(); this.mapHistory = [];
    this.storePoses = new Map(); this.storeDoors = new Map();
    this.truckLoadSlots = new Map();
    this.packingPads = new Map();
    this.receivingPads = new Map(); this.receivingLoads = new Map();
    this.bufferTransfers = new Map(); this.receivingPoses = new Map();
    this.mechanicalSupports = new Map(); this.transferCarts = [];
    this.active = false; this.changed = false; this.view = scene.view || 'overview';
    this.framePoint = { x: 0, y: 0, z: 0 }; this.lastElapsed = -1;
  }

  build(layout) {
    this.dispose();
    this.layout = layout; this.schema = layout.automation;
    if (!this.schema?.stations?.length) return;
    this.static = this.scene._layer('automation');
    this.dynamic = new THREE.Group(); this.dynamic.name = 'autonomous-processes';
    this.scene.dynamic.add(this.dynamic);
    this.exterior = new THREE.Group(); this.exterior.name = 'autonomous-exterior';
    this.scene.content.add(this.exterior);
    this.origin = { x: 0, y: 0, z: 0, heading: 0 };
    // The receiving line is continuous. Gaps between separate machines would
    // otherwise make a real pallet appear to float between unrelated portals.
    const inbound = this.schema.stations.filter(s => !s.branchId && s.type !== 'CASE_PICKING_CELL');
    if (inbound.length) this._receivingLine(inbound);
    for (const station of this.schema.stations) {
      // Geometry is authored along +X; the contract heading describes the
      // carrier's +Z forward axis. Do not rotate portals across the belt.
      this.origin = { ...station, y: 0, heading: station.type === 'CASE_PICKING_CELL' ? number(station.heading) : number(station.heading) - Math.PI / 2 };
      const device = { station, lamps: [], moving: [], type: station.type, point: { x: 0, y: 0, z: 0 } };
      this.devices.set(station.assetId, device);
      switch (station.type) {
        case 'AUTO_UNLOADER': this._unloader(device); break;
        case 'AUTO_ID_GATE': this._portal(device); break;
        case 'PIE_STATION': this._inspection(device); break;
        case 'INBOUND_CONVEYOR': this._accumulation(device); break;
        case 'CASE_PICKING_CELL': this._caseCell(device); break;
        case 'STORE_RECEIVING_STATION': this._storeStation(device); break;
      }
      this._machineFinish(device);
      const height = station.type === 'CASE_PICKING_CELL' ? 4.7 : station.type === 'AUTO_UNLOADER' ? 1.8 : 3.7;
      const record = this.scene._register('asset', station.assetId,
        [station.x, height / 2, station.z], [number(station.width, 4), height, number(station.depth, 4)],
        station.branchId ? this.exterior : this.static);
      record.assetType = station.type; record.deviceId = station.deviceId;
      // The picking cell opens towards its AMR approach on the local -Z face.
      record.inspectionHeading = this.origin.heading + (station.type === 'CASE_PICKING_CELL' ? Math.PI : 0);
      this._statusTower(device, number(station.width, 4) / 2 - .25, 0, -number(station.depth, 4) / 2 + .15);
    }
    for (const cart of this.transferCarts) {
      const record = this.scene.entities.get(`asset:${cart.ownerAssetId}`);
      if (record) cart.group.traverse(mesh => {
        if (mesh.isMesh) { mesh.userData.entity = record; this.scene.hitTargets.push(mesh); }
      });
    }
    this.scene._finish(this.static);
    this._supplierTrailer();
    this.setView(this.view);
  }

  _world(x, y, z) {
    const a = number(this.origin.heading), c = Math.cos(a), s = Math.sin(a);
    return [this.origin.x + x * c + z * s, y + number(this.origin.y), this.origin.z + z * c - x * s];
  }

  _box(x, y, z, width, height, depth, color = C.steel, rotation = [0, 0, 0], options) {
    const p = this._world(x, y, z);
    this.scene._shape(this.static, 'box', color, p, [width, height, depth],
      [rotation[0], rotation[1] + number(this.origin.heading), rotation[2]], true, options);
  }

  _cylinder(x, y, z, radius, length, color = C.steel, rotation = [0, 0, 0], options) {
    this.scene._shape(this.static, 'cylinder', color, this._world(x, y, z), [radius, length, radius],
      [rotation[0], rotation[1] + number(this.origin.heading), rotation[2]], true, options);
  }

  _label(text, x, y, z, width = 3.6) {
    const p = this._world(x, y, z);
    const mesh = this.scene._label(text, ...p, { width:Math.min(width,1.15), fontSize: 28, parent: this.static });
    mesh.rotation.y = number(this.origin.heading); return mesh;
  }

  _cabinet(x, z, width = .95) {
    if (this.scene.models?.place(this.static, 'ElectricalCabinet', this._world(x,.02,z),
      [width/.95,1.03,.96], number(this.origin.heading)+Math.PI)) return;
    this._box(x, .85, z, width, 1.65, .65, C.white, undefined, { roughness: .38, metalness: .28 });
    this._box(x, .08, z, width + .1, .15, .78, C.graphite);
    this._box(x, .86, z + .332, width - .1, 1.48, .018, C.bright);
    this._box(x + width * .3, 1.05, z + .365, .035, .23, .045, C.graphite);
    this._box(x - width * .1, 1.23, z + .355, width * .5, .29, .025, C.screen);
    this._box(x - width * .1, 1.24, z + .373, width * .39, .012, .004, C.green);
    this._cylinder(x + width * .28, .55, z + .37, .065, .02, C.safety, [Math.PI / 2, 0, 0]);
    this._cylinder(x + width * .28, .55, z + .39, .037, .04, C.red, [Math.PI / 2, 0, 0]);
    for (let y = .2; y < .46; y += .055) this._box(x - width * .16, y, z + .347, width * .4, .015, .012, C.steel);
    this._box(x, 1.7, z, width + .04, .08, .7, C.graphite);
    for(const y of [.4,1.3])this._box(x-width*.44,y,z+.35,.045,.12,.045,C.graphite);
    for(const side of [-1,1])this._box(x+side*width*.47,.85,z+.344,.012,1.46,.012,C.dark);
    this._cylinder(x+width*.3,.94,z+.375,.028,.025,C.bright,[Math.PI/2,0,0]);
    this._box(x,.24,z-.38,.055,.4,.055,C.dark);
  }

  _boltPlate(x, z, size = .4) {
    this._box(x, .055, z, size, .08, size, C.steel);
    for (const dx of [-.32, .32]) for (const dz of [-.32, .32])
      this._cylinder(x + dx * size, .106, z + dz * size, .027, .028, C.bright);
  }

  _statusTower(device, x, y, z) {
    const floor = -number(this.origin.y) + .07;
    this._box(x, floor + .04, z, .35, .08, .35, C.graphite);
    this._cylinder(x, (floor + y + 2.43) / 2, z, .045, y + 2.43 - floor, C.steel);
    this._cylinder(x, y + 2.43, z, .11, .1, C.graphite);
    for (let i = 0; i < 3; i++) {
      const p = this._world(x, y + 2.53 + i * .135, z);
      const material = new THREE.MeshStandardMaterial({ color: [C.green, C.safety, C.red][i],
        emissive: [C.green, C.safety, C.red][i], emissiveIntensity: .05, roughness: .28 });
      const mesh = this.scene._shape(this.dynamic, 'cylinder', material, p, [.09, .11, .09], [0, 0, 0], false);
      mesh.userData.ownedResources = [material]; mesh.castShadow = false;
      device.lamps.push(mesh);
    }
  }

  _receivingLine(stations) {
    this.origin = { x: 0, y: 0, z: 0, heading: 0 };
    const start = this.schema.supplierDock?.rear?.x ?? this.schema.supplierDock?.rearPoint?.x ?? -86.8;
    const receive = array(this.schema.mechanicalReceivingRoute).at(-1)
      || array(this.layout.stations).find(s => s.id === 'RECEIVE') || { x: -34, z: 17 };
    const z = stations[0].z, end = stations.find(station => station.type === 'INBOUND_CONVEYOR')?.x || receive.x - 9;
    const transfer = this.schema.supplierDock?.transferPoint || { x: -75, y: .85, z };
    this._rollerRun((transfer.x + end) / 2, z, end - transfer.x, 2.2, .85, 'x');
    const rear = this.schema.supplierDock?.rearPoint || { x: start, y: 1.2, z };
    // Lowered terminal deck hands a pallet into the floor-level receiving bay.
    const run = receive.x - end, length = Math.hypot(run, .67), angle = -Math.atan2(.67, run);
    for (const side of [-1, 1]) this._box((receive.x + end) / 2, .445, z + side * 1.14,
      length, .17, .12, C.graphite, [0, 0, angle]);
    for (let t = 0; t <= Math.max(.7, 1 - .65 / run); t += .03) this._cylinder(end + t * run, .75 - t * .67, z,
      .095, 2.1, C.bright, [Math.PI / 2, 0, 0], { metalness: .7, roughness: .28 });
    for (let x = start + 1; x < end; x += 4.5) {
      if (!this.scene.models?.place(this.static,'RollerDrive',this._world(x,.50,z-1.55))) {
        this._box(x,.5,z-1.42,.62,.32,.4,C.blue);
      }
      for (const side of [-1,1]) {
        this.scene.models?.place(this.static,'ConveyorBearing',this._world(x,.73,z+side*1.14),[1,1,1],side<0?Math.PI:0);
      }
    }
  }

  _rollerRun(x, z, length, width, top, axis = 'x') {
    const alongX = axis === 'x';
    for (const side of [-1, 1]) {
      const edge = this._world(x+(alongX?0:side*width/2),top-.03,z+(alongX?side*width/2:0));
      if (this.scene.models?.place(this.static,'ConveyorSide',edge,[length,1,1],number(this.origin.heading)+(alongX?0:Math.PI/2))) continue;
      this._box(x + (alongX ? 0 : side * width / 2), top - .18,
        z + (alongX ? side * width / 2 : 0), alongX ? length : .14, .23,
        alongX ? .14 : length, C.graphite, undefined, { metalness: .45, roughness: .42 });
      this._box(x + (alongX ? 0 : side * (width / 2 - .04)), top + .045,
        z + (alongX ? side * (width / 2 - .04) : 0), alongX ? length : .055, .085,
        alongX ? .055 : length, C.bright);
    }
    const centers = [];
    for (let a = -length / 2 + .14; a < length / 2; a += .28)
      centers.push(new THREE.Vector3(...this._world(x+(alongX?a:0),top-.095,z+(alongX?0:a))));
    const material=this.scene._mat(C.steel,{texture:'metal',metalness:.82,roughness:.28,repeat:[1,1]});
    const mesh=this.scene._instances(this.scene._geo('cylinder'),material,centers.length);
    mesh.castShadow=true;mesh.receiveShadow=true;
    const heading=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),number(this.origin.heading));
    const axial=new THREE.Quaternion().setFromEuler(new THREE.Euler(alongX?Math.PI/2:0,0,alongX?0:Math.PI/2));
    const orientation=heading.multiply(axial),scale=new THREE.Vector3(.095,width-.12,.095);
    const matrix=new THREE.Matrix4();
    centers.forEach((center,index)=>mesh.setMatrixAt(index,matrix.compose(center,orientation,scale)));
    mesh.computeBoundingSphere();this.dynamic.add(mesh);
    this.rollerRuns.push({mesh,centers,orientation,scale,angle:0,branchId:this.origin.branchId||null});
    // Gearmotor, shaft guard, cabling and feet are mounted outside the load envelope.
    const motorX=x+(alongX?-length/2+.6:width/2+.24),motorZ=z+(alongX?-width/2-.24:-length/2+.6);
    const motor = this.scene.models?.place(this.static, 'ReductionMotor', this._world(motorX,top-.28,motorZ),
      [.77,.77,.77], number(this.origin.heading)+(alongX?0:Math.PI/2));
    if (!motor) {
      this._box(motorX,top-.28,motorZ,.4,.3,.4,C.graphite);
      for(let fin=-.12;fin<=.12;fin+=.06) this._box(motorX+fin,top-.28,motorZ,.02,.32,.44,C.steel);
    }
    for (let a = -length / 2 + .5; a < length / 2; a += 2.7) for (const side of [-1, 1]) {
      const xx = x + (alongX ? a : side * width * .42), zz = z + (alongX ? side * width * .42 : a);
      if (this.scene.models?.place(this.static,'ConveyorLeg',this._world(xx,.014,zz),
        [1,top-.21,1],number(this.origin.heading),false)) continue;
      this._box(xx, (top - .2) / 2, zz, .11, top - .2, .11, C.steel);
      this._boltPlate(xx, zz, .29);
    }
  }

  _machineFinish(device) {
    const {type}=device;
    // Service faces stay outside the conveyor / load's swept volume.
    const span=type==='AUTO_UNLOADER'?12:type==='INBOUND_CONVEYOR'?number(device.station.width,16)-2:type==='CASE_PICKING_CELL'?8:3;
    const side=type==='CASE_PICKING_CELL'?-4.55:-1.8;
    this._box(0,.23,side,span,.13,.16,C.graphite);
    for(let x=-span/2+.3;x<span/2;x+=1.4) {
      this._box(x,.3,side,.09,.22,.22,C.bright);
      for(const dx of [-.025,.025])this._cylinder(x+dx,.42,side,.018,.025,C.bright);
    }
    if(['AUTO_ID_GATE','PIE_STATION','STORE_RECEIVING_STATION'].includes(type)) {
      for(const x of [-.65,.65]) {
        this._box(x,1.2,side,.32,.5,.18,C.graphite);
        this._box(x,1.2,side-.1,.26,.42,.025,C.bright);
        for(const y of [1.04,1.36])this._cylinder(x,y,side-.12,.018,.02,C.dark,[Math.PI/2,0,0]);
        this._box(x,.7,side,.045,.7,.045,C.dark);
      }
    }
    if(['INBOUND_CONVEYOR','AUTO_UNLOADER'].includes(type)) {
      for(const x of [-span*.32,span*.32]) {
        this._cylinder(x,.5,side-.2,.19,.48,C.graphite,[0,0,Math.PI/2]);
        for(let dx=-.18;dx<=.18;dx+=.06)this._cylinder(x+dx,.5,side-.2,.205,.018,C.steel,[0,0,Math.PI/2]);
        this._box(x,.24,side-.2,.6,.08,.6,C.bright);
      }
    }
  }

  _unloader(device) {
    this._cabinet(3.4, -2.15, 1.05);
    this._box(3.4, 1.76, -1.79, .09, .34, .11, C.steel);
    this._label('DESCARGA', 3.4, 1.94, -1.72, 1.15);
    const group=new THREE.Group(); group.userData.batches=new Map();
    if (this.scene.models?.attach(group, 'Forklift', [0,0,0], [1,1.05,1], Math.PI/2)) {
      for (const z of [-.65,.65]) for (const x of [-.8,.35]) {
        const wheel=new THREE.Group();
        wheel.position.set(x,.30,z);
        wheel.rotation.y=z<0?Math.PI/2:-Math.PI/2;
        if(this.scene.models.attach(wheel,'IndustrialWheel',[0,0,0],[.18,.3,.3])) {
          group.add(wheel);
        } else {
          this.scene._shape(group,'cylinder',C.dark,[x,.3,z],[.3,.18,.3],[Math.PI/2,0,0]);
          this.scene._shape(group,'cylinder',C.bright,[x,.3,z+Math.sign(z)*.10],[.155,.05,.155],[Math.PI/2,0,0]);
        }
      }

    } else {
      const box=(x,y,z,w,h,d,c)=>this.scene._box(group,x,y,z,w,h,d,c);
      box(-.25,.55,0,1.8,.8,1.25,C.gold);
      box(-.45,1.05,0,1,.3,1.15,C.graphite);
      for(const z of [-.65,.65]) {
        for(const x of [-.8,.55]) this.scene._shape(group,'cylinder',C.dark,[x,.3,z],[.3,.18,.3],[Math.PI/2,0,0]);
        box(.7,1.6,z*.65,.12,3.05,.13,C.steel);
        box(-.6,1.8,z,.07,2,.07,C.graphite);
      }
      box(-.1,2.8,0,1.5,.12,1.45,C.graphite);
      box(-.8,2.9,0,.35,.18,.4,C.blue);
    }
    this.scene._finish(group);
    const forks=new THREE.Group(); forks.userData.batches=new Map();
    const forkSteel=this.scene._mat(0x9da5ac,{texture:'metal',metalness:.77,roughness:.39});
    for (const z of [-.4,.4]) {
      this.scene._box(forks,1.4,-.06,z,1.5,.1,.16,forkSteel);
      this.scene._box(forks,.694,.13,z,.096,.33,.16,forkSteel);
    }
    this.scene._box(forks,.7,.4,0,.12,.85,1.05,C.graphite);
    for(const z of [-.28,0,.28]) this.scene._box(forks,.773,.52,z,.03,.54,.033,forkSteel);
    this.scene._finish(forks); group.add(forks); this.dynamic.add(group);
    group.position.set(-79,0,20.5);
    device.inboundForklift={group,forks}; this.inboundForklift=device.inboundForklift;
    device.type='AUTO_UNLOADER';
  }

  _portal(device) {
    const detailed=this.scene.models?.place(this.static,'AutoIDGantry',this._world(0,0,0),[1,1,1],number(this.origin.heading));
    if(!detailed) {
    for (const side of [-1, 1]) {
      this._box(0, 1.93, side * 1.55, .24, 3.85, .24, C.bright);
      this._boltPlate(0, side * 1.55, .52);
      this._box(.035, 1.8, side * 1.39, .35, 1.2, .11, C.graphite);
      this._box(.11, 1.82, side * 1.31, .18, .66, .025, C.screen);
      for (const x of [-.5, .5]) {
        this._box(x, 2.0, side * 1.3, .26, .24, .3, C.blue, [side * .1, 0, 0]);
        this._cylinder(x, 2.0, side * 1.12, .073, .045, C.dark, [Math.PI / 2, 0, 0]);
      }
    }
    this._box(0, 3.8, 0, .32, .3, 3.32, C.graphite);
    this._box(.04, 3.64, 0, .2, .04, 2.8, C.white);
    }
    if (!this.scene.models?.place(this.static,'VisionSensor',this._world(0,3.46,0))) {
      this._box(0, 3.46, 0, .34, .28, .38, C.blue);
      this._cylinder(0, 3.28, 0, .1, .06, C.dark);
    }
    this._cabinet(1.4, -2.1, .75);
    this._label('AUTO-ID', 0, 4.03, 1.55, 2.6);
    const material = new THREE.MeshBasicMaterial({ color: 0x49b6b1, transparent: true,
      opacity: .16, depthWrite: false, side: THREE.DoubleSide });
    const scan = new THREE.Mesh(this.scene._geo('plane'), material);
    scan.position.set(...this._world(0, 2.1, 0)); scan.rotation.y = Math.PI / 2;
    scan.scale.set(2.6, 2.45, 1); scan.visible = false;
    scan.userData.ownedResources = [material]; this.dynamic.add(scan); device.scan = scan;
  }

  _inspection(device) {
    this._box(0, .28, 0, 5.8, .46, 3.2, C.steel, undefined, { metalness: .55, roughness: .37 });
    for (const x of [-2.6, 2.6]) for (const z of [-1.4, 1.4]) {
      this._box(x, .14, z, .3, .16, .3, C.graphite);
      this._cylinder(x, .27, z, .1, .12, C.bright);
    }
    const detailed=this.scene.models?.place(this.static,'InspectionGantry',this._world(0,0,0),[1,1,1],number(this.origin.heading));
    if(!detailed) {
      for(const x of [-2,2]) {
        for(const z of [-1.65,1.65]) {this._box(x,1.95,z,.14,3.9,.14,C.bright);this._boltPlate(x,z,.38);}
        this._box(x,3.86,0,.18,.2,3.45,C.bright);
      }
      for(const z of [-1.65,1.65])this._box(0,3.9,z,4.2,.12,.12,C.steel);
    }
    for(const x of [-2,2])this.scene.models?.place(this.static,'VisionSensor',this._world(x,3.65,-.25));
    this._box(.2, 3.38, 0, .9, .15, .6, C.graphite);
    for (const x of [-.28, .28]) this._cylinder(x + .2, 3.28, 0, .06, .05, C.dark);
    this._cabinet(2.0, -2.5, 1.1);
    for (const x of [-.35,.35]) this._box(x,4.035,1.65,.06,.17,.06,C.steel);
    this._label('CONTROL PIE', 0, 4.18, 1.7, 2.8);
    this._label('PIE', -2.1, .48, 1.63, .85);
    const head = new THREE.Group(); head.userData.batches = new Map();
    if (!this.scene.models?.attach(head,'VisionSensor')) {
      this.scene._box(head, 0, 0, 0, .42, .24, .34, C.gold);
      this.scene._shape(head, 'cylinder', C.dark, [0, -.15, 0], [.07, .07, .07]);
    }
    this.scene._finish(head); head.position.set(...this._world(.3, 3.12, 0));
    this.dynamic.add(head); device.inspectionHead = head;
  }

  _accumulation(device) {
    const width = number(device.station.width, 16);
    for (let x = -width / 2 + 1.2; x < width / 2; x += 2.6) {
      for (const side of [-1, 1]) {
        this._box(x, .73, side * 1.26, .22, .2, .2, C.gold);
        this._box(x + .12, .78, side * 1.2, .035, .065, .07, C.screen);
      }
      this._box(x, .55, 0, .08, .1, 2.2, C.graphite);
    }
    this._cabinet(-3.2, -2, 1.05);
    this._box(-3.2,1.79,-1.64,.08,.28,.11,C.steel);
    this._label('TRANSFERENCIA', -3.2, 1.97, -1.57, 3.1);
    for (const side of [-1, 1]) this._box(-7.6, 1.1, side * 1.3, .12, .75, .12, C.safety);
    // The full guide network supports every reported distributor leg. The
    // station has orthogonal wheelsets and telescopic forks; it is a component
    // of this conveyor installation, not another inventory owner or robot.
    const original = this.origin; this.origin = { x: 0, y: 0, z: 0, heading: 0 };
    const terminal = array(this.schema.mechanicalReceivingRoute).at(-1) || device.station.handoffPoint || { x: -34, y: .18, z: 17 };
    const amr = array(this.layout.stations).find(station => station.id === 'RECEIVE') || { x: -34, y: .18, z: 17 };
    this._guideNetwork(array(this.schema.receivingBufferSlots).flatMap(pad => [receivingBufferPath(terminal, pad), receivingBufferPath(amr, pad).slice(1, -2)]));
    this._label('DISTRIBUIDOR · RECEPCIÓN', -40.5, .13, 29.7, 5.7);
    this.origin = original;
    device.receivingCarts = [this._transferCart(`${device.station.deviceId}:DISTRIBUTOR`, device.station.assetId),
      this._transferCart(`${device.station.deviceId}:AMR-TRANSFER`, device.station.assetId)];
    this.receivingDevice = device;
  }

  _guideNetwork(paths) {
    for (const segment of mechanicalGuideSegments(paths)) {
      const alongX = segment.axis === 'x', length = segment.to - segment.from, center = (segment.from + segment.to) / 2;
      const x = alongX ? center : segment.fixed, z = alongX ? segment.fixed : center;
      // Open rails, not a black sheet half buried in the slab. Their vertical
      // clearance covers both the 3 cm warehouse and 4 cm branch foundations.
      for (const side of [-1, 1]) this._box(x + (alongX ? 0 : side * .4), .075,
        z + (alongX ? side * .4 : 0), alongX ? length + .12 : .055, .025, alongX ? .055 : length + .12, C.bright);
      for (let coordinate = segment.from + .4; coordinate < segment.to; coordinate += 1.2)
        this._box(alongX ? coordinate : x, .055, alongX ? z : coordinate,
          alongX ? .055 : .94, .012, alongX ? .94 : .055, C.blue);
    }
  }

  _transferCart(id = 'TRANSFER-CARRIAGE', ownerAssetId = null) {
    const group = new THREE.Group(); group.name = id; group.userData.batches = new Map();
    if (!this.scene.models?.attach(group,'DistributorBase')) {
      this.scene._box(group, 0, .065, 0, .92, .085, .64, C.blue);
      this.scene._box(group, 0, .11, -.3, .87, .025, .045, C.safety);
      this.scene._box(group, 0, .11, .3, .87, .025, .045, C.safety);
      for (const side of [-1, 1]) {
        for (const z of [-.25, .25]) {
          this.scene._shape(group, 'cylinder', C.dark, [side * .42, .075, z], [.04, .07, .04], [0, 0, Math.PI / 2]);
          this.scene._shape(group, 'cylinder', C.bright, [side * .46, .075, z], [.019, .018, .019], [0, 0, Math.PI / 2]);
        }
        this.scene._box(group, side * .45, .077, 0, .06, .055, .16, C.graphite);
        this.scene._box(group, side * .483, .082, 0, .009, .024, .095, C.screen);
      }
    }
    this.scene._finish(group);
    const deck = new THREE.Group(); deck.userData.batches = new Map();
    for (const z of [-.51, .51]) this.scene._box(deck, 0, -.055, z, 1.3, .08, .08, C.graphite);
    for (let x = -.55; x < .6; x += .19) this.scene._shape(deck, 'cylinder', C.bright,
      [x, -.035, 0], [.035, .86, .035], [Math.PI / 2, 0, 0]);
    this.scene._finish(deck); group.add(deck);
    const forks = [];
    for (let index = 0; index < 3; index++) {
      const stage = new THREE.Group(); stage.userData.batches = new Map();
      const offset = .38 - index * .045;
      for (const side of [-1, 1]) this.scene._box(stage, 0, -.09 + index * .035, side * offset,
        1.25, .035, .13 - index * .025, index === 2 ? C.bright : index === 1 ? C.safety : C.steel);
      if (index === 2) {
        for (const x of [-.43, .43]) this.scene._box(stage, x, -.013, 0, .075, .025, .78, C.bright);
      }
      this.scene._finish(stage); (forks.at(-1) || deck).add(stage); forks.push(stage);
    }
    const scissor = this.scene._instances(this.scene._geo('box'), this.scene._mat(C.safety, { metalness: .35, roughness: .45 }), 8);
    scissor.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scissor.castShadow = scissor.receiveShadow = true; group.add(scissor);
    const cylinder = this.scene._shape(group, 'cylinder', this.scene._mat(C.graphite, { metalness: .45 }), [0,.1,0],[.065,.1,.065],[0,0,0],false);
    const piston = this.scene._shape(group, 'cylinder', this.scene._mat(C.bright, { metalness: .75 }), [0,.1,0],[.025,.1,.025],[0,0,0],false);
    this.dynamic.add(group); group.visible = false;
    const cart = { id, ownerAssetId, group, deck, forks, scissor, cylinder, piston, matrix: new THREE.Object3D(),
      pose: null, phase: 'PARKED' };
    this.transferCarts.push(cart); return cart;
  }

  _moveTransferCart(cart, point, heading = Math.PI / 2) {
    if (!cart) return;
    const mechanical = point.carrier ? point : { carrier: { x: point.x, y: 0, z: point.z }, cargo: point,
      surfaceY: point.y, extension: 0, phase: 'TRANSFER', carrying: true };
    const base = mechanical.carrier, top = Math.max(.09, mechanical.surfaceY), extension = number(mechanical.extension);
    cart.group.visible = true; cart.group.position.set(base.x, 0, base.z); cart.group.rotation.y = 0;
    cart.deck.position.set(0, top, 0); cart.deck.rotation.y = mechanical.phase === 'ALIGN' ? mechanical.cargo.heading : number(base.heading, 0);
    for (const fork of cart.forks) fork.position.x = extension / 3;
    const rise = Math.max(.035, top - .14), stageRise = rise / 2, span = Math.sqrt(Math.max(.01, .82 ** 2 - stageRise ** 2));
    let index = 0;
    for (const side of [-1, 1]) for (let stage = 0; stage < 2; stage++) for (const slope of [-1, 1]) {
      const matrix = cart.matrix;
      matrix.position.set(0, .105 + stageRise * (stage + .5), side * .39);
      matrix.rotation.set(0, 0, slope * Math.atan2(stageRise, span)); matrix.scale.set(.82, .035, .055); matrix.updateMatrix();
      cart.scissor.setMatrixAt(index++, matrix.matrix);
    }
    cart.scissor.instanceMatrix.needsUpdate = true;
    const cylinderLength = Math.hypot(.38, rise * .65);
    cart.cylinder.position.set(-.12, .105 + rise * .2, 0); cart.cylinder.scale.y = cylinderLength * .65;
    cart.cylinder.rotation.z = -Math.atan2(.38, Math.max(.015, rise * .65));
    cart.piston.position.set(.035, .105 + rise * .41, 0); cart.piston.scale.y = cylinderLength * .6;
    cart.piston.rotation.z = cart.cylinder.rotation.z;
    cart.pose = { x: base.x, y: 0, z: base.z, surfaceY: top, extension, cargoX: mechanical.cargo.x,
      cargoY: mechanical.cargo.y, cargoZ: mechanical.cargo.z };
    cart.phase = mechanical.phase;
  }

  _fence(x1, z1, x2, z2, height = 2.5) {
    const alongX = Math.abs(x2 - x1) >= Math.abs(z2 - z1), length = Math.hypot(x2 - x1, z2 - z1);
    for (let a = 0; a <= length + .01; a += Math.min(1.8, length)) {
      const t = Math.min(1, a / length), x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      this._box(x, height / 2, z, .07, height, .07, C.safety); this._boltPlate(x, z, .22);
    }
    const x = (x1 + x2) / 2, z = (z1 + z2) / 2;
    for (const y of [.25, height - .12]) this._box(x, y, z, alongX ? length : .035, .035, alongX ? .035 : length, C.graphite);
    for (let a = .15; a < length; a += .18) {
      const t = a / length;
      this._box(x1 + (x2 - x1) * t, height / 2, z1 + (z2 - z1) * t, .012, height - .35, .012, C.graphite);
    }
    for (let y = .45; y < height - .2; y += .24) this._box(x, y, z, alongX ? length : .012, .012, alongX ? .012 : length, C.graphite);
  }

  _caseCell(device) {
    const station = device.station;
    // The service cell leaves the x=12 AMR approach and the source load's actual
    // staging grid clear. The arm is mounted laterally, never inside the load.
    const handoff = station.handoffPoint || array(this.layout.stations).find(s => s.id === 'PACK') || { x: 12, z: 18 };
    const hx = handoff.x - station.x, hz = handoff.z - station.z;
    for (const side of [-1, 1]) {
      this._box(hx + side * 1.25, .46, hz, .15, .92, 2.5, C.steel);
      this._box(hx + side * .74, 1.02, hz, .25, .1, 2.5, C.bright);
      this._box(hx + side * .98, .97, hz, .7, .12, .2, C.steel);
    }
    this._fence(-6, -4.6, -3.7, -4.6); this._fence(-.3, -4.6, 6, -4.6);
    this._fence(6, -4.6, 6, 6.1); this._fence(-6, -4.6, -6, 6.1);
    this._fence(-6, 6.1, 6, 6.1);
    this._cabinet(5, -3.4, 1.15);
    this._label('PREPARACIÓN', 3.8, 2.85, -4.45, 2.9);
    const armBase = station.armBase || { x: 16, z: 20 };
    const bx = armBase.x - station.x, bz = armBase.z - station.z;
    this._box(bx, .12, bz, 1.55, .22, 1.55, C.graphite);
    for (const x of [-.55, .55]) for (const z of [-.55, .55]) this._cylinder(bx + x, .25, bz + z, .065, .07, C.bright);
    this._cylinder(bx, .59, bz, .55, .82, C.blue);
    this._cylinder(bx, 1.02, bz, .61, .12, C.graphite);
    const arm = new THREE.Group(); arm.position.set(armBase.x, 1.12, armBase.z);
    const shoulder = new THREE.Group(), elbow = new THREE.Group(), wrist = new THREE.Group();
    const upper = 3.4, lower = 3.2;
    const link = (group, length, width, name) => {
      if (this.scene.models?.attach(group, name)) return;
      group.userData.batches = new Map();
      // Tapered cast housing and separate servo/flange assemblies, not rectangular sticks.
      if(!this.scene.geometry.has('servoArm'))this.scene.geometry.set('servoArm',new THREE.CylinderGeometry(.34,.5,1,12,1,false));
      this.scene._shape(group,'servoArm',this.scene._mat(0xb99b59,{metalness:.22,roughness:.33}),[0,length/2,0],[width*1.5,length-.18,width*1.2]);
      this.scene._box(group,0,length/2,-width*.43,width*.65,length-.6,.06,C.graphite);
      for(const y of [.15,length-.15])for(const side of [-1,1]) {
        const z=side*width*.61;
        this.scene._shape(group,'cylinder',this.scene._mat(C.graphite,{metalness:.7,roughness:.32}),[0,y,z],[width*.65,.12,width*.65],[Math.PI/2,0,0]);
        this.scene._shape(group,'cylinder',this.scene._mat(C.bright,{metalness:.85,roughness:.25}),[0,y,z+side*.065],[width*.4,.025,width*.4],[Math.PI/2,0,0]);
        for(let i=0;i<6;i++){const a=i*Math.PI/3;this.scene._shape(group,'bolt',C.dark,[Math.cos(a)*width*.31,y+Math.sin(a)*width*.31,z+side*.085],[.022,.025,.022],[Math.PI/2,0,0]);}
      }
      for(const x of [-width*.32,width*.32])this.scene._box(group,x,length/2,-width*.6,.04,length-.5,.065,C.dark);
      this.scene._finish(group);
    };
    link(shoulder, upper, .38, 'RobotUpper'); link(elbow, lower, .3, 'RobotForearm'); elbow.position.y = upper;
    wrist.position.y = lower; wrist.userData.batches = new Map();
    if (!this.scene.models?.attach(wrist,'PickerGripper')) {
      this.scene._shape(wrist, 'cylinder', C.bright, [0, -.13, 0], [.17, .27, .17]);
      this.scene._box(wrist, 0, -.31, 0, .62, .12, .52, C.graphite);
      for (const x of [-.19, .19]) for (const z of [-.16, .16]) {
        this.scene._shape(wrist, 'cylinder', C.steel, [x, -.42, z], [.027, .16, .027]);
        this.scene._shape(wrist, 'cylinder', C.dark, [x, -.51, z], [.07, .025, .07]);
      }
    }
    this.scene._finish(wrist); elbow.add(wrist); shoulder.add(elbow); arm.add(shoulder); this.dynamic.add(arm);
    device.arm = { group: arm, shoulder, elbow, wrist, upper, lower, base: armBase,
      target: { x: armBase.x - 1.8, y: 2.9, z: armBase.z }, delta: { x: 0, y: 0, z: 0 } };
    device.transferCart = this._transferCart(`${station.deviceId}:AMR-TRANSFER`, station.assetId); this.packingDevice = device;
    const previousOrigin = this.origin; this.origin = { x: 0, y: 0, z: 0, heading: 0 };
    this._guideNetwork(Array.from({ length: 4 }, (_, index) => packingBufferPath(
      { x: handoff.x, y: .95, z: handoff.z },
      { x: 12 + (index % 2 ? 1.05 : -1.05), y: .12, z: 20.4 + Math.floor(index / 2) * 1.95 }).slice(1)));
    this.origin = previousOrigin;
    // Printer, supply/take-up label rolls, tamp applicator and guarded exit.
    this._box(.2, .85, 3.4, .85, 1.5, .7, C.white);
    this._box(.2, 1.4, 3.78, .66, .4, .1, C.graphite);
    for (const x of [-.09, .49]) this._cylinder(x, 1.85, 3.4, .22, .23, C.white, [Math.PI / 2, 0, 0]);
    this._box(.2, 1.98, 3.4, .6, .035, .22, C.bright);
    this._box(.2, 1.2, 3.87, .42, .08, .17, C.steel);
    this._label('SSCC / HU', .2, .85, 3.78, .72);
  }

  _storeStation(device) {
    const station = device.station;
    const point = station.handoffPoint || station.receivingPoint || { x: station.x + 4.8, z: station.z - 6 };
    this._box(3.5, -.04, 0, 12.8, .16, 10.5, this.scene._mat(0xb9bdb8, { texture: 'concrete' }));
    // The lift moves independently of the fixed scanner gantry.
    const gantry = this.scene.models?.place(this.static,'BayGantry',this._world(0,0,0),[1,1,1],number(this.origin.heading));
    for (const side of [-1,1]) {
      if (!gantry) {
        this._box(0,1.65,side*1.12,.14,3.3,.14,C.steel);
        this._boltPlate(0,side*1.12,.4);
      }
      this._box(1.1,.55,side*1.18,1.8,1.1,.10,C.graphite);
      this._box(1.1,1.13,side*1.18,1.8,.08,.12,C.safety);
    }
    if (!gantry) this._box(0,3.26,0,.2,.2,2.4,C.graphite);
    this._box(.3, 3.7, 0, 4.1, .13, 3.3, C.blue);
    this._box(.3, 3.61, 0, 3.8, .035, .12, C.white);
    this._cabinet(2.1, -1.7, .7);
    this._label('RECEPCIÓN', .2, 3.5, 1.2, 2.6);
    const paths = array(station.transferPath);
    const bridge = new THREE.Group(); bridge.name = `retractable-${station.deviceId}`;
    for (let i = 1; i < paths.length; i++) {
      const a = paths[i - 1], originalB = paths[i];
      const length = Math.hypot(originalB.x - a.x, originalB.z - a.z) - (i === paths.length - 1 ? .6 : 0);
      if (length <= .05) continue;
      const heading = -Math.atan2(originalB.z - a.z, originalB.x - a.x);
      const deck = new THREE.Group(); deck.userData.batches = new Map();
      deck.position.set(a.x, number(a.y, 1.2), a.z); deck.rotation.y = heading;
      for (const side of [-1, 1]) {
        this.scene._box(deck, length / 2, -.18, side * .86, length, .24, .12, C.graphite);
        this.scene._box(deck, length / 2, .05, side * .86, length, .08, .055, C.safety);
      }
      for (let x = .14; x < length; x += .27) this.scene._shape(deck, 'cylinder', this.scene._mat(C.steel, { metalness: .72, roughness: .26 }),
        [x, -.09, 0], [.09, 1.6, .09], [Math.PI / 2, 0, 0]);
      for (const x of [.3, length - .3]) for (const side of [-1, 1]) this.scene._box(deck, x, -.65, side * .65, .1, .9, .1, C.steel);
      this.scene._finish(deck); bridge.add(deck);
    }
    bridge.visible = false; this.dynamic.add(bridge);
    const mechanism = this._transferCart(`${station.deviceId}:LIFT-DISTRIBUTOR`, station.assetId);
    // The guarded destination bay has assigned, non-overlapping floor pads.
    const buffers = array(station.bufferSlots).slice().sort((a, b) => b.z - a.z || b.x - a.x);
    const origin = this.origin; this.origin = { x: 0, y: 0, z: 0, heading: 0 };
    for (const slot of buffers) {
      this._box(slot.x, .04, slot.z, 1.26, .04, 1.08, C.graphite);
      for (const side of [-1, 1]) this._box(slot.x + side * .61, .07, slot.z, .035, .02, 1.08, C.safety);
    }
    const terminal = paths.at(-1) || { x: station.x, y: 1.2, z: station.z };
    const sideAisle = (buffers[0] ? Math.min(...buffers.map(slot => slot.x)) : terminal.x - 4) - 1.6;
    this._guideNetwork(buffers.map(slot => [{ ...terminal, y: .18 }, { x: sideAisle, y: .18, z: terminal.z },
      { x: sideAisle, y: .18, z: slot.z }, slot]));
    this.origin = origin;
    device.storeBridge = { point, center: station, group: bridge, cart: mechanism.group, mechanism, buffers };
  }

  _supplierTrailer() {
    const pose = this.schema.supplierDock?.truckPose || this.schema.supplierTruckPose
      || { x: -94, y: 0, z: 17, heading: -Math.PI / 2 };
    const group = new THREE.Group(); group.userData.batches = new Map();
    group.position.set(number(pose.x, -94), number(pose.y), number(pose.z, 17));
    group.rotation.y = number(pose.heading, -Math.PI / 2);
    const b = (x, y, z, w, h, d, c) => this.scene._box(group, x, y, z, w, h, d, c);
    b(0, .53, 0, 2.6, .25, 14.4, C.graphite);
    b(0, 1.16, -.2, 2.6, .08, 14, C.steel);
    const trailer = this.scene.models?.attach(group,'TrailerSides',[0,.09,0],[1,.85,1]);
    for (const side of [-1, 1]) {
      if (!trailer) {
        b(side * 1.33, 2.2, -.2, .08, 2.7, 14, C.white);
        b(side * 1.38, 1.16, -.2, .03, .15, 14, C.blue);
        for (let z = -6.8; z < 7; z += .75) b(side * 1.38, 2.22, z, .025, 2.65, .03, C.bright);
      }
      for (const z of [-5.5, -4.1, 7.7]) {
        if (!this.scene.models?.attach(group,'IndustrialWheel',[side*1.28,.45,z],[.25,.45,.45],side<0?Math.PI:0)) {
          this.scene._shape(group,'cylinder',C.dark,[side*1.28,.45,z],[.45,.25,.45],[0,0,Math.PI/2]);
          this.scene._shape(group,'cylinder',C.steel,[side*1.43,.45,z],[.24,.04,.24],[0,0,Math.PI/2]);
        }
      }
      b(side * 1.2, .69, -7.3, .23, .15, .05, C.red);
      if (!this.scene.models) b(side * 1.52, 2.5, 8.8, .12, .45, .28, C.graphite);
    }
    if (!trailer) b(0, 2.15, 6.8, 2.7, 2.7, .08, C.white);
    if (!this.scene.models?.attach(group,'SupplierCab',[0,-.09,0],[1,.9,1])) {
      b(0, 1.8, 8, 2.65, 2.6, 2.7, C.blue);
      b(0, 2.45, 9.38, 2.35, 1.03, .065, C.screen);
      b(0, 1.15, 9.4, 1.5, .4, .07, C.graphite);
      b(0, .73, 9.45, 2.7, .18, .1, C.steel);
      for (const x of [-1, 1]) b(x, 1.24, 9.44, .35, .18, .03, C.white);
    }
    this.scene._finish(group);
    const roof = new THREE.Mesh(this.scene._geo('box'), this.scene._mat(C.white, { metalness: .23, roughness: .42 }));
    roof.position.set(0, 3.6, -.2); roof.scale.set(2.8, .12, 14.2); group.add(roof);
    this.exterior.add(group); group.visible = false;
    const approach=array(this.schema.supplierDock?.approach);
    const rounded=[];
    if(approach.length===3) {
      const [a,b,c]=approach, r=Math.min(8,Math.hypot(b.x-a.x,b.z-a.z)/2,Math.hypot(c.x-b.x,c.z-b.z)/2);
      const ab=Math.hypot(b.x-a.x,b.z-a.z),bc=Math.hypot(c.x-b.x,c.z-b.z);
      const entry={x:b.x-(b.x-a.x)*r/ab,y:0,z:b.z-(b.z-a.z)*r/ab};
      const exit={x:b.x+(c.x-b.x)*r/bc,y:0,z:b.z+(c.z-b.z)*r/bc};
      rounded.push(a,entry);
      for(let i=1;i<=20;i++){const u=i/20,v=1-u;rounded.push({x:v*v*entry.x+2*v*u*b.x+u*u*exit.x,y:0,z:v*v*entry.z+2*v*u*b.z+u*u*exit.z});}
      rounded.push(c);
    }
    this.supplier = { group, roof, pose, approach:rounded.length?rounded:approach, activeJobId: null };
  }

  _loadModel(load) {
    const group = new THREE.Group(); group.userData.batches = new Map();
    const wood = this.scene._mat(C.wood, { texture: 'wood', roughness: .86 });
    if (!this.scene.models?.attach(group,'PalletWood')) {
      for (const z of [-.37, -.185, 0, .185, .37]) this.scene._box(group, 0, .155, z, LOAD.width, .05, .18, wood);
      for (const x of [-.43, 0, .43]) {
        this.scene._box(group, x, .025, 0, .18, .05, LOAD.depth, wood);
        for (const z of [-.35, 0, .35]) this.scene._box(group, x, .09, z, .18, .08, .2, wood);
      }
    }
    const carton = this.scene._mat(C.carton, { texture: 'carton', roughness: .93 });
    const wetCarton = this.scene._mat(0x67513a, { texture: 'carton', roughness: .93 });
    const label = this.scene._mat(C.white, { texture: 'barcode', roughness: .65 });
    for (const p of number(load.cases) > 0 ? caseParts(load.cases) : []) {
      const kind = caseDamageKind(load, p.index);
      const height = LOAD.boxHeight * (kind === 'crushed' ? .78 : 1);
      const centerY = p.y - (LOAD.boxHeight - height) / 2;
      const top = centerY + height / 2;
      this.scene._box(group, p.x, centerY, p.z, LOAD.boxWidth, height, LOAD.boxDepth, kind === 'liquid' ? wetCarton : carton);
      if (kind === 'open') for (const side of [-1,1]) this.scene._box(group, p.x+side*.14, top+.075, p.z, .26,.012,LOAD.boxDepth,C.carton,[0,0,side*.45]);
      const face = p.z + LOAD.boxDepth / 2;
      if (kind === 'liquid') this.scene._box(group,p.x+.08,p.y-.04,face+.009,.21,.16,.012,0x41382d);
      if (kind === 'torn') this.scene._box(group,p.x+.095,p.y+.058,face+.009,.035,.155,.012,0x513c24,[0,0,.58]);
      this.scene._box(group, p.x, top + .002, p.z, .065, .008, LOAD.boxDepth + .002, 0xdccb9f);
      this.scene._box(group, p.x - .05, centerY, face + .005, .2, .16, .008, label);
    }
    this.scene._box(group, -.01, .1, LOAD.depth / 2 + .01, .43, .1, .01, label);
    this.scene._finish(group); this.dynamic.add(group); group.visible = false;
    return group;
  }

  update(snapshot) {
    if (!this.schema) return false;
    this.snapshot = snapshot;
    const map = snapshot.autonomy?.map;
    if (!map) { this.active = false; return false; }
    const signature = JSON.stringify([map.paused, map.supplierDock, array(map.loads).map(row =>
      [row.id, row.stage, row.visible, row.phaseElapsed, row.blocked, row.cases]), array(map.devices).map(row =>
      [row.assetId, row.state, row.stage, row.phaseElapsed, row.blocked, row.carryingHuId]), array(map.bufferTransfers).map(row =>
      [row.id, row.visible, row.phaseElapsed, row.blocked, row.huId])]);
    const changed = signature !== this.updateSignature; this.updateSignature = signature;
    this.map = map; this.latestElapsed = number(map.clockElapsed, snapshot.clock?.elapsed);
    this.paused = Boolean(map.paused ?? snapshot.clock?.paused);
    this.mapHistory.push({ elapsed: this.latestElapsed, map });
    while (this.mapHistory.length > 35 || (this.mapHistory.length > 2 && this.mapHistory[1].elapsed < this.latestElapsed - 90)) this.mapHistory.shift();
    const currentHus = array(snapshot.inventory?.hus || snapshot.hus);
    // A visual bay reservation is inherited by the real HU only after the
    // server supplies its identity. It never allocates inventory or capacity.
    const occupied = new Set([...this.scene.stagingAssignments?.values() || []]
      .filter(value => value.stationId === 'RECEIVE').map(value => value.index));
    for (const [id, assignment] of this.receivingLoads) {
      const row = array(map.loads).find(item => item.id === id);
      if (!row) {
        if (this.latestElapsed - assignment.observedElapsed > 120) this.receivingLoads.delete(id);
        continue;
      }
      const waiting = huId => {
        const hu = currentHus.find(item => item.id === huId);
        return hu && (hu.locationId === 'RECEIVE' || this.scene._visualHu(hu)?.locationId === 'RECEIVE');
      };
      if (row.visible || waiting(row.huIds?.[0])) occupied.add(assignment.index);
      if (assignment.rejected && (row.visible || waiting(row.huIds?.[1]))) occupied.add(assignment.rejected.index);
    }
    const reservePad = () => {
      let index = 0;
      while (occupied.has(index)) index++;
      if (index >= array(this.schema.receivingBufferSlots).length) return null;
      occupied.add(index);
      return { stationId: 'RECEIVE', index, observedElapsed: this.latestElapsed };
    };
    for (const row of array(map.loads)) {
      if (!row.current && !row.received && !this.receivingLoads.has(row.id)) continue;
      let assignment = this.receivingLoads.get(row.id);
      if (!assignment && (row.visible || array(row.huIds).length && array(row.motionHistory).some(sample => sample.visible))) {
        assignment = reservePad();
        if (assignment) this.receivingLoads.set(row.id, assignment);
      }
      if (assignment) {
        assignment.observedElapsed = this.latestElapsed;
        const [mainHu, rejectedHu] = array(row.huIds);
        if (mainHu) this.receivingPads.set(String(mainHu), assignment);
        const reservingSplit = row.visible && row.qualityHeld && row.damagedCases > 0 && row.damagedCases < row.cases;
        if (reservingSplit || rejectedHu) assignment.rejected ||= reservePad();
        if (rejectedHu && assignment.rejected) {
          assignment.rejected.observedElapsed = this.latestElapsed;
          this.receivingPads.set(String(rejectedHu), assignment.rejected);
        }
      }
    }
    for (const [id, assignment] of this.receivingPads) if (this.latestElapsed - assignment.observedElapsed > 120 &&
      !currentHus.some(hu => hu.id === id && hu.locationId === 'RECEIVE')) this.receivingPads.delete(id);
    for (const row of array(map.loads)) {
      const previous = this.loads.get(row.id);
      const history = this._history(`load:${row.id}`, row);
      if (previous) { previous.row = { ...row, motionHistory: history }; previous.seen = this.latestElapsed; }
      else this.loads.set(row.id, { row: { ...row, motionHistory: history }, group: this._loadModel(row), seen: this.latestElapsed, position: { x: 0, y: 0, z: 0 } });
    }
    for (const row of array(map.devices)) {
      const device = this.devices.get(row.assetId);
      if (device) device.row = { ...row, motionHistory: this._history(`device:${row.assetId}`, row) };
    }
    for (const row of array(map.bufferTransfers)) {
      const history = this._history(`buffer:${row.id}`, row);
      this.bufferTransfers.set(row.id, { ...row, motionHistory: history, seen: this.latestElapsed });
      if ((row.visible && row.toStationId === 'PACK' || history.some(sample => sample.visible && sample.toStationId === 'PACK')) && !this.packingPads.has(String(row.huId))) {
        const occupied = new Set([...this.scene.stagingAssignments?.values() || []].filter(value => value.stationId === 'PACK').map(value => value.index));
        for (const [id, assignment] of this.packingPads) if (currentHus.some(hu => hu.id === id && hu.locationId === 'PACK' || hu.packContext?.shipmentHuId === id)) occupied.add(assignment.index);
        const existing = this.scene.stagingAssignments?.get(String(row.huId));
        let index = existing?.stationId === 'PACK' ? existing.index : 0;
        if (!existing) while (occupied.has(index)) index++;
        if (index < 4) this.packingPads.set(String(row.huId), { stationId: 'PACK', index, observedElapsed: this.latestElapsed });
      }
    }
    for (const [id, row] of this.bufferTransfers) if (this.latestElapsed - row.seen > 120) {
      this.bufferTransfers.delete(id); this.histories.delete(`buffer:${id}`);
    }
    for (const truck of array(snapshot.equipment?.trucks || snapshot.trucks)) {
      let slots = this.truckLoadSlots.get(truck.id);
      if (!slots) { slots = new Map(); this.truckLoadSlots.set(truck.id, slots); }
      for (const slot of array(truck.loadPositions)) if (slot.huId) slots.set(slot.huId, { ...slot, observedElapsed: this.latestElapsed });
      for (const [id, slot] of slots) if (this.latestElapsed - slot.observedElapsed > 120) slots.delete(id);
    }
    for (const [id, assignment] of this.packingPads) {
      if (currentHus.some(hu => hu.id === id && hu.locationId === 'PACK' || hu.packContext?.shipmentHuId === id)) assignment.observedElapsed = this.latestElapsed;
      else if (this.latestElapsed - number(assignment.observedElapsed) > 120) this.packingPads.delete(id);
    }
    for (const [id, load] of this.loads) if (this.latestElapsed - load.seen > 90) {
      this._removeGroup(load.group); this.loads.delete(id); this.histories.delete(`load:${id}`);
    }
    if (changed) this.scene._request();
    return changed;
  }

  _history(key, row) {
    const history = this.histories.get(key) || [];
    for (const sample of array(row.motionHistory)) {
      if (!history.length || number(sample.elapsed) > history[history.length - 1].elapsed) history.push({ ...row, ...sample, motionHistory: undefined });
    }
    const current = { ...row, elapsed: this.latestElapsed, motionHistory: undefined };
    if (!history.length || this.latestElapsed > history[history.length - 1].elapsed) history.push(current);
    else history[history.length - 1] = current;
    while (history.length > 250 || (history.length > 2 && history[1].elapsed < this.latestElapsed - 90)) history.shift();
    this.histories.set(key, history); return history;
  }

  frame(simElapsed) {
    if (!this.schema || !this.map) return false;
    const t = Math.min(number(simElapsed, this.latestElapsed), this.latestElapsed);
    const delta = this.lastElapsed == null ? 0 : Math.max(0,Math.min(.25,t-this.lastElapsed));
    this.changed = false; this.lastElapsed = t;
    let inboundBeltTravel = 0;
    this.active = false; this.offsets.clear(); this.storePoses.clear(); this.storeDoors.clear(); this.receivingPoses.clear(); this.mechanicalSupports.clear();
    for (const cart of this.receivingDevice?.receivingCarts || []) cart.group.visible = false;
    if (this.packingDevice?.transferCart) this.packingDevice.transferCart.group.visible = false;
    let map = this.mapHistory[0]?.map || this.map;
    for (const entry of this.mapHistory) { if (entry.elapsed > t) break; map = entry.map; }
    let inboundForkliftBusy=false;
    if (this.supplier) {
      if (this.supplier.group.visible !== Boolean(map.supplierDock?.occupied)) this.changed = true;
      this.supplier.group.visible = Boolean(map.supplierDock?.occupied);
      this.supplier.activeJobId = map.supplierDock?.jobId || null;
      const dock=map.supplierDock, approach=this.supplier.approach;
      if(dock?.occupied && approach.length>1) {
        // Interpolate the two witnessed snapshots instead of stepping at HTTP cadence.
        let arrival=number(dock.arrivalProgress,1),departure=number(dock.departureProgress);
        const next=this.mapHistory.find(entry=>entry.elapsed>t);
        const prior=[...this.mapHistory].reverse().find(entry=>entry.elapsed<=t);
        if(next && prior && next.map.supplierDock?.jobId===dock.jobId) {
          const alpha=clamp((t-prior.elapsed)/(next.elapsed-prior.elapsed));
          arrival+=(number(next.map.supplierDock.arrivalProgress,arrival)-arrival)*alpha;
          departure+=(number(next.map.supplierDock.departureProgress,departure)-departure)*alpha;
        }
        const progress=departure>0?1-departure:arrival;
        const pose=automationPosition({phasePath:approach},ease(progress));
        this.supplier.group.position.set(pose.x,0,pose.z);
        // Reversing along the rounded maneuver keeps the trailer rear facing
        // the dock; orientation follows the path tangent continuously.
        const before=automationPosition({phasePath:approach},Math.max(0,ease(progress)-.002));
        const after=automationPosition({phasePath:approach},Math.min(1,ease(progress)+.002));
        this.supplier.group.rotation.y=Math.atan2(after.x-before.x,after.z-before.z)+Math.PI;
        this.active ||= arrival<1 || departure>0;
        this.changed ||= arrival<1 || departure>0;
      }
      this.supplier.roof.visible = ['overview', 'network'].includes(this.view);
    }
    for (const load of this.loads.values()) {
      const row = automationSample(load.row, t);
      if (!row) { if (load.group.visible) this.changed = true; load.group.visible = false; continue; }
      const progress = automationProgress(row, t, this.latestElapsed);
      const visible = row.visible !== false && !['RECEIVED', 'STORED', 'DELIVERED', 'CANCELLED'].includes(row.status || row.state);
      const wasVisible = load.group.visible;
      if (wasVisible !== visible) this.changed = true;
      load.group.visible = visible;
      if (visible) {
        let onRollers = ['IDENTIFYING', 'INSPECTING', 'RECEIVING'].includes(row.stage);
        const assignment = this.receivingLoads.get(load.row.id);
        const pad = assignment && this.schema.receivingBufferSlots?.[assignment.index];
        if (row.stage === 'RECEIVING' && pad) {
          const mechanical = receivingMechanismPose(array(row.phasePath), pad, progress);
          onRollers = mechanical.phase === 'CONVEYOR';
          Object.assign(load.position, mechanical.cargo);
          const cart = this.receivingDevice?.receivingCarts?.[0];
          this._moveTransferCart(cart, mechanical, 0); this._support(load.row.id, cart, mechanical);
         } else if(row.stage === 'UNLOADING' && this.inboundForklift) {
          inboundForkliftBusy=true;
          const mechanical=inboundForkPose(row.from,row.to,progress);
          Object.assign(load.position,mechanical.cargo);
          this.inboundForklift.group.position.set(mechanical.carrier.x,0,mechanical.carrier.z);
          this.inboundForklift.group.rotation.y=mechanical.carrier.heading;
          this.inboundForklift.forks.position.y=mechanical.surfaceY;
          this.mechanicalSupports.set(load.row.id,{supportKind:'INBOUND_FORKS',supportY:mechanical.surfaceY});
        } else automationPosition(row, progress, load.position);
        if (Math.abs(load.group.position.x - load.position.x) + Math.abs(load.group.position.y - load.position.y)
          + Math.abs(load.group.position.z - load.position.z) > .00001) this.changed = true;
        if (wasVisible && onRollers && !row.blocked) {
          inboundBeltTravel += Math.max(0, load.position.x - load.group.position.x);
        }
        load.group.position.set(load.position.x, load.position.y, load.position.z);
        load.group.rotation.y = row.stage === 'RECEIVING' && Number.isFinite(load.position.heading)
          ? load.position.heading : number(row.heading, Math.PI / 2);
        if (row.moving && !row.blocked && !this.paused && progress < 1 && t < this.latestElapsed) this.active = true;
      }
      load.stage = row.stage; load.progress = progress; load.blocked = Boolean(row.blocked);
    }
    if(this.inboundForklift && !inboundForkliftBusy && delta>0 && !this.paused) {
      const lift=this.inboundForklift, target=new THREE.Vector3(-79,0,20.5), distance=lift.group.position.distanceTo(target);
      if(distance>.01) {lift.group.position.lerp(target,Math.min(1,delta*3/distance));this.active=true;this.changed=true;}
      lift.forks.position.y=Math.max(.15,lift.forks.position.y-delta*.6);
    }
    for (const transfer of this.bufferTransfers.values()) this._animateBufferTransfer(transfer, t);
    for (const device of this.devices.values()) {
      const row = automationSample(device.row, t);
      if (!row) continue;
      const progress = automationProgress(row, t, this.latestElapsed);
      const busy = Boolean(row.moving || row.phaseDuration > 0 && row.processId) && !row.blocked;
      const blocked = Boolean(row.blocked || ['OFFLINE', 'FAULT', 'MAINTENANCE', 'EXCEPTION'].includes(row.state || row.status));
      const status = blocked ? 2 : busy ? 1 : 0;
      if (device.displayProgress !== progress || device.lampStatus !== status || device.displayPhase !== row.stage) this.changed = true;
      device.moving = Boolean(row.moving && !blocked);
      device.lampStatus = status;
      device.lamps.forEach((lamp, index) => { lamp.material.emissiveIntensity = index === status ? .7 : .015; });
      if (device.scan) {
        device.scan.visible = busy && !blocked;
        device.scan.position.x = device.station.x + Math.sin(progress * Math.PI * 2) * .55;
      }
      if (device.inspectionHead) device.inspectionHead.position.z = device.station.z + (busy ? Math.sin(progress * Math.PI * 2) * .6 : 0);
      if (device.arm) this._animateArm(device, row, progress);
      if (device.storeBridge) this._animateStore(device, row, progress);
      if (busy && !this.paused && progress < 1 && t < this.latestElapsed) this.active = true;
      device.displayPhase = row.stage || row.phase || row.state;
      device.displayProgress = progress; device.blocked = blocked;
    }
    if (!this.paused && delta > 0) for (const run of this.rollerRuns) {
      const travel = run.branchId
        ? ([...this.devices.values()].some(device => device.station.branchId === run.branchId && device.moving) ? delta * .65 : 0)
        : inboundBeltTravel;
      if (travel <= 0) continue;
      run.angle = (run.angle + travel / .095) % (Math.PI * 2);
      const spin=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),run.angle);
      const orientation=run.orientation.clone().multiply(spin),matrix=new THREE.Matrix4();
      run.centers.forEach((center,index)=>run.mesh.setMatrixAt(index,matrix.compose(center,orientation,run.scale)));
      run.mesh.instanceMatrix.needsUpdate=true;this.changed=true;
    }
    return this.active || this.changed;
  }

  _animateArm(device, row, progress) {
    const arm = device.arm;
    const hu = array(this.snapshot?.inventory?.hus || this.snapshot?.hus).find(item => item.id === row.carryingHuId);
    const visualHu = hu && this.scene._visualHu(hu);
    const base = hu && this.scene._huPosition(hu, true);
    const sourceCases = base && visualHu?.state === 'PACKING' ? caseParts(visualHu.cases) : [];
    const count = Math.min(sourceCases.length, Math.max(1, number(row.cases, visualHu?.packContext?.cases)));
    const shipmentId = visualHu?.packContext?.shipmentHuId;
    if (shipmentId && !this.packingPads.has(shipmentId)) {
      const used = new Set([...this.scene.stagingAssignments?.values() || []].filter(value => value.stationId === 'PACK').map(value => value.index));
      for (const [id, assignment] of this.packingPads) {
        const current = array(this.snapshot?.inventory?.hus || this.snapshot?.hus).find(item => item.id === id);
        const pending = array(this.snapshot?.inventory?.hus || this.snapshot?.hus).some(item => item.packContext?.shipmentHuId === id);
        if (pending || current && this.scene._visualHu(current)?.locationId === 'PACK') used.add(assignment.index);
      }
      const sourceIndex = this.scene.stagingAssignments?.get(String(hu.id))?.index;
      const selection = packingDestinationSlot(used, sourceIndex, visualHu.cases, count);
      if (selection) this.packingPads.set(shipmentId, { stationId: 'PACK', ...selection, observedElapsed: this.latestElapsed });
    }
    const destination = this.packingPads.get(shipmentId);
    const targetBase = destination ? { x: 12 + (destination.index % 2 ? 1.05 : -1.05), y: .12,
      z: 20.4 + Math.floor(destination.index / 2) * 1.95 } : null;
    if (targetBase && !destination.reusePallet && (!arm.destinationPallet || arm.destinationId !== shipmentId)) {
      this._removeGroup(arm.destinationPallet);
      arm.destinationPallet = this._loadModel({ cases: 0 }); arm.destinationId = shipmentId;
    }
    if (arm.destinationPallet) {
      arm.destinationPallet.visible = Boolean(targetBase && sourceCases.length && !destination.reusePallet);
      if (targetBase) arm.destinationPallet.position.set(targetBase.x, targetBase.y, targetBase.z);
    }
    const source = sourceCases.length && targetBase ? sourceCases.at(-1) : null;
    let tx = arm.base.x - 1.8, ty = 2.9, tz = arm.base.z;
    if (source) {
      const ordinal = Math.min(count - 1, Math.floor(progress * count));
      const cycle = progress >= 1 ? 1 : progress * count - ordinal;
      const destinations = caseParts(count);
      arm.caseDeltas ||= Array.from({ length: LOAD.maxCases }, () => ({ x: 0, y: 0, z: 0 }));
      for (let index = 0; index <= ordinal; index++) {
        const from = sourceCases[sourceCases.length - 1 - index], to = destination.reusePallet ? from : destinations[index];
        const sx = base.x + from.x, sy = base.y + from.y, sz = base.z + from.z;
        const ex = targetBase.x + to.x, ey = targetBase.y + to.y, ez = targetBase.z + to.z;
        const fraction = index < ordinal ? 1 : ease((cycle - .2) / .65);
        const lift = index < ordinal ? 0 : Math.sin(Math.PI * fraction) * 1.6;
        const delta = arm.caseDeltas[index];
        delta.x = (ex - sx) * fraction; delta.y = (ey - sy) * fraction + lift; delta.z = (ez - sz) * fraction;
        if (index < ordinal || cycle >= .2) this.offsets.set(`${hu.id}:${from.index}`, delta);
        if (index !== ordinal) continue;
        const grip = LOAD.boxHeight / 2 + .51;
        if (cycle < .2) {
          const p = ease(cycle / .2), previous = index ? (destination.reusePallet ? sourceCases[sourceCases.length - index] : destinations[index - 1]) : null;
          const px = previous ? targetBase.x + previous.x : tx;
          const py = previous ? targetBase.y + previous.y + grip + .45 : ty;
          const pz = previous ? targetBase.z + previous.z : tz;
          tx = px + (sx - px) * p; ty = py + (sy + grip - py) * p + Math.sin(Math.PI * p) * 1.6;
          tz = pz + (sz - pz) * p;
        } else {
          tx = sx + delta.x; ty = sy + delta.y + grip + (cycle > .85 ? ease((cycle - .85) / .15) * .45 : 0);
          tz = sz + delta.z;
          if (index === count - 1 && cycle > .85) {
            const returning = ease((cycle - .85) / .15);
            tx = ex + (arm.base.x - 1.8 - ex) * returning;
            ty = ey + grip + (2.9 - ey - grip) * returning + Math.sin(Math.PI * returning) * .7;
            tz = ez + (arm.base.z - ez) * returning;
          }
        }
      }
    }
    arm.target.x = tx; arm.target.y = ty; arm.target.z = tz;
    const dx = tx - arm.base.x, dz = tz - arm.base.z;
    const horizontal = Math.hypot(dx, dz), vertical = ty - 1.12;
    const reach = Math.min(arm.upper + arm.lower - .03, Math.hypot(horizontal, vertical));
    const elbowAngle = -Math.acos(Math.max(-1, Math.min(1,
      (reach * reach - arm.upper * arm.upper - arm.lower * arm.lower) / (2 * arm.upper * arm.lower))));
    const shoulderAngle = Math.atan2(vertical, horizontal)
      - Math.atan2(arm.lower * Math.sin(elbowAngle), arm.upper + arm.lower * Math.cos(elbowAngle));
    arm.group.rotation.y = -Math.atan2(dz, dx);
    arm.shoulder.rotation.z = shoulderAngle - Math.PI / 2;
    arm.elbow.rotation.z = elbowAngle;
    arm.wrist.rotation.z = -(arm.shoulder.rotation.z + arm.elbow.rotation.z);
  }

  cargoOffset(huId, caseIndex) { return this.offsets.get(`${huId}:${caseIndex}`) || null; }
  bufferAssignment(huId) { return this.packingPads.get(huId) || this.receivingPads.get(huId) || null; }

  _support(huId, cart, motion) {
    if (!cart || !motion) return;
    this.mechanicalSupports.set(String(huId), { mechanismId: cart.id, ownerAssetId: cart.ownerAssetId,
      phase: motion.phase, kind: motion.supportKind, surfaceY: motion.supportY,
      cargoBottomY: motion.cargo.y, gap: motion.cargo.y - motion.supportY,
      carrier: { ...motion.carrier }, extension: motion.extension, liftHeight: motion.liftHeight,
      deckY: motion.surfaceY, carrying: motion.carrying });
  }

  _animateBufferTransfer(transfer, time) {
    const row = automationSample(transfer, time);
    if (!row?.visible) return;
    const stationId = row.toStationId || row.fromStationId;
    if (!['RECEIVE', 'PACK'].includes(stationId)) return;
    const assignment = this.scene.stagingAssignments?.get(String(row.huId)) || this.bufferAssignment(String(row.huId));
    const pad = assignment && (stationId === 'RECEIVE' ? this.schema.receivingBufferSlots?.[assignment.index]
      : { x: 12 + (assignment.index % 2 ? 1.05 : -1.05), y: .12, z: 20.4 + Math.floor(assignment.index / 2) * 1.95 });
    const unloading = row.stage === 'HANDOFF_FROM_AMR';
    const robotPoint = unloading ? row.from : row.to;
    if (!pad || !robotPoint) return;
    const progress = automationProgress(row, time, this.latestElapsed);
    const mechanical = bufferMechanismPose({ stationId, robot: robotPoint, pad, unloading }, progress);
    const pose = transfer.displayPose ||= { x: 0, y: 0, z: 0, heading: 0 };
    Object.assign(pose, mechanical.cargo);
    this.receivingPoses.set(String(row.huId), pose);
    const cart = stationId === 'RECEIVE' ? this.receivingDevice?.receivingCarts?.[1] : this.packingDevice?.transferCart;
    this._moveTransferCart(cart, mechanical, 0); this._support(row.huId, cart, mechanical);
    if (transfer.displayProgress !== progress) this.changed = true;
    transfer.displayProgress = progress; transfer.displayPhase = row.stage;
    if (row.moving && !row.blocked && !this.paused && progress < 1 && time < this.latestElapsed) this.active = true;
  }

  _animateStore(device, row, progress) {
    const engaged = row.stage === 'DESTINATION_RECEIVING' && Boolean(row.truckId);
    if (device.storeBridge.group.visible !== engaged) this.changed = true;
    device.storeBridge.group.visible = engaged;
    device.storeBridge.cart.visible = false;
    if (!engaged) return;
    const truck = this.scene.movers.get(`truck:${row.truckId}`);
    if (!truck || truck.pose.state !== 'AT_STORE') return;
    const duration = Math.max(1, number(row.phaseDuration));
    const doorSeconds = mechanicalTiming.STORE_DOOR_SECONDS;
    const huIds = array(row.huIds);
    const slots = [...(this.truckLoadSlots.get(row.truckId)?.values() || [])].filter(slot => huIds.includes(slot.huId))
      .sort((a, b) => number(a.z) - number(b.z) || number(a.x) - number(b.x));
    const cycle = storeReceiptCycle(duration, progress, slots.length, number(row.storeIdentifySeconds, 3), doorSeconds);
    this.storeDoors.set(row.truckId, row.storeDoorProgress ?? cycle.doorProgress);
    const path = array(row.transferPath).length ? row.transferPath : array(device.station.transferPath);
    if (path.length < 2) return;
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index], amount = cycle.loads[index];
      if (amount <= 0) continue;
      const pose = truckLoadPoint({ ...truck.pose, heading: truck.group.rotation.y }, slot);
      // Keep the lateral pallet lane while it leaves the back of the trailer;
      // the transverse turn occurs only after its entire footprint is clear.
      const rear = truckLoadPoint({ ...truck.pose, heading: truck.group.rotation.y }, { x: number(slot.x), y: 1.2, z: -7.9 });
      const terminal = path[path.length - 1];
      const buffer = device.storeBridge.buffers[index] || {
        x: terminal.x - 1.35 * (index % 3), y: terminal.y,
        z: terminal.z + 1.45 * Math.floor(index / 3),
      };
      const sideAisle = (device.storeBridge.buffers[0] ? Math.min(...device.storeBridge.buffers.map(slot => slot.x)) : terminal.x - 4) - 1.6;
      const mechanical = storeMechanismPose([pose, rear, ...path], buffer, sideAisle, amount);
      const output = device[`storeLoad${index}`] ||= { x: 0, y: 0, z: 0, heading: Math.PI / 2 };
      Object.assign(output, mechanical.cargo);
      // Boxes remain linked to the original HU while the secure destination
      // buffer is being reconciled; inventory changes only at server receipt.
      output.heading = Math.PI / 2;
      this.storePoses.set(slot.huId, output);
      if (amount < 1) this._moveTransferCart(device.storeBridge.mechanism, mechanical, 0);
      this._support(slot.huId, device.storeBridge.mechanism, mechanical);
    }
  }

  huPose(huId) { return this.storePoses.get(huId) || this.receivingPoses.get(huId) || null; }
  huSupport(huId) { return this.mechanicalSupports.get(String(huId)) || null; }
  huHeading(huId) { return this.huPose(huId)?.heading; }
  truckDoorProgress(truckId) { return this.storeDoors.get(truckId); }

  setView(view) {
    this.view = view;
    const outside = ['overview', 'network'].includes(view);
    if (this.static) this.static.visible = true;
    // Supplier and branch interfaces remain readable outside. Indoor process
    // geometry is naturally occluded by the actual annex/warehouse envelope.
    if (this.supplier) this.supplier.roof.visible = outside;
  }

  diagnostics() {
    return { active: this.active, elapsed: this.lastElapsed,
      rollers:this.rollerRuns.map(run=>({count:run.centers.length,angle:run.angle,branchId:run.branchId})),
      stations: [...this.devices.values()].map(device => ({ assetId: device.station.assetId,
        type: device.type, position: [device.station.x, number(device.station.y), device.station.z],
        phase: device.displayPhase, progress: device.displayProgress, blocked: device.blocked,
        armTarget: device.arm ? { ...device.arm.target } : null })),
      incoming: [...this.loads.entries()].filter(([, value]) => value.group.visible).map(([id, value]) => ({ id,
        stage: value.stage, progress: value.progress, blocked: value.blocked, position: { ...value.position } })),
      supplier: this.supplier ? { visible: this.supplier.group.visible, jobId: this.supplier.activeJobId } : null,
      caseOffsets: [...this.offsets].map(([id, delta]) => ({ id, ...delta })),
      bufferLoads: [...this.receivingPoses].map(([id, pose]) => ({ id, ...pose })),
      mechanicalSupports: [...this.mechanicalSupports].map(([id, support]) => ({ id, ...support })),
      mechanisms: this.transferCarts.filter(cart => cart.group.visible).map(cart => ({ id: cart.id, ownerAssetId: cart.ownerAssetId,
        phase: cart.phase, ...cart.pose, supportPoint: cart.forks.at(-1).getWorldPosition(new THREE.Vector3()).toArray(),
        selectableMeshes: cart.group.children.reduce((count, child) => count + (child.userData.entity ? 1 : 0), 0) })),
      storeLoads: [...this.storePoses].map(([id, pose]) => ({ id, ...pose })) };
  }

  _removeGroup(group) {
    if (!group) return;
    group.removeFromParent();
    group.traverse(object => {
      if (object.isInstancedMesh) object.dispose();
      for (const resource of object.userData.ownedResources || []) resource.dispose();
    });
  }

  dispose() {
    this._removeGroup(this.dynamic); this._removeGroup(this.exterior);
    if (this.static?.parent) this._removeGroup(this.static);
    this.devices.clear(); this.loads.clear(); this.offsets.clear(); this.histories.clear();
    this.phaseStates.clear(); this.mapHistory.length = 0; this.supplier = null;
    this.storePoses.clear(); this.storeDoors.clear();
    this.truckLoadSlots.clear();
    this.packingPads.clear();
    this.receivingPads.clear(); this.receivingLoads.clear(); this.bufferTransfers.clear(); this.receivingPoses.clear();
    this.mechanicalSupports.clear(); this.transferCarts.length = 0; this.rollerRuns.length=0; this.lastElapsed=undefined;
    this.receivingDevice = null;
    this.packingDevice = null;
    this.dynamic = null; this.exterior = null; this.static = null; this.active = false;
    this.updateSignature = null; this.map = null; this.snapshot = null;
  }
}
