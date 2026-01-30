import { useState, useEffect, useCallback, useRef } from 'react';
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

export function useAudioLevel(): UseAudioLevelResult {
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState('init');

  const recordingRef = useRef<Audio.Recording | null>(null);

  // Request permissions on mount
  useEffect(() => {
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
  }, []);

  const startRecording = useCallback(async () => {
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

      // Set up status callback BEFORE preparing
      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording && status.metering !== undefined) {
          const db = status.metering;
          // Map -50dB to -5dB -> 0 to 1
          const normalized = Math.max(0, Math.min(1, (db + 50) / 45));
          const smoothed = Math.pow(normalized, 0.6);
          setAudioLevel(smoothed);
          setDebugInfo(`dB:${db.toFixed(0)} lvl:${(smoothed * 100).toFixed(0)}%`);
        }
      });

      // Set faster update interval
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
      setDebugInfo('recording...');

    } catch (err: any) {
      setError(`Failed: ${err.message}`);
      setDebugInfo(`error: ${err.message}`);
      console.error('Recording error:', err);
    }
  }, [hasPermission]);

  const stopRecording = useCallback(async () => {
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {
        // May already be stopped
      }
      recordingRef.current = null;
    }
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
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
