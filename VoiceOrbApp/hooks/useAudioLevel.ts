import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';

interface UseAudioLevelResult {
  audioLevel: number;
  isRecording: boolean;
  hasPermission: boolean | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  error: string | null;
  debugInfo: string;
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
  const noiseFloorRef = useRef(0.05); // Will calibrate on start

  // Native refs
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Request permissions on mount
  useEffect(() => {
    if (isWeb) {
      // Web: check mic permission
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
      // Native: request expo-av permission
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
          noiseFloorRef.current = Math.max(...calibrationSamples) * 1.2; // 20% above max noise
          setDebugInfo(`calibrating... ${calibrationSamples.length}`);
          webAnimationRef.current = requestAnimationFrame(updateLevel);
          return;
        }

        // Noise gate: subtract noise floor and rescale
        const noiseFloor = noiseFloorRef.current;
        const gated = Math.max(0, rawNormalized - noiseFloor) / (1 - noiseFloor);

        // Apply curve for more natural response
        const curved = Math.pow(gated, 0.7) * 2.0;
        const clampedLevel = Math.min(1, curved);

        // Smoothing: interpolate towards target
        // Fast attack (0.3), slower release (0.08)
        const currentSmoothed = smoothedLevelRef.current;
        const smoothingFactor = clampedLevel > currentSmoothed ? 0.3 : 0.08;
        const smoothed = currentSmoothed + (clampedLevel - currentSmoothed) * smoothingFactor;
        smoothedLevelRef.current = smoothed;

        // If very low, snap to zero to avoid jitter
        const finalLevel = smoothed < 0.02 ? 0 : smoothed;

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
          // Noise gate: -45dB threshold (quiet room is around -50 to -40)
          const noiseGateDb = -42;
          const gatedDb = db > noiseGateDb ? db : -60;

          const normalized = Math.max(0, Math.min(1, (gatedDb + 50) / 40));
          const curved = Math.pow(normalized, 0.6);

          // Smoothing: fast attack, slow release
          const currentSmoothed = smoothedLevelRef.current;
          const smoothingFactor = curved > currentSmoothed ? 0.3 : 0.08;
          const smoothed = currentSmoothed + (curved - currentSmoothed) * smoothingFactor;
          smoothedLevelRef.current = smoothed;

          // Snap to zero if very low
          const finalLevel = smoothed < 0.02 ? 0 : smoothed;

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
