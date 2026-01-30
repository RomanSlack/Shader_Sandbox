# Voice AI Reactive Orb - Implementation Guide

A React Native Expo component that renders a stunning, audio-reactive 3D orb visualization for AI voice interfaces. The orb responds to microphone input with smooth, organic animations and changes appearance based on conversation state (idle, user speaking, AI speaking).

## Features

- WebGL shader-based rendering (60fps)
- Cross-platform audio level detection (Web + iOS/Android)
- Noise gate with auto-calibration
- Smooth interpolation (no strobe effects)
- Three visual states: idle, user, AI
- Two shader styles: default (3D sphere) and siri (flowing ribbons)
- Configurable zoom and wobble intensity

## Dependencies

```json
{
  "dependencies": {
    "expo": "~54.0.0",
    "expo-av": "^16.0.0",
    "expo-gl": "^16.0.0",
    "react": "19.1.0",
    "react-native": "0.81.0"
  }
}
```

Install with:
```bash
npx expo install expo-gl expo-av
```

## File Structure

```
your-project/
├── components/
│   └── ReactiveOrb.tsx    # GL shader component
└── hooks/
    └── useAudioLevel.ts   # Audio capture + processing
```

---

## File 1: hooks/useAudioLevel.ts

This hook handles microphone permissions, audio capture, noise gating, and smooth level interpolation.

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';

interface UseAudioLevelResult {
  audioLevel: number;          // 0-1, smoothed audio amplitude
  isRecording: boolean;        // Whether mic is active
  hasPermission: boolean | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  error: string | null;
  debugInfo: string;           // For debugging, can be removed in production
}

const isWeb = Platform.OS === 'web';

