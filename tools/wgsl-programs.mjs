// The WebGL programs render3d.js builds (name, vertex, fragment, drawn as points): translated to WGSL by
// tools/make_wgsl.mjs, and checked by tools/build-single.mjs (a program without its translation would leave
// the WebGPU renderer unable to start).
import * as S from '../js/shaders.js';
export const PROGRAMS = [
  ['body', S.BODY_VS, S.BODY_FS], ['atmo', S.BODY_VS, S.ATMO_FS], ['rim', S.BODY_VS, S.RIM_FS], ['cloud', S.BODY_VS, S.CLOUD_FS],
  ['sprite', S.SPRITE_VS, S.SPRITE_FS], ['disk', S.DISK_VS, S.DISK_FS], ['points', S.POINTS_VS, S.POINTS_FS, true],
  ['lines', S.LINES_VS, S.LINES_FS], ['sky', S.SKY_VS, S.SKY_FS, true], ['milky', S.FULL_VS, S.MILKYWAY_FS],
  ['down', S.FULL_VS, S.DOWN_FS], ['up', S.FULL_VS, S.UP_FS], ['comp', S.FULL_VS, S.COMPOSITE_FS], ['pixel', S.FULL_VS, S.PIXEL_FS],
  ['surfsky', S.FULL_VS, S.SURFACE_SKY_FS], ['terrain', S.TERRAIN_VS, S.TERRAIN_FS], ['ring', S.DISK_VS, S.RING_FS], ['field', S.FULL_VS, S.TEMP_FIELD_FS], ['gen', S.FULL_VS, S.GEN_FS], ['surfcloud', S.FULL_VS, S.SURFACE_CLOUD_FS], ['weather', S.FULL_VS, S.WEATHER_FS],
  ['nebula', S.FULL_VS, S.NEBULA_FS], ['rembake', S.FULL_VS, S.REMBAKE_FS], ['cut', S.FULL_VS, S.CUT_FS], ['blit', S.FULL_VS, S.BLIT_FS], ['upsample', S.FULL_VS, S.UPSAMPLE_FS],
  ['galglow', S.GALGLOW_VS, S.GALGLOW_FS, true], ['galcomp', S.FULL_VS, S.GALCOMP_FS],
];
