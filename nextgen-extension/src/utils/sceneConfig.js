/**
 * Scene config normalizer — worldlabs shipped two json shapes:
 * - nested (raw worldlabs dump): {camera:{position,quaternion,fov_y_deg},
 *   scene:{position,rotation,offset}, controls:{camera_radius,orbit_radius,duration}}
 * - flat (imgvault upload format): {position,rotation,offset,cameraRadius,radius,duration}
 * The imgvault scene-viewer reads the flat shape. Flatten nested configs on
 * upload so every stored config is one shape (2.12.67).
 */
export function isNestedSceneConfig(cfg) {
  return Boolean(cfg && typeof cfg === 'object' && (cfg.scene || cfg.camera || cfg.controls));
}

export function flattenSceneConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || !isNestedSceneConfig(cfg)) return cfg;
  const cam = cfg.camera && typeof cfg.camera === 'object' ? cfg.camera : {};
  const scene = cfg.scene && typeof cfg.scene === 'object' ? cfg.scene : {};
  const controls = cfg.controls && typeof cfg.controls === 'object' ? cfg.controls : {};
  const pickArr = (v, fallback) => (Array.isArray(v) && v.length === 3 ? v : fallback);
  const num = (v) => (Number.isFinite(+v) ? +v : null);
  return {
    position: pickArr(scene.position, [0, 0, 0]),
    rotation: pickArr(scene.rotation, [0, 0, 0]),
    offset: pickArr(scene.offset, [0, 0, 0]),
    cameraRadius: num(controls.camera_radius) ?? num(cam.position?.[2]),
    radius: num(controls.orbit_radius),
    duration: num(controls.duration),
  };
}
