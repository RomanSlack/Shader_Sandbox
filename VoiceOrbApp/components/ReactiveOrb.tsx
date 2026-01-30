import React, { useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';

export type OrbState = 'idle' | 'user' | 'ai';
export type OrbStyle = 'default' | 'siri';

interface ReactiveOrbProps {
  audioLevel: number; // 0-1
  state: OrbState;
  style?: OrbStyle;
  size?: number;
  fullscreen?: boolean;
  zoom?: number; // 0.5 to 2.0, default 1.0
  wobble?: number; // 0 to 1, default 0.5
}

const vertexShaderSource = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Clean, elegant AI assistant orb - smooth flowing light
const fragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_audioLevel;
uniform float u_state;
uniform float u_zoom;
uniform float u_wobble;

#define PI 3.14159265359

// Attempt tanh approximation for tone mapping
float tanh_approx(float x) {
  float x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

vec3 tanh3(vec3 x) {
  return vec3(tanh_approx(x.x), tanh_approx(x.y), tanh_approx(x.z));
}

// Smooth noise
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float smoothNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// State-based color palettes - refined and elegant
vec3 getBaseColor(float state) {
  // Idle: soft violet/indigo
  vec3 idle = vec3(0.4, 0.3, 0.9);
  // User: cool cyan/teal
  vec3 user = vec3(0.2, 0.8, 0.9);
  // AI: warm magenta/rose
  vec3 ai = vec3(0.9, 0.3, 0.6);

  if (state < 1.0) {
    return mix(idle, user, state);
  } else {
    return mix(user, ai, state - 1.0);
  }
}

vec3 getAccentColor(float state) {
  // Idle: deep blue
  vec3 idle = vec3(0.2, 0.2, 0.6);
  // User: teal/green
  vec3 user = vec3(0.1, 0.6, 0.5);
  // AI: coral/orange
  vec3 ai = vec3(1.0, 0.5, 0.4);

  if (state < 1.0) {
    return mix(idle, user, state);
  } else {
    return mix(user, ai, state - 1.0);
  }
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv /= u_zoom;

  float audio = u_audioLevel;
  float t = u_time;

  float dist = length(uv);
  float angle = atan(uv.y, uv.x);

  // Base sphere radius
  float baseR = 0.5;

  // === DYNAMIC EDGE DISTORTION ===
  // Wobble ONLY happens when there's audio - perfect sphere when silent
  float wob = 0.0;
  if (audio > 0.01) {
    wob += sin(angle * 3.0 + t * 2.0) * 0.08;
    wob += sin(angle * 5.0 - t * 2.5) * 0.05;
    wob += sin(angle * 7.0 + t * 1.8) * 0.04;
    wob += sin(angle * 2.0 - t * 3.0) * 0.06;
    wob *= u_wobble * audio; // Scale by wobble control AND audio level
  }

  // Sphere radius with wobble
  float R = baseR + wob;

  // Start with black
  vec3 col = vec3(0.0);

  // Normalized distance for this distorted radius
  float sphereDist = dist / R;

  // Only render inside sphere area (with glow margin)
  if (dist < baseR * 2.0) {

    if (sphereDist < 1.0) {
      // === 3D SPHERE GEOMETRY ===
      float z = sqrt(max(0.0, 1.0 - sphereDist * sphereDist));
      vec3 normal = vec3(uv / R, z);
      normal = normalize(normal);

      // Light direction (top-right-front)
      vec3 lightDir = normalize(vec3(0.4, 0.5, 0.8));
      vec3 viewDir = vec3(0.0, 0.0, 1.0);

      // Diffuse lighting
      float diffuse = max(0.0, dot(normal, lightDir));
      diffuse = diffuse * 0.4 + 0.6;

      // Specular highlights
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(0.0, dot(normal, halfDir)), 50.0);

      vec3 lightDir2 = normalize(vec3(-0.3, 0.4, 0.6));
      vec3 halfDir2 = normalize(lightDir2 + viewDir);
      float spec2 = pow(max(0.0, dot(normal, halfDir2)), 25.0);

      // Fresnel rim
      float fresnel = pow(1.0 - z, 2.5);

      // === FLOWING PATTERNS (no center convergence) ===
      vec3 pos3D = normal;

      // Multi-axis rotation
      float rot1 = t * 0.25;
      float rot2 = t * 0.18;
      pos3D.xy = mat2(cos(rot1), -sin(rot1), sin(rot1), cos(rot1)) * pos3D.xy;
      pos3D.yz = mat2(cos(rot2), -sin(rot2), sin(rot2), cos(rot2)) * pos3D.yz;

      // Flowing ribbons that wrap around (not converging to center)
      float ribbons = 0.0;

      // Horizontal flowing bands
      ribbons += sin(pos3D.y * 6.0 + pos3D.x * 2.0 + t * 0.8) * 0.5 + 0.5;
      ribbons += sin(pos3D.y * 4.0 - pos3D.z * 3.0 + t * 0.6) * 0.3 + 0.3;

      // Diagonal sweeping waves
      float diag1 = sin((pos3D.x + pos3D.y) * 5.0 + t * 0.7) * 0.5 + 0.5;
      float diag2 = sin((pos3D.x - pos3D.z) * 4.0 - t * 0.5) * 0.5 + 0.5;
      ribbons += diag1 * 0.4 + diag2 * 0.3;

      // Circular flow around the sphere (like latitude lines)
      float circular = sin(pos3D.z * 8.0 + angle * 2.0 + t * 0.9) * 0.5 + 0.5;
      ribbons += circular * 0.3;

      ribbons = ribbons / 2.5; // Normalize

      // Add variation based on position (breaks up uniformity)
      float variation = smoothNoise(pos3D.xy * 3.0 + t * 0.2) * 0.3;
      ribbons = ribbons * (0.7 + variation);

      // Audio reactive energy bursts (edge-focused, not center)
      float edgePulse = (1.0 - z) * sin(angle * 6.0 + t * 5.0) * audio;
      float audioEnergy = fresnel * audio * 1.5 + edgePulse * 0.5;

      // Overall pattern intensity
      float pattern = ribbons * 0.7 + 0.3;
      pattern += audioEnergy * 0.3;

      // === COLORS ===
      vec3 baseCol = getBaseColor(u_state);
      vec3 accentCol = getAccentColor(u_state);

      // Color varies with the flowing patterns
      float colorMix = ribbons * 0.5 + circular * 0.3 + fresnel * 0.2;
      vec3 energyColor = mix(baseCol, accentCol, colorMix);

      // Add some white/glow in bright areas
      energyColor = mix(energyColor, baseCol * 1.3 + 0.2, pattern * 0.2);

      // === FINAL COMPOSITE ===
      col = energyColor * pattern * diffuse;

      // Audio brightness boost
      col *= 0.8 + audio * 0.6;

      // Specular highlights
      col += vec3(1.0) * spec * 0.5;
      col += vec3(0.85, 0.9, 1.0) * spec2 * 0.25;

      // Fresnel rim (stronger with audio)
      float rimStrength = 0.35 + audio * 0.3;
      col += baseCol * fresnel * rimStrength;
      col += vec3(1.0) * fresnel * 0.12;

      // Edge energy with audio
      col += accentCol * audioEnergy * 0.4;

      // Soft inner glow (not center-focused, just overall)
      col += baseCol * 0.1 * (0.5 + audio * 0.3);
    }

    // === DYNAMIC OUTER GLOW ===
    if (sphereDist >= 1.0 && sphereDist < 1.5) {
      float glowDist = sphereDist - 1.0;

      // Glow also has audio-reactive wobble
      float glowWobble = sin(angle * 4.0 + t * 3.0) * audio * 0.1;
      float glow = exp(-(glowDist - glowWobble) * 8.0);
      glow *= 0.5 + audio * 0.5;

      vec3 glowCol = getBaseColor(u_state);
      col += glowCol * glow * 0.5;

      // Secondary accent glow
      float glow2 = exp(-(glowDist) * 5.0) * audio;
      col += getAccentColor(u_state) * glow2 * 0.3;
    }
  }

  // Tone mapping
  col = tanh3(col * 1.1);

  gl_FragColor = vec4(col, 1.0);
}
`;

// Siri-style shader - flowing ribbon orb
const siriFragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_audioLevel;
uniform float u_state;
uniform float u_zoom;
uniform float u_wobble;

float tanh_approx(float x) {
  float x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

vec3 tanh3(vec3 x) {
  return vec3(tanh_approx(x.x), tanh_approx(x.y), tanh_approx(x.z));
}

// State-based color phase offsets
vec3 getColorPhase(float state) {
  // Idle: purple/blue/pink (0, 2, 4)
  vec3 idle = vec3(0.0, 2.0, 4.0);
  // User: cyan/teal/green
  vec3 user = vec3(2.5, 3.5, 5.0);
  // AI: magenta/orange/coral
  vec3 ai = vec3(5.5, 1.0, 3.0);

  if (state < 1.0) {
    return mix(idle, user, state);
  } else {
    return mix(user, ai, state - 1.0);
  }
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv /= u_zoom;

  float audio = u_audioLevel;
  float t = u_time * (0.8 + audio * 0.5);

  vec4 col = vec4(0.0);
  vec3 colorPhase = getColorPhase(u_state);

  // Raymarching loop - Siri ribbon style
  float z = 0.0;
  for (float i = 0.0; i < 120.0; i++) {
    if (z + i > 200.0) break;

    // Ray position
    vec3 p = z * normalize(vec3(uv, -1.0));
    p.z += 9.0;

    // Swirling axis that changes over time
    float s = 0.0;
    vec3 a = normalize(cos(vec3(0.0, 2.0, 4.0) - t * 0.5 + s * 0.3));

    // Project onto swirling axis and create ribbon
    float dotAP = dot(a, p);
    vec3 projected = dotAP * a;
    vec3 crossed = cross(a, p);
    p = projected - crossed;
    s = length(p);

    // Update axis with new s value
    a = normalize(cos(colorPhase * 0.5 - t * 0.5 + s * 0.3));
    dotAP = dot(a, p);
    projected = dotAP * a;
    crossed = cross(a, p);
    p = projected - crossed;
    s = length(p);

    // Distance estimation
    vec3 sinP = sin(p);
    float d1 = abs(dot(p, sinP.yzx)) * 0.2;
    float d2 = s - 5.0;
    d2 = max(d2, 0.1);
    float d3 = abs(d2 - 1.0) + 0.2;
    float d = min(d1 + d2, d3) * 0.2;

    // Accumulate color
    float colorWave = p.x * 0.4 + t * 0.3;

    // Audio-reactive brightness
    float brightness = (1.0 + audio * 2.0);

    // Color based on state
    vec4 sampleCol = vec4(
      cos(colorWave + colorPhase.x) + 1.0,
      cos(colorWave + colorPhase.y) + 1.0,
      cos(colorWave + colorPhase.z) + 1.0,
      1.0
    ) * brightness;

    // Also add the 5/s/s term for inner glow
    float innerGlow = 5.0 / (s * s + 0.1);
    sampleCol += vec4(innerGlow) * 0.3;

    // Accumulate with distance falloff
    float contribution = 1.0 / (d * d + 0.001);
    col += max(sampleCol, vec4(innerGlow * 0.5)) * contribution * 0.00003;

    z += d;
  }

  // Apply zoom-based vignette for sphere containment
  float dist = length(uv);
  float sphereMask = smoothstep(1.2, 0.3, dist);
  col.rgb *= sphereMask;

  // Add glow
  float glow = exp(-dist * 2.0) * (0.2 + audio * 0.3);
  vec3 glowCol = vec3(
    cos(colorPhase.x) * 0.5 + 0.5,
    cos(colorPhase.y) * 0.5 + 0.5,
    cos(colorPhase.z) * 0.5 + 0.5
  );
  col.rgb += glowCol * glow * 0.3;

  // Tone mapping
  col.rgb = tanh3(col.rgb * 0.8);

  gl_FragColor = vec4(col.rgb, 1.0);
}
`;

export const ReactiveOrb: React.FC<ReactiveOrbProps> = ({
  audioLevel,
  state,
  style = 'default',
  size = 300,
  fullscreen = false,
  zoom = 1.0,
  wobble = 0.3,
}) => {
  const glRef = useRef<ExpoWebGLRenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const uniformsRef = useRef<{
    time: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    audioLevel: WebGLUniformLocation | null;
    state: WebGLUniformLocation | null;
    zoom: WebGLUniformLocation | null;
    wobble: WebGLUniformLocation | null;
  }>({ time: null, resolution: null, audioLevel: null, state: null, zoom: null, wobble: null });

  const audioLevelRef = useRef(audioLevel);
  const zoomRef = useRef(zoom);
  const wobbleRef = useRef(wobble);
  const targetStateRef = useRef(0);
  const currentStateRef = useRef(0);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    wobbleRef.current = wobble;
  }, [wobble]);

  useEffect(() => {
    targetStateRef.current = state === 'idle' ? 0 : state === 'user' ? 1 : 2;
  }, [state]);

  const createShader = (gl: ExpoWebGLRenderingContext, type: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    glRef.current = gl;
    startTimeRef.current = Date.now();

    // Select shader based on style
    const fragShader = style === 'siri' ? siriFragmentShaderSource : fragmentShaderSource;

    const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fragShader);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(program));
      return;
    }

    programRef.current = program;
    gl.useProgram(program);

    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    uniformsRef.current = {
      time: gl.getUniformLocation(program, 'u_time'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      audioLevel: gl.getUniformLocation(program, 'u_audioLevel'),
      state: gl.getUniformLocation(program, 'u_state'),
      zoom: gl.getUniformLocation(program, 'u_zoom'),
      wobble: gl.getUniformLocation(program, 'u_wobble'),
    };

    gl.uniform2f(uniformsRef.current.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);

    const render = () => {
      if (!glRef.current || !programRef.current) return;

      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      currentStateRef.current += (targetStateRef.current - currentStateRef.current) * 0.08;

      gl.uniform1f(uniformsRef.current.time, elapsed);
      gl.uniform1f(uniformsRef.current.audioLevel, audioLevelRef.current);
      gl.uniform1f(uniformsRef.current.state, currentStateRef.current);
      gl.uniform1f(uniformsRef.current.zoom, zoomRef.current);
      gl.uniform1f(uniformsRef.current.wobble, wobbleRef.current);

      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.endFrameEXP();

      animationRef.current = requestAnimationFrame(render);
    };

    render();
  }, [style]);

  useEffect(() => {
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <View style={fullscreen ? styles.fullscreen : [styles.container, { width: size, height: size }]}>
      <GLView key={style} style={styles.glView} onContextCreate={onContextCreate} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 1000,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  fullscreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  glView: {
    flex: 1,
  },
});

export default ReactiveOrb;
