import { PostProcessing } from 'three/webgpu';
import { pass, vec4, mix } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

export function configureIndustrialSun(sun) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096,4096);
  Object.assign(sun.shadow.camera,{left:-100,right:100,top:90,bottom:-90,near:1,far:220});
  // Orthographic bounds do not rebuild their projection automatically. Without
  // this call, the default ten-metre frustum leaves most machines shadowless.
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias=-.0002;
  sun.shadow.normalBias=.025;
  sun.shadow.radius=2.5;
}

// Separate camera passes retain the correct inverse projection for perspective
// inspections and orthographic exterior views. There is no temporal accumulation
// to leave trails behind a moving forklift, truck or pallet.
export default class IndustrialLighting {
  constructor(renderer) {
    this.renderer = renderer; this.pipelines = new Map();
  }
  pipeline(camera, scene) {
    let pipeline = this.pipelines.get(camera.uuid);
    if (!pipeline) {
      const scenePass = pass(scene, camera, { samples:4 });
      const color = scenePass.getTextureNode('output');
      const depth = scenePass.getTextureNode('depth');
      const occlusion = ao(depth, null, camera);
      occlusion.radius.value = .85;
      occlusion.thickness.value = .8;
      occlusion.resolutionScale = .75;
      occlusion.samples.value = 16;
      occlusion.distanceFallOff.value = .85;
      const post = new PostProcessing(this.renderer);
      post.outputNode = vec4(color.rgb.mul(mix(1, occlusion.r, .65)), color.a);
      pipeline = { scenePass, occlusion, post };
      this.pipelines.set(camera.uuid, pipeline);
    }
    return pipeline;
  }
  render(camera, scene) {
    const pipeline = this.pipeline(camera, scene);
    pipeline.scenePass.scene = scene;
    pipeline.post.render();
  }
  dispose() {
    for (const {scenePass, occlusion, post} of this.pipelines.values()) {
      post.dispose(); scenePass.dispose(); occlusion.dispose();
    }
    this.pipelines.clear();
  }
}