export function useAudioLevel(): UseAudioLevelResult {
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState(isWeb ? 'web init' : 'native init');

  // Web refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const webAnimationRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  // Smoothing refs
  const smoothedLevelRef = useRef(0);
  const noiseFloorRef = useRef(0.05);

  // Native refs
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Request permissions on mount
  useEffect(() => {
    if (isWeb) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(track => track.stop());
          setHasPermission(true);
        })
        .catch(() => {
          setHasPermission(false);
          setError('Microphone permission denied');
        });
    } else {
      const requestPermissions = async () => {
        try {
          const { status } = await Audio.requestPermissionsAsync();
          setHasPermission(status === 'granted');
          if (status !== 'granted') {
            setError('Microphone permission denied');
          }
        } catch (err) {
          setError('Failed to request permissions');
          setHasPermission(false);
        }
      };
      requestPermissions();
    }
  }, []);

  // Web: start recording with Web Audio API
  const startWebRecording = useCallback(async () => {
    try {
      setError(null);
      setDebugInfo('requesting mic...');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      streamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;

      setIsRecording(true);
      setDebugInfo('recording (web)');

      // Calibration: sample noise floor for first 500ms
      let calibrationSamples: number[] = [];
      const calibrationDuration = 500;
      const calibrationStart = Date.now();

      const updateLevel = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        let sum = 0;
        for (let i = 0; i < dataArrayRef.current.length; i++) {
          sum += dataArrayRef.current[i] * dataArrayRef.current[i];
        }
        const rms = Math.sqrt(sum / dataArrayRef.current.length);
        const rawNormalized = rms / 255;

        // Calibrate noise floor during first 500ms
        if (Date.now() - calibrationStart < calibrationDuration) {
          calibrationSamples.push(rawNormalized);
          noiseFloorRef.current = Math.max(...calibrationSamples) * 1.2;
          setDebugInfo(`calibrating... ${calibrationSamples.length}`);
          webAnimationRef.current = requestAnimationFrame(updateLevel);
          return;
        }

        // Noise gate: subtract noise floor and rescale
        const noiseFloor = noiseFloorRef.current;
        const gated = Math.max(0, rawNormalized - noiseFloor) / (1 - noiseFloor);

        // Apply curve - gentler response, less gain
        const curved = Math.pow(gated, 0.5) * 1.0;
        const clampedLevel = Math.min(1, curved);

        // Heavy smoothing: slow attack, very slow release
        const currentSmoothed = smoothedLevelRef.current;
        const smoothingFactor = clampedLevel > currentSmoothed ? 0.08 : 0.03;
        const smoothed = currentSmoothed + (clampedLevel - currentSmoothed) * smoothingFactor;
        smoothedLevelRef.current = smoothed;

        const finalLevel = smoothed < 0.01 ? 0 : smoothed;

        setAudioLevel(finalLevel);
        setDebugInfo(`lvl:${(finalLevel * 100).toFixed(0)}% nf:${(noiseFloor * 100).toFixed(0)}%`);

        webAnimationRef.current = requestAnimationFrame(updateLevel);
      };

      updateLevel();

    } catch (err: any) {
      setError(`Failed: ${err.message}`);
      setDebugInfo(`error: ${err.message}`);
    }
  }, []);

  // Web: stop recording
  const stopWebRecording = useCallback(async () => {
    if (webAnimationRef.current) {
      cancelAnimationFrame(webAnimationRef.current);
      webAnimationRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    smoothedLevelRef.current = 0;
    setIsRecording(false);
    setAudioLevel(0);
    setDebugInfo('stopped');
  }, []);

  // Native: start recording with expo-av
  const startNativeRecording = useCallback(async () => {
    if (!hasPermission) {
      setError('No microphone permission');
      return;
    }

    try {
      setError(null);
      setDebugInfo('preparing...');

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();

      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording && status.metering !== undefined) {
          const db = status.metering;
          const noiseGateDb = -42;
          const gatedDb = db > noiseGateDb ? db : -60;

          const normalized = Math.max(0, Math.min(1, (gatedDb + 50) / 40));
          const curved = Math.pow(normalized, 0.5) * 1.0;

          const currentSmoothed = smoothedLevelRef.current;
          const smoothingFactor = curved > currentSmoothed ? 0.08 : 0.03;
          const smoothed = currentSmoothed + (curved - currentSmoothed) * smoothingFactor;
          smoothedLevelRef.current = smoothed;

          const finalLevel = smoothed < 0.01 ? 0 : smoothed;

          setAudioLevel(finalLevel);
          setDebugInfo(`dB:${db.toFixed(0)} lvl:${(finalLevel * 100).toFixed(0)}%`);
        }
      });

      recording.setProgressUpdateInterval(50);

      await recording.prepareToRecordAsync({
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      });

      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setDebugInfo('recording (native)');

    } catch (err: any) {
      setError(`Failed: ${err.message}`);
      setDebugInfo(`error: ${err.message}`);
    }
  }, [hasPermission]);

  // Native: stop recording
  const stopNativeRecording = useCallback(async () => {
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {
        // May already be stopped
      }
      recordingRef.current = null;
    }
    smoothedLevelRef.current = 0;
    setIsRecording(false);
    setAudioLevel(0);
    setDebugInfo('stopped');

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });
    } catch {
      // Ignore
    }
  }, []);

  // Platform-specific start/stop
  const startRecording = useCallback(async () => {
    if (isWeb) {
      await startWebRecording();
    } else {
      await startNativeRecording();
    }
  }, [startWebRecording, startNativeRecording]);

  const stopRecording = useCallback(async () => {
    if (isWeb) {
      await stopWebRecording();
    } else {
      await stopNativeRecording();
    }
  }, [stopWebRecording, stopNativeRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isWeb) {
        if (webAnimationRef.current) {
          cancelAnimationFrame(webAnimationRef.current);
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
        }
      } else {
        if (recordingRef.current) {
          recordingRef.current.stopAndUnloadAsync().catch(() => {});
        }
      }
    };
  }, []);

  return {
    audioLevel,
    isRecording,
    hasPermission,
    startRecording,
    stopRecording,
    error,
    debugInfo,
  };
}
```

### Key Audio Processing Concepts

1. **Noise Gate**: Auto-calibrates background noise during first 500ms. Subtracts noise floor from readings so ambient sound = 0.

2. **Smoothing**: Uses exponential moving average with asymmetric attack/release:
   - Attack (0.08): Responds to voice within ~200ms
   - Release (0.03): Fades out over ~500ms
   - Prevents strobe effects, creates organic "breathing" motion

3. **Web vs Native**:
   - Web uses Web Audio API with AnalyserNode (FFT frequency data)
   - Native uses expo-av Recording with metering (dB levels)

---

## File 2: components/ReactiveOrb.tsx

The WebGL shader component that renders the orb.

```typescript
import React, { useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';

export type OrbState = 'idle' | 'user' | 'ai';
export type OrbStyle = 'default' | 'siri';

interface ReactiveOrbProps {
  audioLevel: number;      // 0-1
  state: OrbState;         // Current conversation state
  style?: OrbStyle;        // Visual style
  size?: number;           // Size in pixels (if not fullscreen)
  fullscreen?: boolean;    // Cover entire container
  zoom?: number;           // 0.3-3.0, default 1.0
  wobble?: number;         // 0-1, edge distortion amount
}

const vertexShaderSource = `
attribute vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Default shader: 3D sphere with flowing ribbons
const fragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_audioLevel;
uniform float u_state;
uniform float u_zoom;
uniform float u_wobble;

#define PI 3.14159265359

float tanh_approx(float x) {
  float x2 = x * x;
  return x * (27.0 + x2) / (27.0 + 9.0 * x2);
}

vec3 tanh3(vec3 x) {
  return vec3(tanh_approx(x.x), tanh_approx(x.y), tanh_approx(x.z));
}

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

// State colors: idle=0, user=1, ai=2
vec3 getBaseColor(float state) {
  vec3 idle = vec3(0.4, 0.3, 0.9);  // Violet
  vec3 user = vec3(0.2, 0.8, 0.9);  // Cyan
  vec3 ai = vec3(0.9, 0.3, 0.6);    // Magenta

  if (state < 1.0) {
    return mix(idle, user, state);
  } else {
    return mix(user, ai, state - 1.0);
  }
}

vec3 getAccentColor(float state) {
  vec3 idle = vec3(0.2, 0.2, 0.6);
  vec3 user = vec3(0.1, 0.6, 0.5);
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

  float baseR = 0.5;

  // Audio-reactive edge wobble
  float wob = 0.0;
  if (audio > 0.01) {
    wob += sin(angle * 3.0 + t * 2.0) * 0.08;
    wob += sin(angle * 5.0 - t * 2.5) * 0.05;
    wob += sin(angle * 7.0 + t * 1.8) * 0.04;
    wob += sin(angle * 2.0 - t * 3.0) * 0.06;
    wob *= u_wobble * audio;
  }

  float R = baseR + wob;
  vec3 col = vec3(0.0);
  float sphereDist = dist / R;

  if (dist < baseR * 2.0) {
    if (sphereDist < 1.0) {
      // 3D sphere geometry
      float z = sqrt(max(0.0, 1.0 - sphereDist * sphereDist));
      vec3 normal = normalize(vec3(uv / R, z));

      // Lighting
      vec3 lightDir = normalize(vec3(0.4, 0.5, 0.8));
      vec3 viewDir = vec3(0.0, 0.0, 1.0);
      float diffuse = max(0.0, dot(normal, lightDir)) * 0.4 + 0.6;

      // Specular
      vec3 halfDir = normalize(lightDir + viewDir);
      float spec = pow(max(0.0, dot(normal, halfDir)), 50.0);
      vec3 lightDir2 = normalize(vec3(-0.3, 0.4, 0.6));
      vec3 halfDir2 = normalize(lightDir2 + viewDir);
      float spec2 = pow(max(0.0, dot(normal, halfDir2)), 25.0);

      // Fresnel rim
      float fresnel = pow(1.0 - z, 2.5);

      // Flowing patterns
      vec3 pos3D = normal;
      float rot1 = t * 0.25;
      float rot2 = t * 0.18;
      pos3D.xy = mat2(cos(rot1), -sin(rot1), sin(rot1), cos(rot1)) * pos3D.xy;
      pos3D.yz = mat2(cos(rot2), -sin(rot2), sin(rot2), cos(rot2)) * pos3D.yz;

      float ribbons = 0.0;
      ribbons += sin(pos3D.y * 6.0 + pos3D.x * 2.0 + t * 0.8) * 0.5 + 0.5;
      ribbons += sin(pos3D.y * 4.0 - pos3D.z * 3.0 + t * 0.6) * 0.3 + 0.3;
      float diag1 = sin((pos3D.x + pos3D.y) * 5.0 + t * 0.7) * 0.5 + 0.5;
      float diag2 = sin((pos3D.x - pos3D.z) * 4.0 - t * 0.5) * 0.5 + 0.5;
      ribbons += diag1 * 0.4 + diag2 * 0.3;
      float circular = sin(pos3D.z * 8.0 + angle * 2.0 + t * 0.9) * 0.5 + 0.5;
      ribbons += circular * 0.3;
      ribbons = ribbons / 2.5;

      float variation = smoothNoise(pos3D.xy * 3.0 + t * 0.2) * 0.3;
      ribbons = ribbons * (0.7 + variation);

      float edgePulse = (1.0 - z) * sin(angle * 6.0 + t * 5.0) * audio;
      float audioEnergy = fresnel * audio * 1.5 + edgePulse * 0.5;

      float pattern = ribbons * 0.7 + 0.3 + audioEnergy * 0.3;

      vec3 baseCol = getBaseColor(u_state);
      vec3 accentCol = getAccentColor(u_state);

      float colorMix = ribbons * 0.5 + circular * 0.3 + fresnel * 0.2;
      vec3 energyColor = mix(baseCol, accentCol, colorMix);
      energyColor = mix(energyColor, baseCol * 1.3 + 0.2, pattern * 0.2);

      col = energyColor * pattern * diffuse;
      col *= 0.8 + audio * 0.6;
      col += vec3(1.0) * spec * 0.5;
      col += vec3(0.85, 0.9, 1.0) * spec2 * 0.25;

      float rimStrength = 0.35 + audio * 0.3;
      col += baseCol * fresnel * rimStrength;
      col += vec3(1.0) * fresnel * 0.12;
      col += accentCol * audioEnergy * 0.4;
      col += baseCol * 0.1 * (0.5 + audio * 0.3);
    }

    // Outer glow
    if (sphereDist >= 1.0 && sphereDist < 1.5) {
      float glowDist = sphereDist - 1.0;
      float glowWobble = sin(angle * 4.0 + t * 3.0) * audio * 0.1;
      float glow = exp(-(glowDist - glowWobble) * 8.0);
      glow *= 0.5 + audio * 0.5;

      vec3 glowCol = getBaseColor(u_state);
      col += glowCol * glow * 0.5;

      float glow2 = exp(-(glowDist) * 5.0) * audio;
      col += getAccentColor(u_state) * glow2 * 0.3;
    }
  }

  col = tanh3(col * 1.1);
  gl_FragColor = vec4(col, 1.0);
}
`;

// Siri-style shader: flowing ribbon orb
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

vec3 getColorPhase(float state, float audio) {
  vec3 idle = vec3(3.5, 3.8, 4.2);  // Grey-blue
  vec3 user = vec3(2.5, 3.5, 5.0);  // Cyan/teal
  vec3 ai = vec3(5.5, 1.0, 3.0);    // Magenta/coral

  if (state < 1.0) {
    return mix(idle, user, state);
  } else {
    return mix(user, ai, state - 1.0);
  }
}

float getSaturation(float state, float audio) {
  float baseSat = state < 0.5 ? 0.3 : 0.8;
  return baseSat + audio * 0.5;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv /= u_zoom;

  float audio = u_audioLevel;

  // Audio-reactive speed
  float baseSpeed = 0.1;
  float audioSpeed = audio * 1.5;
  float speed = baseSpeed + audioSpeed;
  float t = u_time * speed;

  vec4 col = vec4(0.0);
  vec3 colorPhase = getColorPhase(u_state, audio);
  float saturation = getSaturation(u_state, audio);

  // Raymarching
  float z = 0.0;
  for (float i = 0.0; i < 120.0; i++) {
    if (z + i > 200.0) break;

    vec3 p = z * normalize(vec3(uv, -1.0));
    p.z += 9.0;

    float s = 0.0;
    vec3 a = normalize(cos(vec3(0.0, 2.0, 4.0) - t * 0.5 + s * 0.3));

    float dotAP = dot(a, p);
    vec3 projected = dotAP * a;
    vec3 crossed = cross(a, p);
    p = projected - crossed;
    s = length(p);

    a = normalize(cos(colorPhase * 0.5 - t * 0.5 + s * 0.3));
    dotAP = dot(a, p);
    projected = dotAP * a;
    crossed = cross(a, p);
    p = projected - crossed;
    s = length(p);

    vec3 sinP = sin(p);
    float d1 = abs(dot(p, sinP.yzx)) * 0.2;
    float d2 = s - 5.0;
    d2 = max(d2, 0.1);
    float d3 = abs(d2 - 1.0) + 0.2;
    float d = min(d1 + d2, d3) * 0.2;

    float colorWave = p.x * 0.4 + t * 0.3;
    float brightness = 0.6 + audio * 1.5;

    vec3 rawCol = vec3(
      cos(colorWave + colorPhase.x) + 1.0,
      cos(colorWave + colorPhase.y) + 1.0,
      cos(colorWave + colorPhase.z) + 1.0
    );

    vec3 grey = vec3(dot(rawCol, vec3(0.299, 0.587, 0.114)));
    rawCol = mix(grey, rawCol, saturation);

    vec4 sampleCol = vec4(rawCol * brightness, 1.0);

    float innerGlow = 5.0 / (s * s + 0.1);
    sampleCol.rgb += vec3(innerGlow) * 0.2;

    float contribution = 1.0 / (d * d + 0.001);
    col += max(sampleCol, vec4(innerGlow * 0.3)) * contribution * 0.00003;

    z += d;
  }

  float dist = length(uv);
  float sphereMask = smoothstep(1.2, 0.3, dist);
  col.rgb *= sphereMask;

  vec3 glowCol = vec3(
    cos(colorPhase.x) * 0.5 + 0.5,
    cos(colorPhase.y) * 0.5 + 0.5,
    cos(colorPhase.z) * 0.5 + 0.5
  );
  vec3 greyGlow = vec3(dot(glowCol, vec3(0.299, 0.587, 0.114)));
  glowCol = mix(greyGlow, glowCol, saturation);

  float glow = exp(-dist * 2.0) * (0.15 + audio * 0.4);
  col.rgb += glowCol * glow * 0.3;

  col.rgb = tanh3(col.rgb * 0.8);

  float idleDarken = 1.0 - (1.0 - u_state) * (1.0 - audio) * 0.2;
  col.rgb *= idleDarken;

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

  // Use refs for values that change frequently (avoids re-creating GL context)
  const audioLevelRef = useRef(audioLevel);
  const zoomRef = useRef(zoom);
  const wobbleRef = useRef(wobble);
  const targetStateRef = useRef(0);
  const currentStateRef = useRef(0);

  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { wobbleRef.current = wobble; }, [wobble]);
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

      // Smooth state transitions
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
```

---

## Integration Example

### Basic Usage

```tsx
import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { ReactiveOrb, OrbState } from './components/ReactiveOrb';
import { useAudioLevel } from './hooks/useAudioLevel';

function VoiceInterface() {
  const [state, setState] = useState<OrbState>('idle');
  const { audioLevel, startRecording, stopRecording } = useAudioLevel();

  // Start listening when component mounts
  useEffect(() => {
    startRecording();
    return () => stopRecording();
  }, []);

  // In your AI logic, update state based on who's speaking:
  // setState('user')  - when user is speaking
  // setState('ai')    - when AI is responding
  // setState('idle')  - when neither is speaking

  return (
    <View style={styles.container}>
      <ReactiveOrb
        audioLevel={audioLevel}
        state={state}
        style="siri"        // or "default"
        fullscreen
        zoom={1.0}
        wobble={0.3}
      />
      {/* Your UI overlay goes here */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
```

### Integration with AI Voice SDK

```tsx
// Example with a voice AI SDK
import { useVoiceAI } from 'your-voice-ai-sdk';

function AIVoiceInterface() {
  const { audioLevel, startRecording, stopRecording } = useAudioLevel();
  const { aiState, startConversation } = useVoiceAI();

  // Map AI SDK state to orb state
  const orbState: OrbState =
    aiState === 'listening' ? 'user' :
    aiState === 'speaking' ? 'ai' :
    'idle';

  // For AI speaking, you might want to use the AI's audio level
  // instead of the mic level
  const displayLevel = orbState === 'ai' ? aiAudioLevel : audioLevel;

  return (
    <ReactiveOrb
      audioLevel={displayLevel}
      state={orbState}
      style="siri"
      fullscreen
    />
  );
}
```

---

## Customization

### State Colors

Edit the `getBaseColor` and `getAccentColor` functions in the shader to change colors:

```glsl
vec3 getBaseColor(float state) {
  vec3 idle = vec3(0.4, 0.3, 0.9);  // RGB, 0-1 range
  vec3 user = vec3(0.2, 0.8, 0.9);
  vec3 ai = vec3(0.9, 0.3, 0.6);
  // ...
}
```

### Audio Sensitivity

In `useAudioLevel.ts`, adjust these values:

```typescript
// Smoothing factors (lower = smoother, slower response)
const smoothingFactor = clampedLevel > currentSmoothed ? 0.08 : 0.03;

// Gain (higher = more sensitive)
const curved = Math.pow(gated, 0.5) * 1.0;  // Change 1.0 to adjust
```

### Animation Speed

In the shader, modify time multipliers:

```glsl
float rot1 = t * 0.25;  // Rotation speed
float rot2 = t * 0.18;
// Lower values = slower animation
```

---

## Performance Notes

- Target 60fps on mid-range devices
- The Siri shader is more GPU-intensive (raymarching with 120 iterations)
- Reduce iterations in the Siri shader for better performance on low-end devices
- The default shader is lighter and better for always-on displays

## Troubleshooting

**Audio not working on web:**
- Ensure HTTPS (except localhost)
- Check browser permissions
- Look at debugInfo for error messages

**Shader compilation errors:**
- expo-gl uses GLSL ES 2.0, not 3.0
- Use `gl_FragColor` not `out vec4`
- No `tanh()` built-in, use the approximation provided

**Low FPS:**
- Reduce shader complexity
- Lower the raymarching iterations
- Check for memory leaks in audio processing
